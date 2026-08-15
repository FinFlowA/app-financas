import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const initialFeedback =
    params.senha_alterada === "1"
      ? { kind: "success" as const, message: "Senha alterada com sucesso. Entre novamente." }
      : params.erro_confirmacao === "1"
        ? {
            kind: "error" as const,
            message: "O link de confirmação é inválido ou expirou. Tente entrar para reenviar.",
          }
        : undefined;

  return (
    <AuthShell
      title="Bem-vindo de volta"
      description="Entre com a mesma conta que você usa no aplicativo FinFlow."
    >
      <LoginForm initialFeedback={initialFeedback} />
    </AuthShell>
  );
}
