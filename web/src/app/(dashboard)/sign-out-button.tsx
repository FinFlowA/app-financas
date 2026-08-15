"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const router = useRouter();

  async function sair() {
    const supabase = createClient();
    await supabase.auth.signOut();
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
