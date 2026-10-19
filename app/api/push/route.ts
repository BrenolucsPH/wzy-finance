import { observe } from "../../../lib/observability";
import { db, session, digest, rate } from "../../../lib/server";
export const dynamic = "force-dynamic";
async function handleGET(req: Request) {
  const u = await session(req);
  if (!u)
    return Response.json({ error: "Entre na sua conta." }, { status: 401 });
  return Response.json(
    { publicKey: process.env.WZY_PUSH_PUBLIC_KEY || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
async function handlePOST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return Response.json({ error: "Origem inválida." }, { status: 403 });
  const u = await session(req);
  if (!u)
    return Response.json({ error: "Entre na sua conta." }, { status: 401 });
  try {
    await rate(req, "push", u.id, 10);
    const raw = await req.text();
    if (raw.length > 10000) throw Error();
    const body = JSON.parse(raw);
    if (typeof body.endpoint !== "string" || body.endpoint.length > 2000)
      throw Error();
    const endpoint = new URL(body.endpoint);
    const allowed = [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
      "wns.windows.com",
    ];
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      !allowed.some(
        (h) => endpoint.hostname === h || endpoint.hostname.endsWith("." + h),
      )
    )
      throw Error();
    const id = await digest(body.endpoint);
    if (body.remove) {
      await db()
        .prepare("DELETE FROM push_subscriptions WHERE id=? AND user_id=?")
        .bind(id, u.id)
        .run();
      return Response.json({ message: "Notificações desativadas." });
    }
    if (!process.env.WZY_PUSH_PRIVATE_KEY || !process.env.WZY_PUSH_PUBLIC_KEY)
      return Response.json(
        { error: "Notificações ainda não configuradas." },
        { status: 503 },
      );
    if (
      !/^[A-Za-z0-9_-]{20,300}$/.test(body.keys?.p256dh || "") ||
      !/^[A-Za-z0-9_-]{10,100}$/.test(body.keys?.auth || "")
    )
      throw Error();
    await db()
      .prepare(
        "INSERT INTO push_subscriptions (id,user_id,payload,created) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,payload=excluded.payload",
      )
      .bind(
        id,
        u.id,
        JSON.stringify({ endpoint: body.endpoint, keys: body.keys }),
        Date.now(),
      )
      .run();
    return Response.json({
      message: "Notificações ativadas neste dispositivo.",
    });
  } catch {
    return Response.json(
      { error: "Não foi possível cadastrar as notificações." },
      { status: 400 },
    );
  }
}

export const GET = observe(handleGET);
export const POST = observe(handlePOST);
