import { db, type User, digest } from "../../server";
import { bucket } from "../../storage";
import { sealBackup, openBackup } from "../../vault-crypto";
import { financialExport } from "./export";
export async function backupUser(user: User, day: string) {
  const existing = await db()
    .prepare("SELECT payload FROM financial_backups WHERE user_id=? AND day=?")
    .bind(user.id, day)
    .first<{ payload: string }>();
  const archive = await db()
    .prepare("SELECT id FROM backup_archives WHERE user_id=? AND day=?")
    .bind(user.id, day)
    .first();
  if (existing && archive) return { replayed: true };
  const payload =
      existing?.payload ||
      (await sealBackup({ ...(await financialExport(user)), day })),
    size = Buffer.byteLength(payload);
  const perUser =
      Number(process.env.WZY_BACKUP_USER_LIMIT_BYTES) || 20 * 1024 * 1024,
    totalLimit =
      Number(process.env.WZY_BACKUP_TOTAL_LIMIT_BYTES) || 128 * 1024 * 1024;
  const occupied = await db()
    .prepare(
      "SELECT COALESCE(SUM(size),0)::text AS total,COALESCE(SUM(CASE WHEN user_id=? THEN size ELSE 0 END),0)::text AS personal FROM backup_archives",
    )
    .bind(user.id)
    .first<{ total: string; personal: string }>();
  if (
    Number(occupied?.personal || 0) + size > perUser ||
    Number(occupied?.total || 0) + size > totalLimit
  )
    throw Error("BACKUP_STORAGE_BUDGET_REACHED");
  if (!existing)
    await db()
      .prepare(
        "INSERT INTO financial_backups(user_id,day,payload,created) VALUES(?,?,?,?) ON CONFLICT(user_id,day) DO NOTHING",
      )
      .bind(user.id, day, payload, Date.now())
      .run();
  const pathname =
    "backups/" +
    (process.env.WZY_TEST_SCHEMA ? process.env.WZY_TEST_SCHEMA + "/" : "") +
    user.id +
    "/" +
    day +
    ".wzy";
  await bucket.put(pathname, new TextEncoder().encode(payload), {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  const verified = await bucket.get(pathname);
  if (!verified) throw Error("BACKUP_VERIFICATION_FAILED");
  const copy = await new Response(verified.body).text();
  if ((await digest(copy)) !== (await digest(payload)))
    throw Error("BACKUP_VERIFICATION_FAILED");
  await db()
    .prepare(
      "INSERT INTO backup_archives(id,user_id,day,pathname,digest,size,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,day) DO NOTHING",
    )
    .bind(
      crypto.randomUUID(),
      user.id,
      day,
      pathname,
      await digest(payload),
      size,
      Date.now(),
    )
    .run();
  return { verified: true };
}
export async function archivedBackup(owner: string, day: string) {
  const row = await db()
    .prepare(
      "SELECT pathname,digest FROM backup_archives WHERE user_id=? AND day=?",
    )
    .bind(owner, day)
    .first<{ pathname: string; digest: string }>();
  if (!row) throw Error("BACKUP_NOT_FOUND");
  const object = await bucket.get(row.pathname);
  if (!object) throw Error("BACKUP_NOT_FOUND");
  const payload = await new Response(object.body).text();
  if ((await digest(payload)) !== row.digest)
    throw Error("BACKUP_VERIFICATION_FAILED");
  const data = await openBackup(payload);
  if (data.profile?.id !== owner) throw Error("BACKUP_OWNER_MISMATCH");
  return data;
}
