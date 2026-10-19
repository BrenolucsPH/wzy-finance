import { database } from "./postgres";
import { bucket } from "./storage";
import bcrypt from "bcryptjs";
import { requestDevice } from "./access";
export { isAdministrator } from "./access";
export const runtime = {
  DB: database,
  BUCKET: bucket,
  AUTH_ENCRYPTION_KEY: process.env.AUTH_ENCRYPTION_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  APP_ORIGIN: process.env.APP_ORIGIN,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_VERIFY_SERVICE_SID: process.env.TWILIO_VERIFY_SERVICE_SID,
};
export const db = () => database;
export const random = () => crypto.randomUUID() + crypto.randomUUID();
export async function digest(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function passwordHash(s: string) {
  return bcrypt.hash(s, 12);
}
export const passwordMatch = (s: string, h: string) => bcrypt.compare(s, h);
export type User = {
  id: string;
  email: string;
  name: string;
  password: string;
  totp: string | null;
  totp_pending: string | null;
  totp_counter: number;
  mfa: string | null;
  phone: string | null;
  verified: number;
  disabled: number;
  avatar_updated: number;
  timezone: string;
};
export async function session(req: Request, pending = false) {
  const cookies = req.headers.get("cookie") || "";
  const token = cookies
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("aurum_session="))
    ?.slice(14);
  if (!token) return null;
  const row = await db()
    .prepare(
      "SELECT u.id,u.email,u.name,u.password,u.totp,u.totp_pending,u.totp_counter,u.mfa,u.phone,u.verified,u.disabled,u.avatar_updated,u.timezone, s.hash AS session_hash, s.id AS session_id, s.verified AS session_verified FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.disabled=0",
    )
    .bind(await digest(token), Date.now())
    .first<
      User & {
        session_hash: string;
        session_id: string;
        session_verified: number;
      }
    >();
  if (!row || (!pending && !row.session_verified)) return null;
  const metadata = requestDevice(req);
  await db()
    .prepare(
      "UPDATE sessions SET last_seen=?,ip=?,city=?,region=?,country=? WHERE hash=? AND last_seen<?",
    )
    .bind(
      Date.now(),
      metadata.ip,
      metadata.city,
      metadata.region,
      metadata.country,
      row.session_hash,
      Date.now() - 300000,
    )
    .run();
  return row;
}
export async function securityEvent(
  req: Request,
  userId: string,
  kind: string,
  detail = "",
) {
  const m = requestDevice(req),
    now = Date.now();
  await db().batch([
    db()
      .prepare(
        "INSERT INTO security_events (id,user_id,kind,created,device,browser,os,ip,city,region,country,detail) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        userId,
        kind,
        now,
        m.device,
        m.browser,
        m.os,
        m.ip,
        m.city,
        m.region,
        m.country,
        detail.slice(0, 200),
      ),
  ]);
}
export async function newSession(req: Request, u: User) {
  const token = random(),
    now = Date.now(),
    m = requestDevice(req);
  const result = await db()
    .prepare(
      "INSERT INTO sessions (hash,user_id,expires,verified,id,created,last_seen,device,browser,os,ip,city,region,country) SELECT ?,id,?,?,?,?,?,?,?,?,?,?,?,? FROM users WHERE id=? AND disabled=0",
    )
    .bind(
      await digest(token),
      now + 7 * 86400000,
      u.mfa ? 0 : 1,
      crypto.randomUUID(),
      now,
      now,
      m.device,
      m.browser,
      m.os,
      m.ip,
      m.city,
      m.region,
      m.country,
      u.id,
    )
    .lockUser(u.id)
    .run();
  if (!result.meta.changes) throw new Error("ACCOUNT_DISABLED");
  await securityEvent(req, u.id, u.mfa ? "login_challenge" : "login_success");
  return cookie(req, token);
}
export function cookie(req: Request, token: string) {
  return `aurum_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 604800 : 0}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function rate(
  req: Request,
  action: string,
  identifier = "",
  max = 12,
) {
  const key = await digest(
    `${action}:${req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"}:${identifier}`,
  );
  const row = await db()
    .prepare(
      "INSERT INTO limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN limits.expires<? THEN 1 ELSE limits.count+1 END, expires=CASE WHEN limits.expires<? THEN excluded.expires ELSE limits.expires END RETURNING count",
    )
    .bind(key, Date.now() + 900000, Date.now(), Date.now())
    .first<{
      count: number;
    }>();
  if ((row?.count || 0) > max) throw new Error("RATE_LIMIT");
}
export async function encrypt(s: string) {
  if (!runtime.AUTH_ENCRYPTION_KEY) throw new Error("ENCRYPTION_UNAVAILABLE");
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(runtime.AUTH_ENCRYPTION_KEY), (c) => c.charCodeAt(0)),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(s),
    ),
  );
  return btoa(String.fromCharCode(...iv, ...data));
}
export async function decrypt(s: string) {
  if (!runtime.AUTH_ENCRYPTION_KEY) throw new Error("ENCRYPTION_UNAVAILABLE");
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(runtime.AUTH_ENCRYPTION_KEY), (c) => c.charCodeAt(0)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12),
    ),
  );
}
const base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function totpSecret() {
  const b = crypto.getRandomValues(new Uint8Array(20));
  let bits = "";
  for (const c of b) bits += c.toString(2).padStart(8, "0");
  return bits
    .match(/.{5}/g)!
    .map((c) => base32[parseInt(c, 2)])
    .join("");
}
export async function totpCode(secret: string, counter: number) {
  let bits = "";
  for (const c of secret)
    bits += base32.indexOf(c).toString(2).padStart(5, "0");
  const bytes = Uint8Array.from(
    bits.match(/.{8}/g)!.map((c) => parseInt(c, 2)),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, BigInt(counter));
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const o = h[h.length - 1] & 15;
  const n =
    ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}
export async function verifyTotp(secret: string, code: string, previous = 0) {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const c of [now, now - 1, now + 1])
    if (c > previous && (await totpCode(secret, c)) === code) return c;
  return null;
}
export async function email(to: string, subject: string, text: string) {
  if (!runtime.RESEND_API_KEY || !runtime.EMAIL_FROM)
    throw new Error("EMAIL_UNAVAILABLE");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: runtime.EMAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error("EMAIL_UNAVAILABLE");
}
export function emailReady() {
  return !!(runtime.RESEND_API_KEY && runtime.EMAIL_FROM);
}
export function smsReady() {
  return !!(
    runtime.TWILIO_ACCOUNT_SID &&
    runtime.TWILIO_AUTH_TOKEN &&
    runtime.TWILIO_VERIFY_SERVICE_SID
  );
}
export async function sms(phone: string, code?: string) {
  if (!smsReady()) throw new Error("SMS_UNAVAILABLE");
  const url = `https://verify.twilio.com/v2/Services/${runtime.TWILIO_VERIFY_SERVICE_SID}/${code ? "VerificationCheck" : "Verifications"}`;
  const body = new URLSearchParams({
    To: phone,
    ...(code ? { Code: code } : { Channel: "sms" }),
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        btoa(`${runtime.TWILIO_ACCOUNT_SID}:${runtime.TWILIO_AUTH_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as {
    status?: string;
  };
  if (!res.ok) throw new Error("SMS_UNAVAILABLE");
  return code ? data.status === "approved" : true;
}
