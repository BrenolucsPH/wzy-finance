import type { Entry } from "../finance";
export type TransactionEntry = Entry & {
  kind: "transaction";
  type: "income" | "expense" | "transfer";
  date: string;
  status: "paid" | "pending";
  accountId: string;
};
export type AccountEntry = Entry & { kind: "account"; initial?: number };
export type CardEntry = Entry & {
  kind: "card";
  closing: number;
  day: number;
  limit: number;
};
export type GroupEntry = Entry & {
  kind: "group";
  members: string[];
  day: number;
};
export type DebtEntry = Entry & {
  kind: "debt";
  installments: number;
  day: number;
};
export type FinancialEntity =
  | TransactionEntry
  | AccountEntry
  | CardEntry
  | GroupEntry
  | DebtEntry
  | (Entry & { kind: "recurring" | "goal" | "budget" });
export { assertCents, weightedSplit } from "../finance";
