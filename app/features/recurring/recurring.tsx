"use client";
import {
  CalendarDays,
  Check,
  Plus,
  Trash2,
  Pencil,
  Wallet,
} from "lucide-react";
import { money, dueDate, localDate } from "../../../lib/finance";
import { Empty } from "../../components";
import { isPaid, type Actions } from "../shared";
export function Recurring(p: Actions) {
  const list = p.entries
    .filter((e) => e.kind === "recurring")
    .sort((a, b) => (a.day || 1) - (b.day || 1));
  const paid = list.filter((e) => isPaid(e, p.entries, p.month));
  return (
    <>
      <div className="mini-summary">
        <span>
          Total mensal <b>{money(list.reduce((s, e) => s + e.amount, 0))}</b>
        </span>
        <span>
          Pago neste mês{" "}
          <b className="positive">
            {money(paid.reduce((s, e) => s + e.amount, 0))}
          </b>
        </span>
        <span>
          Pendente <b>{list.length - paid.length} contas</b>
        </span>
      </div>
      <section className="card">
        {!list.length ? (
          <Empty
            title="Seus compromissos, organizados"
            detail="Cadastre luz, internet, água, aluguel e outras contas mensais."
            action={
              <button
                className="button primary"
                onClick={() => p.edit("recurring")}
              >
                <Plus size={17} />
                Adicionar conta
              </button>
            }
          />
        ) : (
          list.map((e) => {
            const paid = isPaid(e, p.entries, p.month);
            return (
              <div className="recurring-row" key={e.id}>
                <div className="icon-box blue">
                  <CalendarDays size={20} />
                </div>
                <div className="grow">
                  <b>{e.name}</b>
                  <small>
                    {e.category} · Todo dia {e.day}
                    {e.notes ? " · " + e.notes : ""}
                  </small>
                </div>
                <div className="bill-value">
                  <b>{money(e.amount)}</b>
                  <small>
                    {dueDate(p.month, e.day).split("-").reverse().join("/")}
                  </small>
                </div>
                <span className={`status ${paid ? "" : "pending"}`}>
                  {paid
                    ? "Pago"
                    : dueDate(p.month, e.day) < localDate()
                      ? "Vencida"
                      : "Pendente"}
                </span>
                <button
                  className="button"
                  disabled={paid}
                  onClick={() => p.pay(e)}
                >
                  {paid ? <Check size={16} /> : <Wallet size={16} />}{" "}
                  {paid ? "Concluído" : "Pagar"}
                </button>
                <div className="row-actions">
                  <button onClick={() => p.edit("recurring", e)} title="Editar">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => p.remove(e)} title="Excluir">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>
      <div className="notice wide">
        Ao pagar, uma despesa é registrada na conta escolhida. O próximo mês
        terá um novo vencimento.
      </div>
    </>
  );
}
