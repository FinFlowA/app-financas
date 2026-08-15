"use client";

import { useEffect } from "react";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("FinFlow dashboard error", error.digest ?? "sem-digest"); }, [error.digest]);
  return <div className="grid min-h-[60vh] place-items-center"><section className="ff-card max-w-md p-7 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red/10 text-3xl text-red">!</div><h1 className="mt-4 text-2xl font-black">Algo deu errado</h1><p className="mt-2 text-sm text-foreground-muted">Nenhuma alteração financeira foi repetida automaticamente. Verifique sua conexão e tente carregar a tela novamente.</p><button type="button" onClick={reset} className="mt-5 rounded-ff-sm bg-primary px-5 py-3 font-extrabold text-white">Tentar novamente</button></section></div>;
}
