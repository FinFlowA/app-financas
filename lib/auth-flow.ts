import type { SupabaseClient } from "@supabase/supabase-js";
import { idadeEmAnos } from "./legal";

export const PENDING_EMAIL_CONFIRMATION_KEY = "@finflow_pending_email_confirmation";

export const PASSWORD_RECOVERY_FLOW_KEY = "@finflow_password_recovery_flow";
export const PASSWORD_RECOVERY_FLOW_TTL_MS = 15 * 60 * 1000;

export type PasswordRecoveryFlow = {
  userId: string;
  expiresAt: number;
};

export function criarFluxoRecuperacaoSenha(userId: string): PasswordRecoveryFlow {
  return {
    userId,
    expiresAt: Date.now() + PASSWORD_RECOVERY_FLOW_TTL_MS,
  };
}

export function lerFluxoRecuperacaoSenha(raw: string | null): PasswordRecoveryFlow | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PasswordRecoveryFlow>;
    if (typeof value.userId !== "string" || typeof value.expiresAt !== "number") return null;
    return { userId: value.userId, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

export type ResultadoLoginOAuth =
  | { status: "sucesso" }
  | { status: "idade_invalida" }
  | { status: "erro" };

/** Roda depois de exchangeCodeForSession bem-sucedido: confirma e-mail
 * verificado, aplica o bloqueio de 18 anos e liga o tutorial no primeiro
 * acesso via provedor externo. Compartilhado entre a interceptação normal
 * (WebBrowser.openAuthSessionAsync) e a tela de fallback app/auth/callback,
 * usada quando o sistema entrega o retorno como navegação comum. */
export async function finalizarLoginOAuth(
  supabase: SupabaseClient,
): Promise<ResultadoLoginOAuth> {
  const { data: usuarioValidado, error: erroUsuario } = await supabase.auth.getUser();
  const usuario = usuarioValidado.user;
  if (erroUsuario || !usuario?.email || !usuario.email_confirmed_at) {
    await supabase.auth.signOut({ scope: "local" });
    return { status: "erro" };
  }

  const nascimento = usuario.user_metadata?.data_nascimento;
  const idade = typeof nascimento === "string" ? idadeEmAnos(nascimento) : null;
  if (idade !== null && idade < 18) {
    await supabase.auth.signOut({ scope: "local" });
    return { status: "idade_invalida" };
  }

  if (usuario.user_metadata?.tutorial_pendente === undefined) {
    await supabase.auth.updateUser({
      data: { ...usuario.user_metadata, tutorial_pendente: true },
    });
  }

  return { status: "sucesso" };
}
