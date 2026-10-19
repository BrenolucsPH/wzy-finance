"use client";
import Image from "next/image";
import { useState, useEffect } from "react";
import {
  ShieldCheck,
  Smartphone,
  Mail,
  KeyRound,
  Monitor,
  Download,
  Check,
  Copy,
  UploadCloud,
  FileText,
} from "lucide-react";
import { api, Modal, type Person } from "./components";
import { PageSkeleton, Ripple } from "./motion-ui";
import { type Entry } from "../lib/finance";
import { uploadAttachment } from "../lib/upload-client";
import { AccountCenter } from "./account-center";
export function Security({
  user,
  setUser,
  notify,
  demo,
  login,
  dark,
  setDark,
  entries,
}: {
  user: Person | null;
  setUser: (u: Person | null) => void;
  notify: (s: string) => void;
  demo: boolean;
  login: () => void;
  dark: boolean;
  setDark: (d: boolean) => void;
  entries: Entry[];
}) {
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState("");
  const [services, setServices] = useState({
    emailReady: false,
    smsReady: false,
    totpReady: false,
  });
  const [mode, setMode] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api("auth/me")
      .then((r) => {
        if (active) setServices(r);
      })
      .catch((e) => {
        if (active) setServicesError(e.message);
      })
      .finally(() => {
        if (active) setServicesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function configure(m: string) {
    if (demo) {
      login();
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (m === "totp") {
        const r = await api("auth/mfa/setup", {});
        setSecret(r.secret);
        const qrLib = (await import("qrcode")).default;
        setQr(await qrLib.toDataURL(r.uri, { width: 220, margin: 2 }));
      }
      setMode(m);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function backup() {
    const data = { app: "WZY", exportedAt: new Date().toISOString(), entries };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download =
      "WZY-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  if (servicesLoading) return <PageSkeleton page="Configurações" />;
  return (
    <>
      <AccountCenter
        user={user}
        setUser={setUser}
        login={login}
        notify={notify}
        onSignedOut={() => {
          setUser(null);
          login();
        }}
      />
      <div className="settings-grid">
        {servicesError && (
          <div className="form-error" role="alert">
            {servicesError}
          </div>
        )}
        <section className="card settings-card">
          <div className="settings-heading">
            <ShieldCheck size={23} />
            <div>
              <h2>Segurança da conta</h2>
              <p>Uma segunda verificação protege seu acesso.</p>
            </div>
          </div>
          <div className="account-details">
            <span>
              Nome <b>{user?.name || "Conta demonstração"}</b>
            </span>
            <span>
              Email <b>{user?.email || "Entre para criar seu espaço"}</b>
            </span>
            <span>
              Verificação em duas etapas{" "}
              <b className={user?.mfa ? "positive" : "warning"}>
                {user?.mfa === "totp"
                  ? "Aplicativo autenticador"
                  : user?.mfa === "email"
                    ? "Email"
                    : user?.mfa === "sms"
                      ? "SMS"
                      : "Não ativada"}
              </b>
            </span>
          </div>
          {[
            {
              m: "totp",
              Icon: KeyRound,
              title: "Aplicativo autenticador",
              detail:
                "Google Authenticator, Microsoft Authenticator ou 1Password.",
              ready: services.totpReady,
            },
            {
              m: "email",
              Icon: Mail,
              title: "Código por email",
              detail: services.emailReady
                ? "Receba um código no seu email."
                : "Aguardando ativação do serviço de envio.",
              ready: services.emailReady,
            },
            {
              m: "sms",
              Icon: Smartphone,
              title: "Código por SMS",
              detail: services.smsReady
                ? "Receba um código no seu celular."
                : "Aguardando ativação do serviço de SMS.",
              ready: services.smsReady,
            },
          ].map(({ m, Icon, title, detail, ready }) => (
            <div className="security-option" key={m}>
              <Icon size={20} />
              <div className="grow">
                <b>{title}</b>
                <p>{detail}</p>
              </div>
              <button
                className="button"
                disabled={busy || !!user?.mfa || (!demo && !ready)}
                onClick={() => configure(m)}
              >
                {user?.mfa === m ? (
                  <>
                    <Check size={16} />
                    Ativo
                  </>
                ) : ready || demo ? (
                  "Configurar"
                ) : (
                  "Em breve"
                )}
              </button>
            </div>
          ))}
          {user?.mfa && (
            <button
              className="text-button danger"
              onClick={() => {
                setMode("disable");
                setError("");
              }}
            >
              Desativar verificação em duas etapas
            </button>
          )}
        </section>
        <section className="card settings-card">
          <div className="settings-heading">
            <Monitor size={23} />
            <div>
              <h2>Seu espaço</h2>
              <p>Preferências, acesso e cópia dos dados.</p>
            </div>
          </div>
          <div className="preference-row">
            <div>
              <b>Aparência</b>
              <p>Escolha o tema que combina com seu momento.</p>
            </div>
            <div className="segmented">
              <button
                className={!dark ? "selected" : ""}
                onClick={() => setDark(false)}
              >
                Claro
              </button>
              <button
                className={dark ? "selected" : ""}
                onClick={() => setDark(true)}
              >
                Escuro
              </button>
            </div>
          </div>
          <div className="preference-row">
            <div>
              <b>Senha de acesso</b>
              <p>Use uma senha longa e exclusiva.</p>
            </div>
            <button
              className="button"
              onClick={() =>
                demo ? login() : (setMode("password"), setError(""))
              }
            >
              Alterar
            </button>
          </div>
          <div className="preference-row">
            <div>
              <b>Sessões ativas</b>
              <p>Encerre o acesso em outros dispositivos.</p>
            </div>
            <button
              className="button"
              onClick={async () => {
                if (demo) {
                  login();
                  return;
                }
                try {
                  const r = await api("auth/sessions-revoke", {});
                  notify(r.message);
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              Encerrar outras
            </button>
          </div>
          <div className="preference-row">
            <div>
              <b>Cópia dos dados</b>
              <p>Exporte todos os seus registros em JSON.</p>
            </div>
            <button className="button" onClick={backup}>
              <Download size={16} />
              Exportar
            </button>
          </div>
          <div className="notice wide">
            {demo
              ? "Esta é uma demonstração com dados fictícios."
              : "Seus registros ficam vinculados à sua conta."}{" "}
            Os grupos organizam participantes; eles não dão acesso aos seus
            dados.
          </div>
        </section>
        {mode && (
          <Modal
            title={
              mode === "password"
                ? "Alterar senha"
                : mode === "disable"
                  ? "Desativar verificação"
                  : `Configurar ${mode === "totp" ? "autenticador" : mode === "email" ? "email" : "SMS"}`
            }
            onClose={() => {
              setMode(null);
              setSecret("");
              setQr("");
              setError("");
            }}
          >
            <form
              className="entry-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const f = Object.fromEntries(new FormData(e.currentTarget));
                try {
                  if (mode === "password") {
                    const r = await api("auth/password", f);
                    notify(r.message);
                    setMode(null);
                  } else if (mode === "disable") {
                    const r = await api("auth/mfa/disable", f);
                    setUser({ ...user!, mfa: null });
                    notify(r.message);
                    setMode(null);
                  } else {
                    const r = await api("auth/mfa/enable", {
                      mode,
                      code: f.code,
                    });
                    setUser(r.user);
                    setCodes(r.backupCodes || []);
                    notify("Verificação em duas etapas ativada.");
                    setMode(null);
                    setSecret("");
                    setQr("");
                  }
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {mode === "totp" && (
                <>
                  <p className="subtle">
                    No seu aplicativo autenticador, adicione uma conta usando
                    este QR code ou a chave abaixo.
                  </p>
                  {qr && (
                    <Image
                      unoptimized
                      width={220}
                      height={220}
                      className="qr-image"
                      src={qr}
                      alt="QR code de configuração do autenticador"
                    />
                  )}
                  <div className="secret-key">
                    <code>{secret}</code>
                    <button
                      type="button"
                      title="Copiar chave"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(secret)
                          .then(() => notify("Chave copiada."))
                          .catch(() => notify("Copie a chave exibida."))
                      }
                    >
                      <Copy size={17} />
                    </button>
                  </div>
                </>
              )}
              {mode === "disable" && user?.mfa !== "totp" && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await api("auth/mfa/send", {});
                      notify(r.message);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Enviar código de confirmação
                </button>
              )}
              {mode === "sms" && (
                <label>
                  Número do celular
                  <input
                    name="phone"
                    type="tel"
                    placeholder="+5511999999999"
                    required
                  />
                </label>
              )}
              {["email", "sms"].includes(mode) && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={async (ev) => {
                    setBusy(true);
                    setError("");
                    try {
                      const form = ev.currentTarget.form!;
                      const phone = new FormData(form).get("phone");
                      const r = await api("auth/mfa/send", { mode, phone });
                      notify(r.message);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Enviar código
                </button>
              )}
              {["totp", "email", "sms", "disable"].includes(mode) && (
                <label>
                  Código de verificação
                  <input
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    minLength={6}
                    placeholder="000000"
                    required
                  />
                </label>
              )}
              {mode === "disable" && (
                <label>
                  Senha atual
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
              )}
              {mode === "password" && (
                <>
                  <label>
                    Senha atual
                    <input
                      name="current"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                  <label>
                    Nova senha
                    <input
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={72}
                      required
                      placeholder="Pelo menos 12 caracteres"
                    />
                  </label>
                </>
              )}
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <>
                    <Ripple small label="Verificando" />
                    Verificando…
                  </>
                ) : mode === "password" ? (
                  "Salvar senha"
                ) : mode === "disable" ? (
                  "Desativar"
                ) : (
                  "Confirmar e ativar"
                )}
              </button>
            </form>
          </Modal>
        )}
        {codes.length > 0 && (
          <Modal
            title="Guarde seus códigos de recuperação"
            onClose={() => setCodes([])}
          >
            <p className="subtle">
              Cada código pode ser usado uma vez se você perder o autenticador.
              Eles só serão exibidos agora.
            </p>
            <div className="recovery-codes">
              {codes.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
            <button
              className="button primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(codes.join("\n"));
                  notify("Códigos copiados.");
                } catch {
                  notify("Copie os códigos exibidos.");
                }
              }}
            >
              <Copy size={17} />
              Copiar códigos
            </button>
          </Modal>
        )}
      </div>
    </>
  );
}
export function Files({
  demo,
  login,
  notify,
}: {
  demo: boolean;
  login: () => void;
  notify: (s: string) => void;
}) {
  const [files, setFiles] = useState<
    {
      id: string;
      name: string;
      type: string;
      size: number;
      created: number;
    }[]
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setLoaded(false);
    });
    if (demo) {
      void Promise.resolve().then(() => {
        if (active) setLoaded(true);
      });
      return;
    }
    api("files")
      .then((r) => {
        if (active) setFiles(r.files);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [demo]);
  async function upload(file?: File) {
    if (demo) {
      login();
      return;
    }
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = { file: await uploadAttachment(file) };
      setFiles((f) => [data.file, ...f]);
      notify("Arquivo enviado. Você pode vinculá-lo a uma transação.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!loaded) return <PageSkeleton page="Arquivos" />;
  return (
    <>
      <section
        className={`card upload-card ${drag ? "drag-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) upload(e.dataTransfer.files[0]);
        }}
      >
        <div className="upload-icon">
          <UploadCloud size={30} />
        </div>
        <h2>Um lugar para seus comprovantes.</h2>
        <p>Arraste seu arquivo aqui ou selecione no dispositivo.</p>
        <label className="button primary upload-button">
          {busy ? (
            <>
              <Ripple small label="Enviando arquivo" />
              Enviando…
            </>
          ) : (
            "Selecionar arquivo"
          )}
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            disabled={busy}
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <small>
          PDF, JPG ou PNG · Até 10 MB por arquivo · 100 MB por conta
        </small>
      </section>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <section className="card file-list">
        <div className="card-heading">
          <h2>Arquivos enviados</h2>
          <span className="subtle">{files.length} arquivos</span>
        </div>
        {files.length ? (
          files.map((f) => (
            <div className="file-row" key={f.id}>
              <div className="icon-box blue">
                <FileText size={20} />
              </div>
              <div className="grow">
                <b>{f.name}</b>
                <small>
                  {(f.size / 1024).toFixed(0)} KB ·{" "}
                  {new Date(f.created).toLocaleDateString("pt-BR")}
                </small>
              </div>
              <a className="button" href={"/api/files/" + f.id}>
                <Download size={16} />
                Baixar
              </a>
            </div>
          ))
        ) : (
          <p className="empty-file">Seus comprovantes aparecerão aqui.</p>
        )}
      </section>
    </>
  );
}
