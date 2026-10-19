"use client";
import { useEffect, useState } from "react";
import { Modal } from "../../ui/modal";
import { Ripple } from "../../motion-ui";
import { requestJSON } from "../../../lib/client";
import { money, type Entry } from "../../../lib/finance";
type Revision = {
  id: number;
  operation: string;
  before_payload: Entry | null;
  after_payload: Entry | null;
  created: number;
  request_id: string;
};
export function FinancialHistory({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  const [data, setData] = useState<Revision[]>(),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    requestJSON<{ revisions: Revision[] }>(
      "workspace/history?record=" + encodeURIComponent(entry.id),
      undefined,
      controller.signal,
    )
      .then((r) => setData(r.revisions))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [entry.id]);
  return (
    <Modal title={"Histórico · " + entry.name} onClose={onClose}>
      <p className="subtle">
        Alterações preservadas com horário e valores anteriores. Ajustes e
        estornos são novos lançamentos.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!data && !error && <Ripple />}
      {data?.map((r) => (
        <article className="history-item" key={r.id}>
          <b>
            {{
              baseline: "Registro anterior à revisão",
              create: "Criado",
              update: "Alterado",
              delete: "Excluído",
            }[r.operation] || r.operation}
          </b>
          <time>{new Date(Number(r.created)).toLocaleString("pt-BR")}</time>
          {r.before_payload && (
            <p>
              Antes: {r.before_payload.name} · {money(r.before_payload.amount)}{" "}
              · {r.before_payload.date || "sem data"} ·{" "}
              {r.before_payload.category || "sem categoria"}
            </p>
          )}
          {r.after_payload && (
            <p>
              Depois: {r.after_payload.name} · {money(r.after_payload.amount)} ·{" "}
              {r.after_payload.date || "sem data"} ·{" "}
              {r.after_payload.category || "sem categoria"}
            </p>
          )}
        </article>
      ))}
      {data?.length === 100 && (
        <p>
          Mostrando as 100 alterações mais recentes. A exportação completa
          inclui todo o histórico.
        </p>
      )}
    </Modal>
  );
}
