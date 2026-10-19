import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
const root = resolve(import.meta.dirname, ".."),
  schema = "wzy_qa_" + randomUUID().replaceAll("-", ""),
  folder = join(root, ".qa-data", schema),
  data = join(folder, "postgres"),
  storage = join(folder, "storage"),
  port = 64329;
if (
  !/^wzy_qa_[a-f0-9]{32}$/.test(schema) ||
  resolve(folder, "..") !== resolve(root, ".qa-data")
)
  throw Error("Unsafe QA directory.");
await mkdir(folder, { recursive: true });
const password = randomBytes(24).toString("hex"),
  passwordFile = join(folder, "pg-password");
await writeFile(passwordFile, password);
const env = {
  ...process.env,
  WZY_LOCAL_QA: "1",
  WZY_TEST_SCHEMA: schema,
  WZY_QA_STORAGE_DIRECTORY: storage,
  DATABASE_URL: `postgresql://wzy_qa_owner:${password}@127.0.0.1:${port}/postgres`,
  DATABASE_URL_UNPOOLED: `postgresql://wzy_qa_owner:${password}@127.0.0.1:${port}/postgres`,
  AUTH_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  WZY_QA_FX: "1",
  CRON_SECRET: randomUUID(),
  RESEND_API_KEY: "",
  EMAIL_FROM: "",
  TWILIO_AUTH_TOKEN: "",
  WZY_PUSH_PRIVATE_KEY: "",
  WZY_PUSH_PUBLIC_KEY: "",
  BLOB_READ_WRITE_TOKEN:
    "vercel_blob_rw_qaonly_" + randomBytes(24).toString("hex"),
};
async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: "inherit",
    ...options,
  });
  const [code] = await once(child, "exit");
  if (code !== 0) throw Error("QA command failed: " + args[0]);
}
let database, server, pg;
try {
  if (process.platform !== "win32")
    throw Error(
      "This standalone launcher currently uses the Windows QA binaries. CI can supply an isolated PostgreSQL service.",
    );
  pg = await import(
    pathToFileURL(
      resolve(
        root,
        "../qa-tools/node_modules/@embedded-postgres/windows-x64/dist/index.js",
      ),
    ).href
  );
  await run(pg.initdb, [
    "-D",
    data,
    "-U",
    "wzy_qa_owner",
    "--pwfile=" + passwordFile,
    "--encoding=UTF8",
    "--locale=C",
    "--auth=scram-sha-256",
  ]);
  await run(pg.pg_ctl, [
    "-D",
    data,
    "-l",
    join(folder, "postgres.log"),
    "-o",
    "-h 127.0.0.1 -p " + port,
    "-w",
    "start",
  ]);
  database = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  await database.query(`CREATE SCHEMA "${schema}"`);
  Object.assign(process.env, env);
  const { migrate } = await import("./migrate-postgres.mjs");
  await migrate(env.DATABASE_URL, schema);
  const adminId = randomUUID(),
    adminEmail = "qa-admin-" + randomUUID() + "@example.test",
    adminPassword = "QA-" + randomUUID();
  env.WZY_ADMIN_USER_IDS = adminId;
  env.WZY_QA_ADMIN_EMAIL = adminEmail;
  env.WZY_QA_ADMIN_PASSWORD = adminPassword;
  await database.query(
    `INSERT INTO "${schema}".users(id,email,name,password,created) VALUES($1,$2,$3,$4,$5)`,
    [
      adminId,
      adminEmail,
      "Administrador QA",
      await bcrypt.hash(adminPassword, 12),
      Date.now(),
    ],
  );
  const browserAdminId = randomUUID(),
    browserEmail = "qa-browser-admin-" + randomUUID() + "@example.test",
    browserPassword = "QA-" + randomUUID();
  env.WZY_ADMIN_USER_IDS += "," + browserAdminId;
  env.WZY_QA_BROWSER_ADMIN_EMAIL = browserEmail;
  env.WZY_QA_BROWSER_ADMIN_PASSWORD = browserPassword;
  await database.query(
    `INSERT INTO "${schema}".users(id,email,name,password,created) VALUES($1,$2,$3,$4,$5)`,
    [
      browserAdminId,
      browserEmail,
      "Administrador navegador QA",
      await bcrypt.hash(browserPassword, 12),
      Date.now(),
    ],
  );
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      process.argv.includes("--dev") ? "dev" : "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "5173",
    ],
    { cwd: root, env, windowsHide: true, stdio: "inherit" },
  );
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch("http://127.0.0.1:5173/api/auth/me");
      if (response.ok) {
        const state = await response.json();
        if (state.testOrigin) {
          env.WZY_TEST_ORIGIN = state.testOrigin;
          ready = true;
          break;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw Error("Local QA server did not become ready.");
  const scripts = process.env.WZY_QA_SCRIPTS?.split(",") || [
    "verify-runtime.mjs",
    "verify-account.mjs",
    "verify-finance.mjs",
    "verify-interface.mjs",
    "verify-migrations.mjs",
    "verify-domain.mjs",
    "verify-evolution.mjs",
    "verify-browser.mjs",
  ];
  for (const script of scripts) {
    if (!/^verify-[a-z-]+\.mjs$/.test(script))
      throw Error("Invalid QA script.");
    await run(process.execPath, ["scripts/" + script]);
  }
  console.log(
    "Local QA completed: real PostgreSQL, isolated fake users, local file-provider adapter.",
  );
} finally {
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([
      once(server, "exit"),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }
  if (database) await database.end();
  if (pg)
    await run(pg.pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"]).catch(
      () => {},
    );
  console.log(
    "QA processes stopped. Diagnostic files are private under .qa-data and excluded from publication.",
  );
}
