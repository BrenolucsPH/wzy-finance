-- Financial corrections append records. Metadata such as category can still be renamed.
CREATE OR REPLACE FUNCTION protect_financial_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; upcoming jsonb; immutable_keys text[] := ARRAY['amount','type','status','date','accountId','targetId','invoiceCycle','invoicePaymentCycle','financialActivity','investmentPosition','reversalOf','adjustmentReason','originalAmount','targetAmount','sourceId'];
BEGIN
 IF TG_OP <> 'INSERT' THEN
  previous := OLD.payload::jsonb;
  IF TG_OP='DELETE' AND (previous ? 'financialActivity' OR previous ? 'adjustmentReason' OR previous ? 'invoicePaymentCycle' OR previous ? 'sourceId') THEN
   RAISE EXCEPTION 'MANAGED_MOVEMENT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
   upcoming:=NEW.payload::jsonb;
   IF (previous ? 'financialActivity' OR previous ? 'adjustmentReason' OR previous ? 'invoicePaymentCycle' OR previous ? 'sourceId') AND
    EXISTS(SELECT 1 FROM unnest(immutable_keys) k WHERE previous->k IS DISTINCT FROM upcoming->k) THEN
    RAISE EXCEPTION 'MANAGED_MOVEMENT_IMMUTABLE' USING ERRCODE='23514';
   END IF;
  END IF;
  IF previous ? 'invoiceCycle' AND EXISTS(SELECT 1 FROM invoice_cycles WHERE user_id=OLD.user_id AND card_id=OLD.account_id AND cycle=previous->>'invoiceCycle' AND status='closed') AND
   (TG_OP='DELETE' OR EXISTS(SELECT 1 FROM unnest(immutable_keys) k WHERE previous->k IS DISTINCT FROM upcoming->k)) THEN
   RAISE EXCEPTION 'CLOSED_INVOICE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  upcoming:=NEW.payload::jsonb;
  IF upcoming ? 'invoiceCycle' AND NOT upcoming ? 'adjustmentReason' AND EXISTS(SELECT 1 FROM invoice_cycles WHERE user_id=NEW.user_id AND card_id=NEW.account_id AND cycle=upcoming->>'invoiceCycle' AND status='closed') THEN
   RAISE EXCEPTION 'CLOSED_INVOICE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER records_protect_movements BEFORE INSERT OR UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION protect_financial_movement();
