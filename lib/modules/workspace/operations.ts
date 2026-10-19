import { db, emailReady, smsReady } from "../../server";
export async function operationalHealth() {
  const [runs, failures, slow, archives, activation] = await Promise.all([
    db()
      .prepare(
        "SELECT day,status,processed,failed,updated,lease_until FROM operations_runs ORDER BY day DESC LIMIT 14",
      )
      .all(),
    db()
      .prepare(
        "SELECT request_id,route,status,duration_ms,code,created FROM operation_events WHERE status>=500 ORDER BY created DESC LIMIT 30",
      )
      .all(),
    db()
      .prepare(
        "SELECT route,COUNT(*) AS count,AVG(duration_ms)::int AS average_ms,MAX(duration_ms) AS maximum_ms FROM operation_events WHERE code=? AND created>? GROUP BY route ORDER BY maximum_ms DESC",
      )
      .bind("SLOW_REQUEST", Date.now() - 86400000)
      .all(),
    db()
      .prepare(
        "SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS total,MAX(created) AS last_backup FROM backup_archives",
      )
      .all(),
    db()
      .prepare(
        "SELECT event,day,COUNT(DISTINCT user_id) AS count FROM product_events WHERE created>? GROUP BY event,day ORDER BY day DESC",
      )
      .bind(Date.now() - 30 * 86400000)
      .all(),
  ]);
  return {
    runs: runs.results,
    failures: failures.results,
    slowRequests: slow.results,
    archives: archives.results[0],
    activation: activation.results,
    emailReady: emailReady(),
    smsReady: smsReady(),
    pushReady: !!(
      process.env.WZY_PUSH_PRIVATE_KEY && process.env.WZY_PUSH_PUBLIC_KEY
    ),
    limits: {
      perUserBackupBytes:
        Number(process.env.WZY_BACKUP_USER_LIMIT_BYTES) || 20 * 1024 * 1024,
      totalBackupBytes:
        Number(process.env.WZY_BACKUP_TOTAL_LIMIT_BYTES) || 128 * 1024 * 1024,
    },
    scope:
      "Os tempos persistidos representam pedidos lentos; os tempos de todos os pedidos estão nos logs estruturados. Métricas de uso são opcionais.",
  };
}
