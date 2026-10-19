"use client";
import { budgetPlan, categorySpend } from "../../../lib/planning";
import { useState } from "react";
import {
  Check,
  CreditCard,
  Plus,
  Target,
  Trash2,
  Pencil,
  Wallet,
} from "lucide-react";
import { Ripple } from "../../motion-ui";
import { money, parseMoney, type Entry } from "../../../lib/finance";
import { Empty, Modal } from "../../components";
import { isPaid, debtProgress, type Actions } from "../shared";
export function Plans(
  p: Actions & {
    kind: "goal" | "budget" | "debt";
  },
) {
  const list = p.entries.filter((e) => e.kind === p.kind);
  const [deposit, setDeposit] = useState<Entry | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      {!list.length ? (
        <section className="card">
          <Empty
            title={
              p.kind === "goal"
                ? "Um destino para seu dinheiro"
                : p.kind === "budget"
                  ? "Planeje antes de gastar"
                  : "Uma visão clara das suas dívidas"
            }
            detail={
              p.kind === "goal"
                ? "Crie uma meta e acompanhe o valor reservado."
                : p.kind === "budget"
                  ? "Defina limites mensais por categoria."
                  : "Cadastre valores, parcelas e vencimentos."
            }
            action={
              <button className="button primary" onClick={() => p.edit(p.kind)}>
                <Plus size={17} />
                Adicionar
              </button>
            }
          />
        </section>
      ) : (
        <div className="cards-grid">
          {list.map((e) => {
            const paid = debtProgress(e, p.entries);
            const spent = categorySpend(
              p.entries,
              p.month,
              e.category || e.name,
            );
            const current =
              p.kind === "goal"
                ? e.saved || 0
                : p.kind === "debt"
                  ? e.amount - paid.remaining
                  : spent;
            const available =
              p.kind === "budget"
                ? budgetPlan(e, p.entries, p.month).available
                : e.amount;
            const percent = available ? (current / available) * 100 : 0;
            return (
              <section className="card plan-card" key={e.id}>
                <div className="group-heading">
                  <div
                    className="icon-box"
                    style={{
                      background: (e.color || "#357c67") + "18",
                      color: e.color || "#357c67",
                    }}
                  >
                    {p.kind === "goal" ? (
                      <Target size={20} />
                    ) : p.kind === "budget" ? (
                      <Wallet size={20} />
                    ) : (
                      <CreditCard size={20} />
                    )}
                  </div>
                  <h2 className="grow">{e.name}</h2>
                  <button title="Editar" onClick={() => p.edit(p.kind, e)}>
                    <Pencil size={16} />
                  </button>
                  <button title="Excluir" onClick={() => p.remove(e)}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <strong className="plan-value">
                  {money(p.kind === "debt" ? paid.remaining : current)}
                </strong>
                <p className="subtle">
                  {p.kind === "debt"
                    ? "Saldo restante"
                    : p.kind === "goal"
                      ? "reservados"
                      : "gastos"}{" "}
                  · total {money(available)}
                </p>
                <div
                  className={`progress ${percent > 100 ? "over-budget" : ""}`}
                >
                  <i
                    style={{
                      width: `${Math.min(100, percent)}%`,
                      background: p.kind === "goal" ? e.color : undefined,
                    }}
                  />
                </div>
                <div className="group-details">
                  <span>
                    {p.kind === "debt"
                      ? `${paid.count} de ${e.installments} parcelas pagas`
                      : `${Math.round(percent)}% ${p.kind === "goal" ? "da meta" : "do orçamento"}`}
                  </span>
                  <b>
                    {p.kind === "budget" && spent > available
                      ? "Limite excedido"
                      : money(Math.max(0, available - current))}
                  </b>
                </div>
                {e.date && (
                  <small className="subtle">
                    Planejado para {e.date.split("-").reverse().join("/")}
                  </small>
                )}
                {p.kind === "goal" && (
                  <button
                    className="button full"
                    onClick={() => {
                      setDeposit(e);
                      setError("");
                    }}
                  >
                    <Plus size={16} />
                    Adicionar à meta
                  </button>
                )}
                {p.kind === "debt" && (
                  <button
                    className="button full"
                    disabled={!paid.remaining || isPaid(e, p.entries, p.month)}
                    onClick={() => p.pay(e)}
                  >
                    <Check size={16} />
                    {!paid.remaining
                      ? "Dívida quitada"
                      : isPaid(e, p.entries, p.month)
                        ? "Parcela do mês paga"
                        : "Pagar parcela · " + money(paid.next)}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
      {p.kind === "goal" && (
        <div className="notice wide">
          Os valores reservados são um acompanhamento da meta. Para movimentar
          dinheiro entre contas, registre uma transferência.
        </div>
      )}
      {deposit && (
        <Modal title="Adicionar à meta" onClose={() => setDeposit(null)}>
          <form
            className="entry-form"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const value = parseMoney(
                String(new FormData(ev.currentTarget).get("value")),
              );
              if (!Number.isFinite(value) || value <= 0) {
                setError("Informe um valor maior que zero.");
                return;
              }
              setBusy(true);
              try {
                await p.save({
                  ...deposit,
                  saved: (deposit.saved || 0) + value,
                });
                setDeposit(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>{deposit.name}</p>
            <label>
              Valor (R$)
              <input
                name="value"
                required
                inputMode="decimal"
                placeholder="0,00"
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button className="button primary" disabled={busy}>
              {busy ? (
                <>
                  <Ripple small label="Salvando" />
                  Salvando…
                </>
              ) : (
                "Adicionar valor"
              )}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
