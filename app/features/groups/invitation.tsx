"use client";
import { useState } from "react";
import { Modal } from "../../ui/modal";
import { requestJSON } from "../../../lib/client";
export function Invitation({
  token,
  authenticated,
  login,
  onClose,
  onAccepted,
}: {
  token: string;
  authenticated: boolean;
  login: () => void;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Convite para uma assinatura compartilhada" onClose={onClose}>
      <p>
        Você terá acesso ao grupo indicado pelo convite. Suas finanças pessoais
        continuam privadas.
      </p>
      <p className="subtle">
        Use uma conta WZY com o mesmo email informado pelo administrador do
        grupo. O link e o login são necessários para aceitar.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button" onClick={onClose}>
          Agora não
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            if (!authenticated) {
              login();
              return;
            }
            setBusy(true);
            setError("");
            try {
              await requestJSON("workspace/groups/accept", { token });
              onAccepted();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {authenticated ? "Aceitar convite" : "Entrar para aceitar"}
        </button>
      </div>
    </Modal>
  );
}
