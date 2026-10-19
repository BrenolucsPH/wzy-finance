import { Pool as LocalPool } from "pg";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { setDatabaseContext } from "./database-context";
import { AsyncLocalStorage } from "node:async_hooks";
const reads = new AsyncLocalStorage<PoolClient>();
export async function consistentRead<T>(operation: () => Promise<T>) {
  if (reads.getStore()) return operation();
  const client = await postgres().connect();
  try {
    await assertTestSchema(client);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await setDatabaseContext(client);
    const result = await reads.run(client, operation);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
let pool: Pool | undefined;
export function postgres() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_UNAVAILABLE");
  const schema = process.env.WZY_TEST_SCHEMA;
  if (schema && !/^wzy_qa_[a-f0-9]{32}$/.test(schema))
    throw new Error("INVALID_TEST_SCHEMA");
  const connectionString = schema
    ? process.env.DATABASE_URL_UNPOOLED
    : process.env.DATABASE_URL;
  if (!connectionString) throw new Error("TEST_DATABASE_UNAVAILABLE");
  if (!pool) {
    const local =
      process.env.WZY_LOCAL_QA === "1" &&
      schema &&
      new URL(connectionString).hostname === "127.0.0.1";
    pool = local
      ? (new LocalPool({
          connectionString,
          max: 5,
          options: `-c search_path=${schema}`,
        }) as unknown as Pool)
      : new Pool({
          connectionString,
          max: 5,
          ...(schema ? { options: `-c search_path=${schema}` } : {}),
        });
    pool.on("error", () =>
      console.error("WZY database connection interrupted."),
    );
  }
  return pool;
}
function sql(source: string) {
  let index = 0;
  return source
    .replace(
      /json_extract\(payload,\s*'\$\.sourceId'\)/g,
      "(payload::jsonb->>'sourceId')",
    )
    .replace(/\?/g, () => `$${++index}`);
}
function rows<T>(items: Record<string, unknown>[]) {
  return items.map(
    (row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          [
            "created",
            "updated",
            "expires",
            "size",
            "count",
            "n",
            "total",
            "totp_counter",
            "expected_size",
            "last_seen",
            "avatar_updated",
            "last_access",
            "session_count",
          ].includes(key) && typeof value === "string"
            ? Number(value)
            : value,
        ]),
      ) as T,
  );
}
async function assertTestSchema(client: {
  query: (sql: string) => Promise<{
    rows: Record<string, unknown>[];
  }>;
}) {
  if (process.env.WZY_TEST_SCHEMA) {
    const result = await client.query("SELECT current_schema() AS schema");
    if (result.rows[0]?.schema !== process.env.WZY_TEST_SCHEMA)
      throw new Error("TEST_SCHEMA_ISOLATION_FAILED");
  }
}
export class Statement {
  constructor(
    readonly query: string,
    readonly values: unknown[] = [],
    readonly locks: {
      user?: string;
      record?: { id: string; owner: string };
      file?: { owner: string; size: number };
    } = {},
  ) {}
  bind(...values: unknown[]) {
    return new Statement(this.query, values, this.locks);
  }
  lockUser(user: string) {
    return new Statement(this.query, this.values, { ...this.locks, user });
  }
  lockRecord(id: string, owner: string) {
    return new Statement(this.query, this.values, {
      ...this.locks,
      record: { id, owner },
    });
  }
  reserveFile(owner: string, size: number) {
    return new Statement(this.query, this.values, {
      ...this.locks,
      file: { owner, size },
    });
  }
  async all<T = Record<string, unknown>>() {
    const existing = reads.getStore();
    if (existing) {
      const result = await existing.query(sql(this.query), this.values);
      return { results: rows<T>(result.rows) };
    }
    const client = await postgres().connect();
    try {
      await assertTestSchema(client);
      await client.query("BEGIN");
      await setDatabaseContext(client);
      const result = await client.query(sql(this.query), this.values);
      await client.query("COMMIT");
      return { results: rows<T>(result.rows) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async first<T = Record<string, unknown>>() {
    return (await this.all<T>()).results[0] || null;
  }
  async run() {
    const client = await postgres().connect();
    try {
      await assertTestSchema(client);
      await client.query("BEGIN");
      await setDatabaseContext(client);
      if (this.locks.user) {
        const owner = await client.query(
          "SELECT id,disabled FROM users WHERE id=$1 FOR UPDATE",
          [this.locks.user],
        );
        if (!owner.rows.length || owner.rows[0].disabled)
          throw Error("ACCOUNT_DISABLED");
      }
      if (this.locks.record) {
        await client.query(
          "SELECT id FROM records WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [this.locks.record.id, this.locks.record.owner],
        );
      }
      if (this.locks.file) {
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          this.locks.file.owner,
        ]);
        const occupied = await client.query(
          "SELECT (SELECT COALESCE(sum(size),0) FROM files WHERE user_id=$1)+(SELECT COALESCE(sum(expected_size),0) FROM uploads WHERE user_id=$1) AS total",
          [this.locks.file.owner],
        );
        if (
          Number(occupied.rows[0].total) + this.locks.file.size >
          100 * 1024 * 1024
        ) {
          await client.query("COMMIT");
          return { meta: { changes: 0 } };
        }
      }
      const result = await client.query(sql(this.query), this.values);
      await client.query("COMMIT");
      return { meta: { changes: result.rowCount || 0 } };
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        (
          error as {
            code?: string;
          }
        ).code === "23505"
      )
        throw new Error("UNIQUE");
      throw error;
    } finally {
      client.release();
    }
  }
}
export const database = {
  prepare: (query: string) => new Statement(query),
  async batch(statements: Statement[]) {
    const client = await postgres().connect();
    try {
      await assertTestSchema(client);
      await client.query("BEGIN");
      await setDatabaseContext(client);
      const results = [];
      for (const statement of statements) {
        const result = await client.query(
          sql(statement.query),
          statement.values,
        );
        results.push({
          meta: { changes: result.rowCount || 0 },
          results: rows(result.rows),
        });
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};
export async function transaction<T>(
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await postgres().connect();
  try {
    await assertTestSchema(client);
    await client.query("BEGIN");
    await setDatabaseContext(client);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function scopedQuery(query: string, values: unknown[] = []) {
  return transaction((client) => client.query(query, values));
}
