import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Verificação em duas etapas (MFA opcional por app autenticador/TOTP).
 *
 * Quem ativou só acessa dados depois de digitar o código: o banco recusa
 * requisições de sessões sem o código (finflow_guard.enforce_mfa) e este
 * módulo leva o usuário à tela certa no site. Usado no proxy, em Server
 * Actions e em componentes de cliente.
 */

/** Tela em que quem ativou MFA digita o código depois de entrar. */
export const MFA_CHALLENGE_ROUTE = "/verificacao-duas-etapas";

/** Autenticadores por conta: o principal e um reserva (ex.: outro celular). */
export const MAX_TOTP_FACTORS = 2;

export type TotpVerification = "ok" | "invalid" | "rate_limited" | "no_factor";

type AuthClient = { auth: SupabaseClient["auth"] };

export function hasVerifiedFactor(user: Pick<User, "factors"> | null | undefined): boolean {
  return (user?.factors ?? []).some((factor) => factor.status === "verified");
}

/**
 * true quando o usuário ativou MFA e esta sessão ainda não digitou o código.
 * Os fatores vêm do usuário devolvido por getUser() (consulta atual ao Auth),
 * não do cookie, que pode estar desatualizado.
 */
export async function isMfaPending(supabase: AuthClient, user: Pick<User, "factors"> | null | undefined): Promise<boolean> {
  if (!hasVerifiedFactor(user)) return false;
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel !== "aal2";
}

export function normalizeTotpCode(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

/**
 * Confere o código em cada autenticador ativo da conta (até dois). Em caso de
 * sucesso a sessão passa a AAL2. O Auth limita as tentativas por fator e IP.
 */
export async function verifyTotpCode(supabase: AuthClient, rawCode: string): Promise<TotpVerification> {
  const code = normalizeTotpCode(rawCode);
  if (!code) return "invalid";
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return "invalid";
  const factors = data?.totp ?? [];
  if (factors.length === 0) return "no_factor";
  for (const factor of factors) {
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (!verifyError) return "ok";
    if (verifyError.status === 429) return "rate_limited";
  }
  return "invalid";
}

export function totpErrorMessage(result: Exclude<TotpVerification, "ok">): string {
  if (result === "rate_limited") return "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.";
  if (result === "no_factor") return "Nenhum autenticador ativo foi encontrado nesta conta.";
  return "Código inválido ou expirado. Digite o código que aparece agora no seu app autenticador.";
}
