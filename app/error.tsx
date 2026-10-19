"use client";
import Link from "next/link";
import { useEffect } from "react";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "render_error" }),
    }).catch(() => {});
  }, []);
  return (
    <main className="recovery-page">
      <h1>Vamos retomar de onde você parou.</h1>
      <p>
        A tela não pôde ser exibida. Seus registros salvos continuam
        preservados.
      </p>
      <button className="button primary" onClick={reset}>
        Tentar novamente
      </button>
      <Link href="/">Voltar ao início</Link>
    </main>
  );
}
