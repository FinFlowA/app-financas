"use client";

import { useTransition } from "react";
import { signOutAction } from "./sign-out-action";

export default function SignOutButton() {
  const [pending, startTransition] = useTransition();

  function sair() {
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith("finflow:web:ai-pending:")) sessionStorage.removeItem(key);
      }
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith("finflow:web:ai-conversation:")) localStorage.removeItem(key);
      }
    } catch {
      // Storage bloqueado não impede que a sessão seja encerrada no servidor.
    }
    startTransition(() => { void signOutAction(); });
  }

  return (
    <button
      onClick={sair}
      disabled={pending}
      aria-busy={pending}
      className="ff-signout ff-focus"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5M14 8l4 4-4 4M8 12h10" /></svg>
      {pending ? "Saindo…" : "Sair da conta"}
    </button>
  );
}
