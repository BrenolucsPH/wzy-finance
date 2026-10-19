import { entrySchema } from "../validation";
import type { Entry } from "../finance";
export type RestoreData = {
  format?: string;
  entries: unknown[];
  files?: {
    id: string;
    name: string;
    type: string;
    size: number;
    created: number;
  }[];
  preferences?: Record<string, unknown>;
  categories?: Record<string, unknown>[];
  rules?: Record<string, unknown>[];
  invoiceCycles?: Record<string, unknown>[];
  positions?: Record<string, unknown>[];
  investmentOperations?: Record<string, unknown>[];
  revisions?: Record<string, unknown>[];
};
export function restoreRecords(
  source: RestoreData,
  attachments: Record<string, string>,
  newId: () => string = () => crypto.randomUUID(),
) {
  if (
    !source ||
    !Array.isArray(source.entries) ||
    source.entries.length > 100000
  )
    throw Error("Exportação inválida ou acima de 100 mil registros.");
  const entries = source.entries.map((e) => entrySchema.parse(e));
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    throw Error("A exportação contém identificadores duplicados.");
  const operations = Object.fromEntries(
    (source.investmentOperations || []).map((o) => [String(o.id), newId()]),
  );
  const ids = new Map(entries.map((e) => [e.id, newId()]));
  for (const original of Object.keys(operations))
    for (const suffix of ["-cash", "-fees"])
      if (ids.has(original + suffix))
        ids.set(original + suffix, operations[original] + suffix);
  const positions = new Map(
    (source.positions || []).map((p) => [String(p.id), newId()]),
  );
  const normalized = entries.map((e) => {
    for (const reference of [e.accountId, e.targetId, e.sourceId])
      if (reference && !ids.has(reference))
        throw Error("A exportação contém uma conta ou origem ausente.");
    if (e.attachmentId && !attachments[e.attachmentId])
      throw Error(
        "Faltam comprovantes. Importe o ZIP completo ou envie os arquivos antes de restaurar.",
      );
    if (e.investmentPosition && !positions.has(e.investmentPosition))
      throw Error("Falta a posição de investimento vinculada.");
    return {
      ...e,
      id: ids.get(e.id)!,
      accountId: e.accountId ? ids.get(e.accountId) : undefined,
      targetId: e.targetId ? ids.get(e.targetId) : undefined,
      sourceId: e.sourceId ? ids.get(e.sourceId) : undefined,
      attachmentId: e.attachmentId ? attachments[e.attachmentId] : undefined,
      reversalOf: e.reversalOf ? ids.get(e.reversalOf) : undefined,
      investmentPosition: e.investmentPosition
        ? positions.get(e.investmentPosition)
        : undefined,
    } as Entry;
  });
  return {
    entries: normalized,
    ids: Object.fromEntries(ids),
    positions: Object.fromEntries(positions),
    operations,
  };
}
