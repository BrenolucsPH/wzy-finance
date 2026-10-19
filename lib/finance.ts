export type Kind =
  | "transaction"
  | "account"
  | "recurring"
  | "group"
  | "goal"
  | "budget"
  | "debt"
  | "card";
export type Entry = {
  id: string;
  kind: Kind;
  name: string;
  amount: number;
  date?: string;
  category?: string;
  type?: "income" | "expense" | "transfer";
  accountId?: string;
  targetId?: string;
  status?: "paid" | "pending";
  day?: number;
  members?: string[];
  memberWeights?: Record<string, number>;
  payments?: Record<string, string[]>;
  saved?: number;
  initial?: number;
  limit?: number;
  closing?: number;
  paidMonths?: string[];
  installments?: number;
  paidInstallments?: number;
  color?: string;
  notes?: string;
  attachmentId?: string;
  sourceId?: string;
  sourceMonth?: string;
  accountType?:
    "checking" | "savings" | "cash" | "investment" | "meal" | "other";
  subcategory?: string;
  tags?: string[];
  costCenter?: string;
  rollover?: boolean;
  budgetStart?: string;
  monthlyContribution?: number;
  currency?: string;
  originalAmount?: number;
  targetAmount?: number;
  targetOriginalAmount?: number;
  targetCurrency?: string;
  originalInitial?: number;
  fxRate?: number;
  fxDate?: string;
  importKey?: string;
  reconciled?: boolean;
  installmentGroup?: string;
  installmentIndex?: number;
  financialActivity?:
    "investment_principal" | "investment_fee" | "investment_income";
  investmentPosition?: string;
  invoiceCycle?: string;
  invoicePaymentCycle?: string;
  reversalOf?: string;
  adjustmentReason?: string;
  _valuation?: { rate: number; date: string; stale: boolean };
  _invoiceProjection?: { date: string; amount: number }[];
  _version?: number;
  _balance?: number;
  _nativeBalance?: number;
  _paidCount?: number;
  _paidMonths?: string[];
  _summary?: {
    months: {
      month: string;
      category: string;
      type: string;
      status: string;
      total: number;
      count: number;
    }[];
    daily: { date: string; type: string; total: string }[];
    planningStart: string;
    planningEnd: string;
    pending: Entry[];
  };
};
export const money = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    n / 100,
  );
export const parseMoney = (text: string) => {
  let value = text
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\s/g, "");
  if (!value) return NaN;
  if (value.includes(",")) {
    if (!/^(?:\d{1,3}(?:\.\d{3})*|\d+),\d{1,2}$/.test(value)) return NaN;
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (value.includes(".")) {
    if (/^\d+\.\d{1,2}$/.test(value)) {
    } else if (/^\d{1,3}(?:\.\d{3})+$/.test(value))
      value = value.replace(/\./g, "");
    else return NaN;
  } else if (!/^\d+$/.test(value)) return NaN;
  const amount = Number(value);
  return !Number.isFinite(amount) || amount < 0 || amount > 999999999
    ? NaN
    : Math.round(amount * 100);
};
export const split = (amount: number, count: number) => {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100000
  )
    throw Error("Valor ou quantidade de parcelas inválidos.");
  return Array.from(
    { length: count },
    (_, i) => Math.floor(amount / count) + (i < amount % count ? 1 : 0),
  );
};
export function dueDate(month: string, day = 1) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(Math.min(day, new Date(y, m, 0).getDate())).padStart(2, "0")}`;
}
export const localDate = (timeZone = "America/Sao_Paulo") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function balance(account: Entry, entries: Entry[]) {
  if (account._balance !== undefined) return account._balance;
  return (
    (account.initial || 0) +
    entries
      .filter((e) => e.kind === "transaction" && e.status === "paid")
      .reduce(
        (n, e) =>
          n +
          (e.accountId === account.id
            ? e.type === "income"
              ? e.amount
              : -e.amount
            : 0) +
          (e.type === "transfer" && e.targetId === account.id
            ? (e.targetAmount ?? e.amount)
            : 0),
        0,
      )
  );
}
export function totals(entries: Entry[], month: string) {
  const summary = entries.find((e) => e._summary)?._summary;
  if (summary) {
    const rows = summary.months.filter((m) => m.month === month);
    return {
      income: rows
        .filter((r) => r.type === "income" && r.status === "paid")
        .reduce((s, r) => s + Number(r.total), 0),
      expense: rows
        .filter((r) => r.type === "expense" && r.status === "paid")
        .reduce((s, r) => s + Number(r.total), 0),
      pending: rows
        .filter((r) => r.type === "expense" && r.status === "pending")
        .reduce((s, r) => s + Number(r.total), 0),
    };
  }
  const tx = entries
    .filter(
      (e) =>
        e.kind === "transaction" &&
        e.date?.startsWith(month) &&
        e.type !== "transfer" &&
        e.financialActivity !== "investment_principal",
    )
    .map((e) =>
      e.financialActivity === "investment_income" && e.reversalOf
        ? {
            ...e,
            type: "income" as const,
            amount: -e.amount,
            adjustmentReason: undefined,
          }
        : e,
    );
  return {
    income: tx
      .filter(
        (e) =>
          e.type === "income" && e.status === "paid" && !e.adjustmentReason,
      )
      .reduce((s, e) => s + e.amount, 0),
    expense: tx
      .filter(
        (e) =>
          e.status === "paid" &&
          (e.type === "expense" || (e.type === "income" && e.adjustmentReason)),
      )
      .reduce((s, e) => s + (e.type === "income" ? -e.amount : e.amount), 0),
    pending: tx
      .filter((e) => e.type === "expense" && e.status === "pending")
      .reduce((s, e) => s + e.amount, 0),
  };
}
export const categories = [
  "Moradia",
  "Alimentação",
  "Transporte",
  "Lazer",
  "Saúde",
  "Educação",
  "Assinaturas",
  "Salário",
  "Freelance",
  "Outros",
];
export function demoData(month: string): Entry[] {
  return [
    {
      id: "nubank",
      kind: "account",
      name: "Nubank",
      amount: 0,
      initial: 280000,
      color: "#8a46c2",
    },
    {
      id: "inter",
      kind: "account",
      name: "Inter",
      amount: 0,
      initial: 120000,
      color: "#f28736",
    },
    {
      id: "reserve",
      kind: "account",
      name: "Reserva",
      amount: 0,
      initial: 400000,
      color: "#337e72",
    },
    {
      id: "sal",
      kind: "transaction",
      name: "Salário",
      amount: 580000,
      type: "income",
      category: "Salário",
      accountId: "nubank",
      date: `${month}-05`,
      status: "paid",
    },
    {
      id: "free",
      kind: "transaction",
      name: "Projeto freelance",
      amount: 120000,
      type: "income",
      category: "Freelance",
      accountId: "inter",
      date: `${month}-07`,
      status: "paid",
    },
    {
      id: "rent",
      kind: "transaction",
      name: "Aluguel",
      amount: 180000,
      type: "expense",
      category: "Moradia",
      accountId: "nubank",
      date: `${month}-05`,
      status: "paid",
    },
    {
      id: "market",
      kind: "transaction",
      name: "Supermercado",
      amount: 42790,
      type: "expense",
      category: "Alimentação",
      accountId: "nubank",
      date: `${month}-06`,
      status: "paid",
    },
    {
      id: "fuel",
      kind: "transaction",
      name: "Combustível",
      amount: 18500,
      type: "expense",
      category: "Transporte",
      accountId: "inter",
      date: `${month}-07`,
      status: "paid",
    },
    {
      id: "rest",
      kind: "transaction",
      name: "Jantar de sexta",
      amount: 14600,
      type: "expense",
      category: "Lazer",
      accountId: "nubank",
      date: `${month}-08`,
      status: "paid",
    },
    {
      id: "gym",
      kind: "transaction",
      name: "Academia",
      amount: 11990,
      type: "expense",
      category: "Saúde",
      accountId: "inter",
      date: `${month}-08`,
      status: "paid",
    },
    {
      id: "power",
      kind: "recurring",
      name: "Conta de luz",
      amount: 18640,
      day: 12,
      category: "Moradia",
      accountId: "nubank",
      paidMonths: [],
    },
    {
      id: "internet",
      kind: "recurring",
      name: "Internet fibra",
      amount: 11990,
      day: 15,
      category: "Moradia",
      accountId: "nubank",
      paidMonths: [],
    },
    {
      id: "water",
      kind: "recurring",
      name: "Água",
      amount: 7820,
      day: 20,
      category: "Moradia",
      accountId: "inter",
      paidMonths: [],
    },
    {
      id: "youtube",
      kind: "group",
      name: "YouTube Premium",
      amount: 5390,
      day: 16,
      members: ["Você", "Ana", "Lucas", "Marina", "Pedro"],
      payments: { [month]: ["Você", "Ana", "Lucas"] },
      color: "#ff443d",
    },
    {
      id: "spotify",
      kind: "group",
      name: "Spotify Família",
      amount: 4090,
      day: 22,
      members: ["Você", "Ana", "Lucas", "Marina"],
      payments: { [month]: ["Você", "Ana"] },
      color: "#21aa60",
    },
    {
      id: "trip",
      kind: "goal",
      name: "Próxima viagem",
      amount: 800000,
      saved: 340000,
      date: `${Number(month.slice(0, 4)) + 1}-01-10`,
      color: "#467bda",
    },
    {
      id: "emergency",
      kind: "goal",
      name: "Reserva de emergência",
      amount: 2000000,
      saved: 850000,
      color: "#33917a",
    },
    {
      id: "budget1",
      kind: "budget",
      name: "Alimentação",
      amount: 90000,
      category: "Alimentação",
    },
    {
      id: "budget2",
      kind: "budget",
      name: "Lazer",
      amount: 40000,
      category: "Lazer",
    },
    {
      id: "card",
      kind: "card",
      name: "Nubank Mastercard",
      amount: 0,
      limit: 800000,
      day: 10,
      closing: 3,
      color: "#7e3aa9",
    },
    {
      id: "debt",
      kind: "debt",
      name: "Notebook",
      amount: 420000,
      installments: 10,
      paidInstallments: 4,
      day: 18,
      accountId: "nubank",
      category: "Outros",
    },
  ];
}
export function nativeBalance(account: Entry, entries: Entry[]) {
  if (account._nativeBalance !== undefined) return account._nativeBalance;
  const foreign = account.currency && account.currency !== "BRL";
  let total = account.originalInitial ?? account.initial ?? 0;
  for (const e of entries.filter(
    (e) => e.kind === "transaction" && e.status === "paid",
  )) {
    if (e.accountId === account.id) {
      if (foreign && e.originalAmount === undefined) return null;
      const value = e.originalAmount ?? e.amount;
      total += e.type === "income" ? value : -value;
    }
    if (e.type === "transfer" && e.targetId === account.id) {
      if (foreign && e.targetOriginalAmount === undefined) return null;
      total += e.targetOriginalAmount ?? e.targetAmount ?? e.amount;
    }
  }
  return total;
}

export function groupSplit(group: Entry) {
  return weightedSplit(
    group.amount,
    (group.members || []).map((name) =>
      group.memberWeights && Object.hasOwn(group.memberWeights, name)
        ? group.memberWeights[name]
        : 1,
    ),
  );
}

export function assertCents(value: number) {
  if (!Number.isSafeInteger(value))
    throw Error("Valor financeiro fora do intervalo seguro.");
  return value;
}
export function weightedSplit(amount: number, weights: number[]) {
  assertCents(amount);
  if (
    amount < 0 ||
    !weights.length ||
    weights.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 100000)
  )
    throw Error("Divisão inválida.");
  const total = weights.reduce((a, b) => a + b, 0),
    pieces = weights.map((w, index) => ({
      index,
      value: Number((BigInt(amount) * BigInt(w)) / BigInt(total)),
      fraction: (BigInt(amount) * BigInt(w)) % BigInt(total),
    }));
  let remaining = amount - pieces.reduce((s, p) => s + p.value, 0);
  const ordered = pieces
    .slice()
    .sort((a, b) =>
      a.fraction === b.fraction
        ? a.index - b.index
        : a.fraction > b.fraction
          ? -1
          : 1,
    );
  for (let i = 0; remaining > 0; i++, remaining--)
    pieces[ordered[i % ordered.length].index].value++;
  return pieces.map((p) => p.value);
}
