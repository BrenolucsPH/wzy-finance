import { invoiceCycle } from "../../../../lib/domain/invoices";
import { classify } from "../../../../lib/domain/classification";
import { listRules } from "../../../../lib/modules/workspace/categories";
import { financialExport } from "../../../../lib/modules/backups/export";
import { observe } from "../../../../lib/observability";
import {
  withOwner,
  setDatabaseContext,
} from "../../../../lib/database-context";
import { navigationPreferenceSchema } from "../../../../lib/navigation";
import { openBackup } from "../../../../lib/vault-crypto";
import { db, session, rate, digest } from "../../../../lib/server";
import { postgres } from "../../../../lib/postgres";
import { entrySchema } from "../../../../lib/validation";
import { parseStatement } from "../../../../lib/reconcile";
import { currencies, quote } from "../../../../lib/fx";
import { installmentDate } from "../../../../lib/planning";
import { split, localDate, type Entry } from "../../../../lib/finance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const fail = (error: string, status = 400) => json({ error }, status);
async function handleGET(req: Request) {
  return handle(req);
}
async function handlePOST(req: Request) {
  return handle(req);
}
async function handle(req: Request) {
  try {
    if (
      req.method !== "GET" &&
      req.headers.get("origin") !== new URL(req.url).origin
    )
      return fail("Origem inválida.", 403);
    const u = await session(req);
    if (!u) return fail("Entre na sua conta.", 401);
    return await withOwner(u.id, async () => {
      const url = new URL(req.url),
        action = url.pathname.split("/").slice(3).join("/");
      if (action === "quotes" && req.method === "GET")
        return json(
          await quote(
            url.searchParams.get("currency") || "USD",
            url.searchParams.get("date") || undefined,
          ),
        );
      if (action === "preferences" && req.method === "GET") {
        const row = await db()
          .prepare("SELECT payload FROM user_preferences WHERE user_id=?")
          .bind(u.id)
          .first<{
            payload: string;
          }>();
        return json({ preferences: row ? JSON.parse(row.payload) : {} });
      }
      if (action === "export" && req.method === "GET")
        return json(await financialExport(u));
      if (action === "backups" && req.method === "GET") {
        const list = await db()
          .prepare(
            "SELECT day,created FROM financial_backups WHERE user_id=? ORDER BY day DESC",
          )
          .bind(u.id)
          .all();
        return json({ backups: list.results });
      }
      if (action === "backup" && req.method === "GET") {
        const b = await db()
          .prepare(
            "SELECT payload FROM financial_backups WHERE user_id=? AND day=?",
          )
          .bind(u.id, url.searchParams.get("day") || "")
          .first<{
            payload: string;
          }>();
        return b
          ? json(await openBackup(b.payload))
          : fail("Cópia não encontrada.", 404);
      }
      if (req.method !== "POST") return fail("Página não encontrada.", 404);
      await rate(req, "finance-write", u.id, 40);
      const raw = await req.text();
      if (Buffer.byteLength(raw) > 2400000)
        return fail("Use um arquivo de até 2 MB.", 413);
      const body = JSON.parse(raw || "{}");
      if (action === "preferences") {
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          JSON.stringify(body).length > 10000
        )
          return fail("Preferências inválidas.");
        if (!navigationPreferenceSchema.safeParse(body).success)
          return fail(
            "Ordem ou atalhos inválidos. Escolha até quatro opções diferentes.",
          );
        const allowed = [
          "overviewWidgets",
          "notifications",
          "privacyAcceptedAt",
          "sidebarOrder",
          "sidebarPinned",
          "guideDismissed",
          "usageMetrics",
        ];
        if (
          body.usageMetrics !== undefined &&
          typeof body.usageMetrics !== "boolean"
        )
          return fail("Consentimento inválido.");
        const prefs = Object.fromEntries(
          Object.entries(body).filter(([key]) => allowed.includes(key)),
        );
        if (
          prefs.overviewWidgets &&
          (!Array.isArray(prefs.overviewWidgets) ||
            prefs.overviewWidgets.some(
              (x: unknown) =>
                ![
                  "cash-flow",
                  "upcoming",
                  "transactions",
                  "subscriptions",
                ].includes(String(x)),
            ))
        )
          return fail("Widgets inválidos.");
        const saved = await db()
          .prepare(
            "INSERT INTO user_preferences (user_id,payload,updated) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=(user_preferences.payload::jsonb || excluded.payload::jsonb)::text,updated=excluded.updated RETURNING payload",
          )
          .bind(u.id, JSON.stringify(prefs), Date.now())
          .first<{
            payload: string;
          }>();
        return json({ preferences: JSON.parse(saved!.payload) });
      }
      // Load only entities, replay candidates and the date range needed for reconciliation.
      const importedRange =
        action.startsWith("import/") && typeof body.text === "string"
          ? parseStatement(body.text, body.format)
          : [];
      const dates = importedRange.map((r) => r.date).sort();
      const lower = dates.length
        ? new Date(Date.parse(dates[0]) - 3 * 86400000)
            .toISOString()
            .slice(0, 10)
        : "9999-01-01";
      const upper = dates.length
        ? new Date(Date.parse(dates.at(-1)!) + 3 * 86400000)
            .toISOString()
            .slice(0, 10)
        : "0000-01-01";
      const replay = String(body.requestId || ""),
        hash = await digest(u.id + "|" + replay);
      const rows = await db()
        .prepare(
          "SELECT payload,updated FROM records WHERE user_id=? AND (kind<>'transaction' OR id=? OR id=? OR payload::jsonb->>'installmentGroup'=? OR (account_id=? AND record_date>=? AND record_date<=?)) ORDER BY updated",
        )
        .bind(
          u.id,
          "wallet-" + hash,
          "transfer-" + hash,
          replay,
          String(body.accountId || ""),
          lower,
          upper,
        )
        .all<{ payload: string; updated: number }>();
      const entries = rows.results.map((r) => ({
        ...JSON.parse(r.payload),
        _version: r.updated,
      })) as (Entry & { _version: number })[];
      if (action === "wallet") {
        const currency = String(body.currency || "BRL"),
          originalInitial = Number(body.initial);
        if (
          !currencies.includes(currency as (typeof currencies)[number]) ||
          !Number.isSafeInteger(originalInitial) ||
          Math.abs(originalInitial) > 99999999999
        )
          return fail("Informe moeda e saldo válidos.");
        const requestId = String(body.requestId || crypto.randomUUID());
        if (!/^[0-9a-f-]{36}$/.test(requestId)) return fail("Pedido inválido.");
        const id = "wallet-" + (await digest(u.id + "|" + requestId)),
          previous = entries.find((e) => e.id === id);
        if (previous) return json({ entry: previous, replayed: true });
        const q = await quote(currency);
        const e = {
          id,
          kind: "account",
          amount: 0,
          name: String(body.name || ""),
          accountType: body.accountType || "checking",
          currency,
          originalInitial,
          initial: Math.round(originalInitial * q.rate),
          fxRate: q.rate,
          fxDate: q.date,
          color: "#357c67",
        };
        const valid = entrySchema.safeParse(e);
        if (!valid.success) return fail("Dados da carteira inválidos.");
        await db()
          .prepare(
            "INSERT INTO records (id,user_id,kind,payload,updated) VALUES (?,?,?,?,?)",
          )
          .bind(e.id, u.id, e.kind, JSON.stringify(valid.data), Date.now())
          .run();
        return json({ entry: e }, 201);
      }
      if (action === "currency-transfer") {
        const source = entries.find(
            (e) => e.id === body.accountId && e.kind === "account",
          ),
          target = entries.find(
            (e) =>
              e.id === body.targetId && ["account", "card"].includes(e.kind),
          );
        if (!source || !target || source.id === target.id)
          return fail("Selecione duas contas diferentes.");
        const amount = Number(body.amount),
          received = Number(body.targetOriginalAmount);
        if (
          !Number.isSafeInteger(amount) ||
          !Number.isSafeInteger(received) ||
          amount <= 0 ||
          received <= 0 ||
          amount > 99999999999 ||
          received > 99999999999
        )
          return fail("Valores inválidos.");
        const date = String(body.date || "");
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date
        )
          return fail("Data inválida.");
        const group = String(body.requestId || "");
        if (!/^[0-9a-f-]{36}$/.test(group)) return fail("Pedido inválido.");
        const id = "transfer-" + (await digest(u.id + "|" + group)),
          previous = entries.find((e) => e.id === id);
        if (previous) return json({ entry: previous, replayed: true });
        const [a, b] = await Promise.all([
          quote(source.currency || "BRL", date),
          quote(target.currency || "BRL", date),
        ]);
        const entry = {
          id,
          kind: "transaction",
          type: "transfer",
          name: String(body.name || "Transferência"),
          date,
          amount: Math.round(amount * a.rate),
          originalAmount: amount,
          currency: source.currency || "BRL",
          targetAmount: Math.round(received * b.rate),
          targetOriginalAmount: received,
          targetCurrency: target.currency || "BRL",
          accountId: source.id,
          targetId: target.id,
          status: body.status === "pending" ? "pending" : "paid",
          fxRate: a.rate,
          fxDate: a.date,
        };
        const valid = entrySchema.safeParse(entry);
        if (!valid.success) return fail("Transferência inválida.");
        await db()
          .prepare(
            "INSERT INTO records (id,user_id,kind,payload,updated,account_id,target_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(
            id,
            u.id,
            "transaction",
            JSON.stringify(valid.data),
            Date.now(),
            source.id,
            target.id,
          )
          .run();
        return json({ entry: valid.data }, 201);
      }
      if (action === "installments" || action === "currency-transaction") {
        const account = entries.find(
          (e) =>
            e.id === body.accountId && ["account", "card"].includes(e.kind),
        );
        if (!account) return fail("Conta não encontrada.");
        const currency = String(body.currency || account.currency || "BRL");
        if (currency !== (account.currency || "BRL"))
          return fail("Use a moeda da conta selecionada.");
        const originalAmount = Number(body.amount),
          count = action === "installments" ? Number(body.count) : 1;
        if (
          !Number.isSafeInteger(originalAmount) ||
          originalAmount <= 0 ||
          originalAmount > 99999999999 ||
          !Number.isInteger(count) ||
          count < 1 ||
          count > 120 ||
          originalAmount < count
        )
          return fail("Valor ou parcelas inválidos.");
        if (
          typeof body.date !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
          !Number.isFinite(Date.parse(body.date)) ||
          new Date(body.date).toISOString().slice(0, 10) !== body.date
        )
          return fail("Data inválida.");
        const q = await quote(currency, String(body.date || localDate())),
          total = Math.round(originalAmount * q.rate),
          parts = split(total, count),
          nativeParts = split(originalAmount, count),
          group = String(body.requestId || "");
        if (!/^[0-9a-f-]{36}$/.test(group))
          return fail("Identificador do pedido inválido.");
        const ownerGroup = await digest(u.id + "|" + group);
        const batch = parts.map((amount, index) => ({
          id: "batch-" + ownerGroup + "-" + index,
          kind: "transaction",
          name:
            String(body.name || "") +
            (count > 1 ? ` (${index + 1}/${count})` : ""),
          amount,
          originalAmount: nativeParts[index],
          currency,
          fxRate: q.rate,
          fxDate: q.date,
          type: body.type === "income" ? "income" : "expense",
          accountId: account.id,
          date: installmentDate(String(body.date || ""), index),
          status:
            index === 0
              ? body.status === "pending"
                ? "pending"
                : "paid"
              : "pending",
          category: String(body.category || "Outros"),
          subcategory: String(body.subcategory || ""),
          tags: body.tags || [],
          costCenter: String(body.costCenter || ""),
          installmentGroup: group,
          installmentIndex: index + 1,
          installments: count,
        }));
        if (batch.some((e) => !entrySchema.safeParse(e).success))
          return fail("Dados dos lançamentos inválidos.");
        const existing = entries.filter((e) => e.installmentGroup === group);
        if (existing.length) return json({ entries: existing, replayed: true });
        const statements = batch.map((e) =>
          db()
            .prepare(
              "INSERT INTO records (id,user_id,kind,payload,updated,account_id) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
            )
            .bind(
              e.id,
              u.id,
              e.kind,
              JSON.stringify(e),
              Date.now(),
              account.id,
            ),
        );
        await db().batch(statements);
        return json({ entries: batch }, 201);
      }
      if (action === "import/preview" || action === "import/commit") {
        const account = entries.find(
          (e) =>
            e.id === body.accountId && ["account", "card"].includes(e.kind),
        );
        if (!account) return fail("Conta não encontrada.");
        if ((account.currency || "BRL") !== "BRL")
          return fail(
            "Conciliação de extratos disponível para contas em reais.",
          );
        if (
          typeof body.text !== "string" ||
          !["csv", "ofx"].includes(body.format)
        )
          return fail("Escolha um arquivo OFX ou CSV.");
        const imported = parseStatement(body.text, body.format);
        const { rules } = await listRules(u.id);
        const occurrences = new Map<string, number>();
        const trackedRows = await db()
          .prepare(
            "SELECT key FROM reconciliation_keys WHERE user_id=? AND account_id=?",
          )
          .bind(u.id, account.id)
          .all<{
            key: string;
          }>();
        const trackedKeys = new Set(trackedRows.results.map((x) => x.key));
        const preview = await Promise.all(
          imported.map(async (x, index) => {
            const canonical =
              x.date + "|" + x.type + "|" + x.amount + "|" + x.name;
            const occurrence = occurrences.get(canonical) || 0;
            occurrences.set(canonical, occurrence + 1);
            const key = await digest(
              u.id +
                "|" +
                account.id +
                "|" +
                (x.key
                  ? "fitid:" + x.key
                  : "csv:" + canonical + "|" + occurrence),
            );
            const candidates = entries
              .filter(
                (e) =>
                  e.kind === "transaction" &&
                  e.accountId === account.id &&
                  e.type === x.type &&
                  e.amount === x.amount &&
                  Math.abs(Date.parse(e.date!) - Date.parse(x.date)) <=
                    3 * 86400000 &&
                  !e.reconciled,
              )
              .map((e) => ({
                id: e.id,
                name: e.name,
                date: e.date,
                version: e._version,
              }));
            return {
              ...x,
              ...(classify(x.name, rules as never[]) || {}),
              index,
              key,
              duplicate: trackedKeys.has(key),
              candidates,
              matchId: candidates.length === 1 ? candidates[0].id : "",
            };
          }),
        );
        if (action === "import/preview") return json({ rows: preview });
        if (
          !Array.isArray(body.decisions) ||
          body.decisions.length !== preview.length
        )
          return fail("Revise todos os lançamentos antes de confirmar.");
        const client = await postgres().connect();
        let importedCount = 0,
          matched = 0,
          skipped = 0;
        try {
          if (
            process.env.WZY_TEST_SCHEMA &&
            (await client.query("SELECT current_schema() AS schema")).rows[0]
              .schema !== process.env.WZY_TEST_SCHEMA
          )
            throw Error("TEST_SCHEMA_ISOLATION_FAILED");
          await client.query("BEGIN");
          await setDatabaseContext(client);
          await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            u.id,
          ]);
          const owned = await client.query(
            "SELECT id FROM records WHERE id=$1 AND user_id=$2 FOR UPDATE",
            [account.id, u.id],
          );
          if (!owned.rows.length)
            throw Error("A conta mudou. Atualize antes de importar.");
          const lockedRows = await client.query(
            "SELECT id,payload,updated FROM records WHERE user_id=$1 AND account_id=$2 FOR UPDATE",
            [u.id, account.id],
          );
          const locked = new Map(lockedRows.rows.map((r) => [r.id, r]));
          const keys = await client.query(
            "SELECT key FROM reconciliation_keys WHERE user_id=$1 AND account_id=$2",
            [u.id, account.id],
          );
          const known = new Set(keys.rows.map((r) => r.key));
          const newRecords: {
              id: string;
              payload: string;
            }[] = [],
            updates: {
              id: string;
              payload: string;
            }[] = [],
            mappings: {
              key: string;
              record_id: string;
            }[] = [];
          const seenMatches = new Set<string>();
          for (const row of preview) {
            const decision = body.decisions[row.index];
            if (
              !decision ||
              !["skip", "new", "match"].includes(decision.action)
            )
              throw Error("Decisão inválida.");
            if (known.has(row.key) || decision.action === "skip") {
              skipped++;
              continue;
            }
            let id: string;
            if (decision.action === "match") {
              id = String(decision.id || "");
              if (seenMatches.has(id))
                throw Error("Um lançamento não pode conciliar duas linhas.");
              seenMatches.add(id);
              const found = locked.get(id);
              if (!found) throw Error("Lançamento não encontrado.");
              const e = JSON.parse(found.payload) as Entry;
              if (
                e.accountId !== account.id ||
                e.kind !== "transaction" ||
                e.type !== row.type ||
                e.amount !== row.amount ||
                e.reconciled ||
                Math.abs(Date.parse(e.date!) - Date.parse(row.date)) >
                  3 * 86400000 ||
                Number(found.updated) !== Number(decision.version)
              )
                throw Error("O lançamento mudou. Revise a conciliação.");
              updates.push({
                id,
                payload: JSON.stringify({
                  ...e,
                  reconciled: true,
                  importKey: row.key,
                  status: "paid",
                }),
              });
              matched++;
            } else {
              id = "import-" + row.key;
              const e: Entry = {
                id,
                kind: "transaction",
                name: row.name,
                date: row.date,
                type: row.type,
                amount: row.amount,
                status: "paid",
                accountId: account.id,
                category: row.category || "Outros",
                subcategory: row.subcategory || undefined,
                ...(account.kind === "card"
                  ? { invoiceCycle: invoiceCycle(account, row.date) }
                  : {}),
                reconciled: true,
                importKey: row.key,
              };
              newRecords.push({ id, payload: JSON.stringify(e) });
              importedCount++;
            }
            mappings.push({ key: row.key, record_id: id });
            known.add(row.key);
          }
          if (newRecords.length)
            await client.query(
              "INSERT INTO records (id,user_id,kind,payload,updated,account_id) SELECT x.id,$1,'transaction',x.payload,$2,$3 FROM jsonb_to_recordset($4::jsonb) AS x(id text,payload text)",
              [u.id, Date.now(), account.id, JSON.stringify(newRecords)],
            );
          if (updates.length)
            await client.query(
              "UPDATE records r SET payload=x.payload,updated=$2 FROM jsonb_to_recordset($3::jsonb) AS x(id text,payload text) WHERE r.id=x.id AND r.user_id=$1",
              [u.id, Date.now(), JSON.stringify(updates)],
            );
          if (mappings.length)
            await client.query(
              "INSERT INTO reconciliation_keys (key,user_id,account_id,record_id) SELECT x.key,$1,$2,x.record_id FROM jsonb_to_recordset($3::jsonb) AS x(key text,record_id text)",
              [u.id, account.id, JSON.stringify(mappings)],
            );
          await client.query("COMMIT");
          return json({ imported: importedCount, matched, skipped });
        } catch (e) {
          await client.query("ROLLBACK");
          if (
            e instanceof Error &&
            /mudou|concilia|encontrado|inválida/.test(e.message)
          )
            return fail(e.message, 409);
          throw e;
        } finally {
          client.release();
        }
      }
      return fail("Página não encontrada.", 404);
    });
  } catch (e) {
    const message = String(e);
    if (message.includes("RATE_LIMIT"))
      return fail("Muitas tentativas. Aguarde.", 429);
    if (message.includes("CURRENCY_UNAVAILABLE"))
      return fail(
        "A cotação está indisponível. Nenhum valor foi salvo. Tente novamente.",
        503,
      );
    if (message.includes("CURRENCY_INVALID"))
      return fail("Moeda ou data inválida.");
    if (e instanceof SyntaxError) return fail("Pedido inválido.");
    if (
      e instanceof Error &&
      /extrato|CSV|Importe|Entidades|Aspas/.test(e.message)
    )
      return fail(e.message);
    console.error(
      "Finance operation failed",
      e instanceof Error ? e.name : "Error",
    );
    return fail("Não foi possível concluir. Tente novamente.", 500);
  }
}

export const GET = observe(handleGET);
export const POST = observe(handlePOST);
