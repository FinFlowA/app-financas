import { handleOptions, HttpRequestError, isRequestOriginAllowed, json, readJsonRequest } from "../_shared/http.ts";
import { adminClient, authenticatedUser } from "../_shared/supabase.ts";
import { acknowledgeGooglePlaySubscription, getGooglePlaySubscription, googlePlayAccountHash, googlePlayPackageName, normalizedSubscription, productConfiguration } from "../_shared/google-play.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, req);
  if (!isRequestOriginAllowed(req)) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403, req);
  try {
    const user = await authenticatedUser(req);
    const { body } = await readJsonRequest(req, { maxBytes: 8_192, allowedFields: ["purchaseToken", "productId"] });
    const purchaseToken = typeof body.purchaseToken === "string" ? body.purchaseToken.trim() : "";
    const requestedProductId = typeof body.productId === "string" ? body.productId.trim() : "";
    if (!purchaseToken || purchaseToken.length > 4096 || !requestedProductId) throw new HttpRequestError("INVALID_PURCHASE", 400);

    const raw = await getGooglePlaySubscription(purchaseToken);
    const purchase = normalizedSubscription(raw);
    if (purchase.productId !== requestedProductId) throw new HttpRequestError("GOOGLE_PLAY_PRODUCT_MISMATCH", 403);
    const expectedAccount = await googlePlayAccountHash(user.id);
    if (!purchase.obfuscatedAccountId || purchase.obfuscatedAccountId !== expectedAccount) {
      throw new HttpRequestError("GOOGLE_PLAY_ACCOUNT_MISMATCH", 403);
    }
    const configured = productConfiguration(purchase.productId, purchase.basePlanId);
    const admin = adminClient();
    const { error } = await admin.rpc("upsert_google_play_subscription", {
      p_user_id: user.id,
      p_purchase_token: purchaseToken,
      p_package_name: googlePlayPackageName(),
      p_product_id: purchase.productId,
      p_base_plan_id: purchase.basePlanId,
      p_plan: configured.plan,
      p_billing_cycle: configured.cycle,
      p_status: purchase.status,
      p_order_id: purchase.orderId,
      p_started_at: purchase.startedAt,
      p_expiry_at: purchase.expiryAt,
      p_auto_renewing: purchase.autoRenewing,
      p_acknowledgement_state: purchase.acknowledgementState,
      p_linked_purchase_token: purchase.linkedPurchaseToken,
      p_payload: raw,
    });
    if (error) throw new Error(`GOOGLE_PLAY_PERSIST_FAILED:${error.message}`);

    if (purchase.status === "active" && purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
      await acknowledgeGooglePlaySubscription(purchase.productId, purchaseToken);
    }
    return json({ verified: true, status: purchase.status, plan: configured.plan, billingCycle: configured.cycle }, 200, req);
  } catch (error) {
    const status = error instanceof HttpRequestError ? error.status : error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 502;
    const code = error instanceof Error ? error.message.split(":", 1)[0] : "GOOGLE_PLAY_VERIFY_FAILED";
    console.error("google-play-verify-purchase", code);
    return json({ error: code }, status, req);
  }
});
