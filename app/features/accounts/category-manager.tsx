"use client";
import { useEffect, useState } from "react";
import { requestJSON } from "../../../lib/client";
import { categories as defaults } from "../../../lib/finance";
import type { Actions } from "../shared";
type Category = {
  id: string;
  name: string;
  color: string;
  parent_id?: string;
  category_type: string;
  archived: boolean;
};
type Rule = {
  id: string;
  term: string;
  category: string;
  subcategory: string;
  priority: number;
};
export function CategoryManager(p: Actions) {
  const [categories, setCategories] = useState<Category[]>([]),
    [rules, setRules] = useState<Rule[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Category>();
  async function load() {
    const [a, b] = await Promise.all([
      requestJSON<{ categories: Category[] }>("workspace/categories"),
      requestJSON<{ rules: Rule[] }>("workspace/rules"),
    ]);
    setCategories(a.categories);
    setRules(b.rules);
  }
  useEffect(() => {
    let active = true;
    if (p.authenticated)
      void Promise.all([
        requestJSON<{ categories: Category[] }>("workspace/categories"),
        requestJSON<{ rules: Rule[] }>("workspace/rules"),
      ])
        .then(([a, b]) => {
          if (active) {
            setCategories(a.categories);
            setRules(b.rules);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [p.authenticated]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
      await p.refresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="dashboard-grid">
        <section className="card">
          <h2>{editing ? "Editar categoria" : "Suas categorias"}</h2>
          <p className="subtle">
            Renomear atualiza os lançamentos e orçamentos vinculados. Arquivar
            preserva o histórico.
          </p>
          <form
            key={editing?.id || "new"}
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = Object.fromEntries(new FormData(form));
              void run(async () => {
                if (!p.authenticated)
                  throw Error("Entre para personalizar suas categorias.");
                await requestJSON("workspace/category", {
                  id: editing?.id,
                  name: String(f.name),
                  color: String(f.color),
                  parentId: String(f.parentId) || null,
                  type: String(f.type),
                  archived: editing?.archived || false,
                });
                setEditing(undefined);
                form.reset();
                p.notify("Categoria salva.");
              });
            }}
          >
            <label>
              Nome
              <input
                name="name"
                defaultValue={editing?.name}
                maxLength={100}
                required
              />
            </label>
            <label>
              Uso
              <select
                name="type"
                defaultValue={editing?.category_type || "expense"}
              >
                <option value="expense">Despesas</option>
                <option value="income">Receitas</option>
                <option value="both">Receitas e despesas</option>
              </select>
            </label>
            <label>
              Categoria principal
              <select name="parentId" defaultValue={editing?.parent_id || ""}>
                <option value="">Categoria independente</option>
                {categories
                  .filter(
                    (c) =>
                      !c.id.startsWith("default:") &&
                      !c.parent_id &&
                      c.id !== editing?.id,
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Cor
              <input
                type="color"
                name="color"
                defaultValue={editing?.color || "#357c67"}
              />
            </label>
            <div className="form-actions">
              <button className="button primary" disabled={busy}>
                Salvar categoria
              </button>
              {editing && (
                <button
                  type="button"
                  className="button"
                  onClick={() => setEditing(undefined)}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </section>
        <section className="card">
          <h2>Classificação automática</h2>
          <p className="subtle">
            Regras são aplicadas às novas importações e às despesas sem
            categoria específica. A prévia permite revisar antes de confirmar.
          </p>
          <form
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = Object.fromEntries(new FormData(form));
              void run(async () => {
                if (!p.authenticated) throw Error("Entre para criar regras.");
                await requestJSON("workspace/rule", {
                  term: String(f.term),
                  category: String(f.category),
                  subcategory: String(f.subcategory),
                  priority: Number(f.priority),
                });
                form.reset();
                p.notify("Regra salva.");
              });
            }}
          >
            <label>
              Descrição contém
              <input
                name="term"
                minLength={2}
                maxLength={100}
                required
                placeholder="Ex.: supermercado"
              />
            </label>
            <label>
              Categoria
              <select name="category">
                {(categories.length
                  ? categories.map((c) => c.name)
                  : defaults
                ).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Subcategoria
              <input name="subcategory" maxLength={100} />
            </label>
            <label>
              Prioridade
              <input
                name="priority"
                type="number"
                min={0}
                max={100}
                defaultValue={0}
              />
            </label>
            <button className="button" disabled={busy}>
              Criar regra
            </button>
          </form>
          {rules.map((r) => (
            <div className="preference-row" key={r.id}>
              <span>
                <b>{r.term}</b> → {r.category}
              </span>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await requestJSON("workspace/rule", { ...r, remove: true });
                  })
                }
              >
                Remover regra
              </button>
            </div>
          ))}
        </section>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="card">
        <h2>Categorias disponíveis</h2>
        {categories.map((c) => (
          <div className="preference-row" key={c.id}>
            <span>
              <i className="category-swatch" style={{ background: c.color }} />{" "}
              {c.name}
              {c.archived ? " · arquivada" : ""}
            </span>
            {!c.id.startsWith("default:") && (
              <div className="form-actions">
                <button className="button" onClick={() => setEditing(c)}>
                  Editar
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await requestJSON("workspace/category", {
                        id: c.id,
                        name: c.name,
                        color: c.color,
                        parentId: c.parent_id || null,
                        type: c.category_type,
                        archived: !c.archived,
                      });
                    })
                  }
                >
                  {c.archived ? "Reativar" : "Arquivar"}
                </button>
              </div>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
