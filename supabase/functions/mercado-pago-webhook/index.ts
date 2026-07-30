import { handleOptions, json } from "../_shared/http.ts";
import { mapMercadoPagoStatus, mercadoPago, verifyMercadoPagoSignature } from "../_shared/mercado-pago.ts";
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const payload = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const dataId = String(payload?.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
    if (!dataId || !(await verifyMercadoPagoSignature(req, dataId))) {
      return json({ error: "INVALID_SIGNATURE" }, 401);
    }

    const topic = String(payload?.type ?? payload?.topic ?? url.searchParams.get("topic") ?? "unknown");
    const eventId = String(payload?.id ?? `${topic}:${dataId}:${payload?.date_created ?? ""}`);
    const admin = adminClient();
    const { data: event, error: eventError } = await admin.from("subscription_events").insert({
      provider: "mercado_pago",
      provider_event_id: eventId,
      event_type: topic,
      payload,
    }).select("id").single();
    if (eventError?.code === "23505") return json({ received: true });
    if (eventError || !event) throw eventError ?? new Error("EVENT_INSERT_FAILED");

    let providerSubscriptionId = dataId;
    if (topic.includes("authorized_payment") || topic === "payment") {
      const endpoint = topic === "payment" ? `/v1/payments/${encodeURIComponent(dataId)}` : `/authorized_payments/${encodeURIComponent(dataId)}`;
      const payment = await mercadoPago(endpoint);
      providerSubscriptionId = String(payment.preapproval_id ?? payment.subscription_id ?? "");
    }
    if (!providerSubscriptionId) throw new Error("SUBSCRIPTION_ID_MISSING");

    const mp = await mercadoPago(`/preapproval/${encodeURIComponent(providerSubscriptionId)}`);
    const reference = String(mp.external_reference ?? "");
    const [userId, localId] = reference.split(":");
    if (!userId || !localId) throw new Error("INVALID_EXTERNAL_REFERENCE");

    const { data: subscription } = await admin
      .from("subscriptions")
      .select("*")
      .eq("id", localId)
      .eq("user_id", userId)
      .eq("provider", "mercado_pago")
      .eq("provider_subscription_id", providerSubscriptionId)
      .single();
    if (!subscription) throw new Error("SUBSCRIPTION_NOT_FOUND");

    const status = mapMercadoPagoStatus(mp.status);
    const nextPayment = mp.next_payment_date ?? subscription.current_period_end;
    const accessUntil = status === "active" ? nextPayment : subscription.access_until;
    await admin.from("subscriptions").update({
      status,
      started_at: subscription.started_at ?? mp.date_created,
      current_period_end: nextPayment,
      access_until: accessUntil,
      last_provider_sync_at: new Date().toISOString(),
      provider_payload: { ...subscription.provider_payload, last_status: mp.status },
      updated_at: new Date().toISOString(),
    }).eq("id", subscription.id);
    await admin.from("subscription_events").update({
      subscription_id: subscription.id,
      processed_at: new Date().toISOString(),
    }).eq("id", event.id);
    return json({ received: true });
  } catch (error) {
    console.error("mercado-pago-webhook", error);
    return json({ error: "WEBHOOK_FAILED" }, 500);
  }
});
