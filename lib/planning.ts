import { balance, dueDate, money, split, totals, type Entry } from "./finance";
export function monthShift(month: string, offset: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}
export function dateShift(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function installmentDate(date: string, index: number) {
  return dueDate(
    monthShift(date.slice(0, 7), index),
    Number(date.slice(8, 10)),
  );
}
export function categorySpend(
  entries: Entry[],
  month: string,
  category: string,
) {
  const summary = entries.find((e) => e._summary)?._summary;
  if (summary)
    return summary.months
      .filter(
        (r) =>
          r.month === month &&
          r.category === category &&
          r.type === "expense" &&
          r.status === "paid",
      )
      .reduce((n, r) => n + Number(r.total), 0);
  return entries
    .filter(
      (e) =>
        e.kind === "transaction" &&
        (e.type === "expense" || (e.type === "income" && e.adjustmentReason)) &&
        e.financialActivity !== "investment_principal" &&
        e.status === "paid" &&
        e.date?.startsWith(month) &&
        e.category === category,
    )
    .reduce((n, e) => n + (e.type === "income" ? -e.amount : e.amount), 0);
}
export function budgetPlan(budget: Entry, entries: Entry[], month: string) {
  let carry = 0;
  const start = budget.budgetStart || month;
  let m = start;
  for (
    let i = 0;
    budget.rollover && m < month && i < 1200;
    i++, m = monthShift(m, 1)
  )
    carry = Math.max(
      0,
      carry +
        budget.amount -
        categorySpend(entries, m, budget.category || budget.name),
    );
  const spent = categorySpend(entries, month, budget.category || budget.name),
    available = budget.amount + carry;
  return {
    carry,
    available,
    spent,
    remaining: available - spent,
    percent: available
      ? Math.round((spent / available) * 100)
      : spent
        ? 100
        : 0,
  };
}
export type CalendarItem = {
  id: string;
  name: string;
  date: string;
  amount: number;
  type: "income" | "expense";
  source: Entry;
};
export function calendar(entries: Entry[], start: string, end: string) {
  const summary = entries.find((e) => e._summary)?._summary;
  if (
    summary &&
    ((start >= summary.planningStart && end <= summary.planningEnd) ||
      summary.pending.some((e) => e.date! >= start && e.date! <= end))
  )
    entries = [
      ...entries
        .filter((e) => e.kind !== "transaction")
        .map((e) => ({ ...e, _summary: undefined })),
      ...summary.pending,
    ];
  const cards = entries.filter((e) => e.kind === "card"),
    cardIds = new Set(cards.map((c) => c.id));
  const items: CalendarItem[] = entries
    .filter(
      (e) =>
        !cardIds.has(e.accountId || "") &&
        e.kind === "transaction" &&
        e.status === "pending" &&
        e.type !== "transfer" &&
        e.date! >= start &&
        e.date! <= end,
    )
    .map((e) => ({
      id: e.id,
      name: e.name,
      date: e.date!,
      amount: e.amount,
      type: e.type === "income" ? "income" : "expense",
      source: e,
    }));
  for (const card of cards) {
    if (card._invoiceProjection) {
      for (const i of card._invoiceProjection) {
        const due = i.date < start ? start : i.date;
        if (due <= end)
          items.push({
            id: "invoice-" + card.id + "-" + i.date,
            name: card.name + " · fatura",
            date: due,
            amount: i.amount,
            type: "expense",
            source: card,
          });
      }
      continue;
    }
    let month = start.slice(0, 7),
      date = dueDate(month, card.day);
    if (date < start) {
      month = monthShift(month, 1);
      date = dueDate(month, card.day);
    }
    const projected = new Map<string, number>();
    const outstanding = Math.max(0, -balance(card, entries));
    if (outstanding) projected.set(date, outstanding);
    for (const e of entries.filter(
      (e) =>
        e.kind === "transaction" &&
        e.status === "pending" &&
        e.accountId === card.id &&
        e.type !== "transfer" &&
        e.date,
    )) {
      let cycle = e.date!.slice(0, 7);
      if (Number(e.date!.slice(8)) > (card.closing || 1))
        cycle = monthShift(cycle, 1);
      if ((card.day || 10) <= (card.closing || 1)) cycle = monthShift(cycle, 1);
      let due = dueDate(cycle, card.day);
      if (due < start) due = date;
      projected.set(
        due,
        (projected.get(due) || 0) +
          (e.type === "income" ? -e.amount : e.amount),
      );
    }
    for (const [due, amount] of projected)
      if (due >= start && due <= end && amount > 0)
        items.push({
          id: "invoice-" + card.id + "-" + due,
          name: card.name + " · fatura estimada",
          date: due,
          amount,
          type: "expense",
          source: card,
        });
  }
  for (const e of entries.filter(
    (e) => e.kind === "recurring" || e.kind === "debt",
  )) {
    const paid =
      (e._paidCount ?? entries.filter((x) => x.sourceId === e.id).length) +
      (e.paidInstallments || 0);
    let remaining = e.kind === "debt" ? (e.installments || 1) - paid : 1200;
    for (
      let m = start.slice(0, 7), i = 0;
      m <= end.slice(0, 7) && i < 1200;
      m = monthShift(m, 1), i++
    ) {
      const date = dueDate(m, e.day);
      if (
        date < start ||
        date > end ||
        remaining <= 0 ||
        e._paidMonths?.includes(m) ||
        entries.some((x) => x.sourceId === e.id && x.sourceMonth === m)
      )
        continue;
      const amount =
        e.kind === "debt"
          ? split(e.amount, e.installments || 1)[
              (e.installments || 1) - remaining
            ]
          : e.amount;
      items.push({
        id: e.id + "-" + m,
        name: e.name,
        date,
        amount,
        type: e.type === "income" ? "income" : "expense",
        source: e,
      });
      remaining--;
    }
  }
  return items.sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
}
export function forecast(
  entries: Entry[],
  today: string,
  days: number,
  incomeReduction = 0,
  expenseReduction = 0,
) {
  const opening = entries
      .filter((e) => e.kind === "account")
      .reduce((sum, a) => sum + balance(a, entries), 0),
    items = calendar(entries, today, dateShift(today, days));
  let closing = opening;
  const points = items.map((e) => {
    const adjusted = Math.round(
      e.amount *
        (1 - (e.type === "income" ? incomeReduction : expenseReduction) / 100),
    );
    closing += e.type === "income" ? adjusted : -adjusted;
    return { ...e, adjusted, balance: closing };
  });
  return {
    opening,
    closing,
    items: points,
    income: points
      .filter((e) => e.type === "income")
      .reduce((s, e) => s + e.adjusted, 0),
    expense: points
      .filter((e) => e.type === "expense")
      .reduce((s, e) => s + e.adjusted, 0),
    minimum: Math.min(opening, ...points.map((p) => p.balance)),
  };
}
export function insights(entries: Entry[], month: string) {
  const before = monthShift(month, -1),
    messages: string[] = [];
  const categories = new Set([
    ...(entries.find((e) => e._summary)?._summary?.months || []).map(
      (e) => e.category,
    ),
    ...entries
      .filter((e) => e.kind === "transaction" && e.type === "expense")
      .map((e) => e.category || "Outros"),
  ]);
  for (const category of categories) {
    const now = categorySpend(entries, month, category),
      old = categorySpend(entries, before, category);
    if (old > 0 && now !== old)
      messages.push(
        `Você gastou ${Math.round((Math.abs(now - old) / old) * 100)}% ${now > old ? "mais" : "menos"} com ${category.toLowerCase()} neste mês (${money(now)}).`,
      );
  }
  const t = totals(entries, month);
  if (t.income > 0)
    messages.push(
      `Você ${t.income >= t.expense ? "preservou" : "gastou além da renda"} ${money(Math.abs(t.income - t.expense))} no mês.`,
    );
  return messages.slice(0, 8);
}
export function anomalies(entries: Entry[], month: string) {
  const tx = entries.filter(
    (e) =>
      e.kind === "transaction" &&
      e.type === "expense" &&
      e.date?.startsWith(month),
  );
  const warnings: {
    id: string;
    message: string;
    entry: Entry;
  }[] = [];
  for (const e of tx) {
    const same = tx.find(
      (x) =>
        x.id < e.id &&
        x.date === e.date &&
        x.accountId === e.accountId &&
        x.amount === e.amount &&
        x.name.trim().toLowerCase() === e.name.trim().toLowerCase(),
    );
    if (same)
      warnings.push({
        id: "duplicate-" + e.id,
        message:
          "Possível cobrança duplicada. Confira os dois lançamentos antes de alterar.",
        entry: e,
      });
    const history = entries.filter(
      (x) =>
        x.kind === "transaction" &&
        x.type === "expense" &&
        x.category === e.category &&
        x.date! < month + "-01" &&
        x.date! >= monthShift(month, -3) + "-01",
    );
    if (history.length >= 5) {
      const sorted = history.map((x) => x.amount).sort((a, b) => a - b),
        median = sorted[Math.floor(sorted.length / 2)];
      if (median > 0 && e.amount > median * 3)
        warnings.push({
          id: "outlier-" + e.id,
          message:
            "Gasto acima de três vezes o valor típico da categoria. Confira o comprovante.",
          entry: e,
        });
    }
  }
  return warnings.slice(0, 30);
}
export function health(entries: Entry[], month: string) {
  const t = totals(entries, month);
  if (
    !entries.some(
      (e) => e.kind === "transaction" && e.date?.startsWith(month),
    ) &&
    !(entries.find((e) => e._summary)?._summary?.months || []).some(
      (e) => e.month === month,
    )
  )
    return null;
  const saving =
    t.income > 0
      ? Math.max(0, Math.min(40, ((t.income - t.expense) / t.income) * 200))
      : 0;
  const liquid = entries
    .filter((e) => e.kind === "account")
    .reduce((s, e) => s + balance(e, entries), 0);
  const reserve =
    t.expense > 0
      ? Math.max(0, Math.min(30, (liquid / t.expense) * 10))
      : liquid > 0
        ? 30
        : 0;
  const overdue = entries.filter(
    (e) =>
      e.kind === "transaction" &&
      e.status === "pending" &&
      e.type === "expense" &&
      e.date! < month + "-01",
  ).length;
  const budgets = entries.filter((e) => e.kind === "budget");
  const budgetScore = budgets.length
    ? (10 *
        budgets.filter((e) => budgetPlan(e, entries, month).remaining >= 0)
          .length) /
      budgets.length
    : 0;
  return {
    score: Math.round(saving + reserve + (overdue ? 0 : 20) + budgetScore),
    saving: Math.round(saving),
    reserve: Math.round(reserve),
    onTime: overdue ? 0 : 20,
    budgets: Math.round(budgetScore),
  };
}
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function answerQuestion(
  question: string,
  entries: Entry[],
  reference: string,
) {
  const q = normalize(question),
    months = [
      "janeiro",
      "fevereiro",
      "marco",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ];
  let month = reference;
  const named = months.findIndex((m) => q.includes(m));
  if (named >= 0)
    month =
      (question.match(/20\d{2}/)?.[0] || reference.slice(0, 4)) +
      "-" +
      String(named + 1).padStart(2, "0");
  if (/mes passado|ultimo mes/.test(q)) month = monthShift(reference, -1);
  if (/saldo|quanto.*tenho/.test(q))
    return `O saldo registrado nas suas contas é ${money(entries.filter((e) => e.kind === "account").reduce((s, a) => s + balance(a, entries), 0))}.`;
  if (/saude|score/.test(q)) {
    const h = health(entries, month);
    return h
      ? `Seu indicador de organização financeira em ${month} é ${h.score}/100. Ele considera os registros disponíveis, não é um score de crédito.`
      : "Ainda faltam lançamentos para calcular o indicador.";
  }
  if (/venc|pagar|proxim/.test(q)) {
    const next = calendar(entries, month + "-01", dueDate(month, 31)).filter(
      (e) => e.type === "expense",
    );
    return next.length
      ? `Há ${next.length} compromissos registrados em ${month}, somando ${money(next.reduce((s, e) => s + e.amount, 0))}.`
      : "Não há vencimentos pendentes registrados nesse período.";
  }
  if (!/gast|despes|receb|receit|entrou|mercado|delivery|aliment/.test(q))
    return "Posso consultar saldos, despesas, receitas, vencimentos e saúde financeira. Experimente: “Quanto gastei com mercado em setembro?”";
  const type = /receb|receit|entrou/.test(q) ? "income" : "expense";
  let transactions = entries.filter(
    (e) =>
      e.kind === "transaction" &&
      e.type === type &&
      e.status === "paid" &&
      e.date?.startsWith(month),
  );
  const aliases: Record<string, string> = {
    mercado: "Alimentação",
    supermercado: "Alimentação",
    delivery: "delivery",
  };
  const category = Array.from(
    new Set(entries.map((e) => e.category || "")),
  ).find((c) => c && q.includes(normalize(c)));
  const alias = Object.keys(aliases).find((a) => q.includes(a));
  const term = category || (alias ? aliases[alias] : "");
  if (term)
    transactions = transactions.filter(
      (e) =>
        normalize(e.category || "") === normalize(term) ||
        normalize(e.subcategory || "").includes(normalize(term)) ||
        normalize(e.name).includes(normalize(term)) ||
        e.tags?.some((t) => normalize(t).includes(normalize(term))),
    );
  return `${type === "expense" ? "Despesas pagas" : "Receitas recebidas"}${term ? " em " + term : ""}, em ${month}: ${money(transactions.reduce((s, e) => s + e.amount, 0))}, em ${transactions.length} lançamento(s).${alias === "mercado" ? " A consulta usa a categoria Alimentação e descrições correspondentes." : ""}`;
}
