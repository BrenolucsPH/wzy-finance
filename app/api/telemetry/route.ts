import { db, session, rate } from "../../../lib/server";
import { localDate } from "../../../lib/finance";
import { withOwner } from "../../../lib/database-context";
import { recordProductEvent } from "../../../lib/product-metrics";
export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return Response.json({ error: "Origem inválida." }, { status: 403 });
  const user = await session(req);
  if (!user)
    return Response.json({ error: "Entre na sua conta." }, { status: 401 });
  try {
    return await withOwner(user.id, async () => {
      await rate(req, "telemetry", user.id, 20);
      const raw = await req.text();
      if (raw.length > 200) throw Error();
      const body = JSON.parse(raw);
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.event !== "string"
      )
        throw Error();
      if (body.event === "render_error")
        await db()
          .prepare(
            "INSERT INTO operation_events(created,request_id,route,status,duration_ms,code,user_id) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(
            Date.now(),
            crypto.randomUUID(),
            "interface",
            500,
            0,
            "RENDER_ERROR",
            user.id,
          )
          .run();
      else if (["visit", "onboarding_finished"].includes(body.event))
        await recordProductEvent(user.id, body.event, localDate(user.timezone));
      return Response.json({ ok: true });
    });
  } catch {
    return Response.json({ error: "Evento indisponível." }, { status: 400 });
  }
}
