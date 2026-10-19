"use client";
import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { requestJSON } from "../../../lib/client";
import { categories, money, type Entry } from "../../../lib/finance";
import { TransactionTable, type Actions } from "../shared";
import { Ripple } from "../../motion-ui";
type Page = {
  entries: Entry[];
  total: number;
  result: number;
  nextCursor: string | null;
};
export function PagedTransactions(p: Actions) {
  const [search, setSearch] = useState(""),
    [type, setType] = useState("all"),
    [category, setCategory] = useState(""),
    [account, setAccount] = useState(""),
    [cursor, setCursor] = useState(""),
    [previous, setPrevious] = useState<string[]>([]),
    [page, setPage] = useState<Page>(),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [choices, setChoices] = useState(categories),
    [exporting, setExporting] = useState(false);
  const query = new URLSearchParams({
    month: p.month,
    search,
    type,
    category,
    account,
    cursor,
  }).toString();
  useEffect(() => {
    if (!p.authenticated) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        void requestJSON<Page>(
          "workspace/transactions?" + query,
          undefined,
          controller.signal,
        )
          .then((data) => {
            if (active) {
              setPage(data);
              setError("");
            }
          })
          .catch((e) => {
            if (active && e.name !== "AbortError") setError(e.message);
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      search ? 250 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, p.authenticated, p.entries, search]);
  useEffect(() => {
    let active = true;
    if (p.authenticated)
      void requestJSON<{ categories: { name: string; archived: boolean }[] }>(
        "workspace/categories",
      )
        .then((data) => {
          if (active)
            setChoices(
              Array.from(
                new Set([...categories, ...data.categories.map((c) => c.name)]),
              ),
            );
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [p.authenticated]);
  const demo = p.entries.filter(
    (e) =>
      e.kind === "transaction" &&
      e.date?.startsWith(p.month) &&
      e.name.toLowerCase().includes(search.toLowerCase()) &&
      (type === "all" || e.type === type) &&
      (!category || e.category === category) &&
      (!account || e.accountId === account || e.targetId === account),
  );
  function filter(action: () => void) {
    action();
    setCursor("");
    setPrevious([]);
  }
  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      let rows = demo;
      if (p.authenticated) {
        rows = [];
        let after = "";
        do {
          const data = await requestJSON<Page>(
            "workspace/transactions?" +
              new URLSearchParams({
                month: p.month,
                search,
                type,
                category,
                account,
                cursor: after,
              }),
          );
          rows.push(...data.entries);
          after = data.nextCursor || "";
        } while (after);
      }
      const cell = (s: string) =>
        '"' +
        (/^[=+\-@\t\r]/.test(s) ? "'" : "") +
        s.replaceAll('"', '""') +
        '"';
      const cols = [
        "Descrição",
        "Valor",
        "Tipo",
        "Categoria",
        "Data",
        "Conta",
        "Status",
      ];
      const csv = [
        cols,
        ...rows.map((e) => [
          e.name,
          (e.amount / 100).toFixed(2).replace(".", ","),
          e.type || "",
          e.category || "",
          e.date || "",
          p.entries.find((a) => a.id === e.accountId)?.name || "",
          e.status || "",
        ]),
      ]
        .map((r) => r.map(cell).join(";"))
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "WZY-" + p.month + ".csv";
      a.click();
      URL.revokeObjectURL(url);
      p.notify("Todos os resultados filtrados foram exportados.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="card">
      <div className="filterbar">
        <div className="search-box">
          <Search size={17} />
          <input
            aria-label="Buscar transação"
            placeholder="Buscar transação…"
            value={search}
            onChange={(e) => filter(() => setSearch(e.target.value))}
          />
        </div>
        <select
          aria-label="Tipo"
          value={type}
          onChange={(e) => filter(() => setType(e.target.value))}
        >
          <option value="all">Todos os tipos</option>
          <option value="income">Receitas</option>
          <option value="expense">Despesas</option>
          <option value="transfer">Transferências</option>
        </select>
        <select
          aria-label="Categoria"
          value={category}
          onChange={(e) => filter(() => setCategory(e.target.value))}
        >
          <option value="">Todas as categorias</option>
          {choices.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          aria-label="Conta"
          value={account}
          onChange={(e) => filter(() => setAccount(e.target.value))}
        >
          <option value="">Todas as contas</option>
          {p.entries
            .filter((e) => e.kind === "account" || e.kind === "card")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <button className="button" disabled={exporting} onClick={exportCsv}>
          {exporting ? <Ripple small /> : <Download size={16} />}Exportar
          resultados
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="loading-caption" role="status">
          <Ripple />
          Buscando seus lançamentos…
        </div>
      ) : (
        <TransactionTable
          {...p}
          list={p.authenticated ? page?.entries || [] : demo}
        />
      )}
      <div className="chart-footer">
        <span>
          {p.authenticated ? page?.total || 0 : demo.length} resultados · até 50
          por página
        </span>
        <span>
          Resultado filtrado{" "}
          <b>
            {money(
              p.authenticated
                ? page?.result || 0
                : demo.reduce(
                    (s, e) =>
                      s +
                      (e.status === "paid"
                        ? e.type === "income"
                          ? e.amount
                          : e.type === "expense"
                            ? -e.amount
                            : 0
                        : 0),
                    0,
                  ),
            )}
          </b>
        </span>
      </div>
      {p.authenticated && (
        <div className="pagination">
          <button
            className="button"
            disabled={!previous.length || loading}
            onClick={() => {
              setCursor(previous.at(-1) || "");
              setPrevious((v) => v.slice(0, -1));
            }}
          >
            Anterior
          </button>
          <span>Página {previous.length + 1}</span>
          <button
            className="button"
            disabled={!page?.nextCursor || loading}
            onClick={() => {
              setPrevious((v) => [...v, cursor]);
              setCursor(page?.nextCursor || "");
            }}
          >
            Próxima
          </button>
        </div>
      )}
    </section>
  );
}
