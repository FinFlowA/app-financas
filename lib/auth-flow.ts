import type { SupabaseClient } from "@supabase/supabase-js";

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

/** O marcador vale para este usuário e ainda não venceu. */
export function fluxoRecuperacaoVigente(
  fluxo: PasswordRecoveryFlow | null,
  userId: string | null | undefined,
  agora = Date.now(),
): boolean {
  return Boolean(fluxo && userId && fluxo.userId === userId && fluxo.expiresAt > agora);
}

/** Quanto a tela de nova senha espera por um link ainda em processamento. */
export const PASSWORD_RECOVERY_LINK_WAIT_MS = 30_000;

export type MotivoFalhaRecuperacao = "expirado" | "outro_aparelho" | "sem_conexao" | "desconhecido";

export type EstadoLinkRecuperacao =
  | { etapa: "processando"; desde: number }
  | { etapa: "falhou"; motivo: MotivoFalhaRecuperacao };

/**
 * Estado do link de recuperação enquanto o _layout troca o código por uma
 * sessão. Fica só em memória: a tela de nova senha consulta este estado para
 * esperar a troca terminar (rede lenta, app aberto do zero pelo link) e, se
 * ela falhar, explicar o motivo em vez de só dizer "inválido ou expirado".
 */
let estadoLinkRecuperacao: EstadoLinkRecuperacao | null = null;

export function registrarEstadoLinkRecuperacao(estado: EstadoLinkRecuperacao | null): void {
  estadoLinkRecuperacao = estado;
}

export function lerEstadoLinkRecuperacao(): EstadoLinkRecuperacao | null {
  return estadoLinkRecuperacao;
}

/**
 * Erro que o Supabase devolve no próprio link quando o token do e-mail já foi
 * usado ou expirou (ex.: error_code=otp_expired). No fluxo PKCE ele vem na
 * query e no fragmento; no implícito, só no fragmento.
 */
export function erroNoLinkDeAutenticacao(url: string): string | null {
  const [semFragmento, fragmento = ""] = url.split("#");
  const query = semFragmento.includes("?") ? semFragmento.slice(semFragmento.indexOf("?") + 1) : "";
  for (const parte of [query, fragmento]) {
    const params = new URLSearchParams(parte);
    const codigo = params.get("error_code") ?? params.get("error");
    if (codigo) return [codigo, params.get("error_description")].filter(Boolean).join(" ");
  }
  return null;
}

/** Traduz o erro do Supabase (troca do código ou link devolvido com erro). */
export function motivoFalhaRecuperacao(
  erro: { message?: string | null; code?: string | null; name?: string | null } | string | null | undefined,
): MotivoFalhaRecuperacao {
  const texto = typeof erro === "string" ? erro : `${erro?.name ?? ""} ${erro?.code ?? ""} ${erro?.message ?? ""}`;
  // A troca nem chegou ao servidor: o código continua valendo.
  if (/network|fetch|timed?.?out|RetryableFetch/i.test(texto)) return "sem_conexao";
  // PKCE: o código só troca no app que pediu a recuperação.
  if (/code.?verifier|flow.?state/i.test(texto)) return "outro_aparelho";
  if (/expired|already used|been used|invalid.?(grant|code|token)|access_denied/i.test(texto)) return "expirado";
  return "desconhecido";
}

export function mensagemFalhaRecuperacao(motivo: MotivoFalhaRecuperacao | null): string {
  if (motivo === "sem_conexao") {
    return "Sem conexão para validar o link. Confira a internet e toque de novo no link do e-mail.";
  }
  if (motivo === "outro_aparelho") {
    return "Abra o link no mesmo celular em que você pediu a nova senha, com o FinFlow instalado. Se preferir, peça um novo link na tela de login, em \"Esqueci minha senha\".";
  }
  if (motivo === "expirado") {
    return "Este link já foi usado ou expirou. Ele funciona uma única vez, e alguns aplicativos de e-mail abrem links sozinhos para checar segurança. Peça um novo link na tela de login, em \"Esqueci minha senha\".";
  }
  return "Não foi possível validar o link. Peça um novo link na tela de login, em \"Esqueci minha senha\".";
}

export type ResultadoLoginOAuth =
  | { status: "sucesso" }
  | { status: "senha_pendente" }
  | { status: "erro" };

/** Roda depois de exchangeCodeForSession bem-sucedido: confirma e-mail
 * verificado e liga o tutorial no primeiro
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

  if (usuario.user_metadata?.tutorial_pendente === undefined) {
    await supabase.auth.updateUser({
      data: { ...usuario.user_metadata, tutorial_pendente: true },
    });
  }

  if (usuario.app_metadata?.provider === "google" && usuario.user_metadata?.senha_definida !== true) {
    return { status: "senha_pendente" };
  }

  return { status: "sucesso" };
}
