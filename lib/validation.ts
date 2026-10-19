import { z } from "zod";
const cents = z.number().int().min(0).max(99999999999);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Data inválida");
export const entrySchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum([
      "transaction",
      "account",
      "recurring",
      "group",
      "goal",
      "budget",
      "debt",
      "card",
    ]),
    name: z.string().trim().min(1).max(150),
    amount: cents,
    date: date.optional(),
    category: z.string().max(100).optional(),
    type: z.enum(["income", "expense", "transfer"]).optional(),
    accountId: z.string().max(100).optional(),
    targetId: z.string().max(100).optional(),
    status: z.enum(["paid", "pending"]).optional(),
    day: z.number().int().min(1).max(31).optional(),
    members: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(20)
      .refine((a) => new Set(a).size === a.length, "Participantes duplicados")
      .optional(),
    memberWeights: z.record(z.number().int().min(1).max(100000)).optional(),
    payments: z
      .record(
        z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        z.array(z.string().max(80)),
      )
      .optional(),
    saved: cents.optional(),
    initial: z.number().int().min(-99999999999).max(99999999999).optional(),
    limit: cents.optional(),
    closing: z.number().int().min(1).max(31).optional(),
    paidMonths: z.array(z.string().regex(/^\d{4}-\d{2}$/)).optional(),
    installments: z.number().int().min(1).max(600).optional(),
    paidInstallments: z.number().int().min(0).max(600).optional(),
    color: z
      .string()
      .regex(/^#[a-fA-F0-9]{6}$/)
      .optional(),
    notes: z.string().max(2000).optional(),
    attachmentId: z.string().max(100).optional(),
    sourceId: z.string().max(100).optional(),
    sourceMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    accountType: z
      .enum(["checking", "savings", "cash", "investment", "meal", "other"])
      .optional(),
    subcategory: z.string().trim().max(100).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    costCenter: z.string().trim().max(100).optional(),
    rollover: z.boolean().optional(),
    budgetStart: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    monthlyContribution: cents.optional(),
    currency: z
      .enum(["BRL", "USD", "EUR", "GBP", "CAD", "CHF", "AUD"])
      .optional(),
    targetAmount: z.number().int().nonnegative().max(99999999999).optional(),
    targetOriginalAmount: z
      .number()
      .int()
      .nonnegative()
      .max(99999999999)
      .optional(),
    targetCurrency: z
      .enum(["BRL", "USD", "EUR", "GBP", "CAD", "CHF", "AUD"])
      .optional(),
    originalAmount: cents.optional(),
    originalInitial: z
      .number()
      .int()
      .min(-99999999999)
      .max(99999999999)
      .optional(),
    fxRate: z.number().positive().max(100000).optional(),
    fxDate: date.optional(),
    importKey: z.string().max(150).optional(),
    reconciled: z.boolean().optional(),
    installmentGroup: z.string().max(100).optional(),
    installmentIndex: z.number().int().min(1).max(600).optional(),
    financialActivity: z
      .enum(["investment_principal", "investment_fee", "investment_income"])
      .optional(),
    investmentPosition: z.string().max(100).optional(),
    invoiceCycle: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    invoicePaymentCycle: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    reversalOf: z.string().max(100).optional(),
    adjustmentReason: z.string().trim().max(300).optional(),
  })
  .superRefine((e, c) => {
    const issue = (message: string) => c.addIssue({ code: "custom", message });
    if (
      e.kind === "transaction" &&
      (!e.date || !e.type || !e.accountId || !e.status || e.amount <= 0)
    )
      issue("Informe valor, data, tipo e conta");
    if (e.type === "transfer" && (!e.targetId || e.targetId === e.accountId))
      issue("Escolha duas contas diferentes");
    if (e.kind === "group" && !e.members?.length)
      issue("Adicione os participantes");
    if (
      e.kind === "debt" &&
      (!e.installments || (e.paidInstallments || 0) > e.installments)
    )
      issue("Parcelas inválidas");
    if (["recurring", "group", "debt"].includes(e.kind) && !e.day)
      issue("Informe o vencimento");
    if (
      e.kind === "group" &&
      Object.values(e.payments || {}).some((a) =>
        a.some((m) => !e.members?.includes(m)),
      )
    )
      issue("Pagamento de participante inexistente");
  });
export function validPassword(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length >= 12 &&
    new TextEncoder().encode(s).length <= 72
  );
}
