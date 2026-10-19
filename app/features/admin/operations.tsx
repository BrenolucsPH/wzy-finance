"use client";
import { useEffect, useState } from "react";
import { requestJSON } from "../../../lib/client";
type Health = {
  runs: { day: string; status: string; processed: number; failed: number }[];
  failures: {
    request_id: string;
    route: string;
    status: number;
    code: string;
    created: number;
  }[];
  slowRequests: {
    route: string;
    count: number;
    average_ms: number;
    maximum_ms: number;
  }[];
  archives: { count: number; total: number; last_backup: number };
  activation: { event: string; day: string; count: number }[];
  emailReady: boolean;
  smsReady: boolean;
  pushReady: boolean;
  limits: { perUserBackupBytes: number; totalBackupBytes: number };
  scope: string;
};
export function OperationsPanel() {
  const [data, setData] = useState<Health>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      setData(await requestJSON<Health>("admin/health"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    void requestJSON<Health>("admin/health")
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="card operations-panel">
      <div className="card-heading">
        <h2>Saúde do sistema</h2>
        <button className="button" disabled={busy} onClick={load}>
          Atualizar
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="mini-summary">
            <span>
              Cópias independentes <b>{data.archives?.count || 0}</b>
            </span>
            <span>
              Armazenamento das cópias{" "}
              <b>{((data.archives?.total || 0) / 1024 / 1024).toFixed(1)} MB</b>
            </span>
            <span>
              Limite configurado{" "}
              <b>
                {(data.limits.totalBackupBytes / 1024 / 1024).toFixed(0)} MB
              </b>
            </span>
          </div>
          <p>
            Email: {data.emailReady ? "configurado" : "aguardando configuração"}{" "}
            · SMS: {data.smsReady ? "configurado" : "aguardando configuração"} ·
            push:{" "}
            {data.pushReady
              ? "configurado; depende da autorização no dispositivo"
              : "aguardando configuração"}
          </p>
          <h3>Rotinas e recuperação</h3>
          {data.runs.map((r) => (
            <div className="preference-row" key={r.day}>
              <span>
                <b>{r.day}</b> · {r.status}
              </span>
              <span>
                {r.processed} concluídas · {r.failed} pendentes
              </span>
            </div>
          ))}
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await requestJSON("ops/daily", { resume: true });
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Retomar rotina de cópias e lembretes
          </button>
          <h3>Falhas que precisam de atenção</h3>
          {!data.failures.length && <p>Nenhuma falha registrada.</p>}
          {data.failures.map((f) => (
            <div className="preference-row" key={f.request_id}>
              <span>
                <b>{f.route}</b> · {f.code}
                <small>
                  {new Date(f.created).toLocaleString("pt-BR")} · referência{" "}
                  {f.request_id}
                </small>
              </span>
              <span>{f.status}</span>
            </div>
          ))}
          <h3>Pedidos lentos nas últimas 24 horas</h3>
          {data.slowRequests.map((s) => (
            <div className="preference-row" key={s.route}>
              <b>{s.route}</b>
              <span>
                {s.count} ocorrências · média {s.average_ms} ms · maior{" "}
                {s.maximum_ms} ms
              </span>
            </div>
          ))}
          <h3>Uso autorizado pelos participantes</h3>
          {data.activation.length ? (
            data.activation.map((a) => (
              <div className="preference-row" key={a.day + a.event}>
                <span>
                  {a.day} · {a.event}
                </span>
                <b>{a.count}</b>
              </div>
            ))
          ) : (
            <p>Sem eventos de uso consentidos neste período.</p>
          )}
          <p className="subtle">{data.scope}</p>
          <p className="subtle">
            Ao atingir o limite de armazenamento, novas cópias aguardam atenção;
            as cópias anteriores são preservadas.
          </p>
        </>
      )}
    </section>
  );
}
