import {
  pgTable,
  text,
  bigint,
  integer,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { Kind } from "../lib/finance";
// Canonical DDL, policies and triggers: db/vercel-schema.sql + db/migrations.
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    password: text("password").notNull(),
    totp: text("totp"),
    totpPending: text("totp_pending"),
    totpCounter: bigint("totp_counter", { mode: "number" })
      .default(0)
      .notNull(),
    mfa: text("mfa"),
    phone: text("phone"),
    verified: integer("verified").default(0).notNull(),
    created: bigint("created", { mode: "number" }).notNull(),
    disabled: integer("disabled").default(0).notNull(),
    timezone: text("timezone").default("America/Sao_Paulo").notNull(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);
export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    created: bigint("created", { mode: "number" }).notNull(),
  },
  (t) => [index("files_owner").on(t.userId)],
);
export const records = pgTable(
  "records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<Kind>().notNull(),
    payload: text("payload").notNull(),
    updated: bigint("updated", { mode: "number" }).notNull(),
    accountId: text("account_id").references((): AnyPgColumn => records.id),
    targetId: text("target_id").references((): AnyPgColumn => records.id),
    sourceId: text("source_id").references((): AnyPgColumn => records.id),
    attachmentId: text("attachment_id").references(() => files.id),
  },
  (t) => [index("records_owner_kind").on(t.userId, t.kind)],
);
export const sessions = pgTable("sessions", {
  hash: text("hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: bigint("expires", { mode: "number" }).notNull(),
  verified: integer("verified").default(1).notNull(),
});
export const challenges = pgTable("challenges", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  hash: text("hash").notNull(),
  expires: bigint("expires", { mode: "number" }).notNull(),
});
