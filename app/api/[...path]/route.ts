import { observe } from "../../../lib/observability";
import { handleRecords } from "../../../lib/modules/records/handler";
import { z } from "zod";
import {
  db,
  runtime,
  session,
  newSession,
  cookie,
  passwordHash,
  passwordMatch,
  digest,
  random,
  rate,
  encrypt,
  decrypt,
  totpSecret,
  verifyTotp,
  email,
  emailReady,
  sms,
  smsReady,
  securityEvent,
  isAdministrator,
  type User,
} from "../../../lib/server";
import { validPassword } from "../../../lib/validation";

export const dynamic = "force-dynamic";
const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const fail = (message: string, status = 400) =>
  json({ error: message }, status);
const expose = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  mfa: u.mfa,
  phone: u.phone ? u.phone.slice(0, 3) + "••••" + u.phone.slice(-4) : null,
  emailVerified: !!u.verified,
  avatarVersion: u.avatar_updated,
  timezone: u.timezone,
  isAdmin: isAdministrator(u),
});
async function handler(req: Request) {
  try {
    const path = new URL(req.url).pathname.slice(5);
    const method = req.method;
    const read =
      path === "auth/me" ||
      path === "records" ||
      path === "files" ||
      path.startsWith("files/");
    if (method === "GET" && !read) return fail("Método não permitido.", 405);
    if (method === "DELETE" && !path.startsWith("records/"))
      return fail("Método não permitido.", 405);
    if (method === "POST" && (path === "auth/me" || path.startsWith("files/")))
      return fail("Método não permitido.", 405);
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      if (!origin || origin !== new URL(req.url).origin)
        return fail("Origem inválida.", 403);
    }
    if (path === "auth/me") {
      const u = await session(req);
      if (
        req.headers.get("x-wzy-owner") &&
        u?.id !== req.headers.get("x-wzy-owner")
      )
        return fail("Entre na mesma conta para continuar.", 401);
      return json({
        user: u ? expose(u) : null,
        emailReady: emailReady(),
        smsReady: smsReady(),
        totpReady: !!runtime.AUTH_ENCRYPTION_KEY,
        ...(/^wzy_qa_[a-f0-9]{32}$/.test(process.env.WZY_TEST_SCHEMA || "")
          ? { testOrigin: new URL(req.url).origin }
          : {}),
      });
    }
    let body: Record<string, unknown> = {};
    if (method !== "GET" && !path.startsWith("files")) {
      if (Number(req.headers.get("content-length") || 0) > 100000)
        return fail("Conteúdo muito grande.", 413);
      const raw = await req.text();
      if (raw.length > 100000) return fail("Conteúdo muito grande.", 413);
      if (raw) body = JSON.parse(raw);
    }
    if (
      [
        "auth/register",
        "auth/login",
        "auth/reset-request",
        "auth/reset",
        "auth/reset-factor-send",
      ].includes(path)
    ) {
      await rate(req, "auth-ip", "", 35);
      const emailAddress =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      await rate(req, path, emailAddress, 8);
      if (path === "auth/register") {
        if (
          !z.string().email().max(254).safeParse(emailAddress).success ||
          !validPassword(body.password) ||
          typeof body.name !== "string" ||
          !body.name.trim() ||
          body.name.length > 100
        )
          return fail(
            "Informe nome, email válido e senha com 12 a 72 caracteres.",
          );
        const id = crypto.randomUUID();
        try {
          await db()
            .prepare(
              "INSERT INTO users (id,email,name,password,created) VALUES (?,?,?,?,?)",
            )
            .bind(
              id,
              emailAddress,
              body.name.trim(),
              await passwordHash(body.password),
              Date.now(),
            )
            .run();
        } catch (e) {
          if (
            String(e).includes("UNIQUE") ||
            (e as { code?: string })?.code === "23505"
          )
            return fail(
              "Não foi possível criar a conta. Tente entrar ou recuperar seu acesso.",
            );
          throw e;
        }
        const u = await db()
          .prepare("SELECT * FROM users WHERE id=?")
          .bind(id)
          .first<User>();
        return json({ user: expose(u!) }, 201, {
          "Set-Cookie": await newSession(req, u!),
        });
      }
      if (path === "auth/login") {
        if (
          typeof body.password !== "string" ||
          new TextEncoder().encode(body.password).length > 72
        )
          return fail("Email ou senha incorretos.", 401);
        const u = await db()
          .prepare("SELECT * FROM users WHERE email=?")
          .bind(emailAddress)
          .first<User>();
        const hash =
          u?.password ||
          "$2b$12$LsbcSiuhtMzKsrtxSYJfKeceC9VZd03IzMPRpiEyFDTrLHYYdkchy";
        const valid = await passwordMatch(body.password, hash);
        if (u && !valid) await securityEvent(req, u.id, "login_failed");
        if (!u || !valid || u.disabled)
          return fail("Email ou senha incorretos.", 401);
        return json({ user: u.mfa ? null : expose(u), mfa: u.mfa }, 200, {
          "Set-Cookie": await newSession(req, u),
        });
      }
      if (path === "auth/reset-request") {
        if (!emailReady())
          return fail(
            "A recuperação por email será ativada quando o serviço de envio estiver configurado.",
            503,
          );
        const u = await db()
          .prepare("SELECT * FROM users WHERE email=?")
          .bind(emailAddress)
          .first<User>();
        if (u) {
          const token = random();
          await db().batch([
            db()
              .prepare("DELETE FROM challenges WHERE user_id=? AND kind=?")
              .bind(u.id, "reset"),
            db()
              .prepare(
                "INSERT INTO challenges (id,user_id,kind,hash,expires) VALUES (?,?,?,?,?)",
              )
              .bind(
                crypto.randomUUID(),
                u.id,
                "reset",
                await digest(token),
                Date.now() + 3600000,
              ),
          ]);
          const origin = runtime.APP_ORIGIN || new URL(req.url).origin;
          await email(
            u.email,
            "Redefina sua senha no WZY",
            `Recebemos um pedido de recuperação de senha. Use este link em até 1 hora: ${origin}/?reset=${encodeURIComponent(token)}\nSe você não fez o pedido, ignore esta mensagem.`,
          );
        }
        return json({
          message:
            "Se o email estiver cadastrado, enviaremos as instruções de recuperação.",
        });
      }
      if (path === "auth/reset-factor-send") {
        if (typeof body.token !== "string") return fail("Link inválido.");
        const c = await db()
          .prepare(
            "SELECT user_id FROM challenges WHERE hash=? AND kind=? AND expires>?",
          )
          .bind(await digest(body.token), "reset", Date.now())
          .first<{
            user_id: string;
          }>();
        if (!c) return fail("O link expirou ou já foi utilizado.");
        const resetUser = await db()
          .prepare("SELECT * FROM users WHERE id=?")
          .bind(c.user_id)
          .first<User>();
        if (!resetUser?.mfa)
          return json({
            message: "Esta conta não precisa de um segundo código.",
          });
        await rate(req, path, resetUser.id, 5);
        if (resetUser.mfa === "totp")
          return json({
            message: "Use o código do seu aplicativo autenticador.",
          });
        if (resetUser.mfa === "sms") {
          await sms(resetUser.phone!);
          return json({ message: "Código enviado para o celular cadastrado." });
        }
        const code = String(
          crypto.getRandomValues(new Uint32Array(1))[0] % 1000000,
        ).padStart(6, "0");
        await db().batch([
          db()
            .prepare("DELETE FROM challenges WHERE user_id=? AND kind=?")
            .bind(resetUser.id, "reset-email"),
          db()
            .prepare(
              "INSERT INTO challenges (id,user_id,kind,hash,expires) VALUES (?,?,?,?,?)",
            )
            .bind(
              crypto.randomUUID(),
              resetUser.id,
              "reset-email",
              await digest(code),
              Date.now() + 600000,
            ),
        ]);
        await email(
          resetUser.email,
          "Confirme a recuperação do WZY",
          `Seu código de confirmação é ${code}. Ele expira em 10 minutos.`,
        );
        return json({
          message: "Código de confirmação enviado para seu email.",
        });
      }
      if (path === "auth/reset") {
        if (typeof body.token !== "string" || !validPassword(body.password))
          return fail(
            "Link ou senha inválidos. Use uma senha com pelo menos 12 caracteres.",
          );
        const c = await db()
          .prepare(
            "SELECT * FROM challenges WHERE hash=? AND kind=? AND expires>?",
          )
          .bind(await digest(body.token), "reset", Date.now())
          .first<{
            id: string;
            user_id: string;
          }>();
        if (!c) return fail("O link expirou ou já foi utilizado.");
        const u = await db()
          .prepare("SELECT * FROM users WHERE id=?")
          .bind(c.user_id)
          .first<User>();
        if (u?.mfa) {
          if (u.mfa === "email") {
            const check = await db()
              .prepare(
                "DELETE FROM challenges WHERE user_id=? AND kind=? AND hash=? AND expires>? RETURNING id",
              )
              .bind(
                u.id,
                "reset-email",
                await digest(String(body.code || "")),
                Date.now(),
              )
              .first();
            if (!check)
              return fail(
                "Envie e confirme o código de verificação recebido por email.",
              );
          } else if (u.mfa === "sms") {
            if (!u.phone || !(await sms(u.phone, String(body.code || ""))))
              return fail("Confirme o código recebido por SMS.");
          } else {
            const counter = await verifyTotp(
              await decrypt(u.totp!),
              String(body.code || ""),
              u.totp_counter,
            );
            if (!counter)
              return fail(
                "Informe um código válido do aplicativo autenticador.",
              );
            const claimed = await db()
              .prepare(
                "UPDATE users SET totp_counter=? WHERE id=? AND totp_counter<?",
              )
              .bind(counter, u.id, counter)
              .run();
            if (!claimed.meta.changes) return fail("Código já utilizado.");
          }
        }
        const claimed = await db()
          .prepare("DELETE FROM challenges WHERE id=? RETURNING id")
          .bind(c.id)
          .first();
        if (!claimed) return fail("Link já utilizado.");
        await db().batch([
          db()
            .prepare("UPDATE users SET password=? WHERE id=?")
            .bind(await passwordHash(body.password), c.user_id),
          db().prepare("DELETE FROM sessions WHERE user_id=?").bind(c.user_id),
        ]);
        return json({ message: "Senha atualizada. Entre novamente." }, 200, {
          "Set-Cookie": cookie(req, ""),
        });
      }
    }
    const pending = path.startsWith("auth/mfa/");
    const u = await session(req, pending);
    if (!u) return fail("Entre na sua conta para continuar.", 401);
    if (
      req.headers.get("x-wzy-owner") &&
      u.id !== req.headers.get("x-wzy-owner")
    )
      return fail("Entre na mesma conta para continuar.", 401);
    if (path === "auth/logout") {
      await db()
        .prepare("DELETE FROM sessions WHERE hash=?")
        .bind(u.session_hash)
        .run();
      await securityEvent(req, u.id, "logout");
      return json({ ok: true }, 200, { "Set-Cookie": cookie(req, "") });
    }
    if (path === "auth/sessions-revoke") {
      await db()
        .prepare("DELETE FROM sessions WHERE user_id=? AND hash<>?")
        .bind(u.id, u.session_hash)
        .run();
      await securityEvent(req, u.id, "sessions_revoked");
      return json({ message: "Outras sessões encerradas." });
    }
    if (path === "auth/password") {
      await rate(req, path, u.id, 6);
      if (
        !validPassword(body.password) ||
        typeof body.current !== "string" ||
        !(await passwordMatch(body.current, u.password))
      )
        return fail("Senha atual incorreta ou nova senha inválida.");
      await db().batch([
        db()
          .prepare("UPDATE users SET password=? WHERE id=?")
          .bind(await passwordHash(body.password), u.id),
        db()
          .prepare("DELETE FROM sessions WHERE user_id=? AND hash<>?")
          .bind(u.id, u.session_hash),
      ]);
      await securityEvent(req, u.id, "password_changed");
      return json({ message: "Senha atualizada e outras sessões encerradas." });
    }
    if (path.startsWith("auth/mfa/")) {
      await rate(req, path, u.id, 8);
      if (path === "auth/mfa/send") {
        const mode = u.mfa || String(body.mode);
        if (u.mfa && body.mode && body.mode !== u.mfa)
          return fail("Método inválido.");
        if (mode === "email") {
          if (!emailReady())
            return fail("Envio de email ainda não configurado.", 503);
          const code = String(
            crypto.getRandomValues(new Uint32Array(1))[0] % 1000000,
          ).padStart(6, "0");
          await db().batch([
            db()
              .prepare("DELETE FROM challenges WHERE user_id=? AND kind=?")
              .bind(u.id, "mfa-email"),
            db()
              .prepare(
                "INSERT INTO challenges (id,user_id,kind,hash,expires) VALUES (?,?,?,?,?)",
              )
              .bind(
                crypto.randomUUID(),
                u.id,
                "mfa-email",
                await digest(code),
                Date.now() + 600000,
              ),
          ]);
          await email(
            u.email,
            "Seu código WZY",
            `Seu código de verificação é ${code}. Ele expira em 10 minutos.`,
          );
          return json({ message: "Código enviado para seu email." });
        }
        if (mode === "sms") {
          const phone = u.mfa ? u.phone : String(body.phone || "");
          if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone))
            return fail("Use o formato internacional, como +5511999999999.");
          if (!u.mfa) {
            if (!u.session_verified) return fail("Entre novamente.", 403);
            await db()
              .prepare("UPDATE users SET phone=? WHERE id=?")
              .bind(phone, u.id)
              .run();
          }
          await sms(phone);
          return json({ message: "Código enviado por SMS." });
        }
        return fail("Método inválido.");
      }
      if (path === "auth/mfa/setup") {
        if (!u.session_verified || u.mfa)
          return fail("Desative o método atual antes de configurar outro.");
        const secret = totpSecret();
        await db()
          .prepare("UPDATE users SET totp_pending=? WHERE id=?")
          .bind(await encrypt(secret), u.id)
          .run();
        return json({
          secret,
          uri: `otpauth://totp/WZY:${encodeURIComponent(u.email)}?secret=${secret}&issuer=WZY&algorithm=SHA1&digits=6&period=30`,
        });
      }
      if (path === "auth/mfa/verify" || path === "auth/mfa/enable") {
        const enable = path.endsWith("enable");
        if (enable && (!u.session_verified || u.mfa))
          return fail("Ação não permitida.", 403);
        const mode = enable ? String(body.mode) : u.mfa;
        if (!mode) return fail("Método inválido.");
        const code = String(body.code || "");
        let counter: number | null = null;
        if (mode === "totp") {
          const encrypted = enable ? u.totp_pending : u.totp;
          if (!encrypted) return fail("Configure seu autenticador primeiro.");
          counter = await verifyTotp(
            await decrypt(encrypted),
            code,
            enable ? 0 : u.totp_counter,
          );
          if (!counter) {
            if (enable) return fail("Código incorreto ou já utilizado.");
            const recovery = await db()
              .prepare(
                "DELETE FROM challenges WHERE user_id=? AND kind=? AND hash=? AND expires>? RETURNING id",
              )
              .bind(
                u.id,
                "recovery",
                await digest(code.toUpperCase().replace(/\s/g, "")),
                Date.now(),
              )
              .first();
            if (!recovery) return fail("Código incorreto ou já utilizado.");
          } else {
            const result = await db()
              .prepare(
                "UPDATE users SET totp_counter=? WHERE id=? AND totp_counter<?",
              )
              .bind(counter, u.id, counter)
              .run();
            if (!result.meta.changes) return fail("Código já utilizado.");
          }
        } else if (mode === "email") {
          const c = await db()
            .prepare(
              "DELETE FROM challenges WHERE user_id=? AND kind=? AND hash=? AND expires>? RETURNING id",
            )
            .bind(u.id, "mfa-email", await digest(code), Date.now())
            .first();
          if (!c) return fail("Código incorreto ou expirado.");
        } else if (mode === "sms") {
          if (!u.phone || !(await sms(u.phone, code)))
            return fail("Código incorreto ou expirado.");
        } else return fail("Método inválido.");
        let backupCodes: string[] = [];
        if (enable) {
          await db()
            .prepare(
              "UPDATE users SET mfa=?,totp=CASE WHEN ?=? THEN totp_pending ELSE totp END,totp_pending=NULL,verified=CASE WHEN ?=? THEN 1 ELSE verified END WHERE id=?",
            )
            .bind(mode, mode, "totp", mode, "email", u.id)
            .run();
          await db()
            .prepare("DELETE FROM sessions WHERE user_id=? AND hash<>?")
            .bind(u.id, u.session_hash)
            .run();
          if (mode === "totp") {
            backupCodes = Array.from({ length: 8 }, () =>
              crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase(),
            );
            await db()
              .prepare("DELETE FROM challenges WHERE user_id=? AND kind=?")
              .bind(u.id, "recovery")
              .run();
            await db().batch(
              await Promise.all(
                backupCodes.map(async (c) =>
                  db()
                    .prepare(
                      "INSERT INTO challenges (id,user_id,kind,hash,expires) VALUES (?,?,?,?,?)",
                    )
                    .bind(
                      crypto.randomUUID(),
                      u.id,
                      "recovery",
                      await digest(c),
                      Date.now() + 10 * 365 * 86400000,
                    ),
                ),
              ),
            );
          }
        }
        await db()
          .prepare("UPDATE sessions SET verified=1 WHERE hash=?")
          .bind(u.session_hash)
          .run();
        await securityEvent(
          req,
          u.id,
          enable ? "mfa_enabled" : "login_success",
        );
        const fresh = await db()
          .prepare("SELECT * FROM users WHERE id=?")
          .bind(u.id)
          .first<User>();
        return json({
          user: expose(fresh!),
          backupCodes,
          message: "Verificação concluída.",
        });
      }
      if (path === "auth/mfa/disable") {
        if (
          !u.session_verified ||
          typeof body.password !== "string" ||
          !(await passwordMatch(body.password, u.password))
        )
          return fail("Confirme sua senha.");
        if (u.mfa === "totp") {
          const c = await verifyTotp(
            await decrypt(u.totp!),
            String(body.code || ""),
            u.totp_counter,
          );
          if (!c) return fail("Confirme um código válido do autenticador.");
        } else if (u.mfa === "email") {
          const c = await db()
            .prepare(
              "DELETE FROM challenges WHERE user_id=? AND kind=? AND hash=? AND expires>? RETURNING id",
            )
            .bind(
              u.id,
              "mfa-email",
              await digest(String(body.code || "")),
              Date.now(),
            )
            .first();
          if (!c) return fail("Confirme o código recebido por email.");
        } else if (u.mfa === "sms") {
          if (!u.phone || !(await sms(u.phone, String(body.code || ""))))
            return fail("Confirme o código recebido por SMS.");
        }
        await db().batch([
          db()
            .prepare(
              "UPDATE users SET mfa=NULL,totp=NULL,totp_pending=NULL,totp_counter=0 WHERE id=?",
            )
            .bind(u.id),
          db()
            .prepare("DELETE FROM sessions WHERE user_id=? AND hash<>?")
            .bind(u.id, u.session_hash),
        ]);
        await securityEvent(req, u.id, "mfa_disabled");
        return json({ message: "Verificação em duas etapas desativada." });
      }
    }
    return await handleRecords(req, u, path, method, body);
    return fail("Operação não encontrada.", 404);
  } catch (e) {
    const s = String(e);
    if (/MANAGED_MOVEMENT_IMMUTABLE|CLOSED_INVOICE_IMMUTABLE/.test(s))
      return fail(
        "Movimentação protegida. Registre um ajuste ou estorno na tela de origem.",
        409,
      );
    if (s.includes("RATE_LIMIT"))
      return fail("Muitas tentativas. Aguarde 15 minutos.", 429);
    if (s.includes("EMAIL_UNAVAILABLE"))
      return fail(
        "Envio de email indisponível. Tente novamente após a configuração.",
        503,
      );
    if (s.includes("SMS_UNAVAILABLE"))
      return fail(
        "Envio de SMS indisponível. Tente novamente após a configuração.",
        503,
      );
    if (s.includes("ENCRYPTION_UNAVAILABLE"))
      return fail("Configuração de segurança indisponível.", 503);
    if (e instanceof SyntaxError) return fail("Conteúdo inválido.");
    console.error("WZY request failure", e instanceof Error ? e.name : "Error");
    return fail(
      "Não foi possível concluir. Seus dados não foram descartados; tente novamente.",
      503,
    );
  }
}
export const GET = observe(handler);
export const POST = observe(handler);
export const DELETE = observe(handler);
