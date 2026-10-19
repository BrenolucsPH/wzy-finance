"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Person } from "../../../lib/client";
import {
  saveVault,
  unlockVault,
  vaultIds,
  type OfflineSnapshot,
} from "../../../lib/offline";
import { synchronizeVault } from "../../../lib/offline-sync";
import { money, localDate, parseMoney, type Entry } from "../../../lib/finance";
import { useOnline } from "../../../hooks/use-online";
import { Editor } from "../transactions/entry-editor";
export function OfflineWorkspace({
  user,
  notify,
  onSync,
}: {
  user: Person | null;
  notify: (message: string) => void;
  onSync?: () => Promise<void>;
}) {
  const online = useOnline(),
    [ids, setIds] = useState<string[]>([]),
    [id, setId] = useState(user?.id || ""),
    [password, setPassword] = useState(""),
    [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Entry>();
  const snapshotRef = useRef(snapshot),
    passwordRef = useRef(password),
    syncing = useRef(false);
  useEffect(() => {
    snapshotRef.current = snapshot;
    passwordRef.current = password;
  }, [snapshot, password]);
  useEffect(() => {
    let active = true;
    void vaultIds()
      .then((values) => {
        if (active) {
          setIds(values);
          if (!id) setId(values[0] || "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function store(value: OfflineSnapshot) {
    await saveVault(value, password);
    setSnapshot(value);
  }
  async function synchronize() {
    const current = snapshotRef.current;
    if (!current || syncing.current) return;
    syncing.current = true;
    setBusy(true);
    setError("");
    try {
      setSnapshot(
        await synchronizeVault(current, passwordRef.current, setSnapshot),
      );
      await onSync?.();
      notify("Cofre sincronizado com sua conta.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      syncing.current = false;
      setBusy(false);
    }
  }
  const synchronizeRef = useRef(synchronize);
  useEffect(() => {
    synchronizeRef.current = synchronize;
  });
  useEffect(() => {
    const listener = () => {
      if (snapshotRef.current) void synchronizeRef.current();
    };
    window.addEventListener("online", listener);
    return () => window.removeEventListener("online", listener);
  }, []);
  const changes = snapshot?.changes || [],
    count = (snapshot?.pending.length || 0) + changes.length;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card offline-workspace">
      <h2>{online ? "Seu cofre neste dispositivo" : "Você está offline"}</h2>
      <p className="subtle">
        A senha local protege os registros neste aparelho e não é enviada ao
        servidor. Ao recuperar a conexão, a fila é sincronizada enquanto o cofre
        estiver desbloqueado e a mesma conta estiver conectada.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!snapshot ? (
        <form
          className="entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (user && online) {
                const previous = ids.includes(user.id)
                  ? await unlockVault(user.id, password)
                  : null;
                const data = await api("records", undefined, "GET", {
                  "X-WZY-Owner": user.id,
                });
                await store({
                  user,
                  entries: data.entries,
                  pending: previous?.pending || [],
                  changes: previous?.changes || [],
                  savedAt: Date.now(),
                });
                setId(user.id);
                setIds(await vaultIds());
                notify("Cofre protegido e atualizado.");
              } else {
                if (!id) throw Error("Ative o cofre quando estiver conectado.");
                setSnapshot(await unlockVault(id, password));
              }
            });
          }}
        >
          {!user && (
            <label>
              Cofre
              <select
                value={id}
                onChange={(e) => setId(e.target.value)}
                required
              >
                <option value="">Selecione</option>
                {ids.map((value, index) => (
                  <option key={value} value={value}>
                    Cofre {index + 1} · {value.slice(-6)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Senha local
            <input
              type="password"
              minLength={12}
              autoComplete="off"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="button primary" disabled={busy}>
            {user && online ? "Ativar ou atualizar cofre" : "Desbloquear cofre"}
          </button>
        </form>
      ) : (
        <>
          <p>
            <b>{snapshot.user.name}</b> · atualizado em{" "}
            {new Date(snapshot.savedAt).toLocaleString("pt-BR")} · {count}{" "}
            alteração(ões) na fila
          </p>
          <div className="form-actions">
            <button
              className="button"
              onClick={() => {
                setSnapshot(null);
                setPassword("");
              }}
              disabled={busy}
            >
              Bloquear cofre
            </button>
            <button
              className="button primary"
              disabled={busy || !online}
              onClick={synchronize}
            >
              {busy ? "Sincronizando…" : "Sincronizar agora"}
            </button>
          </div>
          <form
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = Object.fromEntries(new FormData(form));
              void run(async () => {
                const amount = parseMoney(String(f.amount));
                if (!Number.isFinite(amount) || amount <= 0)
                  throw Error("Informe um valor positivo.");
                const account = snapshot.entries.find(
                  (e) => e.id === String(f.account),
                );
                if (!account) throw Error("Escolha uma conta.");
                await store({
                  ...snapshot,
                  pending: [
                    ...snapshot.pending,
                    {
                      id: crypto.randomUUID(),
                      kind: "transaction",
                      name: String(f.name),
                      amount,
                      type: String(f.type) === "income" ? "income" : "expense",
                      status: "paid",
                      date: String(f.date),
                      accountId: account.id,
                      category: String(f.category || "Outros"),
                    },
                  ],
                });
                form.reset();
                notify("Lançamento protegido na fila local.");
              });
            }}
          >
            <h3>Adicionar lançamento</h3>
            <div className="two-col">
              <label>
                Descrição
                <input name="name" maxLength={150} required />
              </label>
              <label>
                Valor (R$)
                <input name="amount" inputMode="decimal" required />
              </label>
              <label>
                Conta em reais
                <select name="account" required>
                  <option value="">Selecione</option>
                  {snapshot.entries
                    .filter(
                      (e) =>
                        e.kind === "account" &&
                        (!e.currency || e.currency === "BRL"),
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Tipo
                <select name="type">
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                </select>
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
                Categoria
                <input name="category" maxLength={100} defaultValue="Outros" />
              </label>
            </div>
            <button className="button" disabled={busy}>
              Guardar na fila
            </button>
          </form>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th>Data</th>
                  <th>Valor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.entries
                  .filter((e) => e.kind === "transaction")
                  .slice(-100)
                  .reverse()
                  .map((e) => (
                    <tr key={e.id}>
                      <td>{e.name}</td>
                      <td>{e.date}</td>
                      <td>{money(e.amount)}</td>
                      <td>
                        {!e.sourceId &&
                          !e.financialActivity &&
                          !e.adjustmentReason &&
                          (!e.currency || e.currency === "BRL") && (
                            <div className="row-actions">
                              <button
                                className="button"
                                disabled={busy}
                                onClick={() =>
                                  setEditing(
                                    changes.find(
                                      (c) =>
                                        c.entry.id === e.id &&
                                        c.operation === "update",
                                    )?.entry || e,
                                  )
                                }
                              >
                                Editar offline
                              </button>
                              <button
                                className="button"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    confirm(
                                      "Guardar a exclusão deste lançamento para quando a conexão voltar?",
                                    )
                                  )
                                    void run(async () => {
                                      await store({
                                        ...snapshot,
                                        changes: [
                                          ...changes.filter(
                                            (c) => c.entry.id !== e.id,
                                          ),
                                          {
                                            id: crypto.randomUUID(),
                                            operation: "delete",
                                            entry: e,
                                            baseVersion: e._version || 0,
                                          },
                                        ],
                                      });
                                    });
                                }}
                              >
                                Excluir ao sincronizar
                              </button>
                            </div>
                          )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <h3>Fila preservada</h3>
          {[
            ...snapshot.pending.map((e) => ({
              id: e.id,
              name: e.name,
              type: "Novo lançamento",
            })),
            ...changes.map((c) => ({
              id: c.id,
              name: c.entry.name,
              type: c.operation === "delete" ? "Exclusão" : "Edição",
            })),
          ].map((c) => (
            <div className="preference-row" key={c.id}>
              <span>
                <b>{c.name}</b> · {c.type}
              </span>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Descartar somente esta alteração local? O registro do servidor será preservado.",
                    )
                  )
                    void run(async () => {
                      await store({
                        ...snapshot,
                        pending: snapshot.pending.filter((e) => e.id !== c.id),
                        changes: changes.filter((e) => e.id !== c.id),
                      });
                    });
                }}
              >
                Descartar alteração local
              </button>
            </div>
          ))}
        </>
      )}
      {editing && snapshot && (
        <Editor
          allowCreateAccount={false}
          kind="transaction"
          entry={editing}
          accounts={snapshot.entries.filter(
            (e) => e.kind === "account" || e.kind === "card",
          )}
          onClose={() => setEditing(undefined)}
          onSave={async (entry) => {
            await store({
              ...snapshot,
              changes: [
                ...changes.filter((c) => c.entry.id !== entry.id),
                {
                  id: crypto.randomUUID(),
                  operation: "update",
                  entry,
                  baseVersion: editing._version || 0,
                },
              ],
            });
            notify("Edição protegida na fila local.");
          }}
        />
      )}
    </section>
  );
}
