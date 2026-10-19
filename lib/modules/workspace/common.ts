import { z } from "zod";
import type { PoolClient } from "@neondatabase/serverless";
import { db, digest } from "../../server";
import { entrySchema } from "../../validation";
import type { Entry } from "../../finance";
export class InputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export const cents = z.number().int().positive().max(99999999999);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const x = new Date(d + "T12:00:00Z");
    return !isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
  });
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const id = z.string().min(1).max(100);
export const requestId = z.string().uuid();
export function parse<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new InputError(result.error.issues[0]?.message || "Dados inválidos.");
  return result.data;
}
export async function ownedEntry(owner: string, recordId: string) {
  const row = await db()
    .prepare("SELECT payload,updated FROM records WHERE user_id=? AND id=?")
    .bind(owner, recordId)
    .first<{ payload: string; updated: number }>();
  if (!row) throw new InputError("Registro não encontrado.", 404);
  return { ...JSON.parse(row.payload), _version: Number(row.updated) } as Entry;
}
export async function commandId(owner: string, key: string, prefix: string) {
  return prefix + "-" + (await digest(owner + "|" + key));
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function insertEntry(
  client: PoolClient,
  owner: string,
  entry: Entry,
) {
  const value = entrySchema.parse(entry),
    existing = await client.query(
      "SELECT payload,updated FROM records WHERE id=$1 AND user_id=$2",
      [value.id, owner],
    );
  if (existing.rows.length) {
    if (
      canonical(entrySchema.parse(JSON.parse(existing.rows[0].payload))) !==
      canonical(value)
    )
      throw new InputError(
        "Esta solicitação já foi usada com outros dados.",
        409,
      );
    return {
      ...JSON.parse(existing.rows[0].payload),
      _version: Number(existing.rows[0].updated),
      replayed: true,
    } as Entry;
  }
  const now = Date.now();
  await client.query(
    "INSERT INTO records(id,user_id,kind,payload,updated,account_id,target_id,source_id,attachment_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      value.id,
      owner,
      value.kind,
      JSON.stringify(value),
      now,
      value.accountId || null,
      value.targetId || null,
      value.sourceId || null,
      value.attachmentId || null,
    ],
  );
  return { ...value, _version: now };
}
export async function lockOwner(client: PoolClient, owner: string) {
  const row = await client.query(
    "SELECT disabled FROM users WHERE id=$1 FOR UPDATE",
    [owner],
  );
  if (!row.rows.length || row.rows[0].disabled)
    throw new InputError("Conta indisponível.", 403);
}
