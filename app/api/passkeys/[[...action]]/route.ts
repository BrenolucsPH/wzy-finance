import { observe } from "../../../../lib/observability";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  db,
  session,
  passwordMatch,
  rate,
  newSession,
  digest,
  random,
  isAdministrator,
  securityEvent,
  type User,
} from "../../../../lib/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const fail = (error: string, status = 400) => json({ error }, status);
async function handleGET(req: Request) {
  return handle(req);
}
async function handlePOST(req: Request) {
  return handle(req);
}
async function handle(req: Request) {
  try {
    const url = new URL(req.url),
      origin = url.origin,
      rpID = url.hostname,
      path = url.pathname.split("/").slice(3).join("/");
    if (req.method !== "GET" && req.headers.get("origin") !== origin)
      return fail("Origem inválida.", 403);
    if (
      url.protocol !== "https:" &&
      !process.env.WZY_TEST_SCHEMA &&
      rpID !== "localhost"
    )
      return fail("Biometria exige uma conexão HTTPS.", 400);
    const u = await session(req);
    if (req.method === "GET" && path === "list") {
      if (!u) return fail("Entre na sua conta.", 401);
      const keys = await db()
        .prepare(
          "SELECT id,label,created FROM passkeys WHERE user_id=? AND rp_id=? ORDER BY created DESC",
        )
        .bind(u.id, rpID)
        .all();
      return json({ passkeys: keys.results });
    }
    if (req.method !== "POST") return fail("Método não permitido.", 405);
    await rate(req, "passkey", u?.id || "", 15);
    const text = await req.text();
    if (Buffer.byteLength(text) > 30000)
      return fail("Pedido muito grande.", 413);
    const body = JSON.parse(text || "{}");
    const challengeCookie = (token: string) =>
      `wzy_passkey=${token}; Path=/api/passkeys; HttpOnly; SameSite=Strict; Max-Age=${token ? 300 : 0}${url.protocol === "https:" ? "; Secure" : ""}`;
    if (path === "login/options") {
      const options = await generateAuthenticationOptions({
          rpID,
          userVerification: "required",
        }),
        token = random();
      await db().batch([
        db()
          .prepare("DELETE FROM webauthn_challenges WHERE expires<?")
          .bind(Date.now()),
        db()
          .prepare(
            "INSERT INTO webauthn_challenges (id,kind,challenge,origin,expires) VALUES (?,?,?,?,?)",
          )
          .bind(
            await digest(token),
            "login",
            options.challenge,
            origin,
            Date.now() + 300000,
          ),
      ]);
      return json({ options }, 200, { "Set-Cookie": challengeCookie(token) });
    }
    if (path === "login/verify") {
      const token =
        (req.headers.get("cookie") || "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("wzy_passkey="))
          ?.slice(12) || "";
      const c = await db()
        .prepare(
          "DELETE FROM webauthn_challenges WHERE id=? AND kind=? AND origin=? AND expires>? RETURNING challenge",
        )
        .bind(await digest(token), "login", origin, Date.now())
        .first<{
          challenge: string;
        }>();
      if (!c) return fail("A confirmação expirou. Tente novamente.");
      const key = await db()
        .prepare(
          "SELECT id,user_id,public_key,counter,transports FROM passkeys WHERE id=? AND rp_id=?",
        )
        .bind(String(body.response?.id || ""), rpID)
        .first<{
          id: string;
          user_id: string;
          public_key: Uint8Array;
          counter: number;
          transports: string;
        }>();
      if (!key) return fail("Não foi possível confirmar o acesso.", 401);
      const user = await db()
        .prepare("SELECT * FROM users WHERE id=? AND disabled=0")
        .bind(key.user_id)
        .first<User>();
      if (!user) return fail("Não foi possível confirmar o acesso.", 401);
      const result = await verifyAuthenticationResponse({
        response: body.response as AuthenticationResponseJSON,
        expectedChallenge: c.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: key.id,
          publicKey: new Uint8Array(key.public_key),
          counter: Number(key.counter),
          transports: JSON.parse(key.transports),
        },
      });
      if (!result.verified)
        return fail("Não foi possível confirmar o acesso.", 401);
      const claimed = await db()
        .prepare(
          "UPDATE passkeys SET counter=? WHERE id=? AND user_id=? AND counter=?",
        )
        .bind(
          result.authenticationInfo.newCounter,
          key.id,
          user.id,
          key.counter,
        )
        .run();
      if (!claimed.meta.changes) return fail("Confirmação já utilizada.", 401);
      const exposed = {
        id: user.id,
        name: user.name,
        email: user.email,
        mfa: user.mfa,
        phone: null,
        emailVerified: !!user.verified,
        avatarVersion: user.avatar_updated,
        timezone: user.timezone,
        isAdmin: isAdministrator(user),
      };
      await securityEvent(req, user.id, "passkey_login");
      return json({ user: user.mfa ? null : exposed, mfa: user.mfa }, 200, {
        "Set-Cookie": await newSession(req, user),
      });
    }
    if (!u) return fail("Entre na sua conta.", 401);
    if (path === "register/options" || path === "remove") {
      if (
        typeof body.password !== "string" ||
        Buffer.byteLength(body.password) > 72 ||
        !(await passwordMatch(body.password, u.password))
      )
        return fail("Confirme sua senha atual.", 403);
      if (path === "remove") {
        const removed = await db()
          .prepare("DELETE FROM passkeys WHERE id=? AND user_id=? AND rp_id=?")
          .bind(String(body.id || ""), u.id, rpID)
          .run();
        if (!removed.meta.changes) return fail("Chave não encontrada.", 404);
        await securityEvent(req, u.id, "passkey_removed");
        return json({ message: "Chave de acesso removida." });
      }
      const existing = await db()
        .prepare("SELECT id FROM passkeys WHERE user_id=? AND rp_id=?")
        .bind(u.id, rpID)
        .all<{
          id: string;
        }>();
      if (existing.results.length >= 10)
        return fail("Limite de dez chaves de acesso.");
      const options = await generateRegistrationOptions({
        rpName: "WZY",
        rpID,
        userName: u.email,
        userID: new TextEncoder().encode(u.id),
        userDisplayName: u.name,
        attestationType: "none",
        excludeCredentials: existing.results,
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        preferredAuthenticatorType: "localDevice",
      });
      await db().batch([
        db()
          .prepare("DELETE FROM webauthn_challenges WHERE user_id=? AND kind=?")
          .bind(u.id, "register"),
        db()
          .prepare(
            "INSERT INTO webauthn_challenges (id,user_id,kind,challenge,origin,expires) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            u.session_id,
            u.id,
            "register",
            options.challenge,
            origin,
            Date.now() + 300000,
          ),
      ]);
      return json({ options });
    }
    if (path === "register/verify") {
      const c = await db()
        .prepare(
          "DELETE FROM webauthn_challenges WHERE id=? AND user_id=? AND kind=? AND origin=? AND expires>? RETURNING challenge",
        )
        .bind(u.session_id, u.id, "register", origin, Date.now())
        .first<{
          challenge: string;
        }>();
      if (!c) return fail("A confirmação expirou. Tente novamente.");
      const result = await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        expectedChallenge: c.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!result.verified) return fail("Não foi possível cadastrar a chave.");
      const key = result.registrationInfo.credential;
      await db()
        .prepare(
          "INSERT INTO passkeys (id,user_id,public_key,counter,transports,label,created,rp_id) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          key.id,
          u.id,
          Buffer.from(key.publicKey),
          key.counter,
          JSON.stringify(key.transports || []),
          String(body.label || "Meu dispositivo")
            .trim()
            .slice(0, 60),
          Date.now(),
          rpID,
        )
        .run();
      await securityEvent(req, u.id, "passkey_added");
      return json({ message: "Biometria ou chave de acesso cadastrada." }, 201);
    }
    return fail("Página não encontrada.", 404);
  } catch (e) {
    if (String(e).includes("RATE_LIMIT"))
      return fail("Muitas tentativas. Aguarde alguns minutos.", 429);
    return fail(
      "Não foi possível confirmar a chave de acesso. Tente novamente.",
      400,
    );
  }
}

export const GET = observe(handleGET);
export const POST = observe(handlePOST);
