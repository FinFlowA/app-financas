"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const PRODUCT_CODES = new Set([
  "smart_monthly",
  "smart_annual",
  "premium_monthly",
  "premium_annual",
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{8,100}$/;
const BLOCKING_SUBSCRIPTION_STATUSES = [
  "pending",
  "active",
  "past_due",
  "grace_period",
  "paused",
];

export type PlanActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function formText(formData: FormData, key: string, maximum: number): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function errorState(message: string): PlanActionState {
  return { status: "error", message };
}

function successState(message: string): PlanActionState {
  return { status: "success", message };
}

function checkoutUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    const mercadoPagoHost = hostname === "mercadopago.com"
      || hostname.endsWith(".mercadopago.com")
      || hostname === "mercadopago.com.br"
      || hostname.endsWith(".mercadopago.com.br");
    return url.protocol === "https:" && mercadoPagoHost ? url.toString() : null;
  } catch {
    return null;
  }
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { supabase, user };
}

async function functionErrorCode(error: unknown, data: unknown): Promise<string> {
  const direct = asObject(data).error;
  if (typeof direct === "string") return direct;

  if (error && typeof error === "object" && "context" in error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      try {
        const payload = asObject(await response.clone().json());
        if (typeof payload.error === "string") return payload.error;
      } catch {
        // A mensagem genérica abaixo não expõe detalhes internos do provedor.
      }
    }
  }
  return "UNKNOWN";
}

function checkoutErrorMessage(code: string): string {
  switch (code) {
    case "BILLING_NOT_AVAILABLE": return "As cobranças ainda não estão disponíveis.";
    case "CHECKOUT_PROCESSING": return "Seu checkout ainda está sendo preparado. Aguarde alguns instantes e tente novamente.";
    case "CHECKOUT_RECONCILIATION_REQUIRED": return "Há um checkout pendente de conferência. Atualize a assinatura antes de tentar de novo.";
    case "CHECKOUT_RATE_LIMITED": return "Muitas tentativas de checkout. Aguarde um pouco antes de tentar novamente.";
    case "EMAIL_REQUIRED": return "Sua conta precisa ter um e-mail confirmado para assinar.";
    case "INVALID_PRODUCT": return "Este produto não está disponível.";
    case "UNAUTHORIZED": return "Sua sessão expirou. Entre novamente para continuar.";
    default: return "Não foi possível abrir o checkout. Nenhuma cobrança foi confirmada.";
  }
}

export async function startCheckoutAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const auth = await authenticatedClient();
  if (!auth) return errorState("Sua sessão expirou. Entre novamente para continuar.");

  const productCode = formText(formData, "product_code", 40);
  const requestId = formText(formData, "request_id", 100);
  if (!PRODUCT_CODES.has(productCode)) return errorState("Escolha um produto válido.");
  if (!REQUEST_ID_PATTERN.test(requestId)) return errorState("Atualize a página e tente novamente.");

  const [{ data: entitlementData, error: entitlementError }, existingResult] = await Promise.all([
    auth.supabase.rpc("get_my_entitlement"),
    auth.supabase
      .from("subscriptions")
      .select("product_code,status,provider_payload")
      .eq("user_id", auth.user.id)
      .in("status", BLOCKING_SUBSCRIPTION_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (entitlementError || existingResult.error) {
    return errorState("Não foi possível validar sua assinatura agora.");
  }

  const entitlementRow = Array.isArray(entitlementData) ? entitlementData[0] : entitlementData;
  const entitlement = asObject(entitlementRow);
  if (entitlement.billing_enabled !== true) {
    return errorState("As cobranças estão desativadas. Nenhuma cobrança será iniciada.");
  }

  const existing = existingResult.data;
  if (existing) {
    const payload = asObject(existing.provider_payload);
    const reusableUrl = existing.status === "pending" && existing.product_code === productCode
      ? checkoutUrl(payload.init_point)
      : null;
    if (reusableUrl) redirect(reusableUrl);
    return errorState(existing.status === "pending"
      ? "Já existe um checkout pendente. Atualize a assinatura antes de iniciar outro."
      : "Você já possui uma assinatura em andamento. Cancele-a antes de contratar outro plano.");
  }

  const { data, error } = await auth.supabase.functions.invoke("create-subscription-checkout", {
    body: { productCode, requestId },
    headers: { "x-idempotency-key": requestId },
  });
  if (error) {
    return errorState(checkoutErrorMessage(await functionErrorCode(error, data)));
  }

  const destination = checkoutUrl(asObject(data).checkoutUrl);
  if (!destination) {
    return errorState("O provedor não retornou um endereço de checkout válido. Nenhuma cobrança foi confirmada.");
  }
  redirect(destination);
}

export async function syncSubscriptionAction(
  _previous: PlanActionState,
  _formData: FormData,
): Promise<PlanActionState> {
  void _previous;
  void _formData;
  const auth = await authenticatedClient();
  if (!auth) return errorState("Sua sessão expirou. Entre novamente para continuar.");

  const { data, error } = await auth.supabase.functions.invoke("sync-subscription", {
    body: {},
  });
  if (error) {
    const code = await functionErrorCode(error, data);
    return errorState(code === "UNAUTHORIZED"
      ? "Sua sessão expirou. Entre novamente para continuar."
      : "Não foi possível consultar o provedor agora. Tente novamente em alguns instantes.");
  }

  revalidatePath("/planos");
  revalidatePath("/configuracoes");
  revalidatePath("/");
  const payload = asObject(data);
  return successState(payload.status === "none"
    ? "Nenhuma assinatura foi encontrada para sincronizar."
    : "Assinatura atualizada com o status mais recente do provedor.");
}

export async function cancelSubscriptionAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const auth = await authenticatedClient();
  if (!auth) return errorState("Sua sessão expirou. Entre novamente para continuar.");
  if (formText(formData, "confirmation", 30) !== "cancel_subscription") {
    return errorState("Confirmação de cancelamento inválida.");
  }

  const { data, error } = await auth.supabase.functions.invoke("cancel-subscription", {
    body: {},
  });
  if (error) {
    const code = await functionErrorCode(error, data);
    const message = code === "NO_ACTIVE_SUBSCRIPTION"
      ? "Não há assinatura ativa para cancelar. Atualize o status e tente novamente."
      : code === "UNAUTHORIZED"
        ? "Sua sessão expirou. Entre novamente para continuar."
        : "Não foi possível cancelar no provedor. Sua assinatura não foi alterada.";
    return errorState(message);
  }

  revalidatePath("/planos");
  revalidatePath("/configuracoes");
  revalidatePath("/");
  const accessUntil = asObject(data).accessUntil;
  const accessDate = typeof accessUntil === "string" ? new Date(accessUntil) : null;
  const suffix = accessDate && Number.isFinite(accessDate.getTime())
    ? ` O acesso pago permanece até ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(accessDate)}.`
    : "";
  return successState(`Renovação cancelada com sucesso.${suffix}`);
}
