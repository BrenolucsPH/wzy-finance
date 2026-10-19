import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { put, get } from "@vercel/blob";
export async function captureMigrationBackup(
  client,
  versions,
  storage = { put, get },
) {
  const raw = process.env.AUTH_ENCRYPTION_KEY;
  if (!raw || Buffer.from(raw, "base64").length !== 32)
    throw Error(
      "A valid encryption key is required before production migrations.",
    );
  const names = (
    await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  if (!names.includes("users")) return;
  // A single statement gives every table the same PostgreSQL snapshot.
  const tables = Object.fromEntries(
    (
      await client.query(
        names
          .map(
            (name) =>
              "SELECT '" +
              name.replaceAll("'", "''") +
              "' AS name,COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb) AS data FROM \"" +
              name.replaceAll('"', '""') +
              '" r',
          )
          .join(" UNION ALL "),
      )
    ).rows.map((r) => [r.name, r.data]),
  );
  if (!tables.users.length) return;
  const snapshot = {
    format: "wzy-migration-checkpoint-v1",
    created: new Date().toISOString(),
    versions,
    tables,
  };
  const material = await crypto.subtle.importKey(
    "raw",
    Buffer.from(raw, "base64"),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: Buffer.from("wzy-migrations-v1"),
      info: Buffer.from("database-checkpoint"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    clear = gzipSync(Buffer.from(JSON.stringify(snapshot))),
    cipher = Buffer.from(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, clear),
    );
  const payload = Buffer.from(
    JSON.stringify({
      format: "wzy-migration-checkpoint-v1",
      iv: Buffer.from(iv).toString("base64"),
      cipher: cipher.toString("base64"),
    }),
  );
  if (payload.length > 32 * 1024 * 1024)
    throw Error(
      "Migration checkpoint exceeds its 32 MB safety budget; export before retrying.",
    );
  const digest = createHash("sha256").update(payload).digest("hex"),
    pathname =
      "migration-checkpoints/" +
      new Date().toISOString().slice(0, 10) +
      "/" +
      digest +
      ".wzy";
  await storage.put(pathname, payload, {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/octet-stream",
  });
  const copy = await storage.get(pathname, {
    access: "private",
    useCache: false,
  });
  if (!copy || copy.statusCode !== 200)
    throw Error("Migration checkpoint cannot be verified.");
  const bytes = Buffer.from(await new Response(copy.stream).arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== digest)
    throw Error("Migration checkpoint digest mismatch.");
  const saved = JSON.parse(bytes.toString()),
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(saved.iv, "base64") },
      key,
      Buffer.from(saved.cipher, "base64"),
    );
  const restored = JSON.parse(gunzipSync(Buffer.from(decrypted)).toString());
  if (restored.tables.users.length !== tables.users.length)
    throw Error("Migration checkpoint recovery verification failed.");
  console.log(
    "Encrypted independent pre-migration checkpoint saved and recovery verified.",
  );
}
