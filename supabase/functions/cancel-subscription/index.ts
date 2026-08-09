import { handleOptions, json } from "../_shared/http.ts";
import { mercadoPago } from "../_shared/mercado-pago.ts";
import { adminClient, authenticatedUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, req);
  try {
    const user = await authenticatedUser(req);
    const admin = adminClient();
    const { data: subscription, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "mercado_pago")
      .in("status", ["active", "grace_period", "past_due", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");
    if (!subscription?.provider_subscription_id) return json({ error: "NO_ACTIVE_SUBSCRIPTION" }, 404, req);

    await mercadoPago(`/preapproval/${encodeURIComponent(subscription.provider_subscription_id)}`, {
      method: "PUT",
      body: JSON.stringify({ status: "canceled" }),
    });
    const accessUntil = subscription.access_until ?? subscription.current_period_end ?? new Date().toISOString();
    const { error: updateError } = await admin.from("subscriptions").update({
      status: "cancelled",
      cancel_at_period_end: true,
      cancelled_at: new Date().toISOString(),
      access_until: accessUntil,
      last_provider_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", subscription.id).eq("user_id", user.id);
    if (updateError) throw new Error("SUBSCRIPTION_UPDATE_FAILED");

    return json({ cancelled: true, accessUntil }, 200, req);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ error: "UNAUTHORIZED" }, 401, req);
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message)
      ? error.message
      : "UNKNOWN";
    console.error("cancel-subscription", code);
    return json({ error: "CANCEL_FAILED" }, 500, req);
  }
});
