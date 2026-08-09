import {
  handleOptions,
  HttpRequestError,
  json,
  readJsonRequest,
} from "../_shared/http.ts";
import {
  mapMercadoPagoStatus,
  mercadoPago,
  verifyMercadoPagoSignature,
} from "../_shared/mercado-pago.ts";
import { adminClient } from "../_shared/supabase.ts";

const MAX_WEBHOOK_BYTES = 32_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;
type EventClaim = { eventId: string; processingToken: string };

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function compactText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text && text.length <= maximum ? text : null;
}

function storedPayload(payload: JsonObject, dataId: string): JsonObject {
  const result: JsonObject = { data: { id: dataId } };
  const id = compactText(payload.id, 200);
  const type = compactText(payload.type, 100);
  const topic = compactText(payload.topic, 100);
  const action = compactText(payload.action, 100);
  const dateCreated = compactText(payload.date_created, 80);
  const apiVersion = compactText(payload.api_version, 40);
  if (id) result.id = id;
  if (type) result.type = type;
  if (topic) result.topic = topic;
  if (action) result.action = action;
  if (dateCreated) result.date_created = dateCreated;
  if (apiVersion) result.api_version = apiVersion;
  if (typeof payload.live_mode === "boolean") result.live_mode = payload.live_mode;
  return result;
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate) ? candidate : "WEBHOOK_FAILED";
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, req);

  let admin: ReturnType<typeof adminClient> | null = null;
  let claim: EventClaim | null = null;

  try {
    admin = adminClient();
    const { body: payload } = await readJsonRequest(req, { maxBytes: MAX_WEBHOOK_BYTES });
    const url = new URL(req.url);
    const payloadData = asObject(payload.data);
    const dataId = compactText(
      payloadData.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id"),
      200,
    ) ?? "";
    if (!dataId || !(await verifyMercadoPagoSignature(req, dataId))) {
      return json({ error: "INVALID_SIGNATURE" }, 401, req);
    }

    const topic = compactText(
      payload.type ?? payload.topic ?? url.searchParams.get("topic") ?? "unknown",
      100,
    ) ?? "unknown";
    const eventId = compactText(
      payload.id ?? `${topic}:${dataId}:${compactText(payload.date_created, 80) ?? "unknown"}`,
      240,
    );
    if (!eventId) return json({ error: "INVALID_EVENT" }, 400, req);

    const { data: claimData, error: claimError } = await admin.rpc(
      "claim_subscription_event",
      {
        p_provider: "mercado_pago",
        p_event_id: eventId,
        p_event_type: topic,
        p_payload: storedPayload(payload, dataId),
        p_lease_seconds: 60,
      },
    );
    if (claimError) throw new Error("WEBHOOK_CLAIM_FAILED");
    const claimed = asObject(Array.isArray(claimData) ? claimData[0] : claimData);
    if (claimed.processed === true) {
      return json({ received: true, replayed: true }, 200, req);
    }
    if (claimed.claimed !== true) {
      const retryAfter = Math.max(1, Math.min(300, Number(claimed.retry_after) || 2));
      return json(
        { error: "EVENT_PROCESSING" },
        503,
        req,
        { "Retry-After": String(retryAfter) },
      );
    }
    const eventUuid = compactText(claimed.event_id, 36);
    const processingToken = compactText(claimed.processing_token, 36);
    if (!eventUuid || !processingToken || !UUID_PATTERN.test(eventUuid) || !UUID_PATTERN.test(processingToken)) {
      throw new Error("WEBHOOK_CLAIM_FAILED");
    }
    claim = { eventId: eventUuid, processingToken };

    let providerSubscriptionId = dataId;
    if (topic.includes("authorized_payment") || topic === "payment") {
      const endpoint = topic === "payment"
        ? `/v1/payments/${encodeURIComponent(dataId)}`
        : `/authorized_payments/${encodeURIComponent(dataId)}`;
      const payment = asObject(await mercadoPago(endpoint));
      providerSubscriptionId = compactText(
        payment.preapproval_id ?? payment.subscription_id,
        200,
      ) ?? "";
    }
    if (!providerSubscriptionId) throw new Error("SUBSCRIPTION_ID_MISSING");

    const mp = asObject(await mercadoPago(`/preapproval/${encodeURIComponent(providerSubscriptionId)}`));
    const reference = compactText(mp.external_reference, 200) ?? "";
    const separator = reference.indexOf(":");
    const userId = separator > 0 ? reference.slice(0, separator) : "";
    const localId = separator > 0 ? reference.slice(separator + 1) : "";
    if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(localId)) {
      throw new Error("INVALID_EXTERNAL_REFERENCE");
    }

    const { data: subscription, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("*")
      .eq("id", localId)
      .eq("user_id", userId)
      .eq("provider", "mercado_pago")
      .eq("provider_subscription_id", providerSubscriptionId)
      .single();
    if (subscriptionError || !subscription) throw new Error("SUBSCRIPTION_NOT_FOUND");

    const status = mapMercadoPagoStatus(String(mp.status ?? ""));
    const nextPayment = mp.next_payment_date ?? subscription.current_period_end;
    const accessUntil = status === "active" ? nextPayment : subscription.access_until;
    const { error: updateError } = await admin.from("subscriptions").update({
      status,
      started_at: subscription.started_at ?? mp.date_created,
      current_period_end: nextPayment,
      access_until: accessUntil,
      last_provider_sync_at: new Date().toISOString(),
      provider_payload: { ...subscription.provider_payload, last_status: mp.status },
      updated_at: new Date().toISOString(),
    }).eq("id", subscription.id).eq("user_id", userId);
    if (updateError) throw new Error("SUBSCRIPTION_UPDATE_FAILED");

    const { data: finalized, error: finalizationError } = await admin.rpc(
      "finalize_subscription_event",
      {
        p_event_id: claim.eventId,
        p_processing_token: claim.processingToken,
        p_subscription_id: subscription.id,
        p_error_code: null,
      },
    );
    if (finalizationError || finalized !== true) {
      throw new Error("WEBHOOK_FINALIZATION_CONFLICT");
    }
    claim = null;
    return json({ received: true }, 200, req);
  } catch (error) {
    const code = safeErrorCode(error);
    if (claim && admin) {
      const { error: releaseError } = await admin.rpc("finalize_subscription_event", {
        p_event_id: claim.eventId,
        p_processing_token: claim.processingToken,
        p_subscription_id: null,
        p_error_code: code,
      });
      if (releaseError) console.error("mercado-pago-webhook", "CLAIM_RELEASE_FAILED");
    }
    if (error instanceof HttpRequestError) {
      return json({ error: error.message }, error.status, req);
    }
    console.error("mercado-pago-webhook", code);
    return json({ error: "WEBHOOK_FAILED" }, 500, req);
  }
});
