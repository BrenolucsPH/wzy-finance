"use client";
import Image from "next/image";
import { useState } from "react";
import { FinancialHistory } from "./transactions/history";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  CalendarDays,
  Check,
  Download,
  Eye,
  EyeOff,
  Music,
  Play,
  Trash2,
  Pencil,
  Users,
} from "lucide-react";
import { money, split, totals, balance, type Entry } from "../../lib/finance";
import { Empty } from "../components";
export type Actions = {
  authenticated?: boolean;
  refresh?: () => Promise<void>;
  entries: Entry[];
  month: string;
  edit: (kind: Entry["kind"], e?: Entry) => void;
  save: (e: Entry) => Promise<void>;
  remove: (e: Entry) => void;
  pay: (e: Entry) => void;
  navigate: (s: string) => void;
  notify: (s: string) => void;
};
export const isPaid = (e: Entry, entries: Entry[], month: string) =>
  !!e.paidMonths?.includes(month) ||
  !!e._paidMonths?.includes(month) ||
  entries.some(
    (t) =>
      t.sourceId === e.id && t.sourceMonth === month && t.status === "paid",
  );
export function debtProgress(e: Entry, entries: Entry[]) {
  const n =
    (e.paidInstallments || 0) +
    (e._paidCount ??
      entries.filter((t) => t.sourceId === e.id && t.status === "paid").length);
  const parts = split(e.amount, e.installments || 1);
  return {
    count: n,
    remaining: parts.slice(n).reduce((a, b) => a + b, 0),
    next: parts[n] || 0,
  };
}
export function CashChart({
  entries,
  month,
}: {
  entries: Entry[];
  month: string;
}) {
  const count = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  let inc = 0,
    exp = 0;
  const daily = entries.find((e) => e._summary)?._summary?.daily;
  const points = Array.from({ length: count }, (_, i) => {
    (daily
      ? daily.map((d) => ({
          kind: "transaction",
          status: "paid",
          type: d.type,
          date: d.date,
          amount: Number(d.total),
        }))
      : entries
    )
      .filter(
        (e) =>
          e.kind === "transaction" &&
          e.status === "paid" &&
          e.type !== "transfer" &&
          e.date === `${month}-${String(i + 1).padStart(2, "0")}`,
      )
      .forEach((e) =>
        e.type === "income" ? (inc += e.amount) : (exp += e.amount),
      );
    return { inc, exp };
  });
  const max = Math.max(inc, exp, 10000) * 1.12;
  const path = (key: "inc" | "exp") =>
    points
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${(i * 660) / (count - 1)},${180 - (p[key] * 180) / max}`,
      )
      .join(" ");
  const income = path("inc");
  return (
    <div className="chart">
      <div className="chart-labels">
        {[1, 0.75, 0.5, 0.25, 0].map((x) => (
          <span key={x}>
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
              notation: "compact",
              maximumFractionDigits: 0,
            }).format((max * x) / 100)}
          </span>
        ))}
      </div>
      <div className="chart-canvas">
        <div className="chart-grid" />
        <svg
          viewBox="0 0 660 180"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Receitas acumuladas ${money(inc)} e despesas acumuladas ${money(exp)}`}
        >
          <defs>
            <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#347e69" stopOpacity=".18" />
              <stop offset="1" stopColor="#347e69" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${income} L660,180 L0,180 Z`} fill="url(#area)" />
          <path d={income} stroke="#357c67" fill="none" strokeWidth="2.8" />
          <path
            d={path("exp")}
            stroke="#a8b2bd"
            fill="none"
            strokeWidth="2"
            strokeDasharray="5 5"
          />
        </svg>
        <div className="chart-x">
          {[1, 5, 10, 15, 20, 25, count].map((d, i) => (
            <span key={i}>
              {String(d).padStart(2, "0")}{" "}
              {new Date(month + "-02T12:00:00")
                .toLocaleString("pt-BR", { month: "short" })
                .replace(".", "")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
export function Metrics({ entries, month }: Actions) {
  const [hidden, setHidden] = useState(false);
  const t = totals(entries, month);
  const accounts = entries.filter((e) => e.kind === "account");
  const unpaid = entries.filter(
    (e) =>
      ["recurring", "debt"].includes(e.kind) &&
      !isPaid(e, entries, month) &&
      (e.kind !== "debt" || debtProgress(e, entries).remaining > 0),
  );
  const pending =
    t.pending +
    unpaid.reduce(
      (a, e) =>
        a + (e.kind === "debt" ? debtProgress(e, entries).next : e.amount),
      0,
    );
  const display = (v: number) => (hidden ? "••••••" : money(v));
  return (
    <div className="metrics">
      <section className="metric balance-card">
        <div className="metric-label">
          Saldo disponível{" "}
          <button
            onClick={() => setHidden(!hidden)}
            aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
          >
            {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        <strong>
          {display(accounts.reduce((n, a) => n + balance(a, entries), 0))}
        </strong>
        <p>
          Em {accounts.length} {accounts.length === 1 ? "conta" : "contas"}
        </p>
        <Image
          width={130}
          height={130}
          className="balance-watermark horse-watermark"
          src="/wzy-horse.png"
          alt=""
        />
      </section>
      <section className="metric">
        <div className="metric-label">
          Receitas do mês{" "}
          <span className="icon-box green">
            <ArrowDownLeft size={18} />
          </span>
        </div>
        <strong>{display(t.income)}</strong>
        <p>
          <span className="positive">Recebidas</span> neste mês
        </p>
      </section>
      <section className="metric">
        <div className="metric-label">
          Despesas do mês{" "}
          <span className="icon-box orange">
            <ArrowUpRight size={18} />
          </span>
        </div>
        <strong>{display(t.expense)}</strong>
        <p>Pagamentos concluídos</p>
      </section>
      <section className="metric">
        <div className="metric-label">
          A pagar{" "}
          <span className="icon-box blue">
            <CalendarDays size={18} />
          </span>
        </div>
        <strong>{display(pending)}</strong>
        <p>
          <span className="due-pill">{unpaid.length} vencimentos</span> no mês
        </p>
      </section>
    </div>
  );
}
export function ServiceIcon({ e }: { e: Entry }) {
  return (
    <div className="service-icon" style={{ background: e.color || "#467866" }}>
      {/youtube/i.test(e.name) ? (
        <Play size={18} fill="white" />
      ) : /spotify/i.test(e.name) ? (
        <Music size={18} />
      ) : (
        <Users size={18} />
      )}
    </div>
  );
}
export function TransactionTable({
  list,
  compact,
  ...p
}: Actions & {
  list: Entry[];
  compact?: boolean;
}) {
  const [historyRecord, setHistoryRecord] = useState<Entry>();
  if (!list.length)
    return (
      <Empty
        title="Nenhuma transação por aqui"
        detail="Adicione receitas e despesas para acompanhar seu mês."
      />
    );
  return (
    <>
      {historyRecord && (
        <FinancialHistory
          entry={historyRecord}
          onClose={() => setHistoryRecord(undefined)}
        />
      )}
      <div className="table-scroll">
        <table className="transaction-table">
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Data</th>
              <th>Valor</th>
              <th>Status</th>
              {!compact && <th>Ações</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>
                  <div className="transaction-name">
                    <span
                      className={`transaction-icon ${e.type === "income" ? "green" : ""}`}
                    >
                      {e.type === "income" ? (
                        <ArrowDownLeft size={17} />
                      ) : e.type === "transfer" ? (
                        <ArrowLeftRight size={17} />
                      ) : (
                        <ArrowUpRight size={17} />
                      )}
                    </span>
                    <span>
                      <b>{e.name}</b>
                      <small>
                        {p.entries.find((a) => a.id === e.accountId)?.name}
                        {e.type === "transfer"
                          ? " → " +
                            p.entries.find((a) => a.id === e.targetId)?.name
                          : ""}
                      </small>
                    </span>
                  </div>
                </td>
                <td data-label="Categoria">
                  <span className="category">
                    {e.type === "transfer"
                      ? "Transferência"
                      : e.category || "Outros"}
                  </span>
                </td>
                <td data-label="Data">
                  {e.date?.split("-").reverse().slice(0, 2).join("/")}
                </td>
                <td
                  data-label="Valor"
                  className={e.type === "income" ? "positive" : ""}
                >
                  {e.type === "income" ? "+" : e.type === "expense" ? "−" : ""}{" "}
                  {money(e.amount)}
                </td>
                <td data-label="Status">
                  <span
                    className={`status ${e.status === "pending" ? "pending" : ""}`}
                  >
                    {e.status === "paid" ? (
                      <Check size={12} />
                    ) : (
                      <CalendarDays size={12} />
                    )}{" "}
                    {e.status === "paid"
                      ? e.type === "income"
                        ? "Recebida"
                        : "Pago"
                      : "Pendente"}
                  </span>
                </td>
                {!compact && (
                  <td>
                    <div className="row-actions">
                      {e.attachmentId && (
                        <a
                          href={"/api/files/" + e.attachmentId}
                          aria-label="Baixar comprovante"
                        >
                          <Download size={15} />
                        </a>
                      )}
                      {p.authenticated && (
                        <button
                          onClick={() => setHistoryRecord(e)}
                          title={"Histórico de " + e.name}
                          aria-label={"Histórico de " + e.name}
                        >
                          ↺
                        </button>
                      )}
                      {!e.sourceId &&
                        !e.financialActivity &&
                        !e.adjustmentReason &&
                        !e.invoicePaymentCycle && (
                          <>
                            <button
                              onClick={() => p.edit("transaction", e)}
                              title="Editar"
                            >
                              <Pencil size={15} />
                            </button>
                            {e.status === "pending" && (
                              <button
                                onClick={() =>
                                  p
                                    .save({ ...e, status: "paid" })
                                    .catch((err) => p.notify(err.message))
                                }
                                title="Marcar como pago"
                              >
                                <Check size={16} />
                              </button>
                            )}
                            <button onClick={() => p.remove(e)} title="Excluir">
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      {(e.sourceId ||
                        e.financialActivity ||
                        e.adjustmentReason ||
                        e.invoicePaymentCycle) && (
                        <span className="subtle">Vinculada</span>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
