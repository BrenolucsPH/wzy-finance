import { dailyMaintenance } from "../../../../lib/modules/backups/maintenance";
import { observe } from "../../../../lib/observability";
import { withSystem } from "../../../../lib/database-context";
import { session, isAdministrator } from "../../../../lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
async function run(req: Request) {
  const authorized =
    !!process.env.CRON_SECRET &&
    req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!authorized) {
    if (
      req.method !== "POST" ||
      req.headers.get("origin") !== new URL(req.url).origin
    )
      return Response.json(
        { error: "Acesso não autorizado." },
        { status: 401 },
      );
    const u = await session(req);
    if (!u || !isAdministrator(u) || !u.mfa)
      return Response.json(
        { error: "Acesso não autorizado." },
        { status: 403 },
      );
  }
  const result = await dailyMaintenance();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
async function handleGET(req: Request) {
  try {
    return await withSystem(() => run(req));
  } catch (e) {
    console.error(
      "Daily maintenance failed",
      e instanceof Error ? e.name : "Error",
    );
    return Response.json(
      { error: "A rotina não terminou. Tente novamente." },
      { status: 500 },
    );
  }
}
async function handlePOST(req: Request) {
  return handleGET(req);
}

export const GET = observe(handleGET);
export const POST = observe(handlePOST);
