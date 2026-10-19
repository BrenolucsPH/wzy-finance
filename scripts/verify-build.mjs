import { migrate } from "./migrate-postgres.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { del } from "@vercel/blob";
import bcrypt from "bcryptjs";
const schema = "wzy_qa_" + randomUUID().replaceAll("-", "");
if (!/^wzy_qa_[a-f0-9]{32}$/.test(schema)) throw Error("Unsafe QA schema.");
const sql = neon(process.env.DATABASE_URL);
let server;
await sql.query(`CREATE SCHEMA "${schema}"`);
try {
  await migrate(
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
    schema,
  );
  const adminId = randomUUID(),
    browserAdminId = randomUUID(),
    adminPassword = "QA-" + randomUUID(),
    browserPassword = "QA-" + randomUUID(),
    adminEmail = "admin-" + randomUUID() + "@example.test",
    browserEmail = "browser-admin-" + randomUUID() + "@example.test";
  for (const [id, email, password] of [
    [adminId, adminEmail, adminPassword],
    [browserAdminId, browserEmail, browserPassword],
  ])
    await sql.query(
      `INSERT INTO "${schema}".users(id,email,name,password,created) VALUES($1,$2,$3,$4,$5)`,
      [
        id,
        email,
        "Administrador QA",
        await bcrypt.hash(password, 12),
        Date.now(),
      ],
    );
  const env = {
    ...process.env,
    AUTH_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    WZY_TEST_SCHEMA: schema,
    WZY_QA_FX: "1",
    CRON_SECRET: randomUUID(),
    WZY_ADMIN_USER_IDS: adminId + "," + browserAdminId,
    WZY_QA_ADMIN_EMAIL: adminEmail,
    WZY_QA_ADMIN_PASSWORD: adminPassword,
    WZY_QA_BROWSER_ADMIN_EMAIL: browserEmail,
    WZY_QA_BROWSER_ADMIN_PASSWORD: browserPassword,
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    TWILIO_AUTH_TOKEN: "",
    WZY_PUSH_PRIVATE_KEY: "",
    WZY_PUSH_PUBLIC_KEY: "",
  };
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "5173",
    ],
    { env, stdio: "inherit", windowsHide: true },
  );
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw Error("Verification server stopped.");
    try {
      const r = await fetch("http://127.0.0.1:5173/api/auth/me");
      if (r.ok) {
        const state = await r.json();
        if (state.testOrigin) {
          env.WZY_TEST_ORIGIN = state.testOrigin;
          ready = true;
          break;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw Error("Verification server not ready.");
  for (const script of [
    // Run browser parity first so cloud-only launch failures fail early.
    "verify-browser.mjs",
    "verify-runtime.mjs",
    "verify-account.mjs",
    "verify-finance.mjs",
    "verify-interface.mjs",
    "verify-migrations.mjs",
    "verify-domain.mjs",
    "verify-evolution.mjs",
  ]) {
    const test = spawn(process.execPath, ["scripts/" + script], {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    const [code] = await once(test, "exit");
    if (code !== 0) throw Error("Verification failed: " + script);
  }
  console.log(
    "WZY build gates passed with synthetic users, isolated PostgreSQL and a real headless browser.",
  );
} finally {
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([
      once(server, "exit"),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }
  // Every path and database target comes only from the random QA schema above.
  const tables = (
      await sql.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [
        schema,
      ])
    ).map((r) => r.tablename),
    paths = [];
  for (const table of ["files", "uploads"])
    if (tables.includes(table))
      for (const file of await sql.query(
        `SELECT user_id,id FROM "${schema}"."${table}"`,
      ))
        paths.push(file.user_id + "/" + file.id);
  for (const table of ["backup_archives", "restore_uploads"])
    if (tables.includes(table))
      for (const row of await sql.query(
        `SELECT pathname FROM "${schema}"."${table}"`,
      ))
        paths.push(row.pathname);
  for (const path of new Set(paths)) await del(path);
  await sql.query(`DROP SCHEMA "${schema}" CASCADE`);
  await sql.query(`DROP ROLE IF EXISTS "${schema}_runtime"`);
  console.log(
    "Only this run's temporary QA schema and private test objects were removed.",
  );
}
