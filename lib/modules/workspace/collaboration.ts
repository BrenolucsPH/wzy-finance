import { z } from "zod";
import { db, digest, type User } from "../../server";
import { withOwner } from "../../database-context";
import { transaction } from "../../postgres";
import { parse, id, month, InputError, ownedEntry, lockOwner } from "./common";
import type { Entry } from "../../finance";
export async function inviteMember(
  owner: string,
  body: unknown,
  origin: string,
) {
  const b = parse(
      z.object({
        groupId: id,
        email: z.string().email().max(254),
        memberName: z.string().min(1).max(80),
        role: z.enum(["viewer", "editor"]),
      }),
      body,
    ),
    group = await ownedEntry(owner, b.groupId);
  if (group.kind !== "group" || !group.members?.includes(b.memberName))
    throw new InputError("Escolha um participante já cadastrado no grupo.");
  const token = crypto.randomUUID() + crypto.randomUUID(),
    hash = await digest(token),
    email = b.email.toLowerCase().trim();
  const existing = await db()
    .prepare(
      "SELECT id FROM collaboration_members WHERE owner_id=? AND group_id=? AND member_name=? AND status=?",
    )
    .bind(owner, group.id, b.memberName, "accepted")
    .first();
  if (existing)
    throw new InputError(
      "Este participante já tem acesso. Revogue antes de convidar novamente.",
      409,
    );
  const user = await db()
    .prepare("SELECT email FROM users WHERE id=?")
    .bind(owner)
    .first<{ email: string }>();
  if (user?.email === email)
    throw new InputError("Você já administra este grupo.");
  await db()
    .prepare(
      "INSERT INTO collaboration_members(id,owner_id,group_id,email,member_name,role,weight,status,token_hash,expires,created) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,group_id,email) DO UPDATE SET member_name=excluded.member_name,role=excluded.role,weight=excluded.weight,status=excluded.status,token_hash=excluded.token_hash,expires=excluded.expires,member_user_id=NULL",
    )
    .bind(
      crypto.randomUUID(),
      owner,
      group.id,
      email,
      b.memberName,
      b.role,
      group.memberWeights?.[b.memberName] || 1,
      "pending",
      hash,
      Date.now() + 7 * 86400000,
      Date.now(),
    )
    .lockUser(owner)
    .run();
  return {
    inviteUrl: origin + "/?invite=" + encodeURIComponent(token),
    expires: Date.now() + 7 * 86400000,
  };
}
export async function acceptInvite(user: User, body: unknown) {
  const b = parse(z.object({ token: z.string().min(50).max(100) }), body);
  return transaction(async (client) => {
    await lockOwner(client, user.id);
    const found = await client.query(
      "SELECT * FROM collaboration_members WHERE token_hash=$1 FOR UPDATE",
      [await digest(b.token)],
    );
    const invitation = found.rows[0];
    if (
      !invitation ||
      invitation.status === "revoked" ||
      Number(invitation.expires) < Date.now() ||
      invitation.email !== user.email.toLowerCase()
    )
      throw new InputError(
        "Convite inválido, expirado ou destinado a outro email.",
        403,
      );
    if (
      invitation.status === "accepted" &&
      invitation.member_user_id !== user.id
    )
      throw new InputError("Convite já utilizado.", 409);
    const owner = await client.query("SELECT disabled FROM users WHERE id=$1", [
      invitation.owner_id,
    ]);
    if (!owner.rows.length || owner.rows[0].disabled)
      throw new InputError("O grupo está indisponível.", 403);
    await client.query(
      "UPDATE collaboration_members SET status='accepted',member_user_id=$1 WHERE id=$2",
      [user.id, invitation.id],
    );
    return { message: "Acesso ao grupo confirmado." };
  });
}
export async function sharedGroups(user: User) {
  const memberships = (
    await db()
      .prepare(
        "SELECT m.id,m.owner_id,m.group_id,m.member_name,m.role,u.name AS owner_name FROM collaboration_members m JOIN users u ON u.id=m.owner_id WHERE m.member_user_id=? AND m.status='accepted' AND u.disabled=0",
      )
      .bind(user.id)
      .all<{
        id: string;
        owner_id: string;
        group_id: string;
        member_name: string;
        role: string;
        owner_name: string;
      }>()
  ).results;
  const groups = [];
  for (const m of memberships) {
    try {
      const e = await withOwner(m.owner_id, () =>
        ownedEntry(m.owner_id, m.group_id),
      );
      groups.push({
        membershipId: m.id,
        memberName: m.member_name,
        role: m.role,
        ownerName: m.owner_name,
        group: {
          id: e.id,
          name: e.name,
          amount: e.amount,
          day: e.day,
          members: e.members,
          payments: e.payments,
          memberWeights: e.memberWeights,
        },
      });
    } catch {
      /* A removed group cannot grant access. */
    }
  }
  return { groups };
}
export async function groupMembers(owner: string, groupId: string) {
  const group = await ownedEntry(owner, groupId);
  if (group.kind !== "group") throw new InputError("Grupo inválido.");
  return {
    members: (
      await db()
        .prepare(
          "SELECT id,email,member_name,role,weight,status,expires FROM collaboration_members WHERE owner_id=? AND group_id=? ORDER BY created",
        )
        .bind(owner, groupId)
        .all()
    ).results,
  };
}
export async function revokeMember(owner: string, body: unknown) {
  const b = parse(z.object({ id }), body);
  await db()
    .prepare(
      "UPDATE collaboration_members SET status='revoked' WHERE id=? AND owner_id=?",
    )
    .bind(b.id, owner)
    .lockUser(owner)
    .run();
  return { message: "Acesso revogado." };
}
export async function sharedPayment(user: User, body: unknown) {
  const b = parse(
    z.object({ membershipId: id, month, paid: z.boolean() }),
    body,
  );
  const m = await db()
    .prepare(
      "SELECT owner_id,group_id,member_name FROM collaboration_members WHERE id=? AND member_user_id=? AND status='accepted' AND role='editor'",
    )
    .bind(b.membershipId, user.id)
    .first<{ owner_id: string; group_id: string; member_name: string }>();
  if (!m)
    throw new InputError("Você não pode alterar pagamentos deste grupo.", 403);
  return withOwner(m.owner_id, () =>
    transaction(async (client) => {
      await lockOwner(client, m.owner_id);
      const membership = await client.query(
        "SELECT id FROM collaboration_members WHERE id=$1 AND member_user_id=$2 AND status='accepted' AND role='editor' FOR UPDATE",
        [b.membershipId, user.id],
      );
      if (!membership.rows.length)
        throw new InputError("Acesso revogado.", 403);
      const r = await client.query(
        "SELECT payload,updated FROM records WHERE user_id=$1 AND id=$2 FOR UPDATE",
        [m.owner_id, m.group_id],
      );
      if (!r.rows.length) throw new InputError("Grupo indisponível.", 404);
      const group = JSON.parse(r.rows[0].payload) as Entry;
      if (group.kind !== "group" || !group.members?.includes(m.member_name))
        throw new InputError("Participante indisponível.", 403);
      const paid = new Set(group.payments?.[b.month] || []);
      if (b.paid) paid.add(m.member_name);
      else paid.delete(m.member_name);
      group.payments = { ...group.payments, [b.month]: Array.from(paid) };
      await client.query(
        "UPDATE records SET payload=$1,updated=GREATEST(updated+1,$2) WHERE user_id=$3 AND id=$4",
        [JSON.stringify(group), Date.now(), m.owner_id, group.id],
      );
      return { message: "Seu pagamento foi atualizado." };
    }),
  );
}
