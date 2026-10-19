"use client";
import { useEffect, useRef, useState } from "react";
import { requestJSON } from "../../../lib/client";
import { localDate, money, parseMoney } from "../../../lib/finance";
import type { Actions } from "../shared";
type Position = {
  id: string;
  symbol: string;
  name: string;
  currency: string;
  quantity: string;
  costBasis: number;
  marketValue: number;
  unrealized: number;
  realized: number;
  income: number;
  lastDate: string;
  operations: {
    id: string;
    operation: string;
    date: string;
    quantity: string;
    price_cents: number;
    reversal_of?: string;
  }[];
};
type Result = { positions: Position[]; totalMarketValue: number };
const labels: Record<string, string> = {
  buy: "Compra",
  sell: "Venda",
  income: "Rendimento",
  quote: "Cotação informada",
  reverse: "Correção",
};
export function PortfolioManager(p: Actions) {
  const accounts = p.entries.filter(
    (e) => e.kind === "account" && e.accountType === "investment",
  );
  const [data, setData] = useState<Result>({
      positions: [],
      totalMarketValue: 0,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [position, setPosition] = useState(""),
    [operation, setOperation] = useState("buy");
  const positionRequest = useRef(""),
    tradeRequest = useRef(""),
    reverseRequest = useRef("");
  useEffect(() => {
    let active = true;
    if (p.authenticated)
      void requestJSON<Result>("workspace/portfolio")
        .then((r) => {
          if (active) {
            setData(r);
            setPosition(r.positions[0]?.id || "");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [p.authenticated]);
  const selected = data.positions.find((x) => x.id === position),
    currency = selected?.currency || "BRL",
    format = (n: number) =>
      new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(
        n / 100,
      );
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      const next = await requestJSON<Result>("workspace/portfolio");
      setData(next);
      if (!position) setPosition(next.positions[0]?.id || "");
      await p.refresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!p.authenticated)
    return (
      <section className="card">
        <h2>Sua carteira de investimentos</h2>
        <p>Entre para acompanhar posições, operações e resultados.</p>
      </section>
    );
  return (
    <>
      <section className="card">
        <h2>Investimentos em perspectiva</h2>
        <p className="subtle">
          As cotações dos ativos são informadas por você. Compras e vendas
          ajustam o caixa da conta de investimentos; o principal aplicado não
          entra como gasto de consumo. Taxas e rendimentos têm lançamentos
          separados.
        </p>
        <strong className="plan-value">{money(data.totalMarketValue)}</strong>
        <p>
          Valor de mercado dos ativos, convertido em reais. O saldo de caixa das
          contas é acompanhado separadamente.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!accounts.length && (
          <button className="button primary" onClick={() => p.edit("account")}>
            Criar conta · escolha o tipo Investimentos
          </button>
        )}
      </section>
      <div className="dashboard-grid">
        <section className="card">
          <h2>Adicionar ativo</h2>
          <form
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = Object.fromEntries(new FormData(form));
              if (!positionRequest.current)
                positionRequest.current = crypto.randomUUID();
              void run(async () => {
                await requestJSON("workspace/investment/position", {
                  accountId: String(f.accountId),
                  symbol: String(f.symbol),
                  name: String(f.name),
                  assetType: String(f.assetType),
                  requestId: positionRequest.current,
                });
                positionRequest.current = "";
                form.reset();
                p.notify("Ativo adicionado.");
              });
            }}
          >
            <label>
              Conta de investimentos
              <select name="accountId" required>
                <option value="">Selecione</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency || "BRL"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Código
              <input
                name="symbol"
                maxLength={30}
                required
                placeholder="Ex.: PETR4, CDB, ETF"
              />
            </label>
            <label>
              Nome
              <input name="name" maxLength={100} required />
            </label>
            <label>
              Tipo
              <select name="assetType">
                <option value="stock">Ação</option>
                <option value="fund">Fundo ou ETF</option>
                <option value="fixed_income">Renda fixa</option>
                <option value="crypto">Criptoativo</option>
                <option value="other">Outro</option>
              </select>
            </label>
            <button className="button" disabled={busy}>
              Adicionar ativo
            </button>
          </form>
        </section>
        <section className="card">
          <h2>Registrar operação</h2>
          <form
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = Object.fromEntries(new FormData(form));
              if (!tradeRequest.current)
                tradeRequest.current = crypto.randomUUID();
              void run(async () => {
                await requestJSON("workspace/investment/operation", {
                  positionId: position,
                  operation,
                  quantity: ["buy", "sell"].includes(operation)
                    ? String(f.quantity).replace(",", ".")
                    : "0",
                  price: parseMoney(String(f.price)),
                  fees: parseMoney(String(f.fees || "0")),
                  date: String(f.date),
                  requestId: tradeRequest.current,
                });
                tradeRequest.current = "";
                p.notify("Operação e movimentação de caixa registradas.");
              });
            }}
          >
            <label>
              Ativo
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                required
              >
                <option value="">Selecione</option>
                {data.positions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.symbol} · {x.currency}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Operação
              <select
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
              >
                {Object.entries(labels)
                  .filter(([k]) => k !== "reverse")
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </label>
            {["buy", "sell"].includes(operation) && (
              <label>
                Quantidade
                <input
                  name="quantity"
                  inputMode="decimal"
                  placeholder="Ex.: 10 ou 0,125"
                  required
                />
              </label>
            )}
            <label>
              {operation === "income"
                ? "Rendimento total"
                : "Preço por unidade"}{" "}
              ({currency})<input name="price" inputMode="decimal" required />
            </label>
            {operation !== "quote" && (
              <label>
                Taxas ({currency})
                <input name="fees" inputMode="decimal" defaultValue="0,00" />
              </label>
            )}
            <label>
              Data
              <input
                name="date"
                type="date"
                defaultValue={localDate()}
                required
              />
            </label>
            <button className="button primary" disabled={busy || !position}>
              Registrar
            </button>
          </form>
        </section>
      </div>
      {selected && (
        <>
          <section className="card">
            <h2>
              {selected.symbol} · {selected.name}
            </h2>
            <div className="mini-summary">
              <span>
                Quantidade <b>{selected.quantity}</b>
              </span>
              <span>
                Custo da posição <b>{format(selected.costBasis)}</b>
              </span>
              <span>
                Valor informado <b>{format(selected.marketValue)}</b>
              </span>
              <span>
                Resultado não realizado <b>{format(selected.unrealized)}</b>
              </span>
              <span>
                Resultado realizado <b>{format(selected.realized)}</b>
              </span>
              <span>
                Rendimentos <b>{format(selected.income)}</b>
              </span>
            </div>
            <p className="subtle">
              Último preço informado em {selected.lastDate || "nenhuma data"}.
              Os resultados estão na moeda do ativo.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Operação</th>
                    <th>Quantidade</th>
                    <th>Preço ou rendimento</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.operations.map((o) => (
                    <tr key={o.id}>
                      <td>{o.date}</td>
                      <td>{labels[o.operation]}</td>
                      <td>{o.quantity}</td>
                      <td>{format(Number(o.price_cents))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="subtle">
              Até 50 operações recentes nesta tela. Todas permanecem na
              exportação e no histórico.
            </p>
          </section>
          <section className="card">
            <h2>Corrigir um registro</h2>
            <p>
              Uma correção preserva a operação original e reverte seus
              lançamentos de caixa. Operações dependentes precisam ser
              corrigidas primeiro.
            </p>
            <form
              className="entry-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  f = Object.fromEntries(new FormData(form));
                if (!reverseRequest.current)
                  reverseRequest.current = crypto.randomUUID();
                void run(async () => {
                  await requestJSON("workspace/investment/reverse", {
                    operationId: String(f.operationId),
                    reason: String(f.reason),
                    date: String(f.date),
                    requestId: reverseRequest.current,
                  });
                  reverseRequest.current = "";
                  form.reset();
                  p.notify("Correção registrada.");
                });
              }}
            >
              <label>
                Operação
                <select name="operationId" required>
                  <option value="">Selecione</option>
                  {selected.operations
                    .filter(
                      (o) =>
                        o.operation !== "reverse" &&
                        !selected.operations.some(
                          (r) => r.reversal_of === o.id,
                        ),
                    )
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.date} · {labels[o.operation]} · {o.quantity}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Motivo
                <input name="reason" minLength={3} maxLength={300} required />
              </label>
              <label>
                Data da correção
                <input
                  name="date"
                  type="date"
                  defaultValue={localDate()}
                  required
                />
              </label>
              <button className="button" disabled={busy}>
                Registrar correção
              </button>
            </form>
          </section>
        </>
      )}
    </>
  );
}
