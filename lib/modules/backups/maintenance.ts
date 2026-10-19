import { db, type User } from "../../server";
import { transaction } from "../../postgres";
import { backupUser } from "./archive";
import { localDate } from "../../finance";
import { dueReminders } from "./reminders";
export async function dailyMaintenance(
  options: { maxUsers?: number; timeBudget?: number; register?: boolean } = {},
) {
  const waiting =
    options.register === false
      ? await db()
          .prepare(
            "SELECT r.day FROM operations_runs r WHERE r.status IN ('pending','running','failed') AND r.lease_until<? AND EXISTS(SELECT 1 FROM maintenance_tasks t WHERE t.day=r.day AND t.status<>'completed' AND t.attempts<3) ORDER BY r.day LIMIT 1",
          )
          .bind(Date.now())
          .first<{ day: string }>()
      : null;
  if (options.register === false && !waiting)
    return { ok: true, backedUp: 0, failed: 0, sent: 0, remaining: 0 };
  const day = waiting?.day || localDate(),
    runId = crypto.randomUUID(),
    deadline = Date.now() + (options.timeBudget || 210000);
  const claimed = await transaction(async (client) => {
    await client.query(
      "INSERT INTO operations_runs(id,day,status,updated) VALUES($1,$2,'pending',$3) ON CONFLICT(day) DO NOTHING",
      [runId, day, Date.now()],
    );
    const run = (
      await client.query(
        "SELECT * FROM operations_runs WHERE day=$1 FOR UPDATE",
        [day],
      )
    ).rows[0];
    if (Number(run.lease_until) > Date.now()) return false;
    await client.query(
      "UPDATE operations_runs SET status='running',lease_until=$1,updated=$2 WHERE day=$3",
      [Date.now() + 240000, Date.now(), day],
    );
    return true;
  });
  if (!claimed) return { ok: true, running: true, day };
  let completed = 0,
    failed = 0;
  try {
    if (options.register !== false)
      await db()
        .prepare(
          "INSERT INTO maintenance_tasks(day,user_id,status,updated) SELECT ?,id,'pending',? FROM users WHERE disabled=0 ON CONFLICT(day,user_id) DO NOTHING",
        )
        .bind(day, Date.now())
        .run();
    const tasks = await db()
      .prepare(
        "SELECT t.user_id FROM maintenance_tasks t JOIN users u ON u.id=t.user_id WHERE t.day=? AND t.status<>'completed' AND t.attempts<3 AND u.disabled=0 ORDER BY t.user_id LIMIT ?",
      )
      .bind(day, options.maxUsers || 50)
      .all<{ user_id: string }>();
    for (const task of tasks.results) {
      if (Date.now() >= deadline) break;
      const user = await db()
        .prepare("SELECT id,name,email,timezone,disabled FROM users WHERE id=?")
        .bind(task.user_id)
        .first<User>();
      if (!user) continue;
      try {
        await backupUser(user, localDate(user.timezone));
        await dueReminders(user);
        await db()
          .prepare(
            "UPDATE maintenance_tasks SET status='completed',attempts=attempts+1,last_error='',updated=? WHERE day=? AND user_id=?",
          )
          .bind(Date.now(), day, user.id)
          .run();
        completed++;
      } catch (error) {
        const code = error instanceof Error ? error.message : "BACKUP_FAILED";
        await db()
          .prepare(
            "UPDATE maintenance_tasks SET status='failed',attempts=attempts+1,last_error=?,updated=? WHERE day=? AND user_id=?",
          )
          .bind(
            code === "BACKUP_STORAGE_BUDGET_REACHED" ? code : "BACKUP_FAILED",
            Date.now(),
            day,
            user.id,
          )
          .run();
        failed++;
      }
    }
    const counts = await db()
      .prepare(
        "SELECT COUNT(*) FILTER(WHERE status='completed') AS done,COUNT(*) FILTER(WHERE status<>'completed') AS remaining FROM maintenance_tasks WHERE day=?",
      )
      .bind(day)
      .first<{ done: string; remaining: string }>();
    await db()
      .prepare(
        "UPDATE operations_runs SET status=?,processed=?,failed=?,lease_until=0,updated=? WHERE day=?",
      )
      .bind(
        Number(counts?.remaining) ? "pending" : "completed",
        Number(counts?.done || 0),
        Number(counts?.remaining || 0),
        Date.now(),
        day,
      )
      .run();
    return {
      ok: true,
      day,
      backedUp: completed,
      failed,
      remaining: Number(counts?.remaining || 0),
    };
  } catch (error) {
    await db()
      .prepare(
        "UPDATE operations_runs SET status='failed',lease_until=0,updated=? WHERE day=?",
      )
      .bind(Date.now(), day)
      .run();
    throw error;
  }
}
