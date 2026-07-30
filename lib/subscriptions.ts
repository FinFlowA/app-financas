import { supabase } from "./supabase";
import type { TipoPlano } from "./planos";

export type Entitlement = {
  plan: TipoPlano;
  subscriptionStatus: string;
  billingCycle: "monthly" | "annual" | null;
  provider: "mercado_pago" | "google_play" | "apple" | null;
  accessUntil: string | null;
  billingEnabled: boolean;
  limitsEnabled: boolean;
};

export const DEVELOPMENT_ENTITLEMENT: Entitlement = {
  plan: "free",
  subscriptionStatus: "none",
  billingCycle: null,
  provider: null,
  accessUntil: null,
  billingEnabled: false,
  limitsEnabled: false,
};

export async function fetchMyEntitlement(): Promise<Entitlement> {
  const { data, error } = await supabase.rpc("get_my_entitlement");
  if (error) {
    // Compatibilidade enquanto a migração ainda não foi aplicada:
    // mantém limites desligados, mas nunca concede uma assinatura paga.
    console.warn("Entitlement indisponível; usando modo de desenvolvimento seguro.", error.message);
    return DEVELOPMENT_ENTITLEMENT;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return DEVELOPMENT_ENTITLEMENT;
  return {
    plan: row.plan === "smart" || row.plan === "premium" ? row.plan : "free",
    subscriptionStatus: row.subscription_status ?? "none",
    billingCycle: row.billing_cycle ?? null,
    provider: row.provider ?? null,
    accessUntil: row.access_until ?? null,
    billingEnabled: Boolean(row.billing_enabled),
    limitsEnabled: Boolean(row.limits_enabled),
  };
}

export async function createSubscriptionCheckout(productCode: string) {
  const { data, error } = await supabase.functions.invoke("create-subscription-checkout", {
    body: { productCode },
  });
  if (error) throw error;
  return data as { checkoutUrl: string; subscriptionId: string };
}

export async function syncSubscription() {
  const { data, error } = await supabase.functions.invoke("sync-subscription");
  if (error) throw error;
  return data;
}

export async function cancelSubscription() {
  const { data, error } = await supabase.functions.invoke("cancel-subscription");
  if (error) throw error;
  return data as { cancelled: boolean; accessUntil: string };
}
