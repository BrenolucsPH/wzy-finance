"use client";
import { RestorePanel } from "./features/offline/restore-panel";
import { OfflineWorkspace } from "./features/offline/workspace";
import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { financeApi, HubTabs } from "./finance-hub";
import { type Person } from "./components";
import { downloadBlob, exportArchive } from "../lib/exports";
import { type Entry } from "../lib/finance";

export function Infrastructure({
  user,
  notify,
  login,
  refresh,
}: {
  user: Person | null;
  entries: Entry[];
  notify: (s: string) => void;
  login: () => void;
  refresh?: () => Promise<void>;
}) {
  const [usageMetrics, setUsageMetrics] = useState(false),
    [tab, setTab] = useState("Offline"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [password, setPassword] = useState(""),
    [label, setLabel] = useState("Meu dispositivo"),
    [keys, setKeys] = useState<
      {
        id: string;
        label: string;
      }[]
    >([]),
    [backups, setBackups] = useState<
      {
        day: string;
      }[]
    >([]),
    [widgets, setWidgets] = useState([
      "cash-flow",
      "upcoming",
      "transactions",
      "subscriptions",
    ]);
  useEffect(() => {
    let active = true;
    if (user)
      Promise.all([
        financeApi<{
          passkeys: typeof keys;
        }>("passkeys/list"),
        financeApi<{
          backups: typeof backups;
        }>("finance/backups"),
        financeApi<{
          preferences: {
            overviewWidgets?: string[];
            usageMetrics?: boolean;
          };
        }>("finance/preferences"),
      ])
        .then(([k, b, p]) => {
          if (active) {
            setUsageMetrics(p.preferences.usageMetrics === true);
            setKeys(k.passkeys);
            setBackups(b.backups);
            if (p.preferences.overviewWidgets)
              setWidgets(p.preferences.overviewWidgets);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [user]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <HubTabs
        values={[
          "Offline",
          "Biometria",
          "Notificações",
          "Backups",
          "Painel",
          "Privacidade",
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setError("");
        }}
      />
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <section className="card hub-card hub-panel" key={tab}>
        {tab === "Offline" ? (
          <OfflineWorkspace user={user} notify={notify} />
        ) : tab === "Biometria" ? (
          <>
            <h2>Biometria e chaves de acesso</h2>
            <p className="subtle">
              Use a confirmação do seu dispositivo. O WZY guarda uma chave
              pública; sua impressão digital ou rosto permanecem no dispositivo.
              Cadastre no endereço que costuma usar.
            </p>
            <form
              className="entry-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!user) {
                  login();
                  return;
                }
                run(async () => {
                  const registration = await financeApi<{
                    options: Parameters<
                      typeof startRegistration
                    >[0]["optionsJSON"];
                  }>("passkeys/register/options", { password });
                  const response = await startRegistration({
                    optionsJSON: registration.options,
                  });
                  await financeApi("passkeys/register/verify", {
                    response,
                    label,
                  });
                  setKeys(
                    (
                      await financeApi<{
                        passkeys: typeof keys;
                      }>("passkeys/list")
                    ).passkeys,
                  );
                  setPassword("");
                  notify("Chave de acesso cadastrada.");
                });
              }}
            >
              <label>
                Nome do dispositivo
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={60}
                  required
                />
              </label>
              <label>
                Senha atual
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              <button className="button primary" disabled={busy}>
                Cadastrar biometria / chave
              </button>
            </form>
            {keys.map((k) => (
              <div className="preference-row" key={k.id}>
                <b>{k.label}</b>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await financeApi("passkeys/remove", {
                        id: k.id,
                        password,
                      });
                      setKeys((x) => x.filter((v) => v.id !== k.id));
                      notify("Chave removida.");
                    })
                  }
                >
                  Remover com senha atual
                </button>
              </div>
            ))}
          </>
        ) : tab === "Notificações" ? (
          <>
            <h2>Lembretes neste dispositivo</h2>
            <p className="subtle">
              Notificações discretas sobre vencimentos próximos, sem valores ou
              nomes das contas na tela bloqueada. O navegador pede sua
              autorização. No iPhone, adicione o WZY à tela inicial antes de
              ativar.
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                if (!user) {
                  login();
                  return;
                }
                run(async () => {
                  if (
                    !("Notification" in window) ||
                    !("serviceWorker" in navigator) ||
                    !("PushManager" in window)
                  )
                    throw Error(
                      "Este navegador não oferece notificações push.",
                    );
                  const { publicKey } = await financeApi<{
                    publicKey: string;
                  }>("push");
                  if (!publicKey)
                    throw Error("Notificações ainda não configuradas.");
                  const permission = await Notification.requestPermission();
                  if (permission !== "granted")
                    throw Error("Permissão de notificações não concedida.");
                  const registration = await navigator.serviceWorker.ready;
                  let subscription =
                    await registration.pushManager.getSubscription();
                  if (!subscription) {
                    const bytes = Uint8Array.from(
                      atob(
                        publicKey.replace(/-/g, "+").replace(/_/g, "/") +
                          "=".repeat((4 - (publicKey.length % 4)) % 4),
                      ),
                      (c) => c.charCodeAt(0),
                    );
                    subscription = await registration.pushManager.subscribe({
                      userVisibleOnly: true,
                      applicationServerKey: bytes,
                    });
                  }
                  await financeApi("push", subscription.toJSON());
                  notify("Lembretes ativados neste dispositivo.");
                });
              }}
            >
              Ativar lembretes
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const registration = await navigator.serviceWorker.ready,
                    subscription =
                      await registration.pushManager.getSubscription();
                  if (subscription) {
                    await financeApi("push", {
                      remove: true,
                      endpoint: subscription.endpoint,
                    });
                    await subscription.unsubscribe();
                  }
                  notify("Lembretes desativados.");
                })
              }
            >
              Desativar
            </button>
          </>
        ) : tab === "Backups" ? (
          <>
            <h2>Cópias diárias protegidas</h2>
            <RestorePanel notify={notify} onDone={refresh} />
            <p className="subtle">
              Cópias diárias dos registros e das preferências, criptografadas e
              preservadas no servidor. Os comprovantes são referenciados; baixe
              também os arquivos para uma cópia independente.
            </p>
            {backups.map((b) => (
              <div className="preference-row" key={b.day}>
                <b>{b.day}</b>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const data = await financeApi(
                        "finance/backup?day=" + b.day,
                      );
                      downloadBlob(
                        new Blob([JSON.stringify(data, null, 2)], {
                          type: "application/json",
                        }),
                        "WZY-copia-" + b.day + ".json",
                      );
                    })
                  }
                >
                  Baixar cópia
                </button>
              </div>
            ))}
            {!backups.length && (
              <p>A primeira cópia aparece após a execução diária.</p>
            )}
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                if (!user) {
                  login();
                  return;
                }
                run(async () => {
                  const data = await financeApi("finance/export");
                  downloadBlob(
                    new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    }),
                    "WZY-exportacao-completa.json",
                  );
                });
              }}
            >
              Exportar perfil, registros e preferências
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                if (!user) {
                  login();
                  return;
                }
                run(exportArchive);
              }}
            >
              Baixar ZIP com comprovantes
            </button>
          </>
        ) : tab === "Painel" ? (
          <>
            <h2>Um painel com as suas prioridades</h2>
            {[
              ["cash-flow", "Fluxo de caixa"],
              ["upcoming", "Vencimentos"],
              ["transactions", "Últimas transações"],
              ["subscriptions", "Assinaturas em grupo"],
            ].map(([id, name]) => (
              <label className="preference-row" key={id}>
                <span>{name}</span>
                <input
                  type="checkbox"
                  checked={widgets.includes(id)}
                  onChange={(e) =>
                    setWidgets((x) =>
                      e.target.checked ? [...x, id] : x.filter((v) => v !== id),
                    )
                  }
                />
              </label>
            ))}
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                if (!user) {
                  login();
                  return;
                }
                run(async () => {
                  await financeApi("finance/preferences", {
                    overviewWidgets: widgets,
                  });
                  window.dispatchEvent(
                    new CustomEvent("wzy-widgets", { detail: widgets }),
                  );
                  notify("Painel atualizado.");
                });
              }}
            >
              Salvar meu painel
            </button>
          </>
        ) : (
          <>
            <h2>Seus dados, suas escolhas</h2>
            <label className="preference-row">
              <span>
                Ajudar a melhorar o WZY
                <small>
                  Opcional. Registra somente datas de visita e conclusão dos
                  primeiros passos, sem valores, descrições ou conteúdo
                  financeiro.
                </small>
              </span>
              <input
                aria-label="Compartilhar métricas de uso"
                type="checkbox"
                checked={usageMetrics}
                disabled={busy || !user}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  run(async () => {
                    await financeApi("finance/preferences", {
                      usageMetrics: enabled,
                    });
                    setUsageMetrics(enabled);
                    notify(
                      enabled
                        ? "Métricas opcionais ativadas."
                        : "Métricas opcionais desativadas.",
                    );
                  });
                }}
              />
            </label>
            <p>
              Responsável: Operador desta instalação.
              <br />
              <a href="mailto:privacidade@example.com">
                privacidade@example.com
              </a>
            </p>
            <p className="subtle">
              Você pode pedir acesso, correção, portabilidade ou exclusão dos
              dados. Consulte a política para conhecer os dados tratados, os
              fornecedores e os prazos de retenção.
            </p>
            <a
              className="button"
              href="/privacidade"
              target="_blank"
              rel="noreferrer"
            >
              Política de privacidade
            </a>
            <a
              className="button"
              href="mailto:privacidade@example.com?subject=WZY%20-%20Solicitação%20de%20privacidade"
            >
              Solicitar atendimento
            </a>
            <p className="subtle">
              Não envie senhas ou códigos de autenticação. A confirmação de
              identidade será feita pelo responsável antes de atender à
              solicitação.
            </p>
          </>
        )}
      </section>
    </>
  );
}
