import webpush from "web-push";
import { db, type User } from "../../server";
import { workspaceSnapshot } from "../records/read-model";
import { calendar, dateShift } from "../../planning";
import { localDate } from "../../finance";
export async function dueReminders(user: User) {
  if (
    process.env.WZY_TEST_SCHEMA ||
    !process.env.WZY_PUSH_PRIVATE_KEY ||
    !process.env.WZY_PUSH_PUBLIC_KEY
  )
    return { sent: 0, failed: 0 };
  const today = localDate(user.timezone),
    snapshot = await workspaceSnapshot(user.id, today.slice(0, 7));
  if (
    !calendar(snapshot.entries, today, dateShift(today, 3)).some(
      (e) => e.type === "expense",
    )
  )
    return { sent: 0, failed: 0 };
  webpush.setVapidDetails(
    process.env.APP_ORIGIN || "https://example.com",
    process.env.WZY_PUSH_PUBLIC_KEY,
    process.env.WZY_PUSH_PRIVATE_KEY,
  );
  const subscriptions = await db()
    .prepare(
      "SELECT id,payload FROM push_subscriptions WHERE user_id=? AND last_day<>?",
    )
    .bind(user.id, today)
    .all<{ id: string; payload: string }>();
  let sent = 0,
    failed = 0;
  for (const subscription of subscriptions.results) {
    try {
      await webpush.sendNotification(
        JSON.parse(subscription.payload),
        JSON.stringify({
          body: "Você tem compromissos financeiros nos próximos dias. Confira o WZY.",
        }),
        { TTL: 86400 },
      );
      await db()
        .prepare(
          "UPDATE push_subscriptions SET last_day=? WHERE id=? AND user_id=?",
        )
        .bind(today, subscription.id, user.id)
        .run();
      sent++;
    } catch (error) {
      if (
        [404, 410].includes((error as { statusCode?: number }).statusCode || 0)
      )
        await db()
          .prepare("DELETE FROM push_subscriptions WHERE id=? AND user_id=?")
          .bind(subscription.id, user.id)
          .run();
      failed++;
    }
  }
  return { sent, failed };
}
