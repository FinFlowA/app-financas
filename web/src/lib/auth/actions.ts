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
import type { AuthActionState } from "@/lib/auth/state";
import {
  ageFromIsoDate,
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
    const { data, error } = await supabase.auth.signInWithPassword({
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

    const birthDate = data.user?.user_metadata?.data_nascimento;
    if (typeof birthDate === "string") {
      const age = ageFromIsoDate(birthDate);
      if (age !== null && age < 18) {
        await supabase.auth.signOut({ scope: "local" });
        return {
          status: "error",
          message: "O FinFlow está disponível somente para maiores de 18 anos.",
          values: { email },
        };
      }
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
        queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
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

export async function updatePasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const validation = validateNewPassword(formData);
  if (!validation.ok) return { status: "error", errors: validation.errors };

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
