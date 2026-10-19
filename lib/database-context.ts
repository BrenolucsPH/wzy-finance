import { AsyncLocalStorage } from "node:async_hooks";

type DatabaseContext =
  { userId: string; system?: false } | { system: true; userId?: never };
const context = new AsyncLocalStorage<DatabaseContext>();
const requests = new AsyncLocalStorage<string>();
export function withRequest<T>(id: string, operation: () => Promise<T>) {
  return requests.run(id, operation);
}

export function withOwner<T>(userId: string, operation: () => Promise<T>) {
  if (!userId) throw Error("OWNER_REQUIRED");
  return context.run({ userId }, operation);
}
export function withSystem<T>(operation: () => Promise<T>) {
  return context.run({ system: true }, operation);
}
export async function setDatabaseContext(client: {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}) {
  const current = context.getStore();
  const role = process.env.WZY_TEST_SCHEMA
    ? process.env.WZY_TEST_SCHEMA + "_runtime"
    : "wzy_runtime";
  if (!/^wzy_(?:runtime|qa_[a-f0-9]{32}_runtime)$/.test(role))
    throw Error("INVALID_DATABASE_ROLE");
  await client.query(`SET LOCAL ROLE "${role}"`);
  await client.query(
    "SELECT set_config('wzy.user_id',$1,true),set_config('wzy.system',$2,true),set_config('wzy.request_id',$3,true),set_config('wzy.enforce_context','1',true)",
    [
      current?.userId || "",
      current?.system ? "1" : "0",
      requests.getStore() || "",
    ],
  );
}
