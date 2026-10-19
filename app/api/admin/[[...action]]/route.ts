import { withSystem } from "../../../../lib/database-context";
import { operationalHealth } from "../../../../lib/modules/workspace/operations";
import { observe } from "../../../../lib/observability";
import {
  db,
  session,
  isAdministrator,
  passwordMatch,
  rate,
  securityEvent,
} from "../../../../lib/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
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
    if (
      req.method !== "GET" &&
      req.headers.get("origin") !== new URL(req.url).origin
    )
      return fail("Origem inválida.", 403);
    const u = await session(req);
    if (!u) return fail("Entre na sua conta.", 401);
    if (!isAdministrator(u))
      return fail("Acesso restrito ao administrador.", 403);
    if (!u.mfa)
      return fail(
        "Ative a verificação em duas etapas para administrar usuários.",
        403,
      );
    const url = new URL(req.url),
      path = url.pathname.split("/").filter(Boolean).slice(2).join("/");
    if (req.method === "GET" && path === "health")
      return json(await withSystem(operationalHealth));
    if (req.method === "GET" && path === "users") {
      const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
      const offset = Math.min(
        100000,
        Math.max(0, Number(url.searchParams.get("offset")) || 0),
      );
      const rows = await db()
        .prepare(
          "SELECT u.id,u.name,u.email,u.created,u.disabled,u.mfa,u.verified,COUNT(s.id) AS session_count,COALESCE(MAX(s.last_seen),0) AS last_access FROM users u LEFT JOIN sessions s ON s.user_id=u.id AND s.expires>? WHERE POSITION(LOWER(?) IN LOWER(u.name))>0 OR POSITION(LOWER(?) IN LOWER(u.email))>0 GROUP BY u.id ORDER BY u.created DESC,u.id LIMIT 21 OFFSET ?",
        )
        .bind(Date.now(), query, query, offset)
        .all<{
          id: string;
          disabled: number;
        }>();
      return json({
        users: rows.results.slice(0, 20).map((x) => ({
          ...x,
          isAdmin: isAdministrator({ ...x, disabled: 0 }),
        })),
        more: rows.results.length > 20,
        offset,
      });
    }
    if (req.method === "GET" && path === "sessions") {
      const id = url.searchParams.get("userId") || "";
      const rows = await db()
        .prepare(
          "SELECT id,created,last_seen,expires,device,browser,os,label,ip,city,region,country,verified FROM sessions WHERE user_id=? AND expires>? ORDER BY last_seen DESC",
        )
        .bind(id, Date.now())
        .all();
      return json({ sessions: rows.results });
    }
    if (req.method !== "POST" || !["status", "sessions/revoke"].includes(path))
      return fail("Página não encontrada.", 404);
    await rate(req, "admin-write", u.id, 10);
    const raw = await req.text();
    if (raw.length > 10000) return fail("Conteúdo muito grande.", 413);
    const body = JSON.parse(raw || "{}");
    if (
      typeof body.password !== "string" ||
      Buffer.byteLength(body.password) > 72 ||
      !(await passwordMatch(body.password, u.password))
    )
      return fail("Confirme sua senha atual.", 403);
    const target = await db()
      .prepare("SELECT id,disabled FROM users WHERE id=?")
      .bind(String(body.userId || ""))
      .first<{
        id: string;
        disabled: number;
      }>();
    if (!target) return fail("Usuário não encontrado.", 404);
    if (target.id === u.id || isAdministrator({ ...target, disabled: 0 }))
      return fail(
        "Esta ação não está disponível para contas de administrador.",
        403,
      );
    if (path === "status") {
      if (typeof body.disabled !== "boolean") return fail("Status inválido.");
      await db().batch([
        db()
          .prepare("UPDATE users SET disabled=? WHERE id=?")
          .bind(body.disabled ? 1 : 0, target.id),
        db().prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id),
      ]);
      await securityEvent(
        req,
        u.id,
        body.disabled ? "admin_suspended" : "admin_reactivated",
        target.id,
      );
      await securityEvent(
        req,
        target.id,
        body.disabled ? "account_suspended" : "account_reactivated",
      );
      return json({
        message: body.disabled
          ? "Conta suspensa e sessões encerradas."
          : "Conta reativada. O usuário precisa entrar novamente.",
      });
    }
    await db()
      .prepare("DELETE FROM sessions WHERE user_id=?")
      .bind(target.id)
      .run();
    await securityEvent(req, u.id, "admin_sessions_revoked", target.id);
    await securityEvent(req, target.id, "admin_sessions_revoked");
    return json({
      message: "Todos os dispositivos deste usuário foram desconectados.",
    });
  } catch (e) {
    if (String(e).includes("RATE_LIMIT"))
      return fail("Muitas tentativas. Aguarde alguns minutos.", 429);
    if (e instanceof SyntaxError) return fail("Pedido inválido.");
    console.error(
      "Admin operation failed",
      e instanceof Error ? e.name : "Error",
    );
    return fail("Não foi possível concluir. Tente novamente.", 500);
  }
}

export const GET = observe(handleGET);
export const POST = observe(handlePOST);
