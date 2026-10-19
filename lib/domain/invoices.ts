import { dueDate, type Entry } from "../finance";
import { monthShift } from "../planning";
export function invoiceCycle(card: Entry, date: string) {
  return Number(date.slice(8, 10)) > (card.closing || 1)
    ? monthShift(date.slice(0, 7), 1)
    : date.slice(0, 7);
}
export function invoiceDates(card: Entry, cycle: string) {
  return {
    closingDate: dueDate(cycle, card.closing),
    dueDate: dueDate(
      (card.day || 10) <= (card.closing || 1) ? monthShift(cycle, 1) : cycle,
      card.day,
    ),
  };
}
export type Invoice = {
  cycle: string;
  closingDate: string;
  dueDate: string;
  charges: number;
  pending: number;
  paid: number;
  remaining: number;
  credit: number;
  status: "open" | "closed";
  purchases: Entry[];
};
export function buildInvoices(
  card: Entry,
  entries: Entry[],
  closed: string[] = [],
) {
  const cycles = new Map<string, Invoice>();
  const get = (cycle: string) => {
    if (!cycles.has(cycle))
      cycles.set(cycle, {
        cycle,
        ...invoiceDates(card, cycle),
        charges: 0,
        pending: 0,
        paid: 0,
        remaining: 0,
        credit: 0,
        status: closed.includes(cycle) ? "closed" : "open",
        purchases: [],
      });
    return cycles.get(cycle)!;
  };
  let unallocated = Math.max(0, card.initial || 0);
  if ((card.initial || 0) < 0)
    get(invoiceCycle(card, new Date().toISOString().slice(0, 10))).charges = -(
      card.initial || 0
    );
  for (const entry of entries.filter((e) => e.kind === "transaction")) {
    if (entry.accountId === card.id) {
      const invoice = get(
          entry.invoiceCycle || invoiceCycle(card, entry.date!),
        ),
        value = entry.type === "income" ? -entry.amount : entry.amount;
      if (entry.status === "paid") invoice.charges += value;
      else invoice.pending += value;
      invoice.purchases.push(entry);
    }
    if (
      entry.targetId === card.id &&
      entry.type === "transfer" &&
      entry.status === "paid"
    ) {
      if (entry.invoicePaymentCycle)
        get(entry.invoicePaymentCycle).paid +=
          entry.targetAmount ?? entry.amount;
      else unallocated += entry.targetAmount ?? entry.amount;
    }
  }
  const invoices = Array.from(cycles.values()).sort((a, b) =>
    a.cycle.localeCompare(b.cycle),
  );
  for (const invoice of invoices) {
    const allocated = Math.min(
      unallocated,
      Math.max(0, invoice.charges - invoice.paid),
    );
    invoice.paid += allocated;
    unallocated -= allocated;
    invoice.remaining = Math.max(0, invoice.charges - invoice.paid);
    invoice.credit = Math.max(0, invoice.paid - invoice.charges);
    unallocated += invoice.credit;
  }
  return { invoices, unallocatedCredit: unallocated };
}
