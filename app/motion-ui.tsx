"use client";
import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
export function Ripple({
  label = "Carregando",
  small = false,
}: {
  label?: string;
  small?: boolean;
}) {
  return (
    <span
      className={`ripple-loader ${small ? "ripple-small" : ""}`}
      role="status"
      aria-label={label}
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </span>
  );
}
function Bone({ className = "" }: { className?: string }) {
  return <div className={`skeleton-bone ${className}`} aria-hidden="true" />;
}
export function PageSkeleton({ page = "Visão geral" }: { page?: string }) {
  const overview = page === "Visão geral";
  const table = [
    "Transações",
    "Contas recorrentes",
    "Dívidas",
    "Arquivos",
  ].includes(page);
  return (
    <div
      className="page-skeleton"
      aria-busy="true"
      aria-label={`Carregando ${page}`}
    >
      <div className="loading-caption">
        <Ripple />
        <span role="status">Preparando seu espaço…</span>
      </div>
      {overview && (
        <div className="metrics">
          {[0, 1, 2, 3].map((i) => (
            <div className="metric skeleton-metric" key={i}>
              <Bone className="bone-label" />
              <Bone className="bone-value" />
              <Bone className="bone-detail" />
            </div>
          ))}
        </div>
      )}
      <div
        className={overview ? "dashboard-grid" : table ? "" : "skeleton-grid"}
      >
        {(overview ? [0, 1] : table ? [0] : [0, 1, 2, 3]).map((i) => (
          <section className="card skeleton-panel" key={i}>
            <Bone className="bone-title" />
            {overview && i === 0 ? (
              <Bone className="bone-chart" />
            ) : (
              [0, 1, 2, 3].map((j) => (
                <div className="skeleton-row" key={j}>
                  <Bone className="bone-avatar" />
                  <div>
                    <Bone className="bone-label" />
                    <Bone className="bone-detail" />
                  </div>
                  <Bone className="bone-number" />
                </div>
              ))
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
export function Notification({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(message);
  const [visible, setVisible] = useState(!!message);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (message) {
        setShown(message);
        setVisible(true);
      } else setVisible(false);
    }, 0);
    const removal = !message ? setTimeout(() => setShown(""), 360) : null;
    return () => {
      clearTimeout(timer);
      if (removal) clearTimeout(removal);
    };
  }, [message]);
  if (!shown) return null;
  return (
    <div
      className={`wzy-notification ${visible ? "notification-visible" : ""}`}
    >
      <div className="notification-glow" aria-hidden="true" />
      <span className="notification-icon">
        <Bell size={18} />
      </span>
      <div className="notification-copy">
        <small>
          WZY <span>· agora</span>
        </small>
        <p role="status" aria-live="polite" aria-atomic="true">
          {shown}
        </p>
      </div>
      <button aria-label="Fechar aviso" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}
