"use client";

import { useState, useTransition } from "react";
import { createPortalSessionAction } from "./portal-actions";

export default function PortalButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return <div>
    <button
      type="button"
      disabled={pending}
      className="ff-focus rounded-ff-sm border border-border bg-surface px-4 py-2.5 text-sm font-extrabold text-foreground disabled:opacity-60"
      onClick={() => startTransition(async () => {
        setError("");
        const result = await createPortalSessionAction();
        if (result.url) window.location.assign(result.url);
        else setError(result.error ?? "Não foi possível abrir o portal agora.");
      })}
    >
      {pending ? "Abrindo portal…" : "Gerenciar assinatura e pagamentos"}
    </button>
    {error && <p role="alert" className="mt-2 text-sm font-bold text-red">{error}</p>}
  </div>;
}
