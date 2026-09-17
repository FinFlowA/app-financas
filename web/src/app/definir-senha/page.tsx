import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { DefineOAuthPasswordForm } from "@/components/auth/define-oauth-password-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Definir senha" };

export default async function DefinePasswordPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  if (data.user.app_metadata?.provider !== "google" || data.user.user_metadata?.senha_definida === true) redirect("/");
  return (
    <AuthShell title="Defina sua senha" description="Seu acesso pelo Google está confirmado. Crie também uma senha para acessar e recuperar sua conta com segurança.">
      <DefineOAuthPasswordForm />
    </AuthShell>
  );
}
