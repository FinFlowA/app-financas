"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOutAction(): Promise<never> {
  const supabase = await createClient();
  // O logout normal deve encerrar apenas a sessao web atual. O escopo padrao
  // do Supabase e global e revogaria tambem a sessao mantida pelo app mobile.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
