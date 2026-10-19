import { db, runtime, digest, type User } from "../../server";
import { withOwner } from "../../database-context";
import { entrySchema } from "../../validation";
import type { Entry } from "../../finance";
import { canonical } from "../workspace/common";
import { invoiceCycle } from "../../domain/invoices";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status = 400) => json({ error }, status);
export async function handleRecords(
  req: Request,
  u: User,
  path: string,
  method: string,
  body: Record<string, unknown>,
) {
  return withOwner(u.id, async () => {
    if (path === "records" && method === "GET") {
      const rows = await db()
        .prepare(
          "SELECT payload,updated FROM records WHERE user_id=? ORDER BY updated ASC",
        )
        .bind(u.id)
        .all<{
          payload: string;
          updated: number;
        }>();
      return json({
        entries: rows.results.map((r) => ({
          ...JSON.parse(r.payload),
          _version: r.updated,
        })),
      });
    }
    async function getEntry(id: string) {
      const row = await db()
        .prepare("SELECT * FROM records WHERE user_id=? AND id=?")
        .bind(u!.id, id)
        .first<{
          payload: string;
          updated: number;
          kind: string;
        }>();
      return row
        ? ({ ...JSON.parse(row.payload), _version: row.updated } as Entry & {
            _version: number;
          })
        : null;
    }
    if (path === "records" && method === "POST") {
      const parsed = entrySchema.safeParse(body);
      if (!parsed.success)
        return fail(parsed.error.issues[0]?.message || "Dados inválidos.");
      const e = parsed.data;
      if (
        e.financialActivity ||
        e.investmentPosition ||
        e.adjustmentReason ||
        e.reversalOf ||
        e.invoicePaymentCycle
      )
        return fail(
          "Use a tela de investimentos ou faturas para esta operação.",
          409,
        );
      for (const id of [e.accountId, e.targetId]) {
        if (id) {
          const a = await getEntry(id);
          if (!a || !["account", "card"].includes(a.kind))
            return fail("Conta inválida.");
        }
      }
      if (e.attachmentId) {
        const f = await db()
          .prepare("SELECT id FROM files WHERE id=? AND user_id=?")
          .bind(e.attachmentId, u.id)
          .first();
        if (!f) return fail("Comprovante inválido.");
      }
      const old = await getEntry(e.id);
      if (
        !old &&
        e.kind === "transaction" &&
        (!e.category || e.category === "Outros")
      ) {
        const { listRules } = await import("../workspace/categories");
        const { classify } = await import("../../domain/classification");
        const { rules } = await listRules(u.id);
        Object.assign(e, classify(e.name, rules as never[]) || {});
      }
      if (old?.invoiceCycle) {
        const closed = await db()
          .prepare(
            "SELECT id FROM invoice_cycles WHERE user_id=? AND card_id=? AND cycle=? AND status='closed'",
          )
          .bind(u.id, old.accountId, old.invoiceCycle)
          .first();
        if (
          closed &&
          ["amount", "date", "type", "status", "accountId", "targetId"].some(
            (k) =>
              JSON.stringify(old[k as keyof Entry]) !==
              JSON.stringify((e as Entry)[k as keyof Entry]),
          )
        )
          return fail("Fatura fechada. Registre um ajuste ou estorno.", 409);
      }
      if (
        old &&
        ((old.currency && old.currency !== "BRL") ||
          (old.targetCurrency && old.targetCurrency !== "BRL"))
      ) {
        if (
          [
            "amount",
            "initial",
            "currency",
            "originalAmount",
            "originalInitial",
            "fxRate",
            "fxDate",
            "accountId",
            "targetId",
            "targetAmount",
            "targetOriginalAmount",
            "targetCurrency",
            "date",
            "type",
          ].some(
            (key) =>
              JSON.stringify(
                (old as unknown as Record<string, unknown>)[key],
              ) !==
              JSON.stringify((e as unknown as Record<string, unknown>)[key]),
          )
        )
          return fail(
            "Para alterar valores em moeda estrangeira, exclua e refaça o lançamento em Moedas e parcelas.",
          );
      } else if (
        !old &&
        ((e.currency && e.currency !== "BRL") ||
          (e.accountId &&
            (await getEntry(e.accountId))?.currency &&
            (await getEntry(e.accountId))?.currency !== "BRL") ||
          (e.targetId &&
            (await getEntry(e.targetId))?.currency &&
            (await getEntry(e.targetId))?.currency !== "BRL"))
      )
        return fail("Use Moedas e parcelas para contas em moeda estrangeira.");
      if (e.currency === "BRL" && e.originalAmount !== undefined)
        e.originalAmount = e.amount;
      if (e.currency === "BRL" && e.originalInitial !== undefined)
        e.originalInitial = e.initial;
      if (old?.sourceId) return fail("Use o pagamento na conta de origem.");
      if (e.sourceId) return fail("Origem inválida.");
      if (old && old.kind !== e.kind) return fail("Tipo de registro inválido.");
      if (
        !old &&
        (e.kind === "account" || e.kind === "card") &&
        e.name.trim() === ""
      )
        return fail("Informe o nome.");
      if (
        old &&
        e.kind === "group" &&
        (JSON.stringify(e.members) !== JSON.stringify(old.members) ||
          JSON.stringify(e.members?.map((m) => e.memberWeights?.[m] || 1)) !==
            JSON.stringify(
              old.members?.map((m) => old.memberWeights?.[m] || 1),
            )) &&
        Object.values(old.payments || {}).some((a) => a.length)
      )
        return fail(
          "Crie outro grupo para alterar os participantes e preservar o histórico.",
        );
      if (e.kind === "transaction" && e.accountId) {
        const account = await getEntry(e.accountId);
        if (account?.kind === "card" && e.type !== "transfer") {
          e.invoiceCycle =
            old &&
            old.accountId === e.accountId &&
            old.date === e.date &&
            old.invoiceCycle
              ? old.invoiceCycle
              : invoiceCycle(account, e.date!);
          if (old?.invoiceCycle) {
            const locked = await db()
              .prepare(
                "SELECT id FROM invoice_cycles WHERE user_id=? AND card_id=? AND cycle=? AND status=?",
              )
              .bind(u.id, old.accountId, old.invoiceCycle, "closed")
              .first();
            if (
              locked &&
              (old.amount !== e.amount ||
                old.date !== e.date ||
                old.accountId !== e.accountId ||
                old.status !== e.status)
            )
              return fail(
                "Fatura fechada. Registre um ajuste ou estorno.",
                409,
              );
          }
          const closed = await db()
            .prepare(
              "SELECT id FROM invoice_cycles WHERE user_id=? AND card_id=? AND cycle=? AND status=?",
            )
            .bind(u.id, account.id, e.invoiceCycle, "closed")
            .first();
          if (
            closed &&
            (!old ||
              old.amount !== e.amount ||
              old.date !== e.date ||
              old.accountId !== e.accountId)
          )
            return fail(
              "Fatura fechada. Registre um ajuste ou estorno na tela de faturas.",
              409,
            );
        }
      }
      if (old && canonical(entrySchema.parse(old)) === canonical(e))
        return json({ entry: old, replayed: true });
      if (
        old &&
        body._version !== old._version &&
        !(
          body._version === undefined &&
          canonical(entrySchema.parse(old)) === canonical(e)
        )
      )
        return fail(
          "Este registro mudou em outro dispositivo. Atualize a página antes de editar.",
          409,
        );
      const now = Math.max(Date.now(), (old?._version || 0) + 1);
      if (old) {
        const result = await db()
          .prepare(
            "UPDATE records SET payload=?,updated=?,account_id=?,target_id=?,attachment_id=? WHERE id=? AND user_id=? AND updated=?",
          )
          .bind(
            JSON.stringify(e),
            now,
            e.accountId || null,
            e.targetId || null,
            e.attachmentId || null,
            e.id,
            u.id,
            old._version,
          )
          .lockUser(u.id)
          .run();
        if (!result.meta.changes)
          return fail("Registro alterado em outro dispositivo.", 409);
      } else
        await db()
          .prepare(
            "INSERT INTO records (id,user_id,kind,payload,updated,account_id,target_id,attachment_id) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            e.id,
            u.id,
            e.kind,
            JSON.stringify(e),
            now,
            e.accountId || null,
            e.targetId || null,
            e.attachmentId || null,
          )
          .lockUser(u.id)
          .run();
      if (!old && ["account", "transaction"].includes(e.kind)) {
        try {
          const { recordProductEvent } = await import("../../product-metrics");
          await recordProductEvent(
            u.id,
            e.kind === "account" ? "first_account" : "first_transaction",
            new Date().toISOString().slice(0, 10),
          );
        } catch {
          /* Metrics never block financial writes. */
        }
      }
      return json({ entry: { ...e, _version: now } });
    }
    if (path.startsWith("records/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice(8));
      const e = await getEntry(id);
      if (
        e &&
        req.headers.get("if-match") &&
        Number(req.headers.get("if-match")) !== e._version
      )
        return fail(
          "O registro mudou em outro dispositivo. Revise antes de excluir.",
          409,
        );
      if (!e) return fail("Registro não encontrado.", 404);
      if (e.financialActivity || e.adjustmentReason || e.invoicePaymentCycle)
        return fail(
          "Esta operação possui histórico vinculado. Registre uma correção na tela de origem.",
          409,
        );
      if (e.sourceId)
        return fail("Pagamentos vinculados são preservados no histórico.");
      const linked = await db()
        .prepare(
          "SELECT id FROM records WHERE user_id=? AND (account_id=? OR target_id=? OR source_id=?) LIMIT 1",
        )
        .bind(u.id, id, id, id)
        .first();
      if (linked)
        return fail(
          "Este registro tem movimentações vinculadas. Preserve-o para manter o histórico.",
        );
      const deleted = await db()
        .prepare("DELETE FROM records WHERE id=? AND user_id=? AND updated=?")
        .bind(id, u.id, e._version)
        .lockUser(u.id)
        .run();
      if (!deleted.meta.changes)
        return fail("O registro mudou. Atualize antes de excluir.", 409);
      return json({ ok: true });
    }
    if (path === "pay") {
      const source = await getEntry(String(body.id));
      if (!source || !["recurring", "debt"].includes(source.kind))
        return fail("Conta não encontrada.");
      const month = String(body.month);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail("Mês inválido.");
      const account = await getEntry(
        String(body.accountId || source.accountId),
      );
      if (account?.currency && account.currency !== "BRL")
        return fail(
          "O pagamento de recorrências e dívidas cadastradas em reais precisa de uma conta em reais.",
        );
      if (!account || account.kind !== "account")
        return fail("Escolha a conta do pagamento.");
      let amount = source.amount;
      let paidCount = 0;
      if (source.kind === "debt") {
        const paid = await db()
          .prepare(
            "SELECT count(*) AS n FROM records WHERE user_id=? AND kind=? AND source_id=?",
          )
          .bind(u.id, "transaction", source.id)
          .first<{
            n: number;
          }>();
        const remaining =
          (source.installments || 1) -
          (source.paidInstallments || 0) -
          (paid?.n || 0);
        if (remaining <= 0) return fail("Dívida já quitada.");
        const i = (source.paidInstallments || 0) + (paid?.n || 0);
        paidCount = paid?.n || 0;
        amount =
          Math.floor(source.amount / (source.installments || 1)) +
          (i < source.amount % (source.installments || 1) ? 1 : 0);
      }
      const id = `pay-${await digest(u.id + source.id + month)}`;
      const e: Entry = {
        id,
        kind: "transaction",
        name: source.name,
        amount,
        date:
          typeof body.date === "string"
            ? body.date
            : new Date().toISOString().slice(0, 10),
        type: "expense",
        accountId: account.id,
        category: source.category || "Outros",
        status: "paid",
        sourceId: source.id,
        sourceMonth: month,
      };
      const valid = entrySchema.safeParse(e);
      if (!valid.success) return fail("Dados de pagamento inválidos.");
      const now = Date.now();
      const result = await db()
        .prepare(
          "INSERT INTO records (id,user_id,kind,payload,updated,account_id,source_id) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM records WHERE id=? AND user_id=? AND updated=?) AND (?<>'debt' OR (SELECT count(*) FROM records WHERE user_id=? AND source_id=?)=?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(
          id,
          u.id,
          "transaction",
          JSON.stringify(e),
          now,
          account.id,
          source.id,
          source.id,
          u.id,
          (
            source as Entry & {
              _version: number;
            }
          )._version,
          source.kind,
          u.id,
          source.id,
          paidCount,
        )
        .lockUser(u.id)
        .lockRecord(source.id, u.id)
        .run();
      if (!result.meta.changes)
        return fail(
          "Este vencimento já foi pago ou o registro mudou. Atualize os dados antes de continuar.",
          409,
        );
      return json({ entry: { ...e, _version: now } });
    }
    if (path === "files" && method === "GET") {
      const data = await db()
        .prepare(
          "SELECT id,name,type,size,created FROM files WHERE user_id=? ORDER BY created DESC",
        )
        .bind(u.id)
        .all();
      return json({ files: data.results });
    }
    if (path === "files" && method === "POST") {
      if (!runtime.BUCKET) return fail("Armazenamento indisponível.", 503);
      const existing = await db()
        .prepare(
          "SELECT COALESCE(sum(size),0) AS total FROM files WHERE user_id=?",
        )
        .bind(u.id)
        .first<{
          total: number;
        }>();
      if ((existing?.total || 0) > 100 * 1024 * 1024)
        return fail("Limite de armazenamento de 100 MB atingido.");
      if (Number(req.headers.get("content-length") || 0) > 11 * 1024 * 1024)
        return fail("Limite de 10 MB por arquivo.", 413);
      const form = await req.formData();
      const f = form.get("file");
      if (!(f instanceof File) || f.size > 10 * 1024 * 1024 || f.size === 0)
        return fail("Selecione um PDF, JPG ou PNG de até 10 MB.");
      const bytes = new Uint8Array(await f.arrayBuffer());
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
      if (!type) return fail("Formato não permitido. Use PDF, JPG ou PNG.");
      const id = crypto.randomUUID();
      const name = f.name.replace(/[\x00-\x1f]/g, "").slice(0, 150);
      await runtime.BUCKET.put(`${u.id}/${id}`, bytes, {
        httpMetadata: { contentType: type },
      });
      try {
        const saved = await db()
          .prepare(
            "INSERT INTO files (id,user_id,name,type,size,created) SELECT ?,?,?,?,?,? WHERE (SELECT COALESCE(sum(size),0) FROM files WHERE user_id=?)+?<=?",
          )
          .bind(
            id,
            u.id,
            name,
            type,
            f.size,
            Date.now(),
            u.id,
            f.size,
            100 * 1024 * 1024,
          )
          .reserveFile(u.id, f.size)
          .run();
        if (!saved.meta.changes) {
          await runtime.BUCKET.delete(`${u.id}/${id}`);
          return fail("Limite de armazenamento de 100 MB atingido.");
        }
      } catch (e) {
        await runtime.BUCKET.delete(`${u.id}/${id}`);
        throw e;
      }
      return json(
        { file: { id, name, type, size: f.size, created: Date.now() } },
        201,
      );
    }
    if (path.startsWith("files/") && method === "GET") {
      const id = path.slice(6);
      const f = await db()
        .prepare("SELECT * FROM files WHERE user_id=? AND id=?")
        .bind(u.id, id)
        .first<{
          name: string;
          type: string;
        }>();
      if (!f) return fail("Arquivo não encontrado.", 404);
      const object = await runtime.BUCKET.get(`${u.id}/${id}`);
      if (!object) return fail("Arquivo indisponível.", 404);
      return new Response(object.body, {
        headers: {
          "Content-Type": f.type,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return fail("Operação não encontrada.", 404);
  });
}
