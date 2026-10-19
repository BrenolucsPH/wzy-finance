import type { Entry } from "./finance";
export type Person = {
  id: string;
  name: string;
  email: string;
  mfa: string | null;
  phone: string | null;
  emailVerified: boolean;
  avatarVersion?: number;
  timezone?: string;
  isAdmin?: boolean;
};
export type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  created: number;
};
type ApiResponse = {
  error?: string;
  message: string;
  user: Person;
  mfa?: string;
  entries: Entry[];
  entry: Entry;
  files: Attachment[];
  file: Attachment;
  emailReady: boolean;
  smsReady: boolean;
  totpReady: boolean;
  secret: string;
  uri: string;
  backupCodes: string[];
};
export async function api(
  path: string,
  body?: unknown,
  method?: string,
  headers: Record<string, string> = {},
) {
  const res = await fetch("/api/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      ...headers,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as ApiResponse;
  if (!res.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
export async function requestJSON<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal || AbortSignal.timeout(30000),
  });
  if (
    !(response.headers.get("content-type") || "").includes("application/json")
  )
    throw Error(
      "Não foi possível acessar o serviço. Abra o WZY novamente e confirme seu acesso.",
    );
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw Error(result.error || "Não foi possível concluir.");
  return result;
}
