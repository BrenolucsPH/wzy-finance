"use client";
import { useState } from "react";
import { Download, Search } from "lucide-react";
import { money, categories } from "../../../lib/finance";
import { TransactionTable, type Actions } from "../shared";
export function Transactions(p: Actions) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [category, setCategory] = useState("all");
  const list = p.entries
    .filter(
      (e) =>
        e.kind === "transaction" &&
        e.date?.startsWith(p.month) &&
        e.name.toLowerCase().includes(search.toLowerCase()) &&
        (type === "all" || e.type === type) &&
        (category === "all" || e.category === category),
    )
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  function csv() {
    const cols = [
      "Descrição",
      "Valor",
      "Tipo",
      "Categoria",
      "Data",
      "Conta",
      "Status",
    ];
    const cell = (s: string) =>
      '"' + (/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replace(/"/g, '""') + '"';
    const data = [
      cols,
      ...list.map((e) => [
        e.name,
        (e.amount / 100).toFixed(2).replace(".", ","),
        e.type === "income"
          ? "Receita"
          : e.type === "expense"
            ? "Despesa"
            : "Transferência",
        e.category || "",
        e.date || "",
        p.entries.find((a) => a.id === e.accountId)?.name || "",
        e.status === "paid" ? "Pago" : "Pendente",
      ]),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + data], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `WZY-${p.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Tipo"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="all">Todos os tipos</option>
          <option value="income">Receitas</option>
          <option value="expense">Despesas</option>
          <option value="transfer">Transferências</option>
        </select>
        <select
          aria-label="Categoria"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button className="button" onClick={csv}>
          <Download size={16} />
          Exportar CSV
        </button>
      </div>
      <TransactionTable {...p} list={list} />
      <div className="chart-footer">
        <span>{list.length} transações</span>
        <span>
          Resultado filtrado{" "}
          <b className="positive">
            {money(
              list
                .filter((e) => e.status === "paid" && e.type !== "transfer")
                .reduce(
                  (n, e) => n + (e.type === "income" ? e.amount : -e.amount),
                  0,
                ),
            )}
          </b>
        </span>
      </div>
    </section>
  );
}
