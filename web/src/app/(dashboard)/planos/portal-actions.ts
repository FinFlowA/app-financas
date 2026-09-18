"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaddleInstance } from "@/lib/paddle/server";

export async function createPortalSessionAction(): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Entre novamente para gerenciar sua assinatura." };

  const admin = createAdminClient();
  const { data: customer } = await admin
    .from("paddle_customers")
    .select("customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer?.customer_id) return { error: "Você ainda não possui uma assinatura Paddle vinculada." };

  const { data: subscriptions, error } = await admin
    .from("subscriptions")
    .select("provider_subscription_id")
    .eq("user_id", user.id)
    .eq("provider", "paddle")
    .in("status", ["active", "trialing", "grace_period", "paused"]);
  if (error) return { error: "Não foi possível consultar sua assinatura agora." };

  const ids = (subscriptions ?? [])
    .map((row) => row.provider_subscription_id)
    .filter((id): id is string => typeof id === "string" && id.startsWith("sub_"));
  const session = await getPaddleInstance().customerPortalSessions.create(customer.customer_id, ids);
  return { url: session.urls.general.overview };
}
