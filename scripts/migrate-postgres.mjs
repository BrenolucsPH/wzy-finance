import { Pool } from "@neondatabase/serverless";
import { readFile, readdir } from "node:fs/promises";
import { migrationDigest } from "./migration-digest.mjs";
export async function migrate(connectionString, schema) {
  if (!connectionString)
    throw Error("DATABASE_URL is required for migrations.");
  if (schema && !/^wzy_qa_[a-f0-9]{32}$/.test(schema))
    throw Error("INVALID_TEST_SCHEMA");
  const local =
    process.env.WZY_LOCAL_QA === "1" &&
    schema &&
    new URL(connectionString).hostname === "127.0.0.1";
  const Driver = local ? (await import("pg")).Pool : Pool;
  const pool = new Driver({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (schema) await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query("SELECT pg_advisory_xact_lock(87261008)");
    await client.query("SELECT set_config('wzy.system','1',true)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied bigint NOT NULL)",
    );
    const names = (await readdir(new URL("../db/migrations/", import.meta.url)))
      .filter((n) => n.endsWith(".sql"))
      .sort();
    const baseline = await readFile(
      new URL("../db/vercel-schema.sql", import.meta.url),
      "utf8",
    );
    if (!schema) {
      const done = new Set(
        (await client.query("SELECT version FROM schema_migrations")).rows.map(
          (r) => r.version,
        ),
      );
      const pending = names.filter((n) => !done.has(n));
      if (pending.length) {
        const { captureMigrationBackup } =
          await import("./migration-backup.mjs");
        await captureMigrationBackup(client, pending);
      }
    }
    // Legacy schema is idempotent and retained unchanged; future migrations are immutable.
    await client.query(baseline);
    for (const name of names) {
      const rawSource = await readFile(
        new URL("../db/migrations/" + name, import.meta.url),
        "utf8",
      );
      const { source, checksum, accepts } = migrationDigest(rawSource);
      const old = await client.query(
        "SELECT checksum FROM schema_migrations WHERE version=$1",
        [name],
      );
      if (old.rows.length) {
        if (!accepts(old.rows[0].checksum))
          throw Error("MIGRATION_CHECKSUM_CHANGED: " + name);
        continue;
      }
      await client.query(source);
      await client.query(
        "INSERT INTO schema_migrations(version,checksum,applied) VALUES($1,$2,$3)",
        [name, checksum, Date.now()],
      );
    }
    const role = schema ? schema + "_runtime" : "wzy_runtime";
    if (!/^wzy_(?:runtime|qa_[a-f0-9]{32}_runtime)$/.test(role))
      throw Error("Invalid runtime role.");
    await client.query(
      `DO $role$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS; END IF; END $role$`,
    );
    await client.query(`GRANT "${role}" TO CURRENT_USER`);
    const scope = schema || "public";
    await client.query(`GRANT USAGE ON SCHEMA "${scope}" TO "${role}"`);
    await client.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${scope}" TO "${role}"`,
    );
    await client.query(
      `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA "${scope}" TO "${role}"`,
    );
    await client.query(
      `REVOKE UPDATE,DELETE ON "${scope}".financial_revisions FROM "${role}"`,
    );
    await client.query(
      `REVOKE INSERT,UPDATE,DELETE ON "${scope}".schema_migrations FROM "${role}"`,
    );
    await client.query("COMMIT");
    console.log(
      "Versioned PostgreSQL migrations verified; existing data preserved.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(
    process.argv[1].replaceAll("\\", "/").split("/").at(-1),
  )
) {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(".env.local");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await migrate(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
}
