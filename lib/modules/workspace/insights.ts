import { db } from "../../server";
import { workspaceSnapshot } from "../records/read-model";
import { insights, health, monthShift } from "../../planning";
import type { Entry } from "../../finance";
export async function intelligenceSnapshot(owner: string, month: string) {
  const snapshot = await workspaceSnapshot(owner, month),
    start = month + "-01",
    end = monthShift(month, 1) + "-01";
  const duplicates = await db()
    .prepare(
      "SELECT MIN(id) AS id,json_agg(payload::jsonb || jsonb_build_object('_version',updated)) AS records FROM records WHERE user_id=? AND kind='transaction' AND record_type='expense' AND record_date>=? AND record_date<? GROUP BY account_id,record_date,amount_cents,LOWER(TRIM(payload::jsonb->>'name')) HAVING COUNT(*)>1 LIMIT 30",
    )
    .bind(owner, start, end)
    .all<{ id: string; records: Entry[] }>();
  const outliers = await db()
    .prepare(
      "WITH typical AS (SELECT category,percentile_cont(0.5) WITHIN GROUP(ORDER BY amount_cents) AS median FROM records WHERE user_id=? AND kind='transaction' AND record_type='expense' AND record_date>=? AND record_date<? GROUP BY category HAVING COUNT(*)>=5) SELECT r.payload,r.updated FROM records r JOIN typical t ON r.category=t.category WHERE r.user_id=? AND r.kind='transaction' AND r.record_type='expense' AND r.record_date>=? AND r.record_date<? AND t.median>0 AND r.amount_cents>t.median*3 LIMIT 30",
    )
    .bind(owner, monthShift(month, -3) + "-01", start, owner, start, end)
    .all<{ payload: string; updated: number }>();
  return {
    insights: insights(snapshot.entries, month),
    score: health(snapshot.entries, month),
    findings: [
      ...duplicates.results.map((r) => ({
        id: "duplicate-" + r.id,
        message:
          "Possível duplicidade: mesma data, conta, descrição e valor. Confira os registros.",
        entry: r.records[0],
      })),
      ...outliers.results.map((r) => ({
        id: "outlier-" + JSON.parse(r.payload).id,
        message:
          "Valor acima de três vezes a mediana da categoria nos três meses anteriores. Não confirma fraude.",
        entry: { ...JSON.parse(r.payload), _version: r.updated },
      })),
    ].slice(0, 30),
  };
}
