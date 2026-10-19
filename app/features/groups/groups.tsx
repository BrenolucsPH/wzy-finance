"use client";
import { GroupSharing, SharedGroups } from "./sharing";
import { useState } from "react";
import { Check, Plus, Pencil, Users, Copy, CheckCheck } from "lucide-react";
import { Ripple } from "../../motion-ui";
import { money, groupSplit, type Entry } from "../../../lib/finance";
import { Empty, Modal } from "../../components";
import { ServiceIcon, type Actions } from "../shared";
export function Groups(p: Actions) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = p.entries.filter((e) => e.kind === "group");
  const current = list.find((e) => e.id === selected);
  async function toggle(e: Entry, m: string) {
    setBusy(true);
    try {
      const paid = e.payments?.[p.month] || [];
      await p.save({
        ...e,
        payments: {
          ...e.payments,
          [p.month]: paid.includes(m)
            ? paid.filter((x) => x !== m)
            : [...paid, m],
        },
      });
    } catch (e) {
      p.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SharedGroups {...p} />
      <div className="notice wide">
        <Users size={18} />
        Os pagamentos dos participantes são acompanhados separadamente das
        despesas bancárias. Registre o pagamento da plataforma em Transações.
      </div>
      {!list.length ? (
        <section className="card">
          <Empty
            title="Cada participante, cada pagamento"
            detail="Organize YouTube Premium, Spotify e outras assinaturas compartilhadas."
            action={
              <button
                className="button primary"
                onClick={() => p.edit("group")}
              >
                <Plus size={17} />
                Criar grupo
              </button>
            }
          />
        </section>
      ) : (
        <div className="cards-grid">
          {list.map((e) => {
            const parts = groupSplit(e);
            const paid = e.payments?.[p.month] || [];
            const sum = parts.reduce(
              (n, v, i) => n + (paid.includes(e.members![i]) ? v : 0),
              0,
            );
            return (
              <section className="card group-card" key={e.id}>
                <div className="group-heading">
                  <ServiceIcon e={e} />
                  <div className="grow">
                    <h2>{e.name}</h2>
                    <small>
                      {e.members?.length} participantes · vence dia {e.day}
                    </small>
                  </div>
                  <button
                    onClick={() => p.edit("group", e)}
                    title="Editar grupo"
                  >
                    <Pencil size={17} />
                  </button>
                </div>
                <div className="group-price">
                  <strong>{money(e.amount)}</strong>
                  <span>/mês</span>
                </div>
                <div className="group-details">
                  <span>Cota por pessoa</span>
                  <b>
                    {money(parts[parts.length - 1])}
                    {parts[0] !== parts[parts.length - 1]
                      ? " a " + money(parts[0])
                      : ""}
                  </b>
                </div>
                <div className="progress">
                  <i
                    style={{
                      width: `${(sum / e.amount) * 100 || 0}%`,
                      background: e.color,
                    }}
                  />
                </div>
                <div className="group-details">
                  <span>
                    {paid.length} de {e.members!.length} pagos
                  </span>
                  <b className="warning">{money(e.amount - sum)} pendente</b>
                </div>
                <button
                  className="button full"
                  onClick={() => setSelected(e.id)}
                >
                  Gerenciar participantes
                  <Users size={17} />
                </button>
              </section>
            );
          })}
        </div>
      )}
      {current && (
        <Modal title={current.name} onClose={() => setSelected(null)}>
          <p className="subtle">
            {new Date(p.month + "-02T12:00:00").toLocaleString("pt-BR", {
              month: "long",
              year: "numeric",
            })}{" "}
            · {money(current.amount)} no total
          </p>
          <div className="participant-list">
            {current.members!.map((m, i) => {
              const paid = current.payments?.[p.month]?.includes(m);
              return (
                <div key={m}>
                  <span className="avatar">{m[0]}</span>
                  <div className="grow">
                    <b>{m}</b>
                    <small>{money(groupSplit(current)[i])}</small>
                  </div>
                  <button
                    className={`button ${paid ? "paid-button" : ""}`}
                    disabled={busy}
                    onClick={() => toggle(current, m)}
                  >
                    {busy ? (
                      <Ripple small label="Atualizando pagamento" />
                    ) : paid ? (
                      <CheckCheck size={16} />
                    ) : (
                      <Check size={16} />
                    )}{" "}
                    {paid ? "Pago" : "Marcar pago"}
                  </button>
                  <button
                    title="Copiar lembrete de pagamento"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `Olá, ${m}! Sua cota de ${current.name} de ${p.month.split("-").reverse().join("/")} é ${money(groupSplit(current)[i])}, com vencimento no dia ${current.day}. Obrigado!`,
                        );
                        p.notify("Lembrete copiado.");
                      } catch {
                        p.notify("Não foi possível copiar o lembrete.");
                      }
                    }}
                  >
                    <Copy size={17} />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="subtle small-text">
            O ajuste de centavos mantém a soma das cotas igual ao valor da
            assinatura.
          </p>
          <GroupSharing {...p} group={current} />
        </Modal>
      )}
    </>
  );
}
