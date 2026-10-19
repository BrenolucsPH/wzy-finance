import { z } from "zod";
import { db, type User } from "../../server";
import { transaction } from "../../postgres";
import { sealBackup, openBackup } from "../../vault-crypto";
import { restoreRecords, type RestoreData } from "../../domain/restore";
import {
  parse,
  id,
  date,
  month,
  InputError,
  lockOwner,
} from "../workspace/common";
import { entrySchema } from "../../validation";
export async function previewRestore(
  owner: string,
  source: RestoreData,
  bindings: Record<string, string>,
) {
  const priorFiles = await db()
    .prepare("SELECT id FROM files WHERE user_id=? AND id=ANY(?::text[])")
    .bind(
      owner,
      (source.files || []).map((f) => f.id),
    )
    .all<{ id: string }>();
  bindings = {
    ...Object.fromEntries(priorFiles.results.map((f) => [f.id, f.id])),
    ...bindings,
  };
  const attachmentIds = Object.values(bindings);
  const owned = await db()
    .prepare("SELECT id FROM files WHERE user_id=? AND id=ANY(?::text[])")
    .bind(owner, attachmentIds)
    .all<{ id: string }>();
  if (owned.results.length !== new Set(attachmentIds).size)
    throw new InputError("Comprovante não pertence à sua conta.", 403);
  let normalized: ReturnType<typeof restoreRecords>;
  try {
    normalized = restoreRecords(source, bindings);
  } catch (e) {
    throw new InputError((e as Error).message);
  }
  const planId = crypto.randomUUID(),
    data = { source, normalized },
    payload = await sealBackup(data),
    fingerprint = await import("node:crypto").then((c) =>
      c.createHash("sha256").update(JSON.stringify(source)).digest("hex"),
    );
  const duplicate = await db()
    .prepare(
      "SELECT id FROM restore_plans WHERE user_id=? AND digest=? AND status=?",
    )
    .bind(owner, fingerprint, "completed")
    .first();
  if (duplicate)
    throw new InputError("Esta exportação já foi restaurada nesta conta.", 409);
  await db()
    .prepare(
      "INSERT INTO restore_plans(id,user_id,payload,digest,status,created,expires) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      planId,
      owner,
      payload,
      fingerprint,
      "preview",
      Date.now(),
      Date.now() + 3600000,
    )
    .run();
  const kinds: Record<string, number> = {};
  for (const e of normalized.entries) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  return {
    planId,
    counts: kinds,
    records: normalized.entries.length,
    attachments: attachmentIds.length,
    positions: source.positions?.length || 0,
    revisions: source.revisions?.length || 0,
    mode: "append",
    message:
      "Os registros atuais serão preservados. Novos identificadores evitam colisões. Convites e acessos compartilhados precisam ser recriados.",
  };
}
export async function commitRestore(user: User, body: unknown) {
  const b = parse(z.object({ planId: id, confirm: z.literal(true) }), body);
  return transaction(async (client) => {
    await lockOwner(client, user.id);
    const found = await client.query(
      "SELECT * FROM restore_plans WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [b.planId, user.id],
    );
    const plan = found.rows[0];
    if (!plan) throw new InputError("Prévia não encontrada.", 404);
    if (plan.status === "completed") return { ok: true, replayed: true };
    if (Number(plan.expires) < Date.now())
      throw new InputError("A prévia expirou. Gere outra.", 409);
    const data = (await openBackup(plan.payload)) as {
        source: RestoreData;
        normalized: ReturnType<typeof restoreRecords>;
      },
      source = data.source,
      normalized = data.normalized,
      now = Date.now();
    const entries = normalized.entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      payload: JSON.stringify(entrySchema.parse(e)),
      account_id: e.accountId || null,
      target_id: e.targetId || null,
      source_id: e.sourceId || null,
      attachment_id: e.attachmentId || null,
    }));
    if (entries.length)
      await client.query(
        "INSERT INTO records(id,user_id,kind,payload,updated,account_id,target_id,source_id,attachment_id) SELECT e.id,$1,e.kind,e.payload,$2,e.account_id,e.target_id,e.source_id,e.attachment_id FROM jsonb_to_recordset($3::jsonb) AS e(id text,kind text,payload text,account_id text,target_id text,source_id text,attachment_id text)",
        [user.id, now, JSON.stringify(entries)],
      );
    const presentCategories = (
      await client.query(
        "SELECT id,name FROM financial_categories WHERE user_id=$1",
        [user.id],
      )
    ).rows;
    const categoryIds = new Map(
      (source.categories || []).map((c) => [
        String(c.id),
        presentCategories.find((p) => p.name === c.name)?.id ||
          crypto.randomUUID(),
      ]),
    );
    for (const c of (source.categories || [])
      .slice()
      .sort((a, b) => Number(!!a.parent_id) - Number(!!b.parent_id))) {
      const name = parse(z.string().trim().min(1).max(100), c.name),
        type = parse(z.enum(["income", "expense", "both"]), c.category_type),
        color = parse(z.string().regex(/^#[a-f\d]{6}$/i), c.color || "#357c67");
      await client.query(
        "INSERT INTO financial_categories(id,user_id,name,color,parent_id,category_type,archived,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,name) DO NOTHING",
        [
          categoryIds.get(String(c.id)),
          user.id,
          name,
          color,
          c.parent_id ? categoryIds.get(String(c.parent_id)) : null,
          type,
          c.archived === true,
          now,
        ],
      );
    }
    for (const rule of source.rules || []) {
      await client.query(
        "INSERT INTO classification_rules(id,user_id,term,category,subcategory,priority,created) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          crypto.randomUUID(),
          user.id,
          parse(z.string().trim().min(2).max(100), rule.term),
          parse(z.string().max(100), rule.category),
          parse(z.string().max(100), rule.subcategory || ""),
          parse(z.number().int().min(0).max(100), Number(rule.priority || 0)),
          now,
        ],
      );
    }
    for (const cycle of source.invoiceCycles || []) {
      const card = normalized.ids[String(cycle.card_id)];
      if (!card) throw new InputError("Fatura sem cartão na exportação.");
      await client.query(
        "INSERT INTO invoice_cycles(id,user_id,card_id,cycle,closing_date,due_date,status,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          crypto.randomUUID(),
          user.id,
          card,
          parse(month, cycle.cycle),
          parse(date, cycle.closing_date),
          parse(date, cycle.due_date),
          parse(z.enum(["open", "closed"]), cycle.status),
          now,
        ],
      );
    }
    for (const position of source.positions || []) {
      const account = normalized.ids[String(position.account_id)];
      if (!account)
        throw new InputError("Investimento sem conta na exportação.");
      await client.query(
        "INSERT INTO investment_positions(id,user_id,account_id,symbol,name,asset_type,currency,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          normalized.positions[String(position.id)],
          user.id,
          account,
          parse(z.string().max(30), position.symbol),
          parse(z.string().max(100), position.name),
          parse(
            z.enum(["stock", "fund", "fixed_income", "crypto", "other"]),
            position.asset_type,
          ),
          parse(
            z.enum(["BRL", "USD", "EUR", "GBP", "CAD", "CHF", "AUD"]),
            position.currency,
          ),
          now,
        ],
      );
    }
    const operationIds = new Map(Object.entries(normalized.operations));
    const operations = (source.investmentOperations || []).map((operation) => {
      const position = normalized.positions[String(operation.position_id)];
      if (!position)
        throw new InputError("Operação sem posição de investimento.");
      return {
        id: operationIds.get(String(operation.id)),
        position_id: position,
        operation: parse(
          z.enum(["buy", "sell", "income", "quote", "reverse"]),
          operation.operation,
        ),
        quantity: parse(
          z.string().regex(/^\d{1,12}(?:\.\d{1,8})?$/),
          String(operation.quantity),
        ),
        price_cents: parse(
          z.number().int().nonnegative().max(99999999999),
          Number(operation.price_cents),
        ),
        fees_cents: parse(
          z.number().int().nonnegative().max(99999999999),
          Number(operation.fees_cents),
        ),
        date: parse(date, operation.date),
        created: parse(
          z.number().int().nonnegative(),
          Number(operation.created),
        ),
        request_id: crypto.randomUUID(),
        reversal_of: operation.reversal_of
          ? operationIds.get(String(operation.reversal_of))
          : null,
        reason: String(operation.reason || "").slice(0, 300),
      };
    });
    // Self-references are checked at statement completion; the whole import remains atomic.
    if (operations.length)
      await client.query(
        "INSERT INTO investment_operations(id,user_id,position_id,operation,quantity,price_cents,fees_cents,date,created,request_id,reversal_of,reason) SELECT o.id,$1,o.position_id,o.operation,o.quantity,o.price_cents,o.fees_cents,o.date,o.created,o.request_id,o.reversal_of,o.reason FROM jsonb_to_recordset($2::jsonb) AS o(id text,position_id text,operation text,quantity numeric,price_cents bigint,fees_cents bigint,date text,created bigint,request_id text,reversal_of text,reason text)",
        [user.id, JSON.stringify(operations)],
      );
    const history = (source.revisions || []).map((revision) => {
      const originalId = String(revision.record_id);
      return {
        record_id:
          normalized.ids[originalId] ||
          ("historical-" + originalId).slice(0, 100),
        operation: parse(
          z.enum(["baseline", "create", "update", "delete"]),
          revision.operation,
        ),
        before_payload: revision.before_payload || null,
        after_payload: revision.after_payload || null,
        created: parse(
          z.number().int().nonnegative(),
          Number(revision.created),
        ),
      };
    });
    // Bound each payload without turning a large history into thousands of network round trips.
    for (let offset = 0; offset < history.length; offset += 500)
      await client.query(
        "INSERT INTO financial_revisions(user_id,record_id,operation,before_payload,after_payload,created,request_id) SELECT $1,h.record_id,h.operation,h.before_payload,h.after_payload,h.created,$2 FROM jsonb_to_recordset($3::jsonb) AS h(record_id text,operation text,before_payload jsonb,after_payload jsonb,created bigint)",
        [
          user.id,
          "restore:" + b.planId,
          JSON.stringify(history.slice(offset, offset + 500)),
        ],
      );
    // Restore presentation choices only; consent and notification authorization are never imported.
    if (source.preferences) {
      const { navigationPreferenceSchema } = await import("../../navigation");
      const candidate = Object.fromEntries(
        Object.entries(source.preferences).filter(([key]) =>
          [
            "overviewWidgets",
            "sidebarOrder",
            "sidebarPinned",
            "guideDismissed",
          ].includes(key),
        ),
      );
      if (!navigationPreferenceSchema.safeParse(candidate).success)
        throw new InputError("Preferências do arquivo inválidas.");
      if (
        candidate.overviewWidgets &&
        (!Array.isArray(candidate.overviewWidgets) ||
          candidate.overviewWidgets.some(
            (v) =>
              ![
                "cash-flow",
                "upcoming",
                "transactions",
                "subscriptions",
              ].includes(String(v)),
          ))
      )
        throw new InputError("Widgets do arquivo inválidos.");
      await client.query(
        "INSERT INTO user_preferences(user_id,payload,updated) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET payload=(excluded.payload::jsonb || user_preferences.payload::jsonb)::text,updated=excluded.updated",
        [user.id, JSON.stringify(candidate), now],
      );
    }
    await client.query(
      "UPDATE restore_plans SET status='completed' WHERE id=$1 AND user_id=$2",
      [b.planId, user.id],
    );
    return { ok: true, records: entries.length };
  });
}
