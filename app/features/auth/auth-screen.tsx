"use client";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck, Eye, EyeOff, ArrowLeft, LockKeyhole } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Ripple } from "../../motion-ui";
import { api, type Person } from "../../../lib/client";
export function Auth({
  onDone,
  onClose,
  resetToken,
}: {
  onDone: (u: Person) => void;
  onClose: () => void;
  resetToken?: string;
}) {
  const [mode, setMode] = useState(resetToken ? "reset" : "login");
  const [mfa, setMfa] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [providers, setProviders] = useState({
    emailReady: false,
    smsReady: false,
  });
  useEffect(() => {
    api("auth/me")
      .then(setProviders)
      .catch(() => {});
  }, []);
  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      const r = await api("auth/mfa/send", {});
      setMessage(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (mode === "forgot") {
        const r = await api("auth/reset-request", { email: f.email });
        setMessage(r.message);
      } else if (mode === "reset") {
        const r = await api("auth/reset", {
          token: resetToken,
          password: f.password,
          code: f.code,
        });
        setMessage(r.message);
        setMode("login");
        history.replaceState(null, "", "/");
      } else if (mode === "mfa") {
        const r = await api("auth/mfa/verify", { code: f.code });
        onDone(r.user);
      } else {
        const r = await api(
          "auth/" + (mode === "register" ? "register" : "login"),
          f,
        );
        if (r.mfa) {
          setMfa(r.mfa);
          setMode("mfa");
        } else onDone(r.user);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`auth-screen ${mode === "register" ? "auth-register" : ""}`}
    >
      <div className="auth-grid" aria-hidden="true" />
      <button className="auth-back" onClick={onClose}>
        <ArrowLeft size={17} />
        Voltar ao painel
      </button>
      <div className="auth-content">
        <div className="auth-glass">
          <aside className="auth-intro">
            <div className="auth-brand">
              <Image
                className="horse-mark"
                src="/wzy-horse.png"
                alt=""
                width="46"
                height="46"
              />
              <strong>WZY</strong>
            </div>
            <div className="auth-welcome">
              <span className="auth-eyebrow">
                SUAS FINANÇAS, EM PERSPECTIVA
              </span>
              <h1>
                {mode === "register" ? (
                  <>
                    Seu próximo <br />
                    capítulo começa aqui.
                  </>
                ) : (
                  <>
                    Bom ter <br />
                    você de volta.
                  </>
                )}
              </h1>
              <p>
                Mais clareza para organizar o presente.
                <br />
                Mais liberdade para escolher o futuro.
              </p>
              <button
                type="button"
                className="auth-intro-action"
                disabled={busy}
                onClick={() => {
                  setMode(mode === "register" ? "login" : "register");
                  setError("");
                  setMessage("");
                }}
              >
                {mode === "register"
                  ? "Já tenho uma conta"
                  : "Criar minha conta"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
            <div className="auth-intro-note">
              <ShieldCheck size={16} />
              Um espaço só seu.
            </div>
          </aside>
          <div className="auth-card">
            <div className="auth-form-content" key={mode}>
              <div className="auth-lock">
                <LockKeyhole size={23} />
              </div>
              <h2>
                {
                  (
                    {
                      login: "Entrar na conta",
                      register: "Criar sua conta",
                      forgot: "Recupere seu acesso.",
                      reset: "Uma nova senha.",
                      mfa: "Uma camada a mais.",
                    } as Record<string, string>
                  )[mode]
                }
              </h2>
              <p>
                {mode === "mfa"
                  ? `Use ${mfa === "totp" ? "seu aplicativo autenticador ou um código de recuperação" : mfa === "email" ? "o código enviado por email" : "o código recebido por SMS"}.`
                  : mode === "register"
                    ? "Crie seu espaço pessoal no WZY."
                    : mode === "forgot"
                      ? "Enviaremos um link para redefinir sua senha."
                      : "Entre no seu espaço financeiro."}
              </p>
              <form onSubmit={submit}>
                {mode === "register" && (
                  <label>
                    Seu nome
                    <input
                      name="name"
                      required
                      maxLength={100}
                      autoComplete="name"
                      placeholder="Como podemos chamar você?"
                    />
                  </label>
                )}
                {!["reset", "mfa"].includes(mode) && (
                  <label>
                    Email
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="voce@exemplo.com"
                    />
                  </label>
                )}
                {["login", "register", "reset"].includes(mode) && (
                  <label>
                    Senha
                    <div className="password-input">
                      <input
                        name="password"
                        type={visible ? "text" : "password"}
                        minLength={mode === "login" ? 1 : 12}
                        maxLength={72}
                        required
                        autoComplete={
                          mode === "login" ? "current-password" : "new-password"
                        }
                        placeholder={
                          mode === "login"
                            ? "Sua senha"
                            : "Pelo menos 12 caracteres"
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setVisible(!visible)}
                        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
                      >
                        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </label>
                )}
                {mode === "reset" && (
                  <button
                    type="button"
                    className="auth-secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const r = await api("auth/reset-factor-send", {
                          token: resetToken,
                        });
                        setMessage(r.message);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Enviar segundo código por email ou SMS
                  </button>
                )}
                {mode === "reset" && (
                  <label>
                    Código da verificação em duas etapas (se ativada)
                    <input
                      name="code"
                      inputMode="numeric"
                      placeholder="000000"
                      autoComplete="one-time-code"
                    />
                  </label>
                )}
                {mode === "mfa" && (
                  <label>
                    Código de verificação
                    <input
                      className="otp-input"
                      name="code"
                      required
                      maxLength={20}
                      autoComplete="one-time-code"
                      placeholder="Código de 6 dígitos ou de recuperação"
                    />
                  </label>
                )}
                {mode === "login" && (
                  <button
                    type="button"
                    className="auth-secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const get = await fetch("/api/passkeys/login/options", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: "{}",
                        });
                        const data = (await get.json()) as {
                          options: Parameters<
                            typeof startAuthentication
                          >[0]["optionsJSON"];
                          error?: string;
                        };
                        if (!get.ok) throw Error(data.error);
                        const response = await startAuthentication({
                          optionsJSON: data.options,
                        });
                        const verified = await fetch(
                          "/api/passkeys/login/verify",
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ response }),
                          },
                        );
                        const result = (await verified.json()) as {
                          user: Person;
                          mfa?: string;
                          error?: string;
                        };
                        if (!verified.ok) throw Error(result.error);
                        if (result.mfa) {
                          setMfa(result.mfa);
                          setMode("mfa");
                        } else onDone(result.user);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Entrar com biometria / chave
                  </button>
                )}
                {mode === "login" && (
                  <button
                    type="button"
                    className="auth-forgot"
                    onClick={() => {
                      setMode("forgot");
                      setError("");
                      setMessage("");
                    }}
                  >
                    Esqueci minha senha
                  </button>
                )}
                {mode === "forgot" && !providers.emailReady && (
                  <div className="auth-info">
                    O envio de emails ainda precisa ser ativado pelo
                    administrador.
                  </div>
                )}
                {error && (
                  <div className="form-error" role="alert">
                    {error}
                  </div>
                )}
                {message && (
                  <div className="form-success" role="status">
                    {message}
                  </div>
                )}
                <button
                  className="auth-submit"
                  disabled={
                    busy || (mode === "forgot" && !providers.emailReady)
                  }
                >
                  {busy ? (
                    <>
                      <Ripple small label="Processando" />
                      Aguarde…
                    </>
                  ) : mode === "register" ? (
                    "Criar minha conta"
                  ) : mode === "forgot" ? (
                    "Enviar link de recuperação"
                  ) : mode === "reset" ? (
                    "Atualizar senha"
                  ) : mode === "mfa" ? (
                    "Verificar e entrar"
                  ) : (
                    "Entrar na minha conta"
                  )}
                </button>
                {mode === "mfa" && mfa !== "totp" && (
                  <button
                    type="button"
                    className="auth-secondary"
                    disabled={busy}
                    onClick={sendCode}
                  >
                    Enviar código
                  </button>
                )}
              </form>
              <div className="auth-switch">
                {mode === "login" ? (
                  <>
                    Ainda não tem uma conta?{" "}
                    <button
                      onClick={() => {
                        setMode("register");
                        setError("");
                      }}
                    >
                      Criar conta
                    </button>
                  </>
                ) : mode === "register" ? (
                  <>
                    Já tem uma conta?{" "}
                    <button
                      onClick={() => {
                        setMode("login");
                        setError("");
                      }}
                    >
                      Entrar
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setMode("login");
                      setError("");
                    }}
                  >
                    Voltar para o login
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="auth-footer">
          <ShieldCheck size={15} />
          Seu espaço. Seus dados. Suas escolhas.{" "}
          <a href="/privacidade" target="_blank" rel="noreferrer">
            Política de privacidade
          </a>
        </div>
      </div>
    </div>
  );
}
