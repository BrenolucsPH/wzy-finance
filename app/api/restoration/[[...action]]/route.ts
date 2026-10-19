import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { session, db, rate } from "../../../../lib/server";
import { withOwner } from "../../../../lib/database-context";
import { observe } from "../../../../lib/observability";
import { bucket } from "../../../../lib/storage";
import {
  previewRestore,
  commitRestore,
} from "../../../../lib/modules/backups/restore";
import { archivedBackup } from "../../../../lib/modules/backups/archive";
import {
  InputError,
  parse,
  id,
} from "../../../../lib/modules/workspace/common";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
async function handle(req: Request) {
  if (
    req.method === "POST" &&
    req.headers.get("origin") !== new URL(req.url).origin
  )
    return Response.json({ error: "Origem inválida." }, { status: 403 });
  const user = await session(req);
  if (!user)
    return Response.json({ error: "Entre na sua conta." }, { status: 401 });
  const url = new URL(req.url),
    action = url.pathname.split("/").slice(3).join("/");
  try {
    return await withOwner(user.id, async () => {
      let result: unknown;
      if (req.method === "GET") {
        if (action === "archives")
          result = {
            archives: (
              await db()
                .prepare(
                  "SELECT day,size,created FROM backup_archives WHERE user_id=? ORDER BY day DESC",
                )
                .bind(user.id)
                .all()
            ).results,
          };
        else if (action === "archive") {
          result = await archivedBackup(
            user.id,
            parse(
              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              url.searchParams.get("day"),
            ),
          );
        } else throw new InputError("Página não encontrada.", 404);
      } else {
        await rate(req, "restoration", user.id, 20);
        const raw = await req.text();
        if (Buffer.byteLength(raw) > 100000)
          throw new InputError("Conteúdo muito grande.", 413);
        const body = JSON.parse(raw);
        if (action === "upload") {
          const b = parse(
              z.object({
                size: z
                  .number()
                  .int()
                  .positive()
                  .max(20 * 1024 * 1024),
              }),
              body,
            ),
            uploadId = crypto.randomUUID(),
            pathname = "restoration/" + user.id + "/" + uploadId + ".json";
          const existing = await db()
            .prepare(
              "SELECT COALESCE(SUM(size),0) AS total FROM restore_uploads WHERE user_id=? AND expires>?",
            )
            .bind(user.id, Date.now())
            .first<{ total: number }>();
          if (Number(existing?.total || 0) + b.size > 25 * 1024 * 1024)
            throw new InputError(
              "Já existe uma importação em andamento. Aguarde ou cancele.",
              409,
            );
          const expires = Date.now() + 15 * 60000;
          const token = await generateClientTokenFromReadWriteToken({
            token: process.env.BLOB_READ_WRITE_TOKEN!,
            pathname,
            allowedContentTypes: ["application/json"],
            maximumSizeInBytes: b.size,
            validUntil: expires,
            addRandomSuffix: false,
            allowOverwrite: false,
          });
          await db()
            .prepare(
              "INSERT INTO restore_uploads(id,user_id,pathname,size,created,expires) VALUES(?,?,?,?,?,?)",
            )
            .bind(uploadId, user.id, pathname, b.size, Date.now(), expires)
            .run();
          result = { id: uploadId, pathname, token };
        } else if (action === "preview") {
          const b = parse(
              z.object({ uploadId: id, attachments: z.record(id).default({}) }),
              body,
            ),
            upload = await db()
              .prepare(
                "SELECT pathname,size FROM restore_uploads WHERE id=? AND user_id=? AND expires>?",
              )
              .bind(b.uploadId, user.id, Date.now())
              .first<{ pathname: string; size: number }>();
          if (!upload)
            throw new InputError("Importação não encontrada ou expirada.", 404);
          const file = await bucket.get(upload.pathname);
          if (!file)
            throw new InputError("Envie a exportação antes de gerar a prévia.");
          const bytes = await new Response(file.body).arrayBuffer();
          if (
            bytes.byteLength !== Number(upload.size) ||
            bytes.byteLength > 20 * 1024 * 1024
          )
            throw new InputError("Tamanho da exportação inválido.");
          result = await previewRestore(
            user.id,
            JSON.parse(new TextDecoder().decode(bytes)),
            b.attachments,
          );
        } else if (action === "commit")
          result = await commitRestore(user, body);
        else if (action === "cancel") {
          const b = parse(z.object({ uploadId: id }), body),
            upload = await db()
              .prepare(
                "SELECT pathname FROM restore_uploads WHERE id=? AND user_id=?",
              )
              .bind(b.uploadId, user.id)
              .first<{ pathname: string }>();
          if (upload) {
            await bucket.delete(upload.pathname);
            await db()
              .prepare("DELETE FROM restore_uploads WHERE id=? AND user_id=?")
              .bind(b.uploadId, user.id)
              .run();
          }
          result = { ok: true };
        } else throw new InputError("Operação não encontrada.", 404);
      }
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    });
  } catch (error) {
    if (error instanceof InputError)
      return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError || error instanceof z.ZodError)
      return Response.json({ error: "Exportação inválida." }, { status: 400 });
    throw error;
  }
}
export const GET = observe(handle);
export const POST = observe(handle);
