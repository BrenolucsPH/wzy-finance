"use client";
import type { ReactNode } from "react";
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div>
        <WalletIcon />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function WalletIcon() {
  return <span>↗</span>;
}
