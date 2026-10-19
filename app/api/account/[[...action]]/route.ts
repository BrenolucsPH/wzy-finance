import { observe } from "../../../../lib/observability";
import sharp from "sharp";
import {
  db,
  session,
  securityEvent,
  cookie,
  rate,
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
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const fail = (error: string, status = 400) => json({ error }, status);
async function handleGET(req: Request) {
  return handle(req);
}
async function handlePOST(req: Request) {
  return handle(req);
}
async function handleDELETE(req: Request) {
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
    if (!u) return fail("Entre na sua conta para continuar.", 401);
    const path = new URL(req.url).pathname
      .split("/")
      .filter(Boolean)
      .slice(2)
      .join("/");
    if (path === "avatar") {
      if (req.method === "GET") {
        const row = await db()
          .prepare("SELECT avatar FROM users WHERE id=?")
          .bind(u.id)
          .first<{
            avatar: Uint8Array | null;
          }>();
        return row?.avatar
          ? new Response(new Uint8Array(row.avatar), {
              headers: {
                "Content-Type": "image/webp",
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
              },
            })
          : fail("Você ainda não tem foto de perfil.", 404);
      }
      await rate(req, "avatar", u.id, 15);
      if (req.method === "DELETE") {
        await db()
          .prepare("UPDATE users SET avatar=NULL,avatar_updated=0 WHERE id=?")
          .bind(u.id)
          .run();
        await securityEvent(req, u.id, "avatar_removed");
        return json({ avatarVersion: 0, message: "Foto removida." });
      }
      if (Number(req.headers.get("content-length") || 0) > 2200000)
        return fail("Use uma imagem de até 2 MB.", 413);
      const file = (await req.formData()).get("file");
      if (
        !(file instanceof File) ||
        file.size > 2097152 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      )
        return fail("Use uma foto JPG, PNG ou WebP de até 2 MB.");
      let photo: Buffer;
      try {
        const pipeline = sharp(Buffer.from(await file.arrayBuffer()), {
          limitInputPixels: 16000000,
          failOn: "warning",
        });
        const info = await pipeline.metadata();
        if (
          !["jpeg", "png", "webp"].includes(info.format || "") ||
          (info.pages || 1) > 1
        )
          return fail("Use uma imagem estática JPG, PNG ou WebP.");
        photo = await pipeline
          .rotate()
          .resize(384, 384, { fit: "cover" })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        return fail("Não foi possível ler esta imagem. Escolha outra foto.");
      }
      const version = Date.now();
      await db()
        .prepare("UPDATE users SET avatar=?,avatar_updated=? WHERE id=?")
        .bind(photo, version, u.id)
        .run();
      await securityEvent(req, u.id, "avatar_changed");
      return json({ avatarVersion: version, message: "Foto atualizada." });
    }
    if (req.method === "DELETE") return fail("Método não permitido.", 405);
    if (path === "sessions" && req.method === "GET") {
      const rows = await db()
        .prepare(
          "SELECT id,created,last_seen,expires,device,browser,os,label,ip,city,region,country,verified FROM sessions WHERE user_id=? AND expires>? ORDER BY last_seen DESC",
        )
        .bind(u.id, Date.now())
        .all<{
          id: string;
        }>();
      return json({
        sessions: rows.results.map((r) => ({
          ...r,
          current: r.id === u.session_id,
        })),
      });
    }
    if (path === "events" && req.method === "GET") {
      const rows = await db()
        .prepare(
          "SELECT id,kind,created,device,browser,os,ip,city,region,country,detail FROM security_events WHERE user_id=? AND created>? ORDER BY created DESC LIMIT 50",
        )
        .bind(u.id, Date.now() - 90 * 86400000)
        .all();
      return json({ events: rows.results });
    }
    if (req.method !== "POST") return fail("Página não encontrada.", 404);
    if (Number(req.headers.get("content-length") || 0) > 10000)
      return fail("Conteúdo muito grande.", 413);
    const text = await req.text();
    if (text.length > 10000) return fail("Conteúdo muito grande.", 413);
    const body = JSON.parse(text || "{}");
    await rate(req, "account-change", u.id, 30);
    if (path === "profile") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name))
        return fail("Informe um nome entre 1 e 100 caracteres.");
      const timezone =
        typeof body.timezone === "string" ? body.timezone : "America/Sao_Paulo";
      if (timezone.length > 60) return fail("Fuso horário inválido.");
      try {
        new Intl.DateTimeFormat("pt-BR", { timeZone: timezone });
      } catch {
        return fail("Fuso horário inválido.");
      }
      await db()
        .prepare("UPDATE users SET name=?,timezone=? WHERE id=?")
        .bind(name, timezone, u.id)
        .run();
      await securityEvent(req, u.id, "profile_changed");
      return json({ name, timezone, message: "Perfil atualizado." });
    }
    if (path === "sessions/label") {
      if (
        typeof body.label !== "string" ||
        body.label.length > 60 ||
        /[\x00-\x1f\x7f]/.test(body.label)
      )
        return fail("Use um nome de até 60 caracteres.");
      const result = await db()
        .prepare(
          "UPDATE sessions SET label=? WHERE id=? AND user_id=? AND expires>?",
        )
        .bind(body.label.trim(), String(body.id || ""), u.id, Date.now())
        .run();
      return result.meta.changes
        ? json({ message: "Dispositivo renomeado." })
        : fail("Sessão não encontrada.", 404);
    }
    if (path === "sessions/revoke") {
      const id = String(body.id || "");
      if (id === "others") {
        await db()
          .prepare("DELETE FROM sessions WHERE user_id=? AND hash<>?")
          .bind(u.id, u.session_hash)
          .run();
        await securityEvent(req, u.id, "sessions_revoked");
        return json({ message: "Outros dispositivos desconectados." });
      }
      const result = await db()
        .prepare("DELETE FROM sessions WHERE id=? AND user_id=?")
        .bind(id, u.id)
        .run();
      if (!result.meta.changes) return fail("Sessão não encontrada.", 404);
      await securityEvent(req, u.id, "session_revoked");
      return json(
        {
          message: "Dispositivo desconectado.",
          signedOut: id === u.session_id,
        },
        200,
        id === u.session_id ? { "Set-Cookie": cookie(req, "") } : {},
      );
    }
    return fail("Página não encontrada.", 404);
  } catch (e) {
    if (String(e).includes("RATE_LIMIT"))
      return fail("Muitas tentativas. Aguarde alguns minutos.", 429);
    if (e instanceof SyntaxError) return fail("Pedido inválido.");
    console.error(
      "Account operation failed",
      e instanceof Error ? e.name : "Error",
    );
    return fail("Não foi possível concluir. Tente novamente.", 500);
  }
}

export const GET = observe(handleGET);
export const POST = observe(handlePOST);
export const DELETE = observe(handleDELETE);
