import "server-only";

type AuthErrorLike = {
  code?: unknown;
  status?: unknown;
};

const KNOWN_AUTH_CODES = new Set([
  "captcha_failed",
  "email_address_invalid",
  "email_exists",
  "email_not_confirmed",
  "email_provider_disabled",
  "over_email_send_rate_limit",
  "over_request_rate_limit",
  "signup_disabled",
  "user_already_exists",
  "weak_password",
]);

/** Classifica falhas de autenticação sem registrar mensagem, e-mail ou os
 * dados enviados pelo formulário. O código fica útil no log operacional sem
 * transformar o log em uma nova fonte de dados pessoais. */
export function logSafeAuthFailure(
  operation: "signup" | "resend-confirmation",
  error: AuthErrorLike,
): void {
  const rawCode = typeof error.code === "string" ? error.code : "";
  const code = KNOWN_AUTH_CODES.has(rawCode) ? rawCode : "unclassified";
  const status = typeof error.status === "number" && Number.isInteger(error.status)
    ? error.status
    : null;
  console.warn("[finflow-auth-failure]", { operation, code, status });
}

export function isAuthRateLimitError(error: AuthErrorLike): boolean {
  return error.status === 429
    || error.code === "over_request_rate_limit"
    || error.code === "over_email_send_rate_limit";
}

export function safeSignupErrorMessage(error: AuthErrorLike): string {
  if (isAuthRateLimitError(error)) {
    return "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.";
  }
  if (error.code === "user_already_exists" || error.code === "email_exists") {
    return "Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.";
  }
  if (error.code === "email_address_invalid") {
    return "O serviço de autenticação recusou esse endereço de e-mail. Confira o endereço e tente novamente.";
  }
  if (error.code === "weak_password") {
    return "A senha não atende aos requisitos de segurança informados no formulário.";
  }
  if (error.code === "signup_disabled" || error.code === "email_provider_disabled") {
    return "O cadastro por e-mail está temporariamente indisponível. Tente novamente mais tarde.";
  }
  if (error.code === "captcha_failed") {
    return "Não foi possível validar a tentativa de cadastro. Atualize a página e tente novamente.";
  }
  return "Não foi possível concluir agora. Verifique sua conexão e tente novamente.";
}
