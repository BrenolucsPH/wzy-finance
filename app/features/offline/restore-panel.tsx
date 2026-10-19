"use client";
import { useRef, useState } from "react";
import { requestJSON, type Attachment } from "../../../lib/client";
import { uploadAttachment } from "../../../lib/upload-client";
import type { RestoreData } from "../../../lib/domain/restore";
type Preview = {
  planId: string;
  records: number;
  attachments: number;
  positions: number;
  revisions: number;
  counts: Record<string, number>;
  message: string;
};
async function boundedZipEntry(
  entry: import("jszip").JSZipObject,
  limit: number,
) {
  return new Promise<Uint8Array>((resolve, reject) => {
    let size = 0;
    const chunks: Uint8Array[] = [];
    const stream = (
      entry as import("jszip").JSZipObject & {
        internalStream: (
          type: "uint8array",
        ) => import("jszip").JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream("uint8array");
    stream
      .on("data", (chunk: Uint8Array) => {
        size += chunk.length;
        if (size > limit) {
          stream.pause();
          reject(Error("O arquivo expandido excede o limite permitido."));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", reject)
      .on("end", () => {
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        resolve(result);
      })
      .resume();
  });
}
export function RestorePanel({
  notify,
  onDone,
}: {
  notify: (message: string) => void;
  onDone?: () => Promise<void>;
}) {
  const uploadedBindings = useRef<Record<string, string>>({});
  const [file, setFile] = useState<File>(),
    [preview, setPreview] = useState<Preview>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [uploadId, setUploadId] = useState("");
  async function prepare() {
    if (!file) return;
    setBusy(true);
    setError("");
    setPreview(undefined);
    try {
      if (file.size > 100 * 1024 * 1024)
        throw Error("Use uma exportação de até 100 MB.");
      let source: RestoreData;
      const bindings = uploadedBindings.current;
      if (file.name.toLowerCase().endsWith(".zip")) {
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(file);
        if (Object.keys(zip.files).length > 10000)
          throw Error("O ZIP contém arquivos demais. Divida a exportação.");
        const data = zip.file("WZY-dados.json");
        if (!data) throw Error("O ZIP precisa conter WZY-dados.json.");
        source = JSON.parse(
          new TextDecoder().decode(
            await boundedZipEntry(data, 20 * 1024 * 1024),
          ),
        );
        let total = 0,
          index = 0;
        for (const meta of source.files || []) {
          if (bindings[meta.id]) continue;
          const candidate = Object.values(zip.files).find(
            (f) => !f.dir && f.name.startsWith("comprovantes/" + meta.id + "-"),
          );
          if (!candidate) throw Error("O ZIP está sem um dos comprovantes.");
          if (meta.size <= 0 || meta.size > 10 * 1024 * 1024)
            throw Error("Comprovante acima de 10 MB.");
          total += meta.size;
          if (total > 100 * 1024 * 1024)
            throw Error("Os comprovantes excedem 100 MB.");
          setProgress(
            "Enviando comprovante " +
              ++index +
              " de " +
              (source.files?.length || 0),
          );
          const bytes = await boundedZipEntry(candidate, 10 * 1024 * 1024);
          if (bytes.length !== meta.size)
            throw Error("Tamanho do comprovante não corresponde à exportação.");
          const saved: Attachment = await uploadAttachment(
            new File([bytes as Uint8Array<ArrayBuffer>], meta.name, {
              type: meta.type,
            }),
          );
          bindings[meta.id] = saved.id;
        }
      } else {
        if (file.size > 20 * 1024 * 1024)
          throw Error("Use um JSON de até 20 MB.");
        source = JSON.parse(await file.text());
      }
      if (uploadId) await requestJSON("restoration/cancel", { uploadId });
      setProgress("Preparando uma prévia segura…");
      const data = new Blob([JSON.stringify(source)], {
          type: "application/json",
        }),
        reservation = await requestJSON<{
          id: string;
          pathname: string;
          token: string;
        }>("restoration/upload", { size: data.size });
      setUploadId(reservation.id);
      const { put } = await import("@vercel/blob/client");
      await put(reservation.pathname, data, {
        access: "private",
        token: reservation.token,
        contentType: "application/json",
      });
      setPreview(
        await requestJSON<Preview>("restoration/preview", {
          uploadId: reservation.id,
          attachments: bindings,
        }),
      );
      setProgress("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="restore-panel">
      <h2>Restaurar uma exportação</h2>
      <p className="subtle">
        Importe um JSON ou o ZIP completo do WZY. A prévia informa o que será
        adicionado. Os registros atuais são preservados; nada é sobrescrito.
      </p>
      <label>
        Arquivo de exportação
        <input
          type="file"
          accept=".json,.zip"
          disabled={busy}
          onChange={(e) => {
            uploadedBindings.current = {};
            setFile(e.target.files?.[0]);
            setPreview(undefined);
            setError("");
          }}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {progress && <p role="status">{progress}</p>}
      {!preview ? (
        <button className="button" disabled={!file || busy} onClick={prepare}>
          {busy ? "Preparando…" : "Gerar prévia"}
        </button>
      ) : (
        <>
          <div className="mini-summary">
            <span>
              Registros <b>{preview.records}</b>
            </span>
            <span>
              Comprovantes <b>{preview.attachments}</b>
            </span>
            <span>
              Posições <b>{preview.positions}</b>
            </span>
            <span>
              Revisões <b>{preview.revisions}</b>
            </span>
          </div>
          <p>{preview.message}</p>
          <p>
            Contas e cartões serão adicionados como novos registros. Se já
            existirem dados semelhantes, seus totais passarão a incluir ambos.
          </p>
          <div className="form-actions">
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                if (uploadId)
                  await requestJSON("restoration/cancel", { uploadId });
                setPreview(undefined);
                setUploadId("");
              }}
            >
              Cancelar importação
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await requestJSON("restoration/commit", {
                    planId: preview.planId,
                    confirm: true,
                  });
                  if (uploadId)
                    await requestJSON("restoration/cancel", { uploadId });
                  setPreview(undefined);
                  setUploadId("");
                  setFile(undefined);
                  await onDone?.();
                  notify(
                    "Dados restaurados. Os registros anteriores foram preservados.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirmar restauração
            </button>
          </div>
        </>
      )}
    </section>
  );
}
