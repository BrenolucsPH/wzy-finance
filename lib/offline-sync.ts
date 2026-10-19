import { api } from "./client";
import { saveVault, type OfflineSnapshot } from "./offline";
const comparable = (entry: Record<string, unknown>) =>
  JSON.stringify(
    Object.entries(entry)
      .filter(([key]) => !key.startsWith("_"))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
export async function synchronizeVault(
  snapshot: OfflineSnapshot,
  password: string,
  onProgress: (state: OfflineSnapshot) => void,
) {
  const call = (
    path: string,
    body?: unknown,
    method?: string,
    headers: Record<string, string> = {},
  ) => api(path, body, method, { ...headers, "X-WZY-Owner": snapshot.user.id });
  const me = await call("auth/me");
  if (!me.user || me.user.id !== snapshot.user.id)
    throw Error(
      "Entre na mesma conta para sincronizar. Sua fila local foi preservada.",
    );
  const current = await call("records"),
    known = new Map(current.entries.map((e) => [e.id, e]));
  let state = {
    ...snapshot,
    pending: [...snapshot.pending],
    changes: [...(snapshot.changes || [])],
  };
  async function checkpoint() {
    await saveVault(state, password);
    onProgress(state);
  }
  for (const entry of snapshot.pending) {
    const existing = known.get(entry.id);
    if (existing) {
      if (comparable(existing) !== comparable(entry))
        throw Error(
          "Conflito no lançamento " +
            entry.name +
            ". Revise a fila antes de continuar.",
        );
    } else {
      const saved = await call("records", entry);
      known.set(entry.id, saved.entry);
    }
    state = {
      ...state,
      pending: state.pending.filter((e) => e.id !== entry.id),
    };
    await checkpoint();
  }
  for (const change of snapshot.changes || []) {
    const existing = known.get(change.entry.id);
    if (change.operation === "delete") {
      if (existing) {
        if (existing._version !== change.baseVersion)
          throw Error(
            "O registro " +
              change.entry.name +
              " mudou em outro dispositivo. A exclusão local foi preservada para revisão.",
          );
        await call(
          "records/" + encodeURIComponent(change.entry.id),
          undefined,
          "DELETE",
          { "If-Match": String(change.baseVersion) },
        );
        known.delete(change.entry.id);
      }
    } else if (existing && comparable(existing) === comparable(change.entry)) {
    } else {
      if (!existing || existing._version !== change.baseVersion)
        throw Error(
          "O registro " +
            change.entry.name +
            " mudou em outro dispositivo. A edição local foi preservada para revisão.",
        );
      const result = await call("records", {
        ...change.entry,
        _version: change.baseVersion,
      });
      known.set(change.entry.id, result.entry);
    }
    state = {
      ...state,
      changes: state.changes.filter((c) => c.id !== change.id),
    };
    await checkpoint();
  }
  const fresh = await call("records");
  state = {
    user: me.user,
    entries: fresh.entries,
    pending: [],
    changes: [],
    savedAt: Date.now(),
  };
  await checkpoint();
  return state;
}
