"use client";
import { categorySpend } from "../../../lib/planning";
import { money, totals, categories } from "../../../lib/finance";
import { Empty } from "../../components";
import { CashChart, type Actions } from "../shared";
export function Reports(p: Actions) {
  const t = totals(p.entries, p.month);
  const savings = t.income
    ? Math.round(((t.income - t.expense) / t.income) * 100)
    : 0;
  const list = Array.from(
    new Set([
      ...categories,
      ...(p.entries
        .find((e) => e._summary)
        ?._summary?.months.map((r) => r.category) || []),
      ...p.entries.map((e) => e.category || "").filter(Boolean),
    ]),
  )
    .map((c, i) => ({
      name: c,
      amount: categorySpend(p.entries, p.month, c),
      color: ["#397e69", "#6b8da1", "#b59a77", "#7f8b6f", "#8092bf", "#af809c"][
        i % 6
      ],
    }))
    .filter((e) => e.amount)
    .sort((a, b) => b.amount - a.amount);
  return (
    <>
      <div className="mini-summary">
        <span>
          Receitas <b className="positive">{money(t.income)}</b>
        </span>
        <span>
          Despesas <b>{money(t.expense)}</b>
        </span>
        <span>
          Taxa de economia <b>{savings}%</b>
        </span>
      </div>
      <div className="dashboard-grid">
        <section className="card">
          <div className="card-heading">
            <h2>Entradas e saídas</h2>
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
          <CashChart entries={p.entries} month={p.month} />
          <div className="chart-footer">
            <span>Resultado líquido</span>
            <b className="positive">{money(t.income - t.expense)}</b>
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <h2>Despesas por categoria</h2>
          </div>
          {list.length ? (
            <div className="category-chart">
              {list.map((e) => (
                <div key={e.name}>
                  <div className="group-details">
                    <span>{e.name}</span>
                    <b>{money(e.amount)}</b>
                  </div>
                  <div className="progress">
                    <i
                      style={{
                        width: `${(e.amount / t.expense) * 100}%`,
                        background: e.color,
                      }}
                    />
                  </div>
                  <small>
                    {Math.round((e.amount / t.expense) * 100)}% das despesas
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="Seu mês em números"
              detail="Registre despesas para analisar as categorias."
            />
          )}
        </section>
      </div>
      <section className="card report-detail">
        <div className="card-heading">
          <h2>Visão dos últimos 6 meses</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Receitas</th>
                <th>Despesas</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, i) => {
                const d = new Date(
                  Number(p.month.slice(0, 4)),
                  Number(p.month.slice(5, 7)) - 1 - i,
                  2,
                );
                const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                const v = totals(p.entries, m);
                return (
                  <tr key={m}>
                    <td>
                      {d.toLocaleString("pt-BR", {
                        month: "long",
                        year: "numeric",
                      })}
                    </td>
                    <td className="positive">{money(v.income)}</td>
                    <td>{money(v.expense)}</td>
                    <td>{money(v.income - v.expense)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
