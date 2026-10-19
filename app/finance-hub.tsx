"use client";
import { FeatureTabs } from "./ui/feature-tabs";
import { useState, useRef, useEffect, type FormEvent } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Download,
  FileUp,
  MessageCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { money, localDate, parseMoney, nativeBalance } from "../lib/finance";
import {
  calendar,
  dateShift,
  budgetPlan,
  forecast,
  insights,
  anomalies,
  health,
  answerQuestion,
  monthShift,
} from "../lib/planning";
import { PageSkeleton, Ripple } from "./motion-ui";
import { exportExcel, exportPdf, downloadBlob } from "../lib/exports";
import type { Actions } from "./views";
import type { Person } from "./components";
export { requestJSON as financeApi } from "../lib/client";
import { requestJSON as financeApi } from "../lib/client";
type HubProps = Actions & {
  user: Person | null;
  login: () => void;
  refresh: () => Promise<void>;
};
export function PlanningHub(p: HubProps) {
  const [tab, setTab] = useState("Fluxo projetado"),
    [days, setDays] = useState(30),
    [income, setIncome] = useState(0),
    [expense, setExpense] = useState(0);
  const today = localDate(),
    projection = forecast(
      p.entries,
      today,
      days,
      tab === "Cenários" ? income : 0,
      tab === "Cenários" ? expense : 0,
    ),
    events = calendar(
      p.entries,
      p.month + "-01",
      dateShift(monthShift(p.month, 1) + "-01", -1),
    ),
    budgets = p.entries.filter((e) => e.kind === "budget"),
    goals = p.entries.filter((e) => e.kind === "goal");
  return (
    <>
      <HubTabs
        value={tab}
        values={[
          "Fluxo projetado",
          "Cenários",
          "Calendário",
          "Orçamentos e metas",
        ]}
        onChange={setTab}
      />
      <div className="hub-panel" key={tab}>
        {tab === "Fluxo projetado" || tab === "Cenários" ? (
          <>
            <section className="card hub-card">
              <div className="hub-heading">
                <div>
                  <h2>
                    {tab === "Cenários"
                      ? "E se as coisas mudarem?"
                      : "Seu dinheiro nos próximos dias."}
                  </h2>
                  <p>
                    Projeção com saldo registrado, receitas pendentes e
                    compromissos cadastrados.
                  </p>
                </div>
                <div className="segmented">
                  {[30, 60, 90].map((n) => (
                    <button
                      key={n}
                      className={days === n ? "selected" : ""}
                      onClick={() => setDays(n)}
                    >
                      {n} dias
                    </button>
                  ))}
                </div>
              </div>
              {tab === "Cenários" && (
                <div className="hub-grid">
                  <label>
                    Redução da renda: {income}%
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={income}
                      onChange={(e) => setIncome(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Redução dos gastos: {expense}%
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={expense}
                      onChange={(e) => setExpense(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}
              <div className="hub-stat-grid">
                <HubStat
                  title="Saldo inicial"
                  value={money(projection.opening)}
                />
                <HubStat
                  title="Entradas previstas"
                  value={money(projection.income)}
                />
                <HubStat
                  title="Saídas previstas"
                  value={money(projection.expense)}
                />
                <HubStat
                  title="Saldo projetado"
                  value={money(projection.closing)}
                  warning={projection.closing < 0}
                />
              </div>
              <div className="notice wide">
                {projection.minimum < 0
                  ? "A projeção inclui um saldo negativo. Confira as datas e os compromissos."
                  : "Projeções dependem dos registros disponíveis e não incluem rendas ou gastos não cadastrados. Faturas de cartão são estimadas pelos registros e não substituem a fatura do banco."}{" "}
                No simulador, apenas os lançamentos futuros são ajustados;
                nenhum registro é alterado.
              </div>
            </section>
            <section className="card hub-card">
              <h2>Movimentações previstas</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th>Valor</th>
                      <th>Saldo projetado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projection.items.map((e) => (
                      <tr key={e.id}>
                        <td>{e.date}</td>
                        <td>{e.name}</td>
                        <td className={e.type === "income" ? "positive" : ""}>
                          {e.type === "income" ? "+" : "−"} {money(e.adjusted)}
                        </td>
                        <td>{money(e.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!projection.items.length && (
                <p className="subtle">
                  Cadastre receitas pendentes, recorrências e dívidas para
                  ampliar a projeção.
                </p>
              )}
            </section>
          </>
        ) : tab === "Calendário" ? (
          <section className="card hub-card">
            <div className="hub-heading">
              <div>
                <h2>Calendário financeiro</h2>
                <p>Vencimentos e receitas pendentes em {p.month}.</p>
              </div>
              <CalendarDays size={25} />
            </div>
            <div className="calendar-grid">
              {Array.from(
                {
                  length: Number(
                    dateShift(monthShift(p.month, 1) + "-01", -1).slice(8),
                  ),
                },
                (_, i) => {
                  const date = p.month + "-" + String(i + 1).padStart(2, "0"),
                    list = events.filter((e) => e.date === date);
                  return (
                    <div
                      className={
                        "calendar-day " + (date === today ? "today" : "")
                      }
                      key={date}
                    >
                      <b>{i + 1}</b>
                      {list.map((e) => (
                        <div
                          key={e.id}
                          className={e.type === "income" ? "positive" : ""}
                        >
                          <span>{e.name}</span>
                          <small>{money(e.amount)}</small>
                        </div>
                      ))}
                    </div>
                  );
                },
              )}
            </div>
            <p className="subtle">
              O calendário exibe compromissos pendentes; pagamentos confirmados
              saem da agenda.
            </p>
          </section>
        ) : (
          <>
            <section className="card hub-card">
              <div className="hub-heading">
                <div>
                  <h2>Orçamentos com sobra acumulada</h2>
                  <p>Limites e alertas por categoria em {p.month}.</p>
                </div>
                <button className="button" onClick={() => p.edit("budget")}>
                  <Plus size={16} />
                  Orçamento
                </button>
              </div>
              {budgets.map((b) => {
                const plan = budgetPlan(b, p.entries, p.month);
                return (
                  <div className="hub-budget" key={b.id}>
                    <div>
                      <b>{b.name}</b>
                      <p>
                        {b.rollover
                          ? "Sobra trazida: " + money(plan.carry)
                          : "Sem transferência de sobra"}
                      </p>
                    </div>
                    <div>
                      <strong>
                        {money(plan.spent)} / {money(plan.available)}
                      </strong>
                      <p className={plan.percent >= 100 ? "warning" : "subtle"}>
                        {plan.percent >= 100
                          ? "Limite atingido"
                          : plan.percent >= 80
                            ? "Atenção: acima de 80%"
                            : money(plan.remaining) + " disponível"}
                      </p>
                    </div>
                    <div className="progress">
                      <i style={{ width: Math.min(100, plan.percent) + "%" }} />
                    </div>
                  </div>
                );
              })}
              {!budgets.length && (
                <p className="subtle">
                  Crie um orçamento para acompanhar limites e transferir as
                  sobras.
                </p>
              )}
            </section>
            <section className="card hub-card">
              <div className="hub-heading">
                <h2>Quando sua meta pode acontecer</h2>
                <button className="button" onClick={() => p.edit("goal")}>
                  Nova meta
                </button>
              </div>
              {goals.map((g) => {
                const missing = Math.max(0, g.amount - (g.saved || 0)),
                  months = g.monthlyContribution
                    ? Math.ceil(missing / g.monthlyContribution)
                    : null;
                return (
                  <div className="hub-budget" key={g.id}>
                    <div>
                      <b>{g.name}</b>
                      <p>
                        Reservado: {money(g.saved || 0)} · Meta:{" "}
                        {money(g.amount)}
                      </p>
                    </div>
                    <div>
                      <strong>
                        {missing === 0
                          ? "Meta alcançada"
                          : months !== null
                            ? monthShift(today.slice(0, 7), months)
                            : "Defina um aporte mensal"}
                      </strong>
                      <p className="subtle">
                        {g.monthlyContribution
                          ? money(g.monthlyContribution) + " por mês"
                          : "Edite a meta para planejar o aporte."}
                      </p>
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}
      </div>
    </>
  );
}
export function HubTabs({
  values,
  value,
  onChange,
}: {
  values: string[];
  value: string;
  onChange: (s: string) => void;
}) {
  return <FeatureTabs values={values} value={value} onChange={onChange} />;
}
export function HubStat({
  title,
  value,
  warning = false,
}: {
  title: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="hub-stat">
      <span>{title}</span>
      <strong className={warning ? "warning" : ""}>{value}</strong>
    </div>
  );
}
export function IntelligenceHub(p: HubProps) {
  const [tab, setTab] = useState("Insights"),
    [question, setQuestion] = useState(""),
    [messages, setMessages] = useState<
      {
        question: string;
        answer: string;
      }[]
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<{
    insights: string[];
    findings: ReturnType<typeof anomalies>;
    score: ReturnType<typeof health>;
  }>();
  useEffect(() => {
    let active = true;
    if (p.user)
      void financeApi<{
        insights: string[];
        findings: ReturnType<typeof anomalies>;
        score: ReturnType<typeof health>;
      }>("workspace/insights?month=" + p.month)
        .then((data) => {
          if (active) setAnalysis(data);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [p.user, p.month]);
  const findings = analysis?.findings || anomalies(p.entries, p.month),
    score = analysis?.score || health(p.entries, p.month);
  async function exporting(format: string) {
    setBusy(true);
    setError("");
    try {
      let reportEntries = p.entries;
      if (p.user && ["pdf", "excel"].includes(format)) {
        const transactions = [];
        let cursor = "";
        do {
          const page = await financeApi<{
            entries: typeof p.entries;
            nextCursor: string | null;
          }>(
            "workspace/transactions?" +
              new URLSearchParams({ month: p.month, cursor }),
          );
          transactions.push(...page.entries);
          cursor = page.nextCursor || "";
        } while (cursor);
        reportEntries = [
          ...p.entries.filter((e) => e.kind !== "transaction"),
          ...transactions,
        ];
      }
      if (format === "pdf") await exportPdf(reportEntries, p.month);
      else if (format === "excel") await exportExcel(reportEntries, p.month);
      else {
        if (!p.user) {
          p.login();
          return;
        }
        const data = await financeApi("finance/export");
        downloadBlob(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
          "WZY-exportacao-completa.json",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <HubTabs
        value={tab}
        values={[
          "Insights",
          "Anomalias",
          "Saúde financeira",
          "Assistente",
          "Exportações",
        ]}
        onChange={setTab}
      />
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <section className="card hub-card hub-panel" key={tab}>
        {tab === "Insights" ? (
          <>
            <div className="hub-heading">
              <div>
                <h2>Os números contam uma história.</h2>
                <p>Comparações automáticas dos lançamentos em {p.month}.</p>
              </div>
              <Sparkles size={25} />
            </div>
            {(analysis?.insights || insights(p.entries, p.month)).map((s) => (
              <div className="insight-line" key={s}>
                <ArrowUpRight size={18} />
                <p>{s}</p>
              </div>
            ))}
            {!(analysis?.insights || insights(p.entries, p.month)).length && (
              <p className="subtle">
                Adicione lançamentos de mais de um mês para comparar seus
                hábitos.
              </p>
            )}
            <p className="subtle">
              Compare meses completos para uma leitura mais fiel; o mês atual
              pode estar incompleto.
            </p>
          </>
        ) : tab === "Anomalias" ? (
          <>
            <h2>Vale conferir.</h2>
            <p className="subtle">
              Sinais baseados nos seus registros. Não confirmam fraude.
            </p>
            {findings.map((f) => (
              <div className="insight-line" key={f.id}>
                <ShieldCheck size={20} />
                <div>
                  <b>
                    {f.entry.name} · {money(f.entry.amount)}
                  </b>
                  <p>{f.message}</p>
                  <small>{f.entry.date}</small>
                </div>
                <button
                  className="button"
                  onClick={() => p.edit("transaction", f.entry)}
                >
                  Conferir
                </button>
              </div>
            ))}
            {!findings.length && (
              <div className="account-empty">
                <ShieldCheck size={32} />
                <h3>Nenhum sinal encontrado neste período.</h3>
                <p>Isso não substitui a conferência dos extratos do banco.</p>
              </div>
            )}
          </>
        ) : tab === "Saúde financeira" ? (
          <>
            <h2>Seu indicador de organização.</h2>
            {score ? (
              <>
                <div className="health-score">
                  <strong>{score.score}</strong>
                  <span>/100</span>
                </div>
                <div className="hub-stat-grid">
                  <HubStat
                    title="Sobra da renda"
                    value={score.saving + "/40"}
                  />
                  <HubStat
                    title="Reserva registrada"
                    value={score.reserve + "/30"}
                  />
                  <HubStat
                    title="Pendências antigas"
                    value={score.onTime + "/20"}
                  />
                  <HubStat title="Orçamentos" value={score.budgets + "/10"} />
                </div>
              </>
            ) : (
              <p className="subtle">
                Ainda não há lançamentos suficientes neste mês.
              </p>
            )}
            <div className="notice wide">
              Indicador educativo baseado apenas nos dados cadastrados. Não é
              score de crédito, diagnóstico, nem recomendação de investimento.
              Dados ausentes reduzem sua utilidade.
            </div>
          </>
        ) : tab === "Assistente" ? (
          <>
            <div className="hub-heading">
              <div>
                <h2>Converse com seus números.</h2>
                <p>
                  Consultas locais, sem custo por uso e sem enviar seus
                  lançamentos para uma IA.
                </p>
              </div>
              <MessageCircle size={25} />
            </div>
            <div className="assistant-messages">
              {messages.map((m, i) => (
                <div key={i}>
                  <p className="assistant-question">{m.question}</p>
                  <p className="assistant-answer">{m.answer}</p>
                </div>
              ))}
            </div>
            <form
              className="assistant-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!question.trim() || busy) return;
                setBusy(true);
                setError("");
                try {
                  const result = p.user
                    ? await financeApi<{ answer: string; explanation: string }>(
                        "workspace/assistant",
                        { question, reference: p.month },
                      )
                    : {
                        answer: answerQuestion(question, p.entries, p.month),
                        explanation: "Dados de demonstração.",
                      };
                  setMessages((m) => [
                    ...m.slice(-19),
                    {
                      question,
                      answer: result.answer + " " + result.explanation,
                    },
                  ]);
                  setQuestion("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <input
                aria-label="Pergunta ao assistente"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={300}
                placeholder="Quanto gastei com mercado em setembro?"
              />
              <button className="button primary" disabled={busy}>
                {busy ? "Consultando…" : "Consultar"}
              </button>
            </form>
            <p className="subtle">
              O assistente usa regras de consulta para saldo, despesas,
              receitas, vencimentos e indicador financeiro. Os valores vêm dos
              lançamentos cadastrados.
            </p>
          </>
        ) : (
          <>
            <h2>Seus dados, onde precisar.</h2>
            <p className="subtle">
              Relatórios do período {p.month}, gerados no seu dispositivo.
            </p>
            <div className="hub-export-grid">
              <button
                className="button"
                disabled={busy}
                onClick={() => exporting("pdf")}
              >
                <Download size={18} />
                Relatório PDF
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => exporting("excel")}
              >
                <Download size={18} />
                Planilha Excel
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => exporting("json")}
              >
                <Download size={18} />
                Exportação completa
              </button>
            </div>
            {busy && <Ripple />}
            <p className="subtle">
              A exportação JSON inclui perfil, lançamentos, preferências,
              atividade e lista dos comprovantes. Baixe também os arquivos
              originais na aba Arquivos.
            </p>
          </>
        )}
      </section>
    </>
  );
}
type PreviewRow = {
  index: number;
  date: string;
  name: string;
  amount: number;
  type: string;
  duplicate: boolean;
  matchId: string;
  candidates: {
    id: string;
    name: string;
    date: string;
    version: number;
  }[];
};
export function ReconciliationHub(p: HubProps) {
  const [account, setAccount] = useState(""),
    [file, setFile] = useState<{
      text: string;
      format: string;
      name: string;
    } | null>(null),
    [rows, setRows] = useState<PreviewRow[]>([]),
    [choices, setChoices] = useState<Record<number, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function preview(selected?: File) {
    if (!p.user) {
      p.login();
      return;
    }
    if (!selected) return;
    if (!account) {
      setError("Selecione uma conta antes do arquivo.");
      return;
    }
    setBusy(true);
    setError("");
    setRows([]);
    try {
      if (selected.size > 2000000) throw Error("Use um arquivo de até 2 MB.");
      const format = selected.name.toLowerCase().endsWith(".ofx")
        ? "ofx"
        : "csv";
      const bytes = await selected.arrayBuffer();
      let text = new TextDecoder().decode(bytes);
      if (text.includes("\uFFFD"))
        text = new TextDecoder("windows-1252").decode(bytes);
      const data = { text, format, name: selected.name };
      const result = await financeApi<{
        rows: PreviewRow[];
      }>("finance/import/preview", { accountId: account, ...data });
      setFile(data);
      setRows(result.rows);
      setChoices(
        Object.fromEntries(
          result.rows.map((r) => [
            r.index,
            r.duplicate ? "skip" : r.matchId ? "match:" + r.matchId : "new",
          ]),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card hub-card">
      <div className="hub-heading">
        <div>
          <h2>Concilie antes de somar.</h2>
          <p>
            Importe o extrato e revise correspondências com seus lançamentos.
          </p>
        </div>
        <FileUp size={25} />
      </div>
      <div className="hub-grid">
        <label>
          Conta do extrato
          <select
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setRows([]);
              setFile(null);
            }}
          >
            <option value="">Selecione</option>
            {p.entries
              .filter(
                (e) =>
                  (e.kind === "account" || e.kind === "card") &&
                  (!e.currency || e.currency === "BRL"),
              )
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Arquivo OFX ou CSV
          <input
            type="file"
            accept=".ofx,.csv"
            disabled={busy || !account}
            onChange={(e) => {
              preview(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="subtle">
        CSV: Data, Descrição, Valor e, opcionalmente, ID. Valor negativo
        representa despesa. Até 1.000 linhas e 2 MB. Formatos aceitos:
        DD/MM/AAAA ou AAAA-MM-DD.
      </p>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {busy ? (
        <PageSkeleton page="Conciliação" />
      ) : (
        rows.length > 0 && (
          <>
            <p>
              <b>{file?.name}</b> · {rows.length} lançamentos para revisar
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Decisão</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.index}>
                      <td>{r.date}</td>
                      <td>{r.name}</td>
                      <td>
                        {r.type === "expense" ? "−" : "+"}
                        {money(r.amount)}
                      </td>
                      <td>
                        <select
                          aria-label={"Decisão para " + r.name}
                          value={choices[r.index]}
                          disabled={r.duplicate}
                          onChange={(e) =>
                            setChoices((c) => ({
                              ...c,
                              [r.index]: e.target.value,
                            }))
                          }
                        >
                          <option value="skip">
                            {r.duplicate ? "Já importado" : "Ignorar"}
                          </option>
                          <option value="new">Criar lançamento</option>
                          {r.candidates.map((c) => (
                            <option key={c.id} value={"match:" + c.id}>
                              Conciliar: {c.name} ({c.date})
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button
                className="button"
                onClick={() => {
                  setRows([]);
                  setFile(null);
                }}
              >
                Cancelar
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const decisions = rows.map((r) => {
                      const choice = choices[r.index];
                      const id = choice?.startsWith("match:")
                        ? choice.slice(6)
                        : undefined;
                      return {
                        action: id ? "match" : choice,
                        id,
                        version: r.candidates.find((c) => c.id === id)?.version,
                      };
                    });
                    const result = await financeApi<{
                      imported: number;
                      matched: number;
                      skipped: number;
                    }>("finance/import/commit", {
                      accountId: account,
                      ...file,
                      decisions,
                    });
                    await p.refresh();
                    p.notify(
                      `${result.imported} novos · ${result.matched} conciliados · ${result.skipped} ignorados`,
                    );
                    setRows([]);
                    setFile(null);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirmar conciliação
              </button>
            </div>
          </>
        )
      )}
      <div className="notice wide">
        A prévia não altera seus dados. A confirmação revalida as
        correspondências e impede a importação repetida do mesmo lançamento. O
        extrato é processado no WZY; não é enviado a um banco.
      </div>
    </section>
  );
}
export function CurrencyHub(p: HubProps) {
  const requestId = useRef<string>("");
  const [tab, setTab] = useState("Carteiras"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [currency, setCurrency] = useState("USD"),
    [quote, setQuote] = useState<{
      rate: number;
      date: string;
    } | null>(null),
    [selectedAccount, setSelectedAccount] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!p.user) {
      p.login();
      return;
    }
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      if (tab === "Carteiras")
        await financeApi("finance/wallet", {
          ...body,
          requestId:
            requestId.current || (requestId.current = crypto.randomUUID()),
          initial:
            parseMoney(String(body.initial).replace(/^-/, "").trim()) *
            (String(body.initial).startsWith("-") ? -1 : 1),
        });
      else {
        const account = p.entries.find((a) => a.id === selectedAccount);
        await financeApi(
          tab === "Transferências"
            ? "finance/currency-transfer"
            : tab === "Parcelamentos"
              ? "finance/installments"
              : "finance/currency-transaction",
          {
            ...body,
            accountId: selectedAccount,
            currency: account?.currency || "BRL",
            amount: parseMoney(String(body.amount)),
            targetOriginalAmount: parseMoney(
              String(body.targetOriginalAmount || "0"),
            ),
            count: Number(body.count || 1),
            requestId:
              requestId.current || (requestId.current = crypto.randomUUID()),
          },
        );
      }
      requestId.current = "";
      await p.refresh();
      p.notify("Registros salvos.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <HubTabs
        value={tab}
        values={[
          "Carteiras",
          "Lançamento em moeda",
          "Parcelamentos",
          "Transferências",
          "Cotações",
        ]}
        onChange={setTab}
      />
      <section className="card hub-card hub-panel" key={tab}>
        <div className="hub-heading">
          <div>
            <h2>
              {tab === "Carteiras"
                ? "Cada carteira, na sua moeda."
                : tab === "Parcelamentos"
                  ? "Uma compra, parcelas organizadas."
                  : tab === "Cotações"
                    ? "Cotações de referência."
                    : "Lance o valor na moeda da conta."}
            </h2>
            <p>
              O WZY mantém os relatórios consolidados em reais e preserva o
              valor original.
            </p>
          </div>
          <Wallet size={25} />
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {tab === "Cotações" ? (
          <>
            <div className="hub-grid">
              <label>
                Moeda
                <select
                  value={currency}
                  onChange={(e) => {
                    setCurrency(e.target.value);
                    setQuote(null);
                  }}
                >
                  {["USD", "EUR", "GBP", "CAD", "CHF", "AUD"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  if (!p.user) {
                    p.login();
                    return;
                  }
                  setBusy(true);
                  setError("");
                  try {
                    setQuote(
                      await financeApi("finance/quotes?currency=" + currency),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={16} />
                Consultar cotação
              </button>
            </div>
            {quote && (
              <div className="hub-stat">
                <span>1 {currency} em reais</span>
                <strong>
                  {quote.rate.toLocaleString("pt-BR", {
                    maximumFractionDigits: 6,
                  })}
                </strong>
                <small>Referência: {quote.date} · Frankfurter</small>
              </div>
            )}
          </>
        ) : (
          <form
            className="entry-form"
            onChange={() => {
              if (!busy) requestId.current = "";
            }}
            onSubmit={submit}
          >
            <div className="hub-grid">
              <label>
                {tab === "Carteiras" ? "Nome da carteira" : "Descrição"}
                <input name="name" required maxLength={150} />
              </label>
              {tab === "Carteiras" ? (
                <>
                  <label>
                    Tipo
                    <select name="accountType">
                      <option value="checking">Conta corrente</option>
                      <option value="savings">Poupança</option>
                      <option value="cash">Dinheiro</option>
                      <option value="investment">Investimentos</option>
                      <option value="meal">Vale-refeição</option>
                      <option value="other">Outra carteira</option>
                    </select>
                  </label>
                  <label>
                    Moeda
                    <select name="currency">
                      {["BRL", "USD", "EUR", "GBP", "CAD", "CHF", "AUD"].map(
                        (c) => (
                          <option key={c}>{c}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Saldo inicial na moeda escolhida
                    <input
                      name="initial"
                      inputMode="decimal"
                      required
                      defaultValue="0,00"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Conta ou cartão
                    <select
                      value={selectedAccount}
                      onChange={(e) => setSelectedAccount(e.target.value)}
                      required
                    >
                      <option value="">Selecione</option>
                      {p.entries
                        .filter(
                          (a) =>
                            a.kind === "account" ||
                            (a.kind === "card" && tab !== "Transferências"),
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} · {a.currency || "BRL"}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Valor total (
                    {p.entries.find((a) => a.id === selectedAccount)
                      ?.currency || "BRL"}
                    )
                    <input
                      name="amount"
                      inputMode="decimal"
                      required
                      placeholder="0,00"
                    />
                  </label>
                  <label>
                    Data da primeira parcela
                    <input
                      type="date"
                      name="date"
                      required
                      defaultValue={localDate()}
                    />
                  </label>
                  {tab === "Transferências" && (
                    <>
                      <label>
                        Conta de destino
                        <select name="targetId" required>
                          <option value="">Selecione</option>
                          {p.entries
                            .filter(
                              (a) =>
                                (a.kind === "account" || a.kind === "card") &&
                                a.id !== selectedAccount,
                            )
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} · {a.currency || "BRL"}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Valor recebido na moeda do destino
                        <input
                          name="targetOriginalAmount"
                          inputMode="decimal"
                          required
                        />
                      </label>
                    </>
                  )}
                  <label>
                    Categoria
                    <input
                      name="category"
                      defaultValue="Outros"
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Tipo
                    <select name="type">
                      <option value="expense">Despesa</option>
                      <option value="income">Receita</option>
                    </select>
                  </label>
                  <label>
                    Primeiro lançamento
                    <select name="status">
                      <option value="paid">Concluído</option>
                      <option value="pending">Pendente</option>
                    </select>
                  </label>
                  {tab === "Parcelamentos" && (
                    <label>
                      Quantidade de parcelas
                      <input
                        type="number"
                        name="count"
                        required
                        min={1}
                        max={120}
                        defaultValue={2}
                      />
                    </label>
                  )}
                </>
              )}
            </div>
            <button className="button primary" disabled={busy}>
              {busy ? <Ripple small /> : <Plus size={17} />}Salvar{" "}
              {tab === "Carteiras" ? "carteira" : "lançamentos"}
            </button>
          </form>
        )}
        <div className="hub-stat-grid">
          {p.entries
            .filter((a) => a.kind === "account")
            .map((a) => {
              const value = nativeBalance(a, p.entries);
              return (
                <div className="hub-stat" key={a.id}>
                  <span>
                    {a.name} · {a.currency || "BRL"}
                  </span>
                  <strong>
                    {value === null
                      ? "Confira os valores originais"
                      : new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: a.currency || "BRL",
                        }).format(value / 100)}
                  </strong>
                  <small>Saldo na moeda da carteira</small>
                </div>
              );
            })}
        </div>
        <div className="notice wide">
          Cotações automáticas de referência, atualizadas pela fonte em dias de
          publicação; não são preços de negociação em tempo real. A conversão
          preserva a cotação da data registrada. Parcelas futuras ficam
          pendentes e vencimentos no fim do mês são ajustados ao último dia
          disponível.
        </div>
      </section>
    </>
  );
}
