import { intelligenceSnapshot } from "../../../../lib/modules/workspace/insights";
import { financialAnswer } from "../../../../lib/modules/workspace/intelligence";
import {
  inviteMember,
  acceptInvite,
  sharedGroups,
  groupMembers,
  revokeMember,
  sharedPayment,
} from "../../../../lib/modules/workspace/collaboration";
import {
  portfolio,
  createPosition,
  investmentOperation,
  reverseInvestment,
} from "../../../../lib/modules/workspace/portfolio";
import { session, rate, db } from "../../../../lib/server";
import { observe } from "../../../../lib/observability";
import { withOwner } from "../../../../lib/database-context";
import {
  workspaceSnapshot,
  pagedTransactions,
} from "../../../../lib/modules/records/read-model";
import {
  listCategories,
  saveCategory,
  listRules,
  saveRule,
} from "../../../../lib/modules/workspace/categories";
import {
  cardInvoices,
  closeInvoice,
  payInvoice,
  adjustInvoice,
} from "../../../../lib/modules/workspace/invoices";
import {
  InputError,
  month,
  parse,
} from "../../../../lib/modules/workspace/common";
import { localDate } from "../../../../lib/finance";
import { ZodError } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  if (!["GET", "POST"].includes(req.method))
    return Response.json({ error: "Método inválido." }, { status: 405 });
  if (
    req.method === "POST" &&
    req.headers.get("origin") !== new URL(req.url).origin
  )
    return Response.json({ error: "Origem inválida." }, { status: 403 });
  const user = await session(req);
  if (!user)
    return Response.json({ error: "Entre na sua conta." }, { status: 401 });
  const url = new URL(req.url),
    action = url.pathname.split("/").slice(3).join("/");
  try {
    return await withOwner(user.id, async () => {
      let result: unknown;
      if (req.method === "GET") {
        if (action === "insights")
          result = await intelligenceSnapshot(
            user.id,
            parse(
              month,
              url.searchParams.get("month") || localDate().slice(0, 7),
            ),
          );
        else if (action === "groups/shared") result = await sharedGroups(user);
        else if (action === "groups/members")
          result = await groupMembers(
            user.id,
            url.searchParams.get("group") || "",
          );
        else if (action === "snapshot")
          result = await workspaceSnapshot(
            user.id,
            parse(
              month,
              url.searchParams.get("month") ||
                localDate(user.timezone).slice(0, 7),
            ),
          );
        else if (action === "transactions")
          result = await pagedTransactions(user.id, url);
        else if (action === "categories")
          result = await listCategories(user.id);
        else if (action === "portfolio") result = await portfolio(user.id);
        else if (action === "rules") result = await listRules(user.id);
        else if (action === "invoices")
          result = await cardInvoices(
            user.id,
            url.searchParams.get("card") || "",
          );
        else if (action === "history") {
          const record = url.searchParams.get("record") || "";
          result = {
            revisions: (
              await db()
                .prepare(
                  "SELECT id,operation,before_payload,after_payload,created,request_id FROM financial_revisions WHERE user_id=? AND record_id=? ORDER BY id DESC LIMIT 100",
                )
                .bind(user.id, record)
                .all()
            ).results,
          };
        } else throw new InputError("Página não encontrada.", 404);
      } else {
        await rate(req, "workspace", user.id, 60);
        const raw = await req.text();
        if (raw.length > 50000)
          throw new InputError("Conteúdo muito grande.", 413);
        const body = JSON.parse(raw || "{}");
        if (action === "assistant")
          result = await financialAnswer(user.id, body);
        else if (action === "groups/invite")
          result = await inviteMember(user.id, body, url.origin);
        else if (action === "groups/accept")
          result = await acceptInvite(user, body);
        else if (action === "groups/revoke")
          result = await revokeMember(user.id, body);
        else if (action === "groups/payment")
          result = await sharedPayment(user, body);
        else if (action === "investment/position")
          result = await createPosition(user.id, body);
        else if (action === "investment/operation")
          result = await investmentOperation(user.id, body);
        else if (action === "investment/reverse")
          result = await reverseInvestment(user.id, body);
        else if (action === "category")
          result = await saveCategory(user.id, body);
        else if (action === "rule") result = await saveRule(user.id, body);
        else if (action === "invoice/close")
          result = await closeInvoice(user.id, body);
        else if (action === "invoice/pay")
          result = await payInvoice(user.id, body);
        else if (action === "invoice/adjust")
          result = await adjustInvoice(user.id, body);
        else throw new InputError("Operação não encontrada.", 404);
      }
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505")
      return Response.json(
        {
          error:
            "Já existe um registro com estes dados. Revise antes de salvar.",
        },
        { status: 409 },
      );
    if (error instanceof InputError)
      return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError || error instanceof ZodError)
      return Response.json({ error: "Dados inválidos." }, { status: 400 });
    if (String(error).includes("RATE_LIMIT"))
      return Response.json(
        { error: "Aguarde antes de tentar novamente." },
        { status: 429 },
      );
    throw error;
  }
}
export const GET = observe(handle);
export const POST = observe(handle);
