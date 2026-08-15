"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const router = useRouter();

  async function sair() {
    const supabase = createClient();
    await supabase.auth.signOut();
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
      // A sessão do servidor já foi encerrada; storage bloqueado não impede sair.
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={sair}
      className="w-full rounded-ff-sm border border-border py-2 text-sm font-semibold text-foreground-muted transition hover:bg-surface-muted"
    >
      Sair
    </button>
  );
}
