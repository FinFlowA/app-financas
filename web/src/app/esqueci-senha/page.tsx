import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Recuperar senha | FinFlow" };

type ForgotPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;
  return (
    <AuthShell
      title="Recupere sua senha"
      description="Enviaremos um link seguro para o e-mail confirmado da sua conta."
    >
      <ForgotPasswordForm invalidLink={params.link_invalido === "1"} />
    </AuthShell>
  );
}
