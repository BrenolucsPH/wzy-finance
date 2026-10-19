import { z } from "zod";
import { db } from "../../server";
import { transaction } from "../../postgres";
import { buildInvoices, invoiceDates } from "../../domain/invoices";
import type { Entry } from "../../finance";
import {
  ownedEntry,
  parse,
  id,
  cents,
  date,
  month,
  requestId,
  InputError,
  commandId,
  insertEntry,
  lockOwner,
} from "./common";
export async function cardInvoices(owner: string, cardId: string) {
  const card = await ownedEntry(owner, cardId);
  if (card.kind !== "card") throw new InputError("Cartão inválido.");
  const closed = await db()
    .prepare(
      "SELECT cycle,closing_date,due_date FROM invoice_cycles WHERE user_id=? AND card_id=? AND status=?",
    )
    .bind(owner, cardId, "closed")
    .all<{ cycle: string; closing_date: string; due_date: string }>();
  const cycleSql =
    "CASE WHEN account_id=? THEN COALESCE(payload::jsonb->>'invoiceCycle',to_char(to_date(record_date,'YYYY-MM-DD')+CASE WHEN substring(record_date,9,2)::int>? THEN interval '1 month' ELSE interval '0 month' END,'YYYY-MM')) ELSE payload::jsonb->>'invoicePaymentCycle' END";
  const rows = await db()
    .prepare(
      `SELECT ${cycleSql} AS cycle,account_id,target_id,record_type,record_status,SUM(amount_cents)::text AS total FROM records WHERE user_id=? AND kind='transaction' AND (account_id=? OR target_id=?) GROUP BY 1,2,3,4,5`,
    )
    .bind(cardId, card.closing || 1, owner, cardId, cardId)
    .all<{
      cycle: string | null;
      account_id: string;
      target_id: string;
      record_type: Entry["type"];
      record_status: Entry["status"];
      total: string;
    }>();
  const entries = rows.results.map(
    (r, index) =>
      ({
        id: "invoice-sum-" + index,
        kind: "transaction",
        name: "Movimentações",
        amount: Number(r.total),
        date: (r.cycle || new Date().toISOString().slice(0, 7)) + "-01",
        accountId: r.account_id,
        targetId: r.target_id,
        type: r.record_type,
        status: r.record_status,
        invoiceCycle:
          r.account_id === cardId ? r.cycle || undefined : undefined,
        invoicePaymentCycle:
          r.target_id === cardId ? r.cycle || undefined : undefined,
      }) as Entry,
  );
  const data = buildInvoices(
    card,
    entries,
    closed.results.map((c) => c.cycle),
  );
  for (const invoice of data.invoices) {
    invoice.purchases = [];
    const stored = closed.results.find((c) => c.cycle === invoice.cycle);
    if (stored) {
      invoice.closingDate = stored.closing_date;
      invoice.dueDate = stored.due_date;
    }
  }
  return { card, ...data };
}
export async function closeInvoice(owner: string, body: unknown) {
  const b = parse(z.object({ cardId: id, cycle: month }), body);
  const card = await ownedEntry(owner, b.cardId);
  if (card.kind !== "card") throw new InputError("Cartão inválido.");
  const dates = invoiceDates(card, b.cycle);
  await transaction(async (client) => {
    await lockOwner(client, owner);
    // Freeze legacy charges before closure so changing a card's closing day cannot move history.
    await client.query(
      "UPDATE records SET payload=jsonb_set(payload::jsonb,'{invoiceCycle}',to_jsonb((to_char(to_date(record_date,'YYYY-MM-DD')+CASE WHEN substring(record_date,9,2)::int>$3 THEN interval '1 month' ELSE interval '0 month' END,'YYYY-MM'))::text))::text,updated=GREATEST(updated+1,$4) WHERE user_id=$1 AND account_id=$2 AND kind='transaction' AND record_type<>'transfer' AND NOT payload::jsonb ? 'invoiceCycle'",
      [owner, card.id, card.closing || 1, Date.now()],
    );
    const pending = await client.query(
      "SELECT id FROM records WHERE user_id=$1 AND account_id=$2 AND payload::jsonb->>'invoiceCycle'=$3 AND record_status='pending' LIMIT 1",
      [owner, card.id, b.cycle],
    );
    if (pending.rows.length)
      throw new InputError(
        "Confirme ou reagende as compras pendentes antes de fechar a fatura.",
        409,
      );
    await client.query(
      "INSERT INTO invoice_cycles(id,user_id,card_id,cycle,closing_date,due_date,status,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,card_id,cycle) DO NOTHING",
      [
        crypto.randomUUID(),
        owner,
        card.id,
        b.cycle,
        dates.closingDate,
        dates.dueDate,
        "closed",
        Date.now(),
      ],
    );
  });
  return cardInvoices(owner, card.id);
}
export async function payInvoice(owner: string, body: unknown) {
  const b = parse(
      z.object({
        cardId: id,
        cycle: month,
        accountId: id,
        amount: cents,
        date,
        requestId,
      }),
      body,
    ),
    card = await ownedEntry(owner, b.cardId),
    account = await ownedEntry(owner, b.accountId);
  if (
    card.kind !== "card" ||
    account.kind !== "account" ||
    (account.currency || "BRL") !== "BRL" ||
    (card.currency || "BRL") !== "BRL"
  )
    throw new InputError("Escolha um cartão e uma conta em reais.");
  const entry: Entry = {
    id: await commandId(owner, b.requestId, "invoice-pay"),
    kind: "transaction",
    name: "Pagamento de fatura · " + card.name,
    amount: b.amount,
    type: "transfer",
    date: b.date,
    status: "paid",
    accountId: account.id,
    targetId: card.id,
    invoicePaymentCycle: b.cycle,
  };
  return {
    entry: await transaction(async (client) => {
      await lockOwner(client, owner);
      return insertEntry(client, owner, entry);
    }),
  };
}
export async function adjustInvoice(owner: string, body: unknown) {
  const b = parse(
      z.object({
        cardId: id,
        cycle: month,
        amount: cents,
        date,
        reason: z.string().trim().min(3).max(300),
        type: z.enum(["charge", "refund"]),
        reversalOf: id.optional(),
        requestId,
      }),
      body,
    ),
    card = await ownedEntry(owner, b.cardId);
  if (card.kind !== "card" || (card.currency || "BRL") !== "BRL")
    throw new InputError("Cartão inválido.");
  const entry: Entry = {
    id: await commandId(owner, b.requestId, "invoice-adjust"),
    kind: "transaction",
    name: (b.type === "refund" ? "Estorno" : "Ajuste") + " · " + b.reason,
    amount: b.amount,
    type: b.type === "refund" ? "income" : "expense",
    date: b.date,
    status: "paid",
    accountId: card.id,
    invoiceCycle: b.cycle,
    adjustmentReason: b.reason,
    reversalOf: b.reversalOf,
    category: "Outros",
  };
  return {
    entry: await transaction(async (client) => {
      await lockOwner(client, owner);
      const existing = await client.query(
        "SELECT id FROM records WHERE user_id=$1 AND id=$2",
        [owner, entry.id],
      );
      if (b.reversalOf) {
        const sourceRow = await client.query(
          "SELECT payload FROM records WHERE user_id=$1 AND id=$2",
          [owner, b.reversalOf],
        );
        if (!sourceRow.rows.length)
          throw new InputError("Compra não encontrada.", 404);
        const source = JSON.parse(sourceRow.rows[0].payload) as Entry;
        if (
          source.accountId !== card.id ||
          source.type !== "expense" ||
          b.type !== "refund"
        )
          throw new InputError("Compra de origem inválida.");
        const sum = await client.query(
          "SELECT COALESCE(SUM(amount_cents),0)::text AS total FROM records WHERE user_id=$1 AND payload::jsonb->>'reversalOf'=$2",
          [owner, source.id],
        );
        if (
          !existing.rows.length &&
          Number(sum.rows[0].total) + b.amount > source.amount
        )
          throw new InputError("O estorno excede o valor ainda não estornado.");
        entry.category = source.category || "Outros";
      }
      return insertEntry(client, owner, entry);
    }),
  };
}
