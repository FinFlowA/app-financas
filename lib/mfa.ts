import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Verificação em duas etapas (MFA opcional por app autenticador/TOTP).
 *
 * Quem ativou só acessa dados depois de digitar o código: o banco recusa
 * sessões sem ele (finflow_guard.enforce_mfa) e o app segura a sessão na tela
 * do código até a confirmação.
 */

/** Autenticadores por conta: o principal e um reserva (ex.: outro celular). */
export const MAX_TOTP_FACTORS = 2;

export const MFA_SUPPORT_EMAIL = "Finflowfinancas@gmail.com";

export type TotpVerification = "ok" | "invalid" | "rate_limited" | "no_factor";

type AuthClient = { auth: SupabaseClient["auth"] };

export function hasVerifiedFactor(user: Pick<User, "factors"> | null | undefined): boolean {
  return (user?.factors ?? []).some((factor) => factor.status === "verified");
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64url → texto, em JS puro (o APK antigo não garante atob). */
function decodeBase64Url(segment: string): string | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of segment.replace(/-/g, "+").replace(/_/g, "/")) {
    if (character === "=") break;
    const value = BASE64_ALPHABET.indexOf(character);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""));
  } catch {
    return null;
  }
}

/** Nível de garantia (aal1/aal2) gravado no token de acesso da sessão. */
export function sessionAssuranceLevel(accessToken: string | null | undefined): string | null {
  const payload = accessToken?.split(".")[1];
  if (!payload) return null;
  const json = decodeBase64Url(payload);
  if (!json) return null;
  try {
    const claims = JSON.parse(json) as { aal?: unknown };
    return typeof claims.aal === "string" ? claims.aal : null;
  } catch {
    return null;
  }
}

/**
 * true quando o usuário ativou MFA e esta sessão ainda não digitou o código.
 * Síncrono e sem chamadas ao Supabase: pode rodar dentro de onAuthStateChange.
 */
export function sessaoAguardandoMfa(session: Session | null | undefined): boolean {
  if (!session || !hasVerifiedFactor(session.user)) return false;
  return sessionAssuranceLevel(session.access_token) !== "aal2";
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

/**
 * Reautenticação em telas sensíveis (Segurança, exclusão de conta): entrar
 * de novo com a senha cria uma sessão sem o código. Enquanto a própria tela
 * pede o código, o _layout não troca para a tela de verificação; ao terminar
 * (ou desistir), a sessão é reavaliada e, se ainda faltar o código, a tela de
 * verificação aparece.
 */
let reautenticacaoEmAndamento = false;
let reavaliarSessao: (() => void) | null = null;

export function reautenticacaoAtiva(): boolean {
  return reautenticacaoEmAndamento;
}

export function definirReautenticacao(ativa: boolean): void {
  const estavaAtiva = reautenticacaoEmAndamento;
  reautenticacaoEmAndamento = ativa;
  if (estavaAtiva && !ativa) reavaliarSessao?.();
}

export function registrarReavaliacaoMfa(callback: () => void): () => void {
  reavaliarSessao = callback;
  return () => {
    if (reavaliarSessao === callback) reavaliarSessao = null;
  };
}
