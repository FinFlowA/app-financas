import { handleOptions, json } from "../_shared/http.ts";
import { mercadoPago } from "../_shared/mercado-pago.ts";
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
      .in("status", ["active", "grace_period", "past_due", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!subscription?.provider_subscription_id) return json({ error: "NO_ACTIVE_SUBSCRIPTION" }, 404);

    await mercadoPago(`/preapproval/${encodeURIComponent(subscription.provider_subscription_id)}`, {
      method: "PUT",
      body: JSON.stringify({ status: "canceled" }),
    });
    const accessUntil = subscription.access_until ?? subscription.current_period_end ?? new Date().toISOString();
    await admin.from("subscriptions").update({
      status: "cancelled",
      cancel_at_period_end: true,
      cancelled_at: new Date().toISOString(),
      access_until: accessUntil,
      last_provider_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", subscription.id);

    return json({ cancelled: true, accessUntil });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ error: "UNAUTHORIZED" }, 401);
    console.error("cancel-subscription", error);
    return json({ error: "CANCEL_FAILED" }, 500);
  }
});
