import { consistentRead } from "../../postgres";
import { quote } from "../../fx";
import { cardInvoices } from "../workspace/invoices";
import { assertCents } from "../../finance";
import { ownedEntry, InputError } from "../workspace/common";
import { db } from "../../server";
import { localDate, type Entry } from "../../finance";
import { dateShift, monthShift } from "../../planning";
export async function workspaceSnapshot(owner: string, month: string) {
  const result = await consistentRead(() => snapshotRecords(owner, month));
  for (const e of result.entries as Entry[]) {
    if (e.kind === "account" && e.currency && e.currency !== "BRL") {
      let fx = { rate: e.fxRate || 1, date: e.fxDate || localDate() },
        stale = false;
      try {
        fx = await quote(e.currency);
      } catch {
        stale = true;
      }
      e._balance = assertCents(Math.round(e._nativeBalance! * fx.rate));
      e._valuation = { ...fx, stale };
    }
  }
  return result;
}
async function snapshotRecords(owner: string, month: string) {
  const today = localDate(),
    start = monthShift(month, -5) + "-01",
    end = monthShift(month, 1) + "-01";
  const [entities, recent, sums, balances, sources, daily, pending] =
    await Promise.all([
      db()
        .prepare(
          "SELECT payload,updated FROM records WHERE user_id=? AND kind<>'transaction' ORDER BY updated",
        )
        .bind(owner)
        .all<{ payload: string; updated: number }>(),
      db()
        .prepare(
          "SELECT payload,updated FROM records WHERE user_id=? AND kind='transaction' AND record_date>=? AND record_date<? ORDER BY record_date DESC,id DESC LIMIT 100",
        )
        .bind(owner, start, end)
        .all<{ payload: string; updated: number }>(),
      db()
        .prepare(
          "SELECT substring(record_date,1,7) AS month,COALESCE(category,'Outros') AS category,analysis_type AS type,record_status AS status,SUM(analysis_amount_cents)::text AS total,COUNT(*) AS count FROM records WHERE user_id=? AND kind='transaction' AND record_type<>'transfer' AND COALESCE(payload::jsonb->>'financialActivity','')<>'investment_principal' GROUP BY 1,2,3,4",
        )
        .bind(owner)
        .all<{
          month: string;
          category: string;
          type: string;
          status: string;
          total: number;
          count: number;
        }>(),
      db()
        .prepare(
          "SELECT account_id AS id,SUM(CASE WHEN record_type='income' THEN amount_cents ELSE -amount_cents END)::text AS delta,SUM(CASE WHEN record_type='income' THEN COALESCE((payload::jsonb->>'originalAmount')::bigint,amount_cents) ELSE -COALESCE((payload::jsonb->>'originalAmount')::bigint,amount_cents) END)::text AS native FROM records WHERE user_id=? AND kind='transaction' AND record_status='paid' GROUP BY account_id UNION ALL SELECT target_id AS id,SUM(COALESCE((payload::jsonb->>'targetAmount')::bigint,amount_cents))::text AS delta,SUM(COALESCE((payload::jsonb->>'targetOriginalAmount')::bigint,(payload::jsonb->>'targetAmount')::bigint,amount_cents))::text AS native FROM records WHERE user_id=? AND kind='transaction' AND record_status='paid' AND record_type='transfer' GROUP BY target_id",
        )
        .bind(owner, owner)
        .all<{ id: string; delta: string; native: string }>(),
      db()
        .prepare(
          "SELECT source_id AS id,COUNT(*) AS count,json_agg(payload::jsonb->>'sourceMonth') AS months FROM records WHERE user_id=? AND source_id IS NOT NULL AND record_status='paid' GROUP BY source_id",
        )
        .bind(owner)
        .all<{ id: string; count: number; months: string[] }>(),
      db()
        .prepare(
          "SELECT record_date AS date,analysis_type AS type,SUM(analysis_amount_cents)::text AS total FROM records WHERE user_id=? AND kind='transaction' AND record_type<>'transfer' AND COALESCE(payload::jsonb->>'financialActivity','')<>'investment_principal' AND record_status='paid' AND record_date>=? AND record_date<? GROUP BY 1,2",
        )
        .bind(owner, month + "-01", end)
        .all<{ date: string; type: string; total: string }>(),
      db()
        .prepare(
          "SELECT record_date AS date,account_id AS account,record_type AS type,SUM(amount_cents)::text AS total,COUNT(*) AS count FROM records WHERE user_id=? AND kind='transaction' AND record_status='pending' AND record_type<>'transfer' AND ((record_date>=? AND record_date<=?) OR (record_date>=? AND record_date<?)) GROUP BY 1,2,3",
        )
        .bind(owner, today, dateShift(today, 90), month + "-01", end)
        .all<{
          date: string;
          account: string;
          type: "income" | "expense";
          total: string;
          count: number;
        }>(),
    ]);
  const allEntities = entities.results.map((r) => ({
    ...JSON.parse(r.payload),
    _version: r.updated,
  })) as Entry[];
  for (const e of allEntities) {
    if (e.kind === "account" || e.kind === "card") {
      e._balance =
        (e.initial || 0) +
        balances.results
          .filter((b) => b.id === e.id)
          .reduce((n, b) => n + Number(b.delta), 0);
      e._nativeBalance =
        (e.originalInitial ?? e.initial ?? 0) +
        balances.results
          .filter((b) => b.id === e.id)
          .reduce((n, b) => n + Number(b.native), 0);
    }
    if (e.kind === "card") {
      const invoices = await cardInvoices(owner, e.id);
      e._invoiceProjection = invoices.invoices
        .map((i) => ({ date: i.dueDate, amount: i.remaining + i.pending }))
        .filter((i) => i.amount > 0);
    }
    if (e._balance !== undefined) assertCents(e._balance);
    const source = sources.results.find((s) => s.id === e.id);
    if (source) {
      e._paidCount = Number(source.count);
      e._paidMonths = source.months;
    }
  }
  const summary = {
    months: sums.results.map((r) => ({
      ...r,
      total: assertCents(Number(r.total)),
      count: Number(r.count),
    })),
    daily: daily.results,
    planningStart: today,
    planningEnd: dateShift(today, 90),
    pending: pending.results.map(
      (p, i) =>
        ({
          id: "projection-" + i,
          kind: "transaction",
          name: p.count + " lançamento(s) previsto(s)",
          amount: Number(p.total),
          date: p.date,
          accountId: p.account,
          type: p.type,
          status: "pending",
        }) as Entry,
    ),
  };
  if (allEntities[0]) allEntities[0]._summary = summary;
  return {
    entries: [
      ...allEntities,
      ...recent.results.map((r) => ({
        ...JSON.parse(r.payload),
        _version: r.updated,
      })),
    ],
    summary,
    historyWindow: { start, end, limit: 100 },
    partialHistory: true,
  };
}
export async function pagedTransactions(owner: string, url: URL) {
  return consistentRead(() => queryTransactions(owner, url));
}
async function queryTransactions(owner: string, url: URL) {
  const month = url.searchParams.get("month"),
    account = url.searchParams.get("account") || "",
    category = url.searchParams.get("category") || "",
    search = (url.searchParams.get("search") || "").slice(0, 150),
    type = url.searchParams.get("type") || "",
    cursor = url.searchParams.get("cursor") || "";
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw Error("Mês inválido.");
  const values: unknown[] = [owner],
    conditions = ["user_id=?", "kind='transaction'"];
  if (month) {
    conditions.push("record_date>=? AND record_date<?");
    values.push(month + "-01", monthShift(month, 1) + "-01");
  }
  if (account) {
    conditions.push("(account_id=? OR target_id=?)");
    values.push(account, account);
  }
  if (category) {
    conditions.push("category=?");
    values.push(category);
  }
  const invoice = url.searchParams.get("invoice");
  if (invoice) {
    if (!account || !/^\d{4}-(0[1-9]|1[0-2])$/.test(invoice))
      throw new InputError("Fatura inválida.");
    const card = await ownedEntry(owner, account);
    if (card.kind !== "card") throw new InputError("Cartão inválido.");
    conditions.push(
      "((account_id=? AND record_type<>'transfer' AND COALESCE(payload::jsonb->>'invoiceCycle',to_char(to_date(record_date,'YYYY-MM-DD')+CASE WHEN substring(record_date,9,2)::int>? THEN interval '1 month' ELSE interval '0 month' END,'YYYY-MM'))=?) OR (target_id=? AND payload::jsonb->>'invoicePaymentCycle'=?))",
    );
    values.push(account, card.closing || 1, invoice, account, invoice);
  }

  if (type && type !== "all") {
    if (!["income", "expense", "transfer"].includes(type))
      throw Error("Tipo inválido.");
    conditions.push("record_type=?");
    values.push(type);
  }
  if (search) {
    conditions.push("POSITION(LOWER(?) IN LOWER(payload::jsonb->>'name'))>0");
    values.push(search);
  }
  const count = await db()
    .prepare(
      "SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN record_status='paid' AND record_type='income' THEN amount_cents WHEN record_status='paid' AND record_type='expense' THEN -amount_cents ELSE 0 END),0)::text AS result FROM records WHERE " +
        conditions.join(" AND "),
    )
    .bind(...values)
    .first<{ count: number; result: string }>();
  if (cursor) {
    let decoded: { date: string; id: string };
    try {
      decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(decoded.date) ||
        typeof decoded.id !== "string" ||
        decoded.id.length > 100
      )
        throw Error();
    } catch {
      throw Error("Página inválida.");
    }
    conditions.push("(record_date,id)<(?,?)");
    values.push(decoded.date, decoded.id);
  }
  const rows = await db()
    .prepare(
      "SELECT payload,updated FROM records WHERE " +
        conditions.join(" AND ") +
        " ORDER BY record_date DESC,id DESC LIMIT 51",
    )
    .bind(...values)
    .all<{ payload: string; updated: number }>();
  const entries = rows.results.slice(0, 50).map((r) => ({
      ...JSON.parse(r.payload),
      _version: r.updated,
    })) as Entry[],
    last = entries.at(-1);
  return {
    entries,
    total: Number(count?.count || 0),
    result: Number(count?.result || 0),
    nextCursor:
      rows.results.length > 50 && last
        ? Buffer.from(
            JSON.stringify({ date: last.date, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
