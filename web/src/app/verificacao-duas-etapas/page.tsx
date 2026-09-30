import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { MfaChallengeForm } from "@/components/auth/mfa-challenge-form";
import { isMfaPending } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function MfaChallengePage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  if (!(await isMfaPending(supabase, data.user))) redirect("/");
  return (
    <AuthShell
      title="Verificação em duas etapas"
      description="Sua conta está protegida com um segundo fator. Digite o código do seu app autenticador para continuar."
    >
      <MfaChallengeForm />
    </AuthShell>
  );
}
