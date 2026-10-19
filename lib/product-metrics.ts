import { db } from "./server";
export async function recordProductEvent(
  owner: string,
  event:
    "visit" | "first_account" | "first_transaction" | "onboarding_finished",
  day: string,
) {
  const row = await db()
    .prepare("SELECT payload FROM user_preferences WHERE user_id=?")
    .bind(owner)
    .first<{ payload: string }>();
  if (row && JSON.parse(row.payload).usageMetrics === true)
    await db()
      .prepare(
        "INSERT INTO product_events(user_id,event,day,created) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
      )
      .bind(owner, event, day, Date.now())
      .run();
}
