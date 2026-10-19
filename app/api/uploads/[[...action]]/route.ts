import { bucket } from "../../../../lib/storage";
import {
  withOwner,
  setDatabaseContext,
} from "../../../../lib/database-context";
import { observe } from "../../../../lib/observability";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

import { postgres, scopedQuery } from "../../../../lib/postgres";
import { session, rate } from "../../../../lib/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const quota = 100 * 1024 * 1024;
const uuid = /^[0-9a-f-]{36}$/;
type Pending = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  expected_size: string;
  created: string;
  expires: string;
};
async function handlePOST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Origem inválida." }, 403);
  if (Number(req.headers.get("content-length") || 0) > 4096)
    return json({ error: "Conteúdo muito grande." }, 413);
  try {
    const user = await session(req);
    if (!user) return json({ error: "Entre na sua conta." }, 401);
    return await withOwner(user.id, async () => {
      const raw = await req.text();
      if (raw.length > 4096)
        return json({ error: "Conteúdo muito grande." }, 413);
      const body = JSON.parse(raw);
      const action = new URL(req.url).pathname.slice("/api/uploads".length);
      if (!action || action === "/") {
        await rate(req, "upload", user.id, 30);
        if (
          typeof body.name !== "string" ||
          !body.name.trim() ||
          !Number.isInteger(body.size) ||
          body.size <= 0 ||
          body.size > 10 * 1024 * 1024 ||
          !["application/pdf", "image/jpeg", "image/png"].includes(body.type)
        )
          return json(
            { error: "Selecione um PDF, JPG ou PNG de até 10 MB." },
            400,
          );
        const id = crypto.randomUUID();
        const pathname = `${user.id}/${id}`;
        const expires = Date.now() + 10 * 60000;
        if (!process.env.BLOB_READ_WRITE_TOKEN)
          return json({ error: "Armazenamento indisponível." }, 503);
        const token = await generateClientTokenFromReadWriteToken({
          token: process.env.BLOB_READ_WRITE_TOKEN,
          pathname,
          allowedContentTypes: [body.type],
          maximumSizeInBytes: body.size,
          validUntil: expires,
          addRandomSuffix: false,
          allowOverwrite: false,
        });
        const client = await postgres().connect();
        try {
          await client.query("BEGIN");
          await setDatabaseContext(client);
          await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            user.id,
          ]);
          const expired = await client.query(
            "SELECT id FROM uploads WHERE user_id=$1 AND expires<$2",
            [user.id, Date.now()],
          );
          // Cleanup remains private and is restricted to this authenticated owner's paths.
          for (const row of expired.rows) {
            await bucket.delete(`${user.id}/${row.id}`);
            await client.query(
              "DELETE FROM uploads WHERE id=$1 AND user_id=$2",
              [row.id, user.id],
            );
          }
          const used = await client.query(
            "SELECT (SELECT COALESCE(sum(size),0) FROM files WHERE user_id=$1)+(SELECT COALESCE(sum(expected_size),0) FROM uploads WHERE user_id=$1) AS total",
            [user.id],
          );
          if (Number(used.rows[0].total) + body.size > quota) {
            await client.query("COMMIT");
            return json(
              { error: "Limite de armazenamento de 100 MB atingido." },
              400,
            );
          }
          await client.query(
            "INSERT INTO uploads (id,user_id,name,type,expected_size,created,expires) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [
              id,
              user.id,
              body.name.replace(/[\x00-\x1f]/g, "").slice(0, 150),
              body.type,
              body.size,
              Date.now(),
              expires,
            ],
          );
          await client.query("COMMIT");
          return json({ id, pathname, token }, 201);
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
      if (typeof body.id !== "string" || !uuid.test(body.id))
        return json({ error: "Arquivo inválido." }, 400);
      const pendingResult = await scopedQuery(
        "SELECT * FROM uploads WHERE id=$1 AND user_id=$2",
        [body.id, user.id],
      );
      const pending = pendingResult.rows[0] as Pending | undefined;
      if (!pending) {
        if (action === "/finish") {
          const saved = await scopedQuery(
            "SELECT id,name,type,size,created FROM files WHERE id=$1 AND user_id=$2",
            [body.id, user.id],
          );
          if (saved.rows[0])
            return json({
              file: {
                ...saved.rows[0],
                size: Number(saved.rows[0].size),
                created: Number(saved.rows[0].created),
              },
            });
        }
        return json({ error: "Arquivo não encontrado." }, 404);
      }
      const pathname = `${user.id}/${pending.id}`;
      if (action === "/cancel") {
        // Lock the reservation so a concurrent completion cannot lose its finalized blob.
        const client = await postgres().connect();
        try {
          await client.query("BEGIN");
          await setDatabaseContext(client);
          await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            user.id,
          ]);
          const removed = await client.query(
            "DELETE FROM uploads WHERE id=$1 AND user_id=$2 RETURNING id",
            [pending.id, user.id],
          );
          if (removed.rowCount) await bucket.delete(pathname);
          await client.query("COMMIT");
          return json({ ok: true });
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
      if (action !== "/finish")
        return json({ error: "Operação não encontrada." }, 404);
      if (Number(pending.expires) < Date.now())
        return json(
          { error: "O envio expirou. Selecione o arquivo novamente." },
          400,
        );
      const stored = await bucket.get(pathname);
      if (!stored)
        return json({ error: "Envio incompleto. Tente novamente." }, 400);
      const bytes = new Uint8Array(
        await new Response(stored.body).arrayBuffer(),
      );
      if (
        bytes.length !== Number(pending.expected_size) ||
        bytes.length > 10 * 1024 * 1024
      ) {
        await bucket.delete(pathname);
        await scopedQuery("DELETE FROM uploads WHERE id=$1 AND user_id=$2", [
          pending.id,
          user.id,
        ]);
        return json({ error: "Tamanho inválido." }, 400);
      }
      const type =
        bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46
          ? "application/pdf"
          : bytes[0] === 0xff && bytes[1] === 0xd8
            ? "image/jpeg"
            : bytes[0] === 137 &&
                bytes[1] === 80 &&
                bytes[2] === 78 &&
                bytes[3] === 71
              ? "image/png"
              : null;
      if (
        bytes.length !== Number(pending.expected_size) ||
        type !== pending.type
      ) {
        await bucket.delete(pathname);
        await scopedQuery("DELETE FROM uploads WHERE id=$1 AND user_id=$2", [
          pending.id,
          user.id,
        ]);
        return json(
          {
            error:
              "Formato ou tamanho inválido. Use PDF, JPG ou PNG de até 10 MB.",
          },
          400,
        );
      }
      const client = await postgres().connect();
      try {
        await client.query("BEGIN");
        await setDatabaseContext(client);
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          user.id,
        ]);
        const stillPending = await client.query(
          "SELECT id FROM uploads WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [pending.id, user.id],
        );
        if (!stillPending.rowCount) {
          await client.query("ROLLBACK");
          return json(
            {
              error: "O envio já foi concluído ou cancelado. Atualize a lista.",
            },
            409,
          );
        }
        await client.query(
          "INSERT INTO files (id,user_id,name,type,size,created) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            pending.id,
            user.id,
            pending.name,
            type,
            bytes.length,
            Number(pending.created),
          ],
        );
        await client.query("DELETE FROM uploads WHERE id=$1 AND user_id=$2", [
          pending.id,
          user.id,
        ]);
        await client.query("COMMIT");
        return json(
          {
            file: {
              id: pending.id,
              name: pending.name,
              type,
              size: bytes.length,
              created: Number(pending.created),
            },
          },
          201,
        );
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  } catch (error) {
    // Keep reservations for a safe retry after transient storage/database errors.
    const limited = String(error).includes("RATE_LIMIT");
    return json(
      {
        error: limited
          ? "Muitas tentativas. Aguarde 15 minutos."
          : "Não foi possível concluir o envio. Tente novamente.",
      },
      limited ? 429 : 503,
    );
  }
}

export const POST = observe(handlePOST);
