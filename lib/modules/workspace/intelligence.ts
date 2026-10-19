import { z } from "zod";
import { db } from "../../server";
import { money, localDate, split, type Entry } from "../../finance";
import { queryPlan } from "../../domain/queries";
import { health, calendar, dateShift } from "../../planning";
import { workspaceSnapshot } from "../records/read-model";
import { portfolio } from "./portfolio";
import { parse, month } from "./common";
export async function financialAnswer(owner: string, body: unknown) {
  const b = parse(
      z.object({
        question: z.string().trim().min(3).max(500),
        reference: month,
      }),
      body,
    ),
    entities = (
      await db()
        .prepare(
          "SELECT payload FROM records WHERE user_id=? AND kind<>'transaction'",
        )
        .bind(owner)
        .all<{ payload: string }>()
    ).results.map((r) => JSON.parse(r.payload)) as Entry[];
  const cats = (
    await db()
      .prepare(
        "SELECT DISTINCT category FROM records WHERE user_id=? AND category IS NOT NULL UNION SELECT name FROM financial_categories WHERE user_id=?",
      )
      .bind(owner, owner)
      .all<{ category: string }>()
  ).results.map((r) => r.category);
  const plan = queryPlan(
    b.question,
    b.reference,
    entities.filter((e) => e.kind === "account" || e.kind === "card"),
    cats,
  );
  if ("clarify" in plan)
    return { answer: plan.clarify, explanation: "Nenhum dado foi alterado." };
  if (plan.intent === "unknown")
    return {
      answer:
        "Posso consultar saldos, despesas, receitas, patrimônio registrado, categorias, vencimentos e saúde financeira. Experimente: “Quais foram meus maiores gastos por categoria nos últimos 3 meses?”",
      explanation:
        "Consultas processadas localmente. Seus registros não são enviados a serviços externos.",
    };
  const snapshot = await workspaceSnapshot(owner, plan.month);
  if (plan.intent === "balance") {
    const accounts = snapshot.entries.filter(
      (e) =>
        e.kind === "account" && (!plan.accountId || e.id === plan.accountId),
    );
    return {
      answer:
        "Saldo registrado: " +
        money(accounts.reduce((s, a) => s + (a._balance || 0), 0)) +
        ".",
      explanation:
        "Somente contas financeiras; valores registrados, sem conexão bancária automática.",
    };
  }
  if (plan.intent === "wealth") {
    const assets = await portfolio(owner),
      cash = snapshot.entries
        .filter((e) => e.kind === "account")
        .reduce((s, a) => s + (a._balance || 0), 0),
      cards = snapshot.entries
        .filter((e) => e.kind === "card")
        .reduce((s, c) => s + Math.max(0, -(c._balance || 0)), 0),
      debts = snapshot.entries
        .filter((e) => e.kind === "debt")
        .reduce(
          (s, d) =>
            s +
            Math.max(
              0,
              split(d.amount, d.installments || 1)
                .slice((d.paidInstallments || 0) + (d._paidCount || 0))
                .reduce((n, v) => n + v, 0),
            ),
          0,
        );
    return {
      answer:
        "Patrimônio financeiro registrado: " +
        money(cash + assets.totalMarketValue - cards - debts) +
        ".",
      explanation:
        "Caixa e ativos com cotação informada, menos cartões e dívidas cadastradas. Bens não cadastrados não entram.",
    };
  }
  if (plan.intent === "health") {
    const score = health(snapshot.entries, plan.month);
    return {
      answer: score
        ? "Indicador de organização: " + score.score + "/100."
        : "Ainda não há registros suficientes.",
      explanation:
        "Considera poupança, liquidez, pendências e orçamentos. Não representa score de crédito nem diagnóstico financeiro.",
    };
  }
  if (plan.intent === "upcoming") {
    const events = calendar(
      snapshot.entries,
      localDate(),
      dateShift(localDate(), 30),
    ).filter((e) => e.type === "expense");
    return {
      answer:
        events.length +
        " compromisso(s) previsto(s) nos próximos 30 dias, somando " +
        money(events.reduce((s, e) => s + e.amount, 0)) +
        ".",
      explanation:
        "Recorrências, parcelas e lançamentos pendentes registrados; faturas dependem dos seus registros.",
    };
  }
  const conditions = [
      "user_id=?",
      "kind='transaction'",
      "record_status='paid'",
      "analysis_type=?",
      "record_date>=?",
      "record_date<?",
    ],
    values: unknown[] = [owner, plan.type, plan.start, plan.end];
  if (plan.accountId) {
    conditions.push("account_id=?");
    values.push(plan.accountId);
  }
  if (plan.category) {
    conditions.push("category=?");
    values.push(plan.category);
  }
  if (plan.term) {
    conditions.push(
      "POSITION(? IN TRANSLATE(LOWER(CONCAT(payload::jsonb->>'name',' ',payload::jsonb->>'subcategory',' ',payload::jsonb->>'tags')),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'))>0",
    );
    values.push(plan.term);
  }
  const dimension =
    plan.group === "category"
      ? "COALESCE(category,'Outros')"
      : plan.group === "account"
        ? "account_id"
        : "'Total'";
  const rows = (
    await db()
      .prepare(
        `SELECT ${dimension} AS label,SUM(analysis_amount_cents)::text AS total,COUNT(*) AS count FROM records WHERE ${conditions.join(" AND ")} GROUP BY 1 ORDER BY SUM(analysis_amount_cents) DESC`,
      )
      .bind(...values)
      .all<{ label: string; total: number; count: number }>()
  ).results;
  const total = rows.reduce((s, r) => s + Number(r.total), 0),
    count = rows.reduce((s, r) => s + Number(r.count), 0),
    breakdown = rows.slice(0, 10).map((r) => ({
      name:
        plan.group === "account"
          ? entities.find((e) => e.id === r.label)?.name || "Conta"
          : r.label,
      amount: Number(r.total),
    }));
  return {
    answer:
      (plan.type === "expense" ? "Despesas" : "Receitas") +
      " registradas: " +
      money(total) +
      ", em " +
      count +
      " lançamento(s)." +
      (plan.group === "total"
        ? ""
        : " " +
          breakdown.map((r) => r.name + ": " + money(r.amount)).join("; ") +
          "."),
    breakdown,
    explanation:
      "Período: " +
      plan.start +
      " até " +
      dateShift(plan.end, -1) +
      ". Somente registros concluídos. " +
      (plan.category
        ? "Categoria: " + plan.category + ". "
        : plan.term
          ? "Busca na descrição, subcategoria e tags: " + plan.term + ". "
          : "") +
      "Transferências e principal de investimentos não são gastos de consumo. Estornos ajustam os totais.",
  };
}
