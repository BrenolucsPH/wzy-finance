ALTER TABLE records ADD COLUMN IF NOT EXISTS amount_cents bigint GENERATED ALWAYS AS ((payload::jsonb->>'amount')::bigint) STORED;
ALTER TABLE records ADD COLUMN IF NOT EXISTS record_date text GENERATED ALWAYS AS (payload::jsonb->>'date') STORED;
ALTER TABLE records ADD COLUMN IF NOT EXISTS record_type text GENERATED ALWAYS AS (payload::jsonb->>'type') STORED;
ALTER TABLE records ADD COLUMN IF NOT EXISTS record_status text GENERATED ALWAYS AS (payload::jsonb->>'status') STORED;
ALTER TABLE records ADD COLUMN IF NOT EXISTS category text GENERATED ALWAYS AS (payload::jsonb->>'category') STORED;
ALTER TABLE records ADD COLUMN IF NOT EXISTS currency text GENERATED ALWAYS AS (COALESCE(payload::jsonb->>'currency','BRL')) STORED;
CREATE INDEX IF NOT EXISTS records_owner_date ON records(user_id,record_date DESC,id) WHERE kind='transaction';
CREATE INDEX IF NOT EXISTS records_owner_account_date ON records(user_id,account_id,record_date DESC,id) WHERE kind='transaction';
CREATE INDEX IF NOT EXISTS records_owner_category_date ON records(user_id,category,record_date DESC) WHERE kind='transaction';
CREATE UNIQUE INDEX IF NOT EXISTS records_id_owner ON records(id,user_id);

CREATE TABLE IF NOT EXISTS financial_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 record_id text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('baseline','create','update','delete')),
 before_payload jsonb,
 after_payload jsonb,
 created bigint NOT NULL,
 request_id text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS financial_revisions_owner_record ON financial_revisions(user_id,record_id,id DESC);
INSERT INTO financial_revisions(user_id,record_id,operation,after_payload,created)
SELECT r.user_id,r.id,'baseline',r.payload::jsonb,r.updated FROM records r
WHERE NOT EXISTS(SELECT 1 FROM financial_revisions h WHERE h.record_id=r.id AND h.user_id=r.user_id);

CREATE OR REPLACE FUNCTION wzy_record_revision() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO financial_revisions(user_id,record_id,operation,after_payload,created,request_id)
  VALUES(NEW.user_id,NEW.id,'create',NEW.payload::jsonb,NEW.updated,COALESCE(current_setting('wzy.request_id',true),''));
 ELSIF TG_OP='UPDATE' AND OLD.payload IS DISTINCT FROM NEW.payload THEN
  INSERT INTO financial_revisions(user_id,record_id,operation,before_payload,after_payload,created,request_id)
  VALUES(NEW.user_id,NEW.id,'update',OLD.payload::jsonb,NEW.payload::jsonb,NEW.updated,COALESCE(current_setting('wzy.request_id',true),''));
 ELSIF TG_OP='DELETE' THEN
  INSERT INTO financial_revisions(user_id,record_id,operation,before_payload,created,request_id)
  VALUES(OLD.user_id,OLD.id,'delete',OLD.payload::jsonb,(extract(epoch FROM clock_timestamp())*1000)::bigint,COALESCE(current_setting('wzy.request_id',true),''));
 END IF;
 RETURN NULL;
END
$function$;
CREATE OR REPLACE TRIGGER records_revision AFTER INSERT OR UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION wzy_record_revision();

CREATE TABLE IF NOT EXISTS financial_categories (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,color text NOT NULL DEFAULT '#357c67',parent_id text,
 category_type text NOT NULL DEFAULT 'expense' CHECK(category_type IN ('expense','income','both')),
 archived boolean NOT NULL DEFAULT false,created bigint NOT NULL,
 UNIQUE(user_id,name),UNIQUE(id,user_id),FOREIGN KEY(parent_id,user_id) REFERENCES financial_categories(id,user_id)
);
CREATE TABLE IF NOT EXISTS classification_rules (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 term text NOT NULL,category text NOT NULL,subcategory text NOT NULL DEFAULT '',priority integer NOT NULL DEFAULT 0,created bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_cycles (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 card_id text NOT NULL,cycle text NOT NULL,closing_date text NOT NULL,due_date text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),created bigint NOT NULL,
 UNIQUE(user_id,card_id,cycle),FOREIGN KEY(card_id,user_id) REFERENCES records(id,user_id)
);
CREATE TABLE IF NOT EXISTS investment_positions (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id text NOT NULL,symbol text NOT NULL,name text NOT NULL,
 asset_type text NOT NULL,currency text NOT NULL DEFAULT 'BRL',created bigint NOT NULL,
 UNIQUE(user_id,account_id,symbol),FOREIGN KEY(account_id,user_id) REFERENCES records(id,user_id)
);
CREATE TABLE IF NOT EXISTS investment_operations (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 position_id text NOT NULL REFERENCES investment_positions(id),
 operation text NOT NULL CHECK(operation IN ('buy','sell','income','quote','reverse')),
 quantity numeric(24,8) NOT NULL DEFAULT 0,price_cents bigint NOT NULL,fees_cents bigint NOT NULL DEFAULT 0,
 date text NOT NULL,created bigint NOT NULL,request_id text NOT NULL,reversal_of text REFERENCES investment_operations(id),reason text NOT NULL DEFAULT '',UNIQUE(user_id,request_id)
);
CREATE INDEX IF NOT EXISTS investment_operations_position ON investment_operations(user_id,position_id,date,created);
CREATE TABLE IF NOT EXISTS collaboration_members (
 id text PRIMARY KEY,owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 group_id text NOT NULL REFERENCES records(id),member_user_id text REFERENCES users(id),
 email text NOT NULL,member_name text NOT NULL,role text NOT NULL CHECK(role IN ('viewer','editor')),
 weight integer NOT NULL DEFAULT 1 CHECK(weight>0),status text NOT NULL CHECK(status IN ('pending','accepted','revoked')),
 token_hash text NOT NULL UNIQUE,expires bigint NOT NULL,created bigint NOT NULL,UNIQUE(owner_id,group_id,email)
);
CREATE TABLE IF NOT EXISTS operations_runs (
 id text PRIMARY KEY,day text NOT NULL UNIQUE,cursor text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'pending',
 processed integer NOT NULL DEFAULT 0,failed integer NOT NULL DEFAULT 0,updated bigint NOT NULL,lease_until bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS backup_archives (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day text NOT NULL,pathname text NOT NULL,digest text NOT NULL,size bigint NOT NULL,created bigint NOT NULL,UNIQUE(user_id,day)
);
CREATE TABLE IF NOT EXISTS operation_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,created bigint NOT NULL,
 request_id text NOT NULL,route text NOT NULL,status integer NOT NULL,duration_ms integer NOT NULL,
 code text NOT NULL DEFAULT '',user_id text REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS operation_events_created ON operation_events(created DESC);
CREATE TABLE IF NOT EXISTS product_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event text NOT NULL CHECK(event IN ('first_account','first_transaction','visit','onboarding_finished')),
 day text NOT NULL,created bigint NOT NULL,UNIQUE(user_id,event,day)
);

ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS records_owner_policy ON records;
CREATE POLICY records_owner_policy ON records USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='records'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='records'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');
ALTER TABLE financial_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_revisions_owner_policy ON financial_revisions USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='financial_revisions'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='financial_revisions'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

-- Compatibility policy permits rollback to the previous release; new runtime queries always enforce an owner context.

ALTER TABLE records ADD COLUMN IF NOT EXISTS analysis_type text GENERATED ALWAYS AS (CASE WHEN payload::jsonb->>'financialActivity'='investment_principal' THEN 'capital' WHEN payload::jsonb->>'financialActivity'='investment_income' AND payload::jsonb->>'adjustmentReason' IS NOT NULL AND (payload::jsonb->>'type')='expense' THEN 'income' WHEN payload::jsonb->>'adjustmentReason' IS NOT NULL AND (payload::jsonb->>'type')='income' THEN 'expense' ELSE (payload::jsonb->>'type') END) STORED;
ALTER TABLE records ADD COLUMN IF NOT EXISTS analysis_amount_cents bigint GENERATED ALWAYS AS (CASE WHEN payload::jsonb->>'adjustmentReason' IS NOT NULL AND ((payload::jsonb->>'type')='income' OR (payload::jsonb->>'financialActivity'='investment_income' AND (payload::jsonb->>'type')='expense')) THEN -((payload::jsonb->>'amount')::bigint) ELSE ((payload::jsonb->>'amount')::bigint) END) STORED;

CREATE TABLE IF NOT EXISTS restore_uploads(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,pathname text NOT NULL,size bigint NOT NULL,created bigint NOT NULL,expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS restore_plans(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload text NOT NULL,digest text NOT NULL,status text NOT NULL DEFAULT 'preview',created bigint NOT NULL,expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS maintenance_tasks(day text NOT NULL,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,last_error text NOT NULL DEFAULT '',updated bigint NOT NULL,PRIMARY KEY(day,user_id));

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY files_owner ON files USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='files'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='files'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY uploads_owner ON uploads USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='uploads'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='uploads'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY user_preferences_owner ON user_preferences USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='user_preferences'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='user_preferences'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE financial_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_categories_owner ON financial_categories USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='financial_categories'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='financial_categories'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE classification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY classification_rules_owner ON classification_rules USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='classification_rules'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='classification_rules'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE invoice_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_cycles FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_cycles_owner ON invoice_cycles USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='invoice_cycles'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='invoice_cycles'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE investment_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_positions FORCE ROW LEVEL SECURITY;
CREATE POLICY investment_positions_owner ON investment_positions USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='investment_positions'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='investment_positions'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE investment_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY investment_operations_owner ON investment_operations USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='investment_operations'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='investment_operations'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE financial_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_backups FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_backups_owner ON financial_backups USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='financial_backups'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='financial_backups'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE backup_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_archives FORCE ROW LEVEL SECURITY;
CREATE POLICY backup_archives_owner ON backup_archives USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='backup_archives'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='backup_archives'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE restore_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE restore_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY restore_uploads_owner ON restore_uploads USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='restore_uploads'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='restore_uploads'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

ALTER TABLE restore_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE restore_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY restore_plans_owner ON restore_plans USING((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='restore_plans'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1') WITH CHECK((current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='restore_plans'::regclass)) AND current_setting('wzy.enforce_context',true) IS DISTINCT FROM '1') OR user_id=current_setting('wzy.user_id',true) OR current_setting('wzy.system',true)='1');

CREATE UNIQUE INDEX IF NOT EXISTS files_id_owner ON files(id,user_id);
ALTER TABLE records ADD CONSTRAINT records_account_owner FOREIGN KEY(account_id,user_id) REFERENCES records(id,user_id) NOT VALID;
ALTER TABLE records ADD CONSTRAINT records_target_owner FOREIGN KEY(target_id,user_id) REFERENCES records(id,user_id) NOT VALID;
ALTER TABLE records ADD CONSTRAINT records_source_owner FOREIGN KEY(source_id,user_id) REFERENCES records(id,user_id) NOT VALID;
ALTER TABLE records ADD CONSTRAINT records_attachment_owner FOREIGN KEY(attachment_id,user_id) REFERENCES files(id,user_id) NOT VALID;
ALTER TABLE records VALIDATE CONSTRAINT records_account_owner;
ALTER TABLE records VALIDATE CONSTRAINT records_target_owner;
ALTER TABLE records VALIDATE CONSTRAINT records_source_owner;
ALTER TABLE records VALIDATE CONSTRAINT records_attachment_owner;
ALTER TABLE records ADD CONSTRAINT records_payload_identity CHECK(payload::jsonb->>'id'=id AND payload::jsonb->>'kind'=kind AND amount_cents>=0) NOT VALID;
ALTER TABLE records VALIDATE CONSTRAINT records_payload_identity;
