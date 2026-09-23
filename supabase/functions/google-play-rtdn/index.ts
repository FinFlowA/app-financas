import { adminClient, serverSecret } from "../_shared/supabase.ts";
import { getGooglePlaySubscription, googlePlayPackageName, normalizedSubscription, productConfiguration } from "../_shared/google-play.ts";

function response(status = 204) { return new Response(null, { status }); }

async function verifyPushIdentity(req: Request) {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return false;
  const check = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(bearer)}`);
  if (!check.ok) return false;
  const token = await check.json();
  return (token.iss === "https://accounts.google.com" || token.iss === "accounts.google.com")
    && token.aud === serverSecret("GOOGLE_PLAY_PUBSUB_AUDIENCE")
    && token.email === serverSecret("GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL")
    && (token.email_verified === "true" || token.email_verified === true);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response(405);
  if (!await verifyPushIdentity(req)) return response(401);
  let envelope: Record<string, any>;
  try { envelope = await req.json(); } catch { return response(400); }
  const message = envelope.message;
  if (!message?.messageId || !message?.data) return response(400);

  const admin = adminClient();
  const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0))));
  const notification = decoded.subscriptionNotification;
  const purchaseToken = notification?.purchaseToken ?? null;
  const eventTime = decoded.eventTimeMillis ? new Date(Number(decoded.eventTimeMillis)).toISOString() : null;
  const { error: insertError } = await admin.from("google_play_rtdn_events").insert({
    message_id: message.messageId,
    notification_type: notification?.notificationType ?? null,
    purchase_token: purchaseToken,
    event_time: eventTime,
    payload: decoded,
  });
  if (insertError?.code === "23505") return response();
  if (insertError) return response(500);
  if (!purchaseToken) {
    await admin.from("google_play_rtdn_events").update({ status: "ignored", processed_at: new Date().toISOString() }).eq("message_id", message.messageId);
    return response();
  }

  const { data: bound } = await admin.from("google_play_purchases").select("user_id").eq("purchase_token", purchaseToken).maybeSingle();
  if (!bound?.user_id) {
    await admin.from("google_play_rtdn_events").update({ status: "unbound", processed_at: new Date().toISOString() }).eq("message_id", message.messageId);
    return response();
  }
  try {
    const raw = await getGooglePlaySubscription(purchaseToken);
    const purchase = normalizedSubscription(raw);
    const configured = productConfiguration(purchase.productId, purchase.basePlanId);
    const { error } = await admin.rpc("upsert_google_play_subscription", {
      p_user_id: bound.user_id, p_purchase_token: purchaseToken,
      p_package_name: googlePlayPackageName(), p_product_id: purchase.productId,
      p_base_plan_id: purchase.basePlanId, p_plan: configured.plan,
      p_billing_cycle: configured.cycle, p_status: purchase.status,
      p_order_id: purchase.orderId, p_started_at: purchase.startedAt,
      p_expiry_at: purchase.expiryAt, p_auto_renewing: purchase.autoRenewing,
      p_acknowledgement_state: purchase.acknowledgementState,
      p_linked_purchase_token: purchase.linkedPurchaseToken, p_payload: raw,
    });
    if (error) throw error;
    await admin.from("google_play_rtdn_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("message_id", message.messageId);
    return response();
  } catch (error) {
    console.error("google-play-rtdn", error instanceof Error ? error.message : "UNKNOWN");
    await admin.from("google_play_rtdn_events").update({ status: "failed", error: "SYNC_FAILED", processed_at: new Date().toISOString() }).eq("message_id", message.messageId);
    return response(500);
  }
});
