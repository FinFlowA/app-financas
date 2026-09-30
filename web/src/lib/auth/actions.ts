"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  LEGAL_DOCUMENT_VERSION,
  RECOVERY_COOKIE_NAME,
} from "@/lib/auth/constants";
import { callbackUrl, getAppOrigin } from "@/lib/auth/origin";
import {
  isAuthRateLimitError,
  logSafeAuthFailure,
  safeSignupErrorMessage,
} from "@/lib/auth/safe-errors";
import { totpErrorMessage, verifyTotpCode } from "@/lib/auth/mfa";
import { isPwnedPassword, PWNED_PASSWORD_MESSAGE } from "@/lib/auth/pwned-password";
import type { AuthActionState } from "@/lib/auth/state";
import {
  validateLogin,
  validateNewPassword,
  validateRecoveryEmail,
  validateSignup,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

function isRateLimitError(error: { status?: number; code?: string }): boolean {
  return isAuthRateLimitError(error);
}

function safeUnexpectedMessage(): string {
  return "Não foi possível concluir agora. Verifique sua conexão e tente novamente.";
}

export async function signInAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const validation = validateLogin(formData);
  if (!validation.ok) return { status: "error", errors: validation.errors };

  const { email, senha } = validation.data;
  let authenticated = false;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (error) {
      if (error.code === "email_not_confirmed") {
        return {
          status: "error",
          message:
            "Seu e-mail ainda não foi confirmado. Confira a caixa de entrada e também o spam.",
          values: { email },
          canResendConfirmation: true,
        };
      }
      if (isRateLimitError(error)) {
        return {
          status: "error",
          message: "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.",
          values: { email },
        };
      }
      return {
        status: "error",
        message: "E-mail ou senha inválidos.",
        values: { email },
      };
    }

    authenticated = true;
  } catch {
    return { status: "error", message: safeUnexpectedMessage(), values: { email } };
  }

  if (authenticated) redirect("/");
  return { status: "error", message: safeUnexpectedMessage(), values: { email } };
}

export type OAuthProvider = "google" | "apple";

export async function signInWithOAuthAction(provider: OAuthProvider): Promise<void> {
  let destination: string | null = null;
  try {
    const origin = await getAppOrigin();
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl(origin, "oauth"),
        ...(provider === "google"
          ? { queryParams: { prompt: "select_account" } }
          : {}),
      },
    });
    if (!error && data.url) destination = data.url;
  } catch {
    // A interface recebe uma mensagem genérica; detalhes de configuração do
    // provedor não são expostos ao navegador nem registrados com PII.
  }

  redirect(destination ?? "/login?erro_oauth=1");
}

export async function signUpAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const validation = validateSignup(formData);
  const values = {
    nome: String(formData.get("nome") ?? "").slice(0, 80),
    email: String(formData.get("email") ?? "").slice(0, 254),
    telefone: String(formData.get("telefone") ?? "").slice(0, 30),
    dataNascimento: String(formData.get("dataNascimento") ?? "").slice(0, 10),
  };
  if (!validation.ok) {
    return { status: "error", errors: validation.errors, values };
  }

  const { nome, email, telefoneE164, dataNascimento, senha } = validation.data;
  if (await isPwnedPassword(senha)) {
    return { status: "error", errors: { senha: PWNED_PASSWORD_MESSAGE }, values };
  }
  let hasSession = false;

  try {
    const origin = await getAppOrigin();
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: {
        emailRedirectTo: callbackUrl(origin, "signup"),
        data: {
          nome_usuario: nome,
          full_name: nome,
          ...(telefoneE164 ? { telefone: telefoneE164 } : {}),
          data_nascimento: dataNascimento,
          termos_aceitos_em: new Date().toISOString(),
          termos_versao: LEGAL_DOCUMENT_VERSION,
          tutorial_pendente: true,
          senha_definida: true,
        },
      },
    });

    if (error) {
      logSafeAuthFailure("signup", error);
      return { status: "error", message: safeSignupErrorMessage(error), values };
    }

    if (!data.user || data.user.identities?.length === 0) {
      return {
        status: "error",
        message: "Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.",
        values,
      };
    }

    hasSession = Boolean(data.session);
  } catch {
    logSafeAuthFailure("signup", {});
    return { status: "error", message: safeUnexpectedMessage(), values };
  }

  if (hasSession) redirect("/");
  return {
    status: "success",
    message:
      "Conta criada! Enviamos um link de confirmação para seu e-mail. Verifique também a caixa de spam antes de entrar.",
    values: { email },
  };
}

export async function requestPasswordResetAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const validation = validateRecoveryEmail(formData);
  if (!validation.ok) return { status: "error", errors: validation.errors };
  const { email } = validation.data;

  try {
    const origin = await getAppOrigin();
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl(origin, "recovery"),
    });

    if (error && isRateLimitError(error)) {
      return {
        status: "error",
        message: "Muitas solicitações seguidas. Aguarde alguns minutos e tente novamente.",
        values: { email },
      };
    }
    if (error && error.status && error.status >= 500) {
      return { status: "error", message: safeUnexpectedMessage(), values: { email } };
    }
  } catch {
    return { status: "error", message: safeUnexpectedMessage(), values: { email } };
  }

  return {
    status: "success",
    message:
      "Se este e-mail estiver cadastrado, enviaremos um link para criar uma nova senha. Confira também a caixa de spam.",
    values: { email },
  };
}

export async function resendConfirmationAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const validation = validateRecoveryEmail(formData);
  if (!validation.ok) return { status: "error", errors: validation.errors };
  const { email } = validation.data;

  try {
    const origin = await getAppOrigin();
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: callbackUrl(origin, "signup") },
    });

    if (error && isRateLimitError(error)) {
      logSafeAuthFailure("resend-confirmation", error);
      return {
        status: "error",
        message: "Aguarde alguns minutos antes de solicitar outro e-mail.",
        values: { email },
      };
    }
    if (error) logSafeAuthFailure("resend-confirmation", error);
    if (error && error.status && error.status >= 500) {
      return { status: "error", message: safeUnexpectedMessage(), values: { email } };
    }
  } catch {
    return { status: "error", message: safeUnexpectedMessage(), values: { email } };
  }

  return {
    status: "success",
    message:
      "Se a confirmação ainda estiver pendente, um novo link será enviado. Confira também a caixa de spam.",
    values: { email },
  };
}

export async function defineOAuthPasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const validation = validateNewPassword(formData);
  if (!validation.ok) return { status: "error", errors: validation.errors };
  if (await isPwnedPassword(validation.data.senha)) {
    return { status: "error", errors: { senha: PWNED_PASSWORD_MESSAGE } };
  }
  try {
    const supabase = await createClient();
    const { data, error: userError } = await supabase.auth.getUser();
    const user = data.user;
    if (userError || !user || user.app_metadata?.provider !== "google") {
      return { status: "error", message: "Entre novamente com o Google para definir sua senha." };
    }
    const { error } = await supabase.auth.updateUser({
      password: validation.data.senha,
      data: { ...user.user_metadata, senha_definida: true },
    });
    if (error) return { status: "error", message: safeUnexpectedMessage() };
  } catch {
    return { status: "error", message: safeUnexpectedMessage() };
  }
  redirect("/");
}

export async function updatePasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const validation = validateNewPassword(formData);
  if (!validation.ok) return { status: "error", errors: validation.errors };
  if (await isPwnedPassword(validation.data.senha)) {
    return { status: "error", errors: { senha: PWNED_PASSWORD_MESSAGE } };
  }

  try {
    const cookieStore = await cookies();
    if (cookieStore.get(RECOVERY_COOKIE_NAME)?.value !== "1") {
      return {
        status: "error",
        message: "Este link de recuperação expirou ou já foi utilizado. Solicite um novo link.",
      };
    }

    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      cookieStore.delete(RECOVERY_COOKIE_NAME);
      return {
        status: "error",
        message: "Este link de recuperação expirou. Solicite um novo link.",
      };
    }

    const { error } = await supabase.auth.updateUser({ password: validation.data.senha });
    if (error) {
      if (isRateLimitError(error)) {
        return {
          status: "error",
          message: "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.",
        };
      }
      return { status: "error", message: safeUnexpectedMessage() };
    }

    cookieStore.delete(RECOVERY_COOKIE_NAME);
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    return { status: "error", message: safeUnexpectedMessage() };
  }

  redirect("/login?senha_alterada=1");
}

/**
 * Checagem de senha vazada para o painel de Segurança, que troca a senha no
 * navegador (o CSP não libera chamadas a terceiros). Exige sessão para não
 * virar um proxy aberto do HaveIBeenPwned.
 */
export async function checkPasswordExposureAction(password: string): Promise<{ pwned: boolean }> {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return { pwned: false };
  }
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return { pwned: false };
    return { pwned: await isPwnedPassword(password) };
  } catch {
    return { pwned: false };
  }
}

/**
 * Segunda etapa do login para quem ativou a verificação em duas etapas:
 * confere o código do app autenticador e eleva a sessão a AAL2.
 */
export async function verifyMfaChallengeAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const code = String(formData.get("codigo") ?? "").slice(0, 12);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { status: "error", message: "Sua sessão expirou. Entre novamente." };
    }
    const result = await verifyTotpCode(supabase, code);
    if (result !== "ok") return { status: "error", errors: { codigo: totpErrorMessage(result) } };
  } catch {
    return { status: "error", message: safeUnexpectedMessage() };
  }
  redirect("/");
}
