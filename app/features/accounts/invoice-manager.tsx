"use client";
import { useEffect, useRef, useState } from "react";
import { requestJSON } from "../../../lib/client";
import { localDate, money, parseMoney, type Entry } from "../../../lib/finance";
import type { Invoice } from "../../../lib/domain/invoices";
import type { Actions } from "../shared";
import { TransactionTable } from "../shared";
import { Ripple } from "../../motion-ui";
type Result = { card: Entry; invoices: Invoice[]; unallocatedCredit: number };
export function InvoiceManager(p: Actions) {
  const cards = p.entries.filter((e) => e.kind === "card"),
    accounts = p.entries.filter(
      (e) => e.kind === "account" && (!e.currency || e.currency === "BRL"),
    );
  const [card, setCard] = useState(cards[0]?.id || ""),
    [cycle, setCycle] = useState(p.month),
    [data, setData] = useState<Result>(),
    [items, setItems] = useState<Entry[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const paymentId = useRef<string>(""),
    adjustmentId = useRef<string>("");
  async function load() {
    if (!card || !p.authenticated) return;
    const result = await requestJSON<Result>(
      "workspace/invoices?card=" + encodeURIComponent(card),
    );
    setData(result);
    const rows = await requestJSON<{
      entries: Entry[];
      nextCursor: string | null;
    }>(
      "workspace/transactions?account=" +
        encodeURIComponent(card) +
        "&invoice=" +
        cycle,
    );
    setItems(rows.entries);
    setCursor(rows.nextCursor);
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (card && p.authenticated) {
      void Promise.all([
        requestJSON<Result>(
          "workspace/invoices?card=" + encodeURIComponent(card),
          undefined,
          controller.signal,
        ),
        requestJSON<{ entries: Entry[]; nextCursor: string | null }>(
          "workspace/transactions?account=" +
            encodeURIComponent(card) +
            "&invoice=" +
            cycle,
          undefined,
          controller.signal,
        ),
      ])
        .then(([result, rows]) => {
          if (active) {
            setData(result);
            setItems(rows.entries);
            setCursor(rows.nextCursor);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [card, cycle, p.authenticated]);
  const invoice = data?.invoices.find((i) => i.cycle === cycle);
  async function run(action: () => Promise<void>, reload = true) {
    setBusy(true);
    setError("");
    try {
      await action();
      if (reload) {
        await load();
        await p.refresh?.();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!p.authenticated)
    return (
      <section className="card">
        <h2>Faturas organizadas por mês</h2>
        <p>
          Entre para acompanhar compras, fechar faturas, registrar pagamentos
          parciais e estornos.
        </p>
      </section>
    );
  if (!cards.length)
    return (
      <section className="card">
        <h2>Seu primeiro cartão</h2>
        <p>Cadastre o cartão, o dia de fechamento e o vencimento.</p>
        <button className="button primary" onClick={() => p.edit("card")}>
          Adicionar cartão
        </button>
      </section>
    );
  return (
    <>
      <section className="card">
        <div className="filterbar">
          <label>
            Cartão
            <select value={card} onChange={(e) => setCard(e.target.value)}>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ciclo de fechamento
            <input
              type="month"
              value={cycle}
              onChange={(e) => setCycle(e.target.value)}
              required
            />
          </label>
        </div>
        <p className="subtle">
          Os ciclos usam o fechamento cadastrado. Pagamentos antigos sem ciclo
          são distribuídos pelas faturas mais antigas.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="mini-summary">
          <span>
            Compras e ajustes <b>{money(invoice?.charges || 0)}</b>
          </span>
          <span>
            Pago <b>{money(invoice?.paid || 0)}</b>
          </span>
          <span>
            Saldo da fatura <b>{money(invoice?.remaining || 0)}</b>
          </span>
          <span>
            Previsto <b>{money(invoice?.pending || 0)}</b>
          </span>
        </div>
        <p>
          Fecha {invoice?.closingDate || "no dia cadastrado"} · vence{" "}
          {invoice?.dueDate || "no dia cadastrado"} ·{" "}
          {invoice?.status === "closed" ? "Fechada" : "Aberta"}
        </p>
        {!!data?.unallocatedCredit && (
          <p>Crédito ainda não utilizado: {money(data.unallocatedCredit)}</p>
        )}
        <button
          className="button"
          disabled={busy || invoice?.status === "closed"}
          onClick={() =>
            run(async () => {
              await requestJSON("workspace/invoice/close", {
                cardId: card,
                cycle,
              });
              p.notify(
                "Fatura fechada. Alterações de valor precisam de ajuste ou estorno.",
              );
            })
          }
        >
          Fechar fatura
        </button>
      </section>
      <div className="dashboard-grid">
        <section className="card">
          <h2>Registrar pagamento</h2>
          <p className="subtle">
            Você pode pagar parte da fatura. O pagamento é uma transferência e
            preserva o histórico de despesas.
          </p>
          <form
            key={card + cycle}
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              if (!paymentId.current) paymentId.current = crypto.randomUUID();
              void run(async () => {
                await requestJSON("workspace/invoice/pay", {
                  cardId: card,
                  cycle,
                  accountId: String(f.accountId),
                  amount: parseMoney(String(f.amount)),
                  date: String(f.date),
                  requestId: paymentId.current,
                });
                paymentId.current = "";
                p.notify("Pagamento da fatura registrado.");
              });
            }}
          >
            <label>
              Conta
              <select name="accountId" required>
                <option value="">Selecione</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Valor (R$)
              <input
                name="amount"
                inputMode="decimal"
                defaultValue={((invoice?.remaining || 0) / 100).toLocaleString(
                  "pt-BR",
                  { minimumFractionDigits: 2 },
                )}
                required
              />
            </label>
            <label>
              Data
              <input
                name="date"
                type="date"
                defaultValue={localDate()}
                required
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? <Ripple small /> : "Registrar pagamento"}
            </button>
          </form>
        </section>
        <section className="card">
          <h2>Ajuste ou estorno</h2>
          <p className="subtle">
            Uma nova movimentação documenta a correção. A compra original
            permanece no histórico.
          </p>
          <form
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = Object.fromEntries(new FormData(form));
              if (!adjustmentId.current)
                adjustmentId.current = crypto.randomUUID();
              void run(async () => {
                await requestJSON("workspace/invoice/adjust", {
                  cardId: card,
                  cycle,
                  type: String(f.type),
                  amount: parseMoney(String(f.amount)),
                  date: String(f.date),
                  reason: String(f.reason),
                  reversalOf: String(f.reversalOf) || undefined,
                  requestId: adjustmentId.current,
                });
                adjustmentId.current = "";
                form.reset();
                p.notify("Correção registrada no histórico.");
              });
            }}
          >
            <label>
              Tipo
              <select name="type">
                <option value="refund">Estorno ou crédito</option>
                <option value="charge">Encargo ou ajuste de cobrança</option>
              </select>
            </label>
            <label>
              Compra de origem (opcional)
              <select name="reversalOf">
                <option value="">Ajuste sem compra vinculada</option>
                {items
                  .filter((i) => i.type === "expense")
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} · {money(i.amount)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Valor (R$)
              <input name="amount" inputMode="decimal" required />
            </label>
            <label>
              Data
              <input
                name="date"
                type="date"
                defaultValue={localDate()}
                required
              />
            </label>
            <label>
              Motivo
              <input name="reason" minLength={3} maxLength={300} required />
            </label>
            <button className="button" disabled={busy}>
              Registrar correção
            </button>
          </form>
        </section>
      </div>
      <section className="card">
        <h2>Movimentações deste ciclo</h2>
        <TransactionTable {...p} list={items} />
        {cursor && (
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const next = await requestJSON<{
                  entries: Entry[];
                  nextCursor: string | null;
                }>(
                  "workspace/transactions?account=" +
                    encodeURIComponent(card) +
                    "&invoice=" +
                    cycle +
                    "&cursor=" +
                    encodeURIComponent(cursor),
                );
                setItems((i) => [...i, ...next.entries]);
                setCursor(next.nextCursor);
              }, false)
            }
          >
            Carregar mais compras
          </button>
        )}
      </section>
    </>
  );
}
