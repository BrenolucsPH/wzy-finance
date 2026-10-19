import { consistentRead } from "../../postgres";
import { db, type User } from "../../server";
async function snapshotExport(
  user: Pick<User, "id" | "name" | "email" | "timezone">,
) {
  const rows = await db()
    .prepare(
      "SELECT payload,updated FROM records WHERE user_id=? ORDER BY updated",
    )
    .bind(user.id)
    .all<{ payload: string; updated: number }>();
  const [
    files,
    prefs,
    categories,
    rules,
    cycles,
    positions,
    operations,
    history,
    members,
    securityEvents,
  ] = await Promise.all([
    db()
      .prepare("SELECT id,name,type,size,created FROM files WHERE user_id=?")
      .bind(user.id)
      .all(),
    db()
      .prepare("SELECT payload FROM user_preferences WHERE user_id=?")
      .bind(user.id)
      .first<{ payload: string }>(),
    db()
      .prepare("SELECT * FROM financial_categories WHERE user_id=?")
      .bind(user.id)
      .all(),
    db()
      .prepare("SELECT * FROM classification_rules WHERE user_id=?")
      .bind(user.id)
      .all(),
    db()
      .prepare("SELECT * FROM invoice_cycles WHERE user_id=?")
      .bind(user.id)
      .all(),
    db()
      .prepare("SELECT * FROM investment_positions WHERE user_id=?")
      .bind(user.id)
      .all(),
    db()
      .prepare("SELECT * FROM investment_operations WHERE user_id=?")
      .bind(user.id)
      .all(),
    db()
      .prepare(
        "SELECT record_id,operation,before_payload,after_payload,created,request_id FROM financial_revisions WHERE user_id=? ORDER BY id",
      )
      .bind(user.id)
      .all(),
    db()
      .prepare(
        "SELECT group_id,email,member_name,role,weight,status FROM collaboration_members WHERE owner_id=?",
      )
      .bind(user.id)
      .all(),
    db()
      .prepare(
        "SELECT kind,created,device,browser,os,ip,city,region,country FROM security_events WHERE user_id=? ORDER BY created",
      )
      .bind(user.id)
      .all(),
  ]);
  return {
    format: "wzy-export-v3",
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
    },
    entries: rows.results.map((r) => ({
      ...JSON.parse(r.payload),
      _version: r.updated,
    })),
    files: files.results,
    preferences: prefs ? JSON.parse(prefs.payload) : {},
    categories: categories.results,
    rules: rules.results,
    invoiceCycles: cycles.results,
    positions: positions.results,
    investmentOperations: operations.results,
    revisions: history.results,
    groupInvitations: members.results,
    securityEvents: securityEvents.results,
    attachmentDownload: "/api/files/{id}",
  };
}

export async function financialExport(
  user: Pick<User, "id" | "name" | "email" | "timezone">,
) {
  return consistentRead(() => snapshotExport(user));
}
