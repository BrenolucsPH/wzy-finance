"use client";
import { CalendarDays } from "lucide-react";
import {
  money,
  groupSplit,
  totals,
  dueDate,
  localDate,
} from "../../../lib/finance";
import { Empty } from "../../components";
import {
  isPaid,
  debtProgress,
  CashChart,
  Metrics,
  ServiceIcon,
  TransactionTable,
  type Actions,
} from "../shared";
export function Overview(p: Actions) {
  const { entries, month, navigate } = p;
  const t = totals(entries, month);
  const bills = entries
    .filter(
      (e) =>
        ["recurring", "debt"].includes(e.kind) &&
        !isPaid(e, entries, month) &&
        (e.kind !== "debt" || debtProgress(e, entries).remaining > 0),
    )
    .sort((a, b) => (a.day || 1) - (b.day || 1))
    .slice(0, 3);
  const groups = entries.filter((e) => e.kind === "group");
  const groupPending = groups.reduce(
    (a, e) =>
      a +
      groupSplit(e)
        .filter((_, i) => !e.payments?.[month]?.includes(e.members![i]))
        .reduce((x, y) => x + y, 0),
    0,
  );
  const mon = new Date(month + "-02T12:00:00")
    .toLocaleString("pt-BR", { month: "short" })
    .replace(".", "")
    .toUpperCase();
  return (
    <>
      <Metrics {...p} />
      <div className="dashboard-grid">
        <section className="card cash-flow">
          <div className="card-heading">
            <div>
              <h2>Fluxo de caixa</h2>
              <p>Receitas e despesas acumuladas no mês</p>
            </div>
            <div className="legend">
              <span>
                <i className="income-dot" />
                Receitas
              </span>
              <span>
                <i className="expense-dot" />
                Despesas
              </span>
            </div>
          </div>
          <CashChart entries={entries} month={month} />
          <div className="chart-footer">
            <span>
              Resultado do mês{" "}
              <b className="positive">{money(t.income - t.expense)}</b>
            </span>
            <span className="subtle">Receitas menos despesas</span>
          </div>
        </section>
        <section className="card upcoming">
          <div className="card-heading">
            <h2>Próximos vencimentos</h2>
            <button
              className="text-button"
              onClick={() => navigate("Contas recorrentes")}
            >
              Ver todos
            </button>
          </div>
          {!bills.length ? (
            <Empty
              title="Tudo em dia"
              detail="Nenhuma conta recorrente pendente neste mês."
            />
          ) : (
            bills.map((e) => (
              <div className="bill-row" key={e.id}>
                <span className="date-tile">
                  <b>{dueDate(month, e.day).slice(8)}</b>
                  <small>{mon}</small>
                </span>
                <div>
                  <b>{e.name}</b>
                  <small>
                    {e.category || "Outros"} ·{" "}
                    {e.kind === "debt" ? "Parcela" : "Mensal"}
                  </small>
                </div>
                <div className="bill-value">
                  <b>
                    {money(
                      e.kind === "debt"
                        ? debtProgress(e, entries).next
                        : e.amount,
                    )}
                  </b>
                  <small className="warning">
                    {dueDate(month, e.day) < localDate()
                      ? "Vencida"
                      : "A pagar"}
                  </small>
                </div>
              </div>
            ))
          )}
          <div className="notice">
            <CalendarDays size={17} />
            <span>Pequenos lembretes. Menos surpresas.</span>
          </div>
        </section>
        <section className="card transactions">
          <div className="card-heading">
            <h2>Últimas transações</h2>
            <button
              className="text-button"
              onClick={() => navigate("Transações")}
            >
              Ver todas
            </button>
          </div>
          <TransactionTable
            {...p}
            list={entries
              .filter(
                (e) => e.kind === "transaction" && e.date?.startsWith(month),
              )
              .slice()
              .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
              .slice(0, 4)}
            compact
          />
        </section>
        <section className="card subscriptions">
          <div className="card-heading">
            <h2>Seu grupo, organizado</h2>
            <button
              className="text-button"
              onClick={() => navigate("Assinaturas em grupo")}
            >
              Gerenciar
            </button>
          </div>
          {!groups.length ? (
            <Empty
              title="Um lugar para seus grupos"
              detail="Divida assinaturas e acompanhe os pagamentos."
            />
          ) : (
            groups.slice(0, 2).map((e) => (
              <div className="subscription-row" key={e.id}>
                <ServiceIcon e={e} />
                <div>
                  <b>{e.name}</b>
                  <small>
                    {e.members?.length} participantes · {money(e.amount)}/mês
                  </small>
                  <div className="mini-avatars">
                    {e.members?.slice(0, 6).map((m, i) => (
                      <span
                        key={m}
                        title={m}
                        style={{
                          background: [
                            "#dfe7f8",
                            "#f3e1d5",
                            "#d9e9e0",
                            "#e9dff4",
                            "#f1e5ca",
                          ][i % 5],
                        }}
                      >
                        {m[0]}
                      </span>
                    ))}
                    <small>
                      {e.payments?.[month]?.length || 0}/{e.members?.length}{" "}
                      pagos
                    </small>
                  </div>
                </div>
              </div>
            ))
          )}
          <div className="subscription-footer">
            <span>Pendente nos grupos</span>
            <b>{money(groupPending)}</b>
          </div>
        </section>
      </div>
    </>
  );
}
