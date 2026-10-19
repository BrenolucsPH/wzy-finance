"use client";
import { OperationsPanel } from "./features/admin/operations";
/* eslint-disable @next/next/no-img-element -- Profile photos are private, already resized, and require the owner's session cookie. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Camera,
  UserRound,
  Monitor,
  Smartphone,
  MapPin,
  Clock3,
  ShieldCheck,
  Activity,
  UsersRound,
  RefreshCw,
  LogOut,
  Pencil,
  Search,
  Check,
  KeyRound,
} from "lucide-react";
import { Modal, type Person } from "./components";
import { PageSkeleton, Ripple } from "./motion-ui";
type Device = {
  id: string;
  created: number;
  last_seen: number;
  expires: number;
  device: string;
  browser: string;
  os: string;
  label: string;
  ip: string;
  city: string;
  region: string;
  country: string;
  verified: number;
  current?: boolean;
};
type Event = {
  id: string;
  kind: string;
  created: number;
  device: string;
  browser: string;
  os: string;
  ip: string;
  city: string;
  region: string;
  country: string;
};
type Member = {
  id: string;
  name: string;
  email: string;
  created: number;
  disabled: number;
  mfa: string | null;
  verified: number;
  session_count: number;
  last_access: number;
  isAdmin: boolean;
};
async function request<T>(
  path: string,
  body?: unknown,
  method = "GET",
  signal?: AbortSignal,
): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch("/api/" + path, {
    method: body === undefined ? method : method === "GET" ? "POST" : method,
    credentials: "same-origin",
    headers: multipart
      ? undefined
      : body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    signal,
  });
  const data = (await response.json()) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
export function Avatar({
  user,
  small = false,
  large = false,
}: {
  user: Person | null;
  small?: boolean;
  large?: boolean;
}) {
  const [failedVersion, setFailedVersion] = useState<number>();
  return (
    <div
      className={`avatar ${small ? "small" : ""} ${large ? "account-avatar" : ""}`}
    >
      {user?.avatarVersion && failedVersion !== user.avatarVersion ? (
        <img
          src={"/api/account/avatar?v=" + user.avatarVersion}
          alt={"Foto de " + user.name}
          onError={() => setFailedVersion(user.avatarVersion)}
        />
      ) : (
        user?.name[0]?.toUpperCase() || <UserRound size={large ? 30 : 18} />
      )}
    </div>
  );
}
const labels: Record<string, string> = {
  login_success: "Acesso confirmado",
  login_challenge: "Verificação de acesso solicitada",
  login_failed: "Tentativa de acesso com senha incorreta",
  logout: "Saída da conta",
  profile_changed: "Perfil atualizado",
  avatar_changed: "Foto de perfil atualizada",
  avatar_removed: "Foto de perfil removida",
  password_changed: "Senha alterada",
  mfa_enabled: "Verificação em duas etapas ativada",
  mfa_disabled: "Verificação em duas etapas desativada",
  sessions_revoked: "Outros dispositivos desconectados",
  session_revoked: "Dispositivo desconectado",
  admin_suspended: "Conta suspensa pelo administrador",
  admin_reactivated: "Conta reativada pelo administrador",
  account_suspended: "Sua conta foi suspensa",
  account_reactivated: "Sua conta foi reativada",
  admin_sessions_revoked: "Sessões encerradas pelo administrador",
};
const zones = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Cuiaba",
  "America/Rio_Branco",
  "America/Noronha",
  "Europe/Lisbon",
  "UTC",
];
function place(x: { city: string; region: string; country: string }) {
  return (
    [x.city, x.region, x.country].filter(Boolean).join(", ") ||
    "Local não disponível"
  );
}
export function AccountCenter({
  user,
  setUser,
  login,
  notify,
  onSignedOut,
}: {
  user: Person | null;
  setUser: (u: Person) => void;
  login: () => void;
  notify: (s: string) => void;
  onSignedOut: () => void;
}) {
  const [tab, setTab] = useState("Perfil"),
    [devices, setDevices] = useState<Device[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [loadedKey, setLoadedKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const [name, setName] = useState(user?.name || ""),
    [timezone, setTimezone] = useState(user?.timezone || "America/Sao_Paulo");
  const [confirm, setConfirm] = useState<Device | "others" | null>(null),
    [rename, setRename] = useState<Device | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const userId = user?.id;
  const queryKey = tab + ":" + userId + ":" + reload;
  const loading =
    !!userId &&
    ["Dispositivos", "Atividade"].includes(tab) &&
    loadedKey !== queryKey;
  useEffect(() => {
    if (!userId || !["Dispositivos", "Atividade"].includes(tab)) return;
    const abort = new AbortController();
    const task =
      tab === "Dispositivos"
        ? request<{
            sessions: Device[];
          }>("account/sessions", undefined, "GET", abort.signal).then((r) => {
            setDevices(r.sessions);
            setError("");
          })
        : request<{
            events: Event[];
          }>("account/events", undefined, "GET", abort.signal).then((r) => {
            setEvents(r.events);
            setError("");
          });
    task
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadedKey(queryKey);
      });
    return () => abort.abort();
  }, [tab, userId, reload, queryKey]);
  const date = (value: number) =>
    value
      ? new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: user?.timezone || "America/Sao_Paulo",
        }).format(value)
      : "Não registrado";
  async function photo(file?: File) {
    if (!user) {
      login();
      return;
    }
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await request<{
        avatarVersion: number;
        message: string;
      }>("account/avatar", form);
      setUser({ ...user, avatarVersion: r.avatarVersion });
      notify(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!user) {
      login();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await request<{
        name: string;
        timezone: string;
        message: string;
      }>("account/profile", { name, timezone });
      setUser({ ...user, name: r.name, timezone: r.timezone });
      notify(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-center">
      <div className="account-intro">
        <div>
          <p className="eyebrow">SEU ACESSO, SOB CONTROLE</p>
          <h2>Um espaço que é seu.</h2>
          <p>Cuide do seu perfil e acompanhe os acessos à sua conta.</p>
        </div>
        <span className="account-shield">
          <ShieldCheck size={24} />
        </span>
      </div>
      <div className="account-tabs" role="tablist" aria-label="Gerenciar conta">
        {[
          ["Perfil", UserRound],
          ["Dispositivos", Monitor],
          ["Atividade", Activity],
          ...(user?.isAdmin ? [["Administração", UsersRound]] : []),
        ].map(([title, Icon]) => {
          const I = Icon as typeof Monitor;
          return (
            <button
              key={String(title)}
              role="tab"
              tabIndex={tab === title ? 0 : -1}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                const items = Array.from(
                  e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    "[role=tab]",
                  ) || [],
                );
                const at = items.indexOf(e.currentTarget);
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : (at +
                          (e.key === "ArrowRight" ? 1 : -1) +
                          items.length) %
                        items.length;
                items[next]?.focus();
                items[next]?.click();
              }}
              aria-selected={tab === title}
              aria-controls="account-panel"
              id={"account-tab-" + title}
              className={tab === title ? "selected" : ""}
              onClick={() => {
                setError("");
                setTab(String(title));
              }}
            >
              <I size={17} />
              <span>{String(title)}</span>
            </button>
          );
        })}
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setReload((x) => x + 1)}
          >
            Tentar novamente
          </button>
        </div>
      )}
      <div
        id="account-panel"
        role="tabpanel"
        aria-labelledby={"account-tab-" + tab}
        className="account-panel"
        key={tab}
      >
        {tab === "Perfil" ? (
          <div className="account-profile-grid">
            <section className="card settings-card profile-photo-card">
              <Avatar user={user} large />
              <h3>{user?.name || "Seu perfil no WZY"}</h3>
              <p className="subtle">
                Uma foto para deixar seu espaço com a sua cara.
              </p>
              <input
                type="file"
                ref={fileRef}
                accept="image/jpeg,image/png,image/webp"
                hidden
                aria-label="Escolher foto de perfil"
                onChange={(e) => photo(e.target.files?.[0])}
              />
              <button
                className="button"
                disabled={busy}
                onClick={() => (user ? fileRef.current?.click() : login())}
              >
                {busy ? <Ripple small /> : <Camera size={17} />}Alterar foto
              </button>
              <small>JPG, PNG ou WebP · até 2 MB</small>
              {!!user?.avatarVersion && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await request<{
                        message: string;
                      }>("account/avatar", undefined, "DELETE");
                      setUser({ ...user, avatarVersion: 0 });
                      notify(r.message);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remover foto
                </button>
              )}
            </section>
            <section className="card settings-card">
              <div className="settings-heading">
                <UserRound size={23} />
                <div>
                  <h2>Informações pessoais</h2>
                  <p>Você escolhe como aparece no seu espaço.</p>
                </div>
              </div>
              <form className="entry-form account-form" onSubmit={saveProfile}>
                <label>
                  Nome de exibição
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Como você quer ser chamado?"
                    required
                    maxLength={100}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Email da conta
                  <input
                    value={user?.email || "Entre para ver seu email"}
                    readOnly
                    type={user ? "email" : "text"}
                  />
                </label>
                <p className="subtle account-email-note">
                  {user?.emailVerified
                    ? "Email verificado."
                    : "A verificação de email ficará disponível após a ativação do serviço de envio."}
                </p>
                <label>
                  Fuso horário
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  >
                    {Array.from(new Set([...zones, timezone])).map((z) => (
                      <option key={z} value={z}>
                        {z
                          .replace("America/", "")
                          .replace("Europe/", "")
                          .replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="subtle">
                  Usado para exibir os horários dos seus acessos.
                </p>
                <button className="button primary" disabled={busy}>
                  {busy ? <Ripple small /> : <Check size={17} />}Salvar perfil
                </button>
              </form>
              {user && (
                <p className="account-id">
                  Identificador da conta <code>{user.id}</code>
                </p>
              )}
            </section>
          </div>
        ) : tab === "Dispositivos" ? (
          <section className="card settings-card">
            <div className="account-section-heading">
              <div>
                <h2>Dispositivos conectados</h2>
                <p>Reconheça seus acessos e desconecte os que não usa mais.</p>
              </div>
              <div className="account-actions">
                <button
                  className="button icon-button"
                  aria-label="Atualizar dispositivos"
                  disabled={loading}
                  onClick={() => setReload((x) => x + 1)}
                >
                  <RefreshCw size={17} />
                </button>
                <button
                  className="button"
                  onClick={() => (user ? setConfirm("others") : login())}
                  disabled={busy}
                >
                  Encerrar outros
                </button>
              </div>
            </div>
            {loading ? (
              <PageSkeleton page="Dispositivos" />
            ) : !user ? (
              <div className="account-empty">
                <Monitor size={36} />
                <h3>Reconheça cada acesso.</h3>
                <p>
                  Entre para ver seus dispositivos, horários e locais de
                  conexão.
                </p>
                <button className="button primary" onClick={login}>
                  Entrar na minha conta
                </button>
              </div>
            ) : devices.length === 0 ? (
              <p className="subtle">Nenhuma sessão ativa encontrada.</p>
            ) : (
              <div className="device-list">
                {devices.map((d) => (
                  <div className="device-card" key={d.id}>
                    <span className="device-icon">
                      {d.device === "Celular" ? (
                        <Smartphone size={23} />
                      ) : (
                        <Monitor size={23} />
                      )}
                    </span>
                    <div className="device-body">
                      <h3>
                        {d.label ||
                          [d.browser, d.os].filter(Boolean).join(" · ") ||
                          "Acesso anterior"}
                        {d.current && (
                          <span className="account-badge">
                            Este dispositivo
                          </span>
                        )}
                      </h3>
                      <p>
                        {d.device || "Dispositivo não registrado"}
                        {d.label && ` · ${d.browser} · ${d.os}`}
                        {!d.verified && " · Aguardando verificação"}
                      </p>
                      <div className="device-meta">
                        <span>
                          <MapPin size={13} />
                          {place(d)}
                        </span>
                        <span>
                          <Clock3 size={13} />
                          Última atividade: {date(d.last_seen)}
                        </span>
                      </div>
                      {d.ip && <small>IP: {d.ip}</small>}
                      <small>
                        Conectado em {date(d.created)} · Expira em{" "}
                        {date(d.expires)}
                      </small>
                    </div>
                    <div className="device-actions">
                      <button
                        className="button icon-button"
                        aria-label="Renomear dispositivo"
                        onClick={() => {
                          setError("");
                          setRename(d);
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="button"
                        onClick={() => {
                          setError("");
                          setConfirm(d);
                        }}
                      >
                        <LogOut size={15} />
                        Desconectar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="notice wide">
              O local é aproximado e pode mudar com VPN ou rede móvel. Cada
              acesso representa uma sessão do navegador. A atividade é
              atualizada em intervalos de até cinco minutos; acessos antigos
              podem não ter detalhes registrados.
            </div>
          </section>
        ) : tab === "Atividade" ? (
          <section className="card settings-card">
            <div className="account-section-heading">
              <div>
                <h2>Atividade de segurança</h2>
                <p>Acessos e alterações recentes da sua conta.</p>
              </div>
              <button
                className="button icon-button"
                aria-label="Atualizar atividade"
                disabled={loading}
                onClick={() => setReload((x) => x + 1)}
              >
                <RefreshCw size={17} />
              </button>
            </div>
            {loading ? (
              <PageSkeleton page="Atividade" />
            ) : !user ? (
              <div className="account-empty">
                <Activity size={36} />
                <h3>Seu histórico de segurança.</h3>
                <p>
                  Entre para acompanhar os acessos e as alterações da sua conta.
                </p>
                <button className="button primary" onClick={login}>
                  Entrar na minha conta
                </button>
              </div>
            ) : events.length === 0 ? (
              <p className="subtle">
                Os próximos acessos e alterações aparecerão aqui.
              </p>
            ) : (
              <div className="account-timeline">
                {events.map((e) => (
                  <div
                    key={e.id}
                    className={
                      "activity-row " +
                      (e.kind === "login_failed" ? "activity-warning" : "")
                    }
                  >
                    <span className="activity-dot" />
                    <div>
                      <h3>{labels[e.kind] || "Alteração de segurança"}</h3>
                      <p>
                        {[e.browser, e.os].filter(Boolean).join(" · ")} ·{" "}
                        {place(e)}
                      </p>
                      <small>
                        {date(e.created)}
                        {e.ip && ` · IP ${e.ip}`}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="notice wide">
              Até 50 eventos recentes preservados. O registro começou com a
              ativação deste recurso.
            </div>
          </section>
        ) : user?.isAdmin ? (
          <AdminPanel user={user} notify={notify} />
        ) : null}
      </div>
      {confirm && (
        <Modal
          title="Desconectar dispositivo"
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <p>
            {confirm === "others"
              ? "Encerrar todos os outros acessos? Você continuará conectado neste dispositivo."
              : confirm.current
                ? "Você será desconectado deste navegador."
                : "Encerrar o acesso de " +
                  (confirm.label || confirm.browser || "este dispositivo") +
                  "?"}
          </p>
          <div className="form-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Cancelar
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                if (!user) return;
                setBusy(true);
                try {
                  const r = await request<{
                    message: string;
                    signedOut?: boolean;
                  }>("account/sessions/revoke", {
                    id: confirm === "others" ? "others" : confirm.id,
                  });
                  notify(r.message);
                  setConfirm(null);
                  setReload((x) => x + 1);
                  if (r.signedOut) onSignedOut();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Ripple small /> : <LogOut size={16} />}Desconectar
            </button>
          </div>
        </Modal>
      )}
      {rename && (
        <Modal
          title="Nome do dispositivo"
          onClose={() => {
            if (!busy) setRename(null);
          }}
        >
          <form
            className="entry-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const data = new FormData(e.currentTarget);
              try {
                const r = await request<{
                  message: string;
                }>("account/sessions/label", {
                  id: rename.id,
                  label: data.get("label"),
                });
                notify(r.message);
                setRename(null);
                setReload((x) => x + 1);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <label>
              Nome
              <input
                name="label"
                defaultValue={rename.label}
                placeholder="Meu computador, celular pessoal…"
                maxLength={60}
              />
            </label>
            <button className="button primary" disabled={busy}>
              Salvar nome
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function AdminPanel({
  user,
  notify,
}: {
  user: Person;
  notify: (s: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [users, setUsers] = useState<Member[]>([]),
    [more, setMore] = useState(false),
    [loadedKey, setLoadedKey] = useState(""),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{
      member: Member;
      kind: "status" | "sessions/revoke";
    } | null>(null),
    [dialogError, setDialogError] = useState(""),
    [detail, setDetail] = useState<Member | null>(null),
    [devices, setDevices] = useState<Device[]>([]),
    [devicesKey, setDevicesKey] = useState("");
  const queryKey = search + ":" + offset + ":" + reload;
  const loading = loadedKey !== queryKey;
  const devicesLoading = !!detail && devicesKey !== detail.id;
  useEffect(() => {
    if (!user.mfa) return;
    const abort = new AbortController();
    request<{
      users: Member[];
      more: boolean;
    }>(
      `admin/users?q=${encodeURIComponent(search)}&offset=${offset}`,
      undefined,
      "GET",
      abort.signal,
    )
      .then((r) => {
        setUsers(r.users);
        setMore(r.more);
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadedKey(queryKey);
      });
    return () => abort.abort();
  }, [search, offset, reload, user.mfa, queryKey]);
  useEffect(() => {
    if (!detail) return;
    const abort = new AbortController();
    request<{
      sessions: Device[];
    }>(
      "admin/sessions?userId=" + encodeURIComponent(detail.id),
      undefined,
      "GET",
      abort.signal,
    )
      .then((r) => {
        setDevices(r.sessions);
        setDialogError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setDialogError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setDevicesKey(detail.id);
      });
    return () => abort.abort();
  }, [detail]);
  if (!user.mfa)
    return (
      <section className="card settings-card account-empty">
        <KeyRound size={36} />
        <h2>Proteja seu acesso de administrador.</h2>
        <p>
          Ative a verificação em duas etapas na seção Segurança da conta abaixo
          para acessar a administração.
        </p>
      </section>
    );
  return (
    <>
      <OperationsPanel />
      <section className="card settings-card admin-panel">
        <div className="account-section-heading">
          <div>
            <h2>Administração de usuários</h2>
            <p>
              Gerencie contas e acessos. Os dados financeiros permanecem
              privados.
            </p>
          </div>
          <ShieldCheck size={24} />
        </div>
        <form
          className="admin-search"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setSearch(query);
            setReload((x) => x + 1);
          }}
        >
          <label>
            <Search size={17} />
            <input
              aria-label="Buscar usuário por nome ou email"
              placeholder="Buscar por nome ou email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={100}
            />
          </label>
          <button className="button" disabled={loading}>
            Buscar
          </button>
          <button
            className="button icon-button"
            type="button"
            aria-label="Atualizar usuários"
            disabled={loading}
            onClick={() => setReload((x) => x + 1)}
          >
            <RefreshCw size={17} />
          </button>
        </form>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {loading ? (
          <PageSkeleton page="Usuários" />
        ) : users.length === 0 ? (
          <div className="account-empty">Nenhum usuário encontrado.</div>
        ) : (
          <div className="admin-members">
            {users.map((m) => (
              <div className="admin-member" key={m.id}>
                <div className="admin-member-info">
                  <h3>
                    {m.name}
                    <span
                      className={
                        "account-badge " + (m.disabled ? "suspended" : "")
                      }
                    >
                      {m.disabled
                        ? "Suspenso"
                        : m.isAdmin
                          ? "Administrador"
                          : "Ativo"}
                    </span>
                  </h3>
                  <p>{m.email}</p>
                  <small>
                    {m.session_count} sessões ·{" "}
                    {m.mfa ? "2FA ativado" : "2FA desativado"} ·{" "}
                    {m.verified ? "Email verificado" : "Email não verificado"}
                  </small>
                </div>
                <div className="admin-member-actions">
                  <button className="button" onClick={() => setDetail(m)}>
                    <Monitor size={15} />
                    Dispositivos
                  </button>
                  {!m.isAdmin && m.id !== user.id && (
                    <>
                      <button
                        className="button"
                        onClick={() => {
                          setDialogError("");
                          setAction({ member: m, kind: "sessions/revoke" });
                        }}
                      >
                        Desconectar
                      </button>
                      <button
                        className={
                          "button " + (!m.disabled ? "danger-button" : "")
                        }
                        onClick={() => {
                          setDialogError("");
                          setAction({ member: m, kind: "status" });
                        }}
                      >
                        {m.disabled ? "Reativar" : "Suspender"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="admin-pagination">
          <button
            className="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset((x) => Math.max(0, x - 20))}
          >
            Anterior
          </button>
          <span>Página {Math.floor(offset / 20) + 1}</span>
          <button
            className="button"
            disabled={!more || loading}
            onClick={() => setOffset((x) => x + 20)}
          >
            Próxima
          </button>
        </div>
        <div className="notice wide">
          A suspensão encerra as sessões e impede novos acessos. Ao reativar, o
          usuário precisa entrar novamente. Cada ação é registrada no histórico
          de segurança.
        </div>
        {action && (
          <Modal
            title={
              action.kind === "status"
                ? action.member.disabled
                  ? "Reativar conta"
                  : "Suspender conta"
                : "Desconectar usuário"
            }
            onClose={() => {
              if (!busy) setAction(null);
            }}
          >
            <form
              className="entry-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                setBusy(true);
                setDialogError("");
                try {
                  const r = await request<{
                    message: string;
                  }>("admin/" + action.kind, {
                    userId: action.member.id,
                    disabled: !action.member.disabled,
                    password: data.get("password"),
                  });
                  notify(r.message);
                  setAction(null);
                  setReload((x) => x + 1);
                } catch (e) {
                  setDialogError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p>
                Confirme a ação para <b>{action.member.name}</b> (
                {action.member.email}).
              </p>
              {action.kind === "status" && !action.member.disabled && (
                <p className="subtle">
                  O usuário perderá o acesso imediatamente. Seus registros serão
                  preservados.
                </p>
              )}
              <label>
                Sua senha atual
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  maxLength={72}
                />
              </label>
              {dialogError && (
                <div className="form-error" role="alert">
                  {dialogError}
                </div>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? <Ripple small /> : <ShieldCheck size={16} />}Confirmar
                ação
              </button>
            </form>
          </Modal>
        )}
        {detail && (
          <Modal
            title={"Dispositivos de " + detail.name}
            onClose={() => setDetail(null)}
          >
            {dialogError && (
              <div className="form-error" role="alert">
                {dialogError}
              </div>
            )}
            {devicesLoading ? (
              <PageSkeleton page="Dispositivos" />
            ) : devices.length === 0 ? (
              <p className="subtle">Nenhuma sessão ativa.</p>
            ) : (
              devices.map((d) => (
                <div key={d.id} className="admin-device">
                  <b>
                    {d.label ||
                      [d.browser, d.os].filter(Boolean).join(" · ") ||
                      "Acesso anterior"}
                  </b>
                  <p>
                    {place(d)}
                    {d.ip && ` · IP ${d.ip}`}
                  </p>
                  <small>
                    Última atividade:{" "}
                    {d.last_seen
                      ? new Date(d.last_seen).toLocaleString("pt-BR", {
                          timeZone: user.timezone || "America/Sao_Paulo",
                        })
                      : "Não registrada"}
                  </small>
                </div>
              ))
            )}
            <p className="subtle">Localização aproximada da conexão.</p>
          </Modal>
        )}
      </section>
    </>
  );
}
