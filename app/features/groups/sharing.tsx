"use client";
import { useEffect, useState } from "react";
import { requestJSON } from "../../../lib/client";
import { money, groupSplit, type Entry } from "../../../lib/finance";
import type { Actions } from "../shared";
type Member = {
  id: string;
  email: string;
  member_name: string;
  role: string;
  status: string;
};
type Shared = {
  membershipId: string;
  memberName: string;
  role: string;
  ownerName: string;
  group: Entry;
};
export function GroupSharing({ group, ...p }: Actions & { group: Entry }) {
  const [members, setMembers] = useState<Member[]>([]),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (p.authenticated)
      void requestJSON<{ members: Member[] }>(
        "workspace/groups/members?group=" + encodeURIComponent(group.id),
      )
        .then((r) => {
          if (active) setMembers(r.members);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [group.id, p.authenticated]);
  async function reload() {
    setMembers(
      (
        await requestJSON<{ members: Member[] }>(
          "workspace/groups/members?group=" + encodeURIComponent(group.id),
        )
      ).members,
    );
  }
  return (
    <div className="sharing-panel">
      <h3>Compartilhar este grupo</h3>
      <p className="subtle">
        O convite dá acesso somente a esta assinatura. As contas, transações e
        outros grupos permanecem privados. O link expira em sete dias.
      </p>
      <form
        className="entry-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          setBusy(true);
          setError("");
          try {
            const r = await requestJSON<{ inviteUrl: string }>(
              "workspace/groups/invite",
              {
                groupId: group.id,
                email: String(f.email),
                memberName: String(f.memberName),
                role: String(f.role),
              },
            );
            setLink(r.inviteUrl);
            await reload();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Participante
          <select name="memberName">
            {group.members?.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Email da conta WZY
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label>
          Permissão
          <select name="role">
            <option value="viewer">Consultar o grupo</option>
            <option value="editor">
              Consultar e marcar o próprio pagamento
            </option>
          </select>
        </label>
        <button className="button" disabled={busy || !p.authenticated}>
          Gerar convite
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {link && (
        <div className="invite-link">
          <label>
            Link do convite
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="button primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                p.notify(
                  "Convite copiado. Envie à pessoa pelo canal que preferir.",
                );
              } catch {
                setError("Selecione e copie o link acima.");
              }
            }}
          >
            Copiar convite
          </button>
        </div>
      )}
      {members.map((m) => (
        <div className="preference-row" key={m.id}>
          <span>
            <b>{m.member_name}</b>
            <small>
              {m.email} ·{" "}
              {m.status === "accepted"
                ? "aceito"
                : m.status === "pending"
                  ? "pendente"
                  : "revogado"}
            </small>
          </span>
          {m.status !== "revoked" && (
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await requestJSON("workspace/groups/revoke", { id: m.id });
                  await reload();
                  p.notify("Acesso revogado.");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Revogar acesso
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
export function SharedGroups(p: Actions) {
  const [groups, setGroups] = useState<Shared[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function reload() {
    setGroups(
      (await requestJSON<{ groups: Shared[] }>("workspace/groups/shared"))
        .groups,
    );
  }
  useEffect(() => {
    let active = true;
    if (p.authenticated)
      void requestJSON<{ groups: Shared[] }>("workspace/groups/shared")
        .then((r) => {
          if (active) setGroups(r.groups);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [p.authenticated]);
  if (!groups.length && !error) return null;
  return (
    <section className="card">
      <h2>Compartilhados com você</h2>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {groups.map((g) => {
        const index = g.group.members?.indexOf(g.memberName) || 0,
          share = groupSplit(g.group)[index],
          paid = g.group.payments?.[p.month]?.includes(g.memberName);
        return (
          <div className="shared-group" key={g.membershipId}>
            <div>
              <h3>{g.group.name}</h3>
              <p>
                Administrado por {g.ownerName} · vence dia {g.group.day}
              </p>
              <b>Sua cota: {money(share)}</b>
              <p>
                {paid
                  ? "Seu pagamento está marcado como concluído."
                  : "Sua cota ainda está pendente."}
              </p>
            </div>
            {g.role === "editor" && (
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await requestJSON("workspace/groups/payment", {
                      membershipId: g.membershipId,
                      month: p.month,
                      paid: !paid,
                    });
                    await reload();
                    p.notify("Seu pagamento foi atualizado.");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {paid ? "Marcar como pendente" : "Marcar meu pagamento"}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
