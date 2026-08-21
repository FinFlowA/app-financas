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
        : params.erro_oauth === "1"
          ? {
              kind: "error" as const,
              message: "Não foi possível entrar com Google agora. Tente novamente ou use seu e-mail e senha.",
            }
          : undefined;

  return (
    <AuthShell
      title="Bem-vindo de volta"
      description="Entre com a mesma conta que você usa no aplicativo FinFlow."
      showSplash
    >
      <LoginForm initialFeedback={initialFeedback} />
    </AuthShell>
  );
}
