import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Pool as LocalPool } from "pg";
import { Pool as NeonPool } from "@neondatabase/serverless";
const schema = process.env.WZY_TEST_SCHEMA;
if (!/^wzy_qa_[a-f0-9]{32}$/.test(schema || ""))
  throw Error("Only isolated QA schemas are allowed.");
const base = "http://127.0.0.1:5173",
  origin = process.env.WZY_TEST_ORIGIN || base,
  checks = [];
const pool =
  process.env.WZY_LOCAL_QA === "1"
    ? new LocalPool({ connectionString: process.env.DATABASE_URL })
    : new NeonPool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const test = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
async function call(
  path,
  body,
  cookie = "",
  expected = 200,
  method,
  headers = {},
) {
  const r = await fetch(base + "/api/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.equal(r.status, expected, path + ": " + JSON.stringify(data));
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const password = "QA-" + randomUUID();
try {
  await client.query(`SET search_path TO "${schema}"`);
  const email = "evolution-" + randomUUID() + "@example.test",
    one = await call(
      "auth/register",
      { name: "Evolução QA", email, password },
      "",
      201,
    ),
    twoEmail = "collaborator-" + randomUUID() + "@example.test",
    two = await call(
      "auth/register",
      { name: "Convidada QA", email: twoEmail, password },
      "",
      201,
    ),
    cookie = one.cookie,
    owner = one.data.user.id;
  const save = async (e) =>
    (await call("records", { id: randomUUID(), amount: 0, ...e }, cookie)).data
      .entry;
  const account = await save({
      kind: "account",
      name: "Banco QA",
      initial: 1000000,
    }),
    card = await save({
      kind: "card",
      name: "Cartão QA",
      closing: 10,
      day: 20,
      limit: 100000,
    });
  let tx = await save({
    kind: "transaction",
    name: "Internet QA",
    amount: 10000,
    date: "2026-10-08",
    type: "expense",
    status: "paid",
    accountId: card.id,
    category: "Moradia",
  });
  const replay = await call("records", tx, cookie);
  assert.equal(replay.data.replayed, true);
  await call(
    "workspace/invoice/close",
    { cardId: card.id, cycle: "2026-10" },
    cookie,
  );
  await call("records", { ...tx, accountId: account.id }, cookie, 409);
  await call("records/" + tx.id, undefined, cookie, 409, "DELETE", {
    "If-Match": String(tx._version),
  });
  const pay = {
    cardId: card.id,
    cycle: "2026-10",
    accountId: account.id,
    amount: 3000,
    date: "2026-10-15",
    requestId: randomUUID(),
  };
  await call("workspace/invoice/pay", pay, cookie);
  await call("workspace/invoice/pay", pay, cookie);
  let invoices = (
    await call("workspace/invoices?card=" + card.id, undefined, cookie)
  ).data;
  assert.equal(
    invoices.invoices.find((i) => i.cycle === "2026-10").remaining,
    7000,
  );
  const refund = {
    cardId: card.id,
    cycle: "2026-10",
    amount: 2000,
    date: "2026-10-15",
    type: "refund",
    reason: "Estorno parcial QA",
    reversalOf: tx.id,
    requestId: randomUUID(),
  };
  await call("workspace/invoice/adjust", refund, cookie);
  await call("workspace/invoice/adjust", refund, cookie);
  await call(
    "workspace/invoice/adjust",
    { ...refund, amount: 9000, requestId: randomUUID() },
    cookie,
    400,
  );
  invoices = (
    await call("workspace/invoices?card=" + card.id, undefined, cookie)
  ).data;
  assert.equal(
    invoices.invoices.find((i) => i.cycle === "2026-10").remaining,
    5000,
  );
  test(
    "Closed invoices cannot be moved or deleted; partial payments and refunds replay safely without double counting",
  );
  let cats = (
    await call(
      "workspace/category",
      { name: "Pets QA", type: "expense", color: "#357c67" },
      cookie,
    )
  ).data.categories;
  const cat = cats.find((c) => c.name === "Pets QA");
  await call(
    "workspace/rule",
    { term: "petshop", category: "Pets QA", priority: 50 },
    cookie,
  );
  const pet = await save({
    kind: "transaction",
    name: "Petshop da esquina",
    amount: 1234,
    date: "2026-10-14",
    type: "expense",
    status: "paid",
    accountId: account.id,
    category: "Outros",
  });
  assert.equal(pet.category, "Pets QA");
  await call(
    "workspace/category",
    { id: cat.id, name: "Animais QA", type: "expense", color: "#357c67" },
    cookie,
  );
  const history = (
    await call("workspace/history?record=" + pet.id, undefined, cookie)
  ).data.revisions;
  assert.equal(history.length, 2);
  assert.equal(history[0].after_payload.category, "Animais QA");
  assert.equal(
    (await call("workspace/history?record=" + pet.id, undefined, two.cookie))
      .data.revisions.length,
    0,
  );
  await call("records", { ...pet, name: "Stale" }, cookie, 409);
  test(
    "Rules classify new entries; category renames preserve an owner-scoped immutable history and reject stale edits",
  );
  const investment = await save({
    kind: "account",
    name: "Corretora QA",
    accountType: "investment",
    initial: 100000,
  });
  let portfolio = (
    await call(
      "workspace/investment/position",
      {
        accountId: investment.id,
        symbol: "TESTE",
        name: "Ativo QA",
        assetType: "stock",
        requestId: randomUUID(),
      },
      cookie,
    )
  ).data;
  const position = portfolio.positions[0];
  const buy = {
    positionId: position.id,
    operation: "buy",
    quantity: "1.5",
    price: 1000,
    fees: 10,
    date: "2026-10-14",
    requestId: randomUUID(),
  };
  await call("workspace/investment/operation", buy, cookie);
  portfolio = (await call("workspace/investment/operation", buy, cookie)).data;
  assert.equal(portfolio.positions[0].quantity, "1.5");
  assert.equal(portfolio.positions[0].costBasis, 1510);
  await call(
    "workspace/investment/operation",
    { ...buy, operation: "sell", quantity: "2", requestId: randomUUID() },
    cookie,
    400,
  );
  await call(
    "workspace/investment/operation",
    { ...buy, requestId: randomUUID() },
    two.cookie,
    404,
  );
  const op = portfolio.positions[0].operations.find(
    (o) => o.operation === "buy",
  );
  await call(
    "workspace/investment/reverse",
    {
      operationId: op.id,
      date: "2026-10-15",
      reason: "Correção de teste",
      requestId: randomUUID(),
    },
    cookie,
  );
  portfolio = (await call("workspace/portfolio", undefined, cookie)).data;
  assert.equal(portfolio.positions[0].quantity, "0");
  let snapshot = (
    await call("workspace/snapshot?month=2026-10", undefined, cookie)
  ).data;
  assert.equal(
    snapshot.entries.find((e) => e.id === investment.id)._balance,
    100000,
  );
  test(
    "Fractional investment operations preserve exact cost, owned cash movements, idempotency and correction balances",
  );
  const group = await save({
    kind: "group",
    name: "Família QA",
    amount: 10001,
    day: 20,
    members: ["Titular", "Convidada"],
    memberWeights: { Titular: 2, Convidada: 1 },
    payments: {},
  });
  const invitation = (
    await call(
      "workspace/groups/invite",
      {
        groupId: group.id,
        email: twoEmail,
        memberName: "Convidada",
        role: "editor",
      },
      cookie,
    )
  ).data;
  const token = new URL(invitation.inviteUrl).searchParams.get("invite");
  await call("workspace/groups/accept", { token }, cookie, 403);
  await call("workspace/groups/accept", { token }, two.cookie);
  const shared = (await call("workspace/groups/shared", undefined, two.cookie))
    .data.groups[0];
  assert.equal(shared.group.accountId, undefined);
  await call(
    "workspace/groups/payment",
    { membershipId: shared.membershipId, month: "2026-10", paid: true },
    two.cookie,
  );
  const groupNow = (await call("records", undefined, cookie)).data.entries.find(
    (e) => e.id === group.id,
  );
  assert.deepEqual(groupNow.payments["2026-10"], ["Convidada"]);
  await call("workspace/groups/revoke", { id: shared.membershipId }, cookie);
  await call(
    "workspace/groups/payment",
    { membershipId: shared.membershipId, month: "2026-10", paid: false },
    two.cookie,
    403,
  );
  test(
    "Invitations bind to the intended identity, expose only the group and immediately revoke access",
  );
  // Bulk data belongs only to the temporary QA schema and fake owner.
  const bulk = Array.from({ length: 5000 }, (_, i) => ({
    id: randomUUID(),
    kind: "transaction",
    name: "Volume QA " + i,
    amount: 100,
    type: "income",
    status: "paid",
    date: "2026-09-" + String((i % 28) + 1).padStart(2, "0"),
    accountId: account.id,
    category: "Salário",
  }));
  await client.query(
    "INSERT INTO records(id,user_id,kind,payload,updated,account_id) SELECT x.id,$1,'transaction',x.payload::text,$2,$3 FROM jsonb_to_recordset($4::jsonb) AS x(id text,payload jsonb)",
    [
      owner,
      Date.now(),
      account.id,
      JSON.stringify(bulk.map((e) => ({ id: e.id, payload: e }))),
    ],
  );
  const start = performance.now();
  snapshot = (await call("workspace/snapshot?month=2026-09", undefined, cookie))
    .data;
  const duration = Math.round(performance.now() - start);
  assert.equal(
    snapshot.entries.filter((e) => e.kind === "transaction").length,
    100,
  );
  assert.equal(
    snapshot.summary.months.find(
      (e) => e.month === "2026-09" && e.type === "income",
    ).total,
    500000,
  );
  let cursor = "",
    count = 0,
    ids = new Set();
  do {
    const page = (
      await call(
        "workspace/transactions?month=2026-09&cursor=" +
          encodeURIComponent(cursor),
        undefined,
        cookie,
      )
    ).data;
    assert.equal(page.total, 5000);
    assert.ok(page.entries.length <= 50);
    for (const e of page.entries) ids.add(e.id);
    count += page.entries.length;
    cursor = page.nextCursor || "";
  } while (cursor);
  assert.equal(count, 5000);
  assert.equal(ids.size, 5000);
  console.log("MEASURE snapshot 5000 records:", duration, "ms");
  test(
    "Five thousand records keep complete server totals and deterministic pagination without duplication",
  );
  const { captureMigrationBackup } = await import("./migration-backup.mjs");
  let checkpoint;
  await captureMigrationBackup(client, ["synthetic-checkpoint-test"], {
    put: async (_path, bytes) => {
      checkpoint = Buffer.from(bytes);
    },
    get: async () => ({
      statusCode: 200,
      stream: new Blob([checkpoint]).stream(),
    }),
  });
  assert.ok(checkpoint.length > 0);
  const role = schema + "_runtime";
  await client.query("BEGIN");
  await client.query(`SET LOCAL ROLE "${role}"`);
  await client.query(
    "SELECT set_config('wzy.enforce_context','1',true),set_config('wzy.user_id',$1,true)",
    [two.data.user.id],
  );
  assert.equal(
    (
      await client.query(
        "SELECT COUNT(*)::int AS n FROM records WHERE user_id=$1",
        [owner],
      )
    ).rows[0].n,
    0,
  );
  const flags = (
    await client.query(
      "SELECT rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname=$1",
      [role],
    )
  ).rows[0];
  assert.equal(flags.rolcanlogin, false);
  assert.equal(flags.rolbypassrls, false);
  await assert.rejects(() =>
    client.query("DELETE FROM financial_revisions WHERE user_id=$1", [owner]),
  );
  await client.query("ROLLBACK");
  test(
    "The actual runtime database role enforces account isolation and cannot rewrite financial history",
  );
  await call(
    "finance/preferences",
    { sidebarPinned: ["Metas"], usageMetrics: true },
    cookie,
  );
  const proofBytes = Buffer.from(
    "%PDF-1.4\nWZY synthetic recovery proof\n%%EOF",
  );
  async function proof(cookie) {
    const form = new FormData();
    form.set(
      "file",
      new File([proofBytes], "proof-qa.pdf", { type: "application/pdf" }),
    );
    const response = await fetch(base + "/api/files", {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
      body: form,
    });
    assert.equal(response.status, 201);
    return (await response.json()).file.id;
  }
  const sourceProof = await proof(cookie);
  await save({
    kind: "transaction",
    name: "Comprovante restaurável QA",
    amount: 100,
    date: "2026-10-14",
    type: "expense",
    status: "paid",
    accountId: account.id,
    attachmentId: sourceProof,
  });
  await call(
    "workspace/investment/operation",
    { ...buy, requestId: randomUUID() },
    cookie,
  );
  const exported = (await call("finance/export", undefined, cookie)).data;
  assert.equal(exported.format, "wzy-export-v3");
  assert.ok(exported.revisions.length >= 5000);
  assert.equal(exported.profile.password, undefined);
  // Restore into an empty third owner, including a private attachment with verified bytes.
  const third = await call(
    "auth/register",
    {
      name: "Restauração QA",
      email: "restore-" + randomUUID() + "@example.test",
      password,
    },
    "",
    201,
  );
  const destinationProof = await proof(third.cookie);
  const jsonBytes = Buffer.from(JSON.stringify(exported));
  const upload = (
    await call("restoration/upload", { size: jsonBytes.length }, third.cookie)
  ).data;
  if (process.env.WZY_LOCAL_QA === "1") {
    const target = join(process.env.WZY_QA_STORAGE_DIRECTORY, upload.pathname);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, jsonBytes);
  } else {
    const { put } = await import("@vercel/blob/client");
    await put(upload.pathname, jsonBytes, {
      access: "private",
      token: upload.token,
      contentType: "application/json",
    });
  }
  await call("restoration/preview", { uploadId: upload.id }, two.cookie, 404);
  await call("restoration/preview", { uploadId: upload.id }, third.cookie, 400);
  const preview = (
    await call(
      "restoration/preview",
      { uploadId: upload.id, attachments: { [sourceProof]: destinationProof } },
      third.cookie,
    )
  ).data;
  assert.equal(preview.records, exported.entries.length);
  await call(
    "restoration/commit",
    { planId: preview.planId, confirm: true },
    third.cookie,
  );
  assert.equal(
    (
      await call(
        "restoration/commit",
        { planId: preview.planId, confirm: true },
        third.cookie,
      )
    ).data.replayed,
    true,
  );
  const restored = (await call("finance/export", undefined, third.cookie)).data;
  assert.equal(restored.entries.length, exported.entries.length);
  assert.deepEqual(restored.preferences.sidebarPinned, ["Metas"]);
  assert.equal(restored.preferences.usageMetrics, undefined);
  const reversed = new Set(
    restored.investmentOperations
      .filter((o) => o.operation === "reverse")
      .map((o) => o.reversal_of),
  );
  const restoredOp = restored.investmentOperations.find(
    (o) => o.operation === "buy" && !reversed.has(o.id),
  );
  assert.ok(restored.entries.some((e) => e.id === restoredOp.id + "-cash"));
  const restoredProof = restored.entries.find(
    (e) => e.name === "Comprovante restaurável QA",
  );
  assert.equal(restoredProof.attachmentId, destinationProof);
  const download = await fetch(base + "/api/files/" + destinationProof, {
    headers: { Cookie: third.cookie },
  });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), proofBytes);
  await call(
    "workspace/investment/reverse",
    {
      operationId: restoredOp.id,
      date: "2026-10-15",
      reason: "Correção após restauração QA",
      requestId: randomUUID(),
    },
    third.cookie,
  );
  assert.equal(
    (await call("workspace/portfolio", undefined, third.cookie)).data
      .positions[0].quantity,
    "0",
  );
  await call("restoration/cancel", { uploadId: upload.id }, third.cookie);
  test(
    "Complete export restores atomically with remapped investment links and preferences; consent is not copied and retry is safe",
  );
  const answer = (
    await call(
      "workspace/assistant",
      { question: "Quanto recebi em setembro de 2026?", reference: "2026-10" },
      cookie,
    )
  ).data;
  assert.ok(answer.answer.includes("5.000,00"));
  test(
    "The local assistant queries complete historical data beyond the visible page",
  );
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/evolution.json",
    JSON.stringify(
      {
        passed: checks.length,
        checks,
        measurement: { records: 5000, snapshotMs: duration },
        environment: "isolated PostgreSQL; synthetic users",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  client.release();
  await pool.end();
}
