import { handleOptions, json } from "../_shared/http.ts";
import { mapMercadoPagoStatus, mercadoPago } from "../_shared/mercado-pago.ts";
import { adminClient, authenticatedUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  try {
    const user = await authenticatedUser(req);
    const admin = adminClient();
    const { data: subscription } = await admin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "mercado_pago")
      .not("provider_subscription_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!subscription) return json({ status: "none" });

    const mp = await mercadoPago(`/preapproval/${encodeURIComponent(subscription.provider_subscription_id)}`);
    const status = mapMercadoPagoStatus(mp.status);
    const nextPayment = mp.next_payment_date ?? subscription.current_period_end;
    const accessUntil = status === "active"
      ? nextPayment
      : subscription.access_until;
    await admin.from("subscriptions").update({
      status,
      started_at: subscription.started_at ?? mp.date_created,
      current_period_end: nextPayment,
      access_until: accessUntil,
      last_provider_sync_at: new Date().toISOString(),
      provider_payload: { ...subscription.provider_payload, last_status: mp.status },
      updated_at: new Date().toISOString(),
    }).eq("id", subscription.id);

    return json({ status, plan: subscription.plan, accessUntil });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ error: "UNAUTHORIZED" }, 401);
    console.error("sync-subscription", error);
    return json({ error: "SYNC_FAILED" }, 500);
  }
});
