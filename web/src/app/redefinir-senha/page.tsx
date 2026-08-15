import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/constants";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nova senha" };

export default async function ResetPasswordPage() {
  const cookieStore = await cookies();
  const hasRecoveryMarker = cookieStore.get(RECOVERY_COOKIE_NAME)?.value === "1";
  let recoveryIsValid = false;

  if (hasRecoveryMarker) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    recoveryIsValid = !error && Boolean(data.user);
  }

  return (
    <AuthShell
      title="Crie uma nova senha"
      description="Escolha uma senha forte e diferente das que você usa em outros serviços."
    >
      <ResetPasswordForm recoveryIsValid={recoveryIsValid} />
    </AuthShell>
  );
}
