import {
  handleOptions,
  HttpRequestError,
  json,
  readJsonRequest,
} from "../_shared/http.ts";
import {
  mercadoPago,
  MercadoPagoRequestError,
} from "../_shared/mercado-pago.ts";
import { adminClient, authenticatedUser, serverSecret } from "../_shared/supabase.ts";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{8,100}$/;
const ALLOWED_PRODUCTS = new Set([
  "smart_monthly",
  "smart_annual",
  "premium_monthly",
  "premium_annual",
]);

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function checkoutUrl(row: JsonObject | null | undefined): string | null {
  const payload = asObject(row?.provider_payload);
  return typeof payload.init_point === "string" && payload.init_point.startsWith("https://")
    ? payload.init_point
    : null;
}

function checkoutErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate) ? candidate : "CHECKOUT_FAILED";
}

function idempotencyKey(body: JsonObject, req: Request): string {
  const supplied = req.headers.get("x-idempotency-key") ?? body.requestId;
  if (supplied != null) {
    if (typeof supplied !== "string" || !REQUEST_ID_PATTERN.test(supplied)) {
      throw new HttpRequestError("INVALID_IDEMPOTENCY_KEY", 400);
    }
    return `client:${supplied}`;
  }
  // Clientes antigos ainda ganham idempotência por janela sem precisarem de uma
  // atualização imediata. O product_code também faz parte do índice único.
  return `automatic:${Math.floor(Date.now() / 900_000)}`;
}

function retryResponse(req: Request, row: JsonObject) {
  const ageMs = Date.now() - Date.parse(String(row.created_at ?? ""));
  const hasError = typeof row.checkout_error_code === "string";
  if (hasError || !Number.isFinite(ageMs) || ageMs >= 120_000) {
    return json(
      { error: "CHECKOUT_RECONCILIATION_REQUIRED" },
      503,
      req,
      { "Retry-After": "300" },
    );
  }
  const retryAfter = Math.max(2, Math.ceil((120_000 - ageMs) / 1_000));
  return json(
    { error: "CHECKOUT_PROCESSING" },
    409,
    req,
    { "Retry-After": String(retryAfter) },
  );
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, req);

  let admin: ReturnType<typeof adminClient> | null = null;
  let localId: string | null = null;
  let localPayload: JsonObject = {};
  let providerIdForRecovery: string | null = null;
  let providerCustomerForRecovery: string | null = null;

  try {
    const { body } = await readJsonRequest(req, {
      maxBytes: 2_048,
      allowedFields: ["productCode", "requestId"],
    });
    const productCode = typeof body.productCode === "string" ? body.productCode.trim() : "";
    if (!ALLOWED_PRODUCTS.has(productCode)) {
      return json({ error: "INVALID_PRODUCT" }, 400, req);
    }
    const checkoutKey = idempotencyKey(body, req);

    const user = await authenticatedUser(req);
    if (!user.email) return json({ error: "EMAIL_REQUIRED" }, 400, req);
    admin = adminClient();

    const { data: settings, error: settingsError } = await admin
      .from("billing_settings")
      .select("billing_enabled")
      .eq("id", true)
      .single();
    if (settingsError) throw new Error("BILLING_CONFIGURATION_FAILED");
    if (!settings?.billing_enabled) return json({ error: "BILLING_NOT_AVAILABLE" }, 409, req);

    const { data: product, error: productError } = await admin
      .from("billing_products")
      .select("code, plan, billing_cycle, amount_brl, active")
      .eq("code", productCode)
      .eq("active", true)
      .single();
    if (productError || !product) return json({ error: "INVALID_PRODUCT" }, 400, req);

    const { data: replay, error: replayError } = await admin
      .from("subscriptions")
      .select("id,status,provider_payload,created_at,checkout_error_code")
      .eq("user_id", user.id)
      .eq("product_code", product.code)
      .eq("checkout_idempotency_key", checkoutKey)
      .maybeSingle();
    if (replayError) throw new Error("CHECKOUT_IDEMPOTENCY_LOOKUP_FAILED");
    if (replay) {
      const url = checkoutUrl(replay);
      if (url) {
        return json({ checkoutUrl: url, subscriptionId: replay.id, replayed: true }, 200, req);
      }
      return retryResponse(req, replay);
    }

    // Uma tentativa cujo resultado externo ficou ambíguo nunca é duplicada
    // automaticamente. Ela exige reconciliação antes de criar outra assinatura.
    const { data: unresolved, error: unresolvedError } = await admin
      .from("subscriptions")
      .select("id,status,provider_payload,created_at,checkout_error_code")
      .eq("user_id", user.id)
      .eq("product_code", product.code)
      .eq("provider", "mercado_pago")
      .eq("status", "pending")
      .is("provider_subscription_id", null)
      .not("checkout_idempotency_key", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (unresolvedError) throw new Error("CHECKOUT_RECONCILIATION_LOOKUP_FAILED");
    if (unresolved) return retryResponse(req, unresolved);

    // O limite global evita rotação entre planos; o específico reduz duplicatas
    // do mesmo produto. Replays idempotentes retornam antes e não consomem cota.
    for (const limitConfig of [
      { subject: `user:${user.id}`, cooldown: 10, maximum: 8 },
      { subject: `product:${user.id}:${product.code}`, cooldown: 30, maximum: 4 },
    ]) {
      const { data: rateData, error: rateError } = await admin.rpc(
        "reserve_edge_rate_limit",
        {
          p_scope: "subscription_checkout",
          p_subject: limitConfig.subject,
          p_cooldown_seconds: limitConfig.cooldown,
          p_window_seconds: 3_600,
          p_max_attempts: limitConfig.maximum,
        },
      );
      if (rateError) throw new Error("CHECKOUT_RATE_LIMIT_UNAVAILABLE");
      const rate = asObject(Array.isArray(rateData) ? rateData[0] : rateData);
      if (rate.allowed !== true) {
        const retryAfter = Math.max(1, Math.min(3_600, Number(rate.retry_after) || 30));
        return json(
          { error: "CHECKOUT_RATE_LIMITED" },
          429,
          req,
          { "Retry-After": String(retryAfter) },
        );
      }
    }

    localPayload = { checkout_idempotency_key: checkoutKey };
    const { data: local, error: insertError } = await admin.from("subscriptions").insert({
      user_id: user.id,
      product_code: product.code,
      plan: product.plan,
      billing_cycle: product.billing_cycle,
      provider: "mercado_pago",
      status: "pending",
      checkout_idempotency_key: checkoutKey,
      checkout_error_code: null,
      checkout_last_attempt_at: new Date().toISOString(),
      checkout_attempt_count: 1,
      provider_payload: localPayload,
    }).select("id").single();
    if (insertError?.code === "23505") {
      const { data: concurrent, error: concurrentError } = await admin
        .from("subscriptions")
        .select("id,status,provider_payload,created_at,checkout_error_code")
        .eq("user_id", user.id)
        .eq("product_code", product.code)
        .eq("checkout_idempotency_key", checkoutKey)
        .single();
      if (concurrentError || !concurrent) throw new Error("CHECKOUT_IDEMPOTENCY_LOOKUP_FAILED");
      const url = checkoutUrl(concurrent);
      if (url) return json({ checkoutUrl: url, subscriptionId: concurrent.id, replayed: true }, 200, req);
      return retryResponse(req, concurrent ?? {});
    }
    if (insertError || !local) throw new Error("LOCAL_SUBSCRIPTION_FAILED");
    localId = String(local.id);

    const frequency = product.billing_cycle === "annual" ? 12 : 1;
    const backUrl = serverSecret("FINFLOW_BILLING_RETURN_URL");
    const externalReference = `${user.id}:${local.id}`;
    const mp = asObject(await mercadoPago("/preapproval", {
      method: "POST",
      body: JSON.stringify({
        reason: `FinFlow ${product.plan === "premium" ? "Premium" : "Smart"} - ${product.billing_cycle === "annual" ? "Anual" : "Mensal"}`,
        external_reference: externalReference,
        payer_email: user.email,
        auto_recurring: {
          frequency,
          frequency_type: "months",
          transaction_amount: Number(product.amount_brl),
          currency_id: "BRL",
        },
        back_url: backUrl,
        status: "pending",
      }),
    }));
    const providerId = typeof mp.id === "string" ? mp.id : "";
    const initPoint = typeof mp.init_point === "string" ? mp.init_point : "";
    if (!providerId || !initPoint.startsWith("https://")) {
      throw new Error("INVALID_PROVIDER_RESPONSE");
    }
    providerIdForRecovery = providerId;
    providerCustomerForRecovery = mp.payer_id ? String(mp.payer_id) : null;

    const completedPayload = {
      ...localPayload,
      init_point: initPoint,
      date_created: mp.date_created,
    };
    localPayload = completedPayload;
    const { error: updateError } = await admin.from("subscriptions").update({
      provider_subscription_id: providerId,
      provider_customer_id: mp.payer_id ? String(mp.payer_id) : null,
      status: "pending",
      provider_payload: completedPayload,
      checkout_error_code: null,
      last_provider_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", local.id).eq("user_id", user.id);
    if (updateError) throw new Error("LOCAL_SUBSCRIPTION_UPDATE_FAILED");

    return json({ checkoutUrl: initPoint, subscriptionId: local.id, replayed: false }, 200, req);
  } catch (error) {
    const code = checkoutErrorCode(error);
    if (admin && localId) {
      const definitiveRejection = error instanceof MercadoPagoRequestError
        && error.status != null
        && error.status >= 400
        && error.status < 500
        && error.status !== 429;
      const failureState: JsonObject = {
        status: definitiveRejection ? "expired" : "pending",
        checkout_error_code: code,
        provider_payload: {
          ...localPayload,
          checkout_error_code: code,
          checkout_requires_reconciliation: !definitiveRejection,
        },
        updated_at: new Date().toISOString(),
      };
      if (providerIdForRecovery) {
        failureState.provider_subscription_id = providerIdForRecovery;
        failureState.provider_customer_id = providerCustomerForRecovery;
        failureState.last_provider_sync_at = new Date().toISOString();
      }
      const { error: failureWriteError } = await admin.from("subscriptions").update(failureState)
        .eq("id", localId);
      if (failureWriteError) console.error("create-subscription-checkout", "FAILURE_STATE_WRITE_FAILED");
    }
    if (error instanceof HttpRequestError) {
      return json({ error: error.message }, error.status, req);
    }
    if (code === "UNAUTHORIZED") return json({ error: code }, 401, req);
    console.error("create-subscription-checkout", code);
    return json({ error: "CHECKOUT_FAILED" }, 500, req);
  }
});
