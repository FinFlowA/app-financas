import "server-only";
import {
  EventName,
  type CustomerCreatedEvent,
  type CustomerUpdatedEvent,
  type EventEntity,
  type SubscriptionCanceledEvent,
  type SubscriptionCreatedEvent,
  type SubscriptionActivatedEvent,
  type SubscriptionPastDueEvent,
  type SubscriptionPausedEvent,
  type SubscriptionResumedEvent,
  type SubscriptionTrialingEvent,
  type SubscriptionUpdatedEvent,
  type TransactionCompletedEvent,
} from "@paddle/paddle-node-sdk";
import { createAdminClient } from "@/lib/supabase/admin";

type SubscriptionEvent = SubscriptionCreatedEvent | SubscriptionUpdatedEvent | SubscriptionCanceledEvent
  | SubscriptionActivatedEvent | SubscriptionPastDueEvent | SubscriptionPausedEvent
  | SubscriptionResumedEvent | SubscriptionTrialingEvent;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PADDLE_PRICE_ENV_MISSING:${name}`);
  return value;
}

function priceMetadata(priceId: string) {
  const prices = new Map([
    [requiredEnv("NEXT_PUBLIC_PADDLE_SMART_MONTHLY_PRICE_ID"), { productCode: "smart_monthly", plan: "smart", cycle: "monthly" }],
    [requiredEnv("NEXT_PUBLIC_PADDLE_SMART_YEARLY_PRICE_ID"), { productCode: "smart_annual", plan: "smart", cycle: "annual" }],
    [requiredEnv("NEXT_PUBLIC_PADDLE_PREMIUM_MONTHLY_PRICE_ID"), { productCode: "premium_monthly", plan: "premium", cycle: "monthly" }],
    [requiredEnv("NEXT_PUBLIC_PADDLE_PREMIUM_YEARLY_PRICE_ID"), { productCode: "premium_annual", plan: "premium", cycle: "annual" }],
  ]);
  const value = prices.get(priceId);
  if (!value) throw new Error("PADDLE_PRICE_NOT_ALLOWED");
  return value;
}

function databaseStatus(status: string) {
  if (status === "canceled") return "cancelled";
  if (status === "past_due") return "grace_period";
  if (["active", "trialing", "paused"].includes(status)) return status;
  throw new Error("PADDLE_SUBSCRIPTION_STATUS_UNSUPPORTED");
}

function customUserId(customData: unknown): string | null {
  if (!customData || typeof customData !== "object" || Array.isArray(customData)) return null;
  const value = (customData as Record<string, unknown>).finflow_user_id;
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

async function handleCustomer(event: CustomerCreatedEvent | CustomerUpdatedEvent) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("bind_paddle_customer", {
    p_customer_id: event.data.id,
    p_email: event.data.email,
    p_user_id: null,
  });
  if (error) throw new Error("PADDLE_CUSTOMER_SYNC_FAILED");
}

async function handleSubscription(event: SubscriptionEvent) {
  const item = event.data.items[0];
  if (!item?.price) throw new Error("PADDLE_SUBSCRIPTION_ITEM_MISSING");
  const priceId = item.price.id;
  const productId = item.price.productId;
  const metadata = priceMetadata(priceId);
  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("paddle_customers")
    .select("email,user_id")
    .eq("customer_id", event.data.customerId)
    .maybeSingle();
  if (!customer?.email) throw new Error("PADDLE_CUSTOMER_NOT_SYNCED");

  const { data: userId, error: bindError } = await admin.rpc("bind_paddle_customer", {
    p_customer_id: event.data.customerId,
    p_email: customer.email,
    p_user_id: customer.user_id ?? customUserId(event.data.customData),
  });
  if (bindError || typeof userId !== "string") throw new Error("PADDLE_CUSTOMER_NOT_BOUND");

  const scheduled = event.data.scheduledChange;
  const periodEnd = event.data.currentBillingPeriod?.endsAt ?? event.data.nextBilledAt;
  const { error } = await admin.rpc("upsert_paddle_subscription", {
    p_user_id: userId,
    p_product_code: metadata.productCode,
    p_plan: metadata.plan,
    p_billing_cycle: metadata.cycle,
    p_subscription_id: event.data.id,
    p_customer_id: event.data.customerId,
    p_status: databaseStatus(event.data.status),
    p_price_id: priceId,
    p_product_id: productId,
    p_started_at: event.data.startedAt,
    p_period_end: periodEnd,
    p_cancel_at_period_end: scheduled?.action === "cancel",
    p_cancelled_at: event.data.canceledAt,
    p_scheduled_action: scheduled?.action ?? null,
    p_scheduled_at: scheduled?.effectiveAt ?? null,
    p_event_at: event.occurredAt,
    p_payload: {
      paddle_status: event.data.status,
      transaction_id: "transactionId" in event.data ? event.data.transactionId : null,
      currency_code: event.data.currencyCode,
    },
  });
  if (error) throw new Error("PADDLE_SUBSCRIPTION_SYNC_FAILED");
}

async function handleTransactionCompleted(event: TransactionCompletedEvent) {
  if (!event.data.subscriptionId) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from("subscriptions")
    .update({
      last_provider_sync_at: event.occurredAt,
      provider_payload: {
        last_transaction_id: event.data.id,
        last_transaction_status: event.data.status,
        currency_code: event.data.currencyCode,
      },
    })
    .eq("provider", "paddle")
    .eq("provider_subscription_id", event.data.subscriptionId);
  if (error) throw new Error("PADDLE_TRANSACTION_SYNC_FAILED");
}

export async function processPaddleEvent(event: EventEntity) {
  switch (event.eventType) {
    case EventName.CustomerCreated:
    case EventName.CustomerUpdated:
      return handleCustomer(event);
    case EventName.SubscriptionCreated:
    case EventName.SubscriptionUpdated:
    case EventName.SubscriptionCanceled:
    case EventName.SubscriptionActivated:
    case EventName.SubscriptionPastDue:
    case EventName.SubscriptionPaused:
    case EventName.SubscriptionResumed:
    case EventName.SubscriptionTrialing:
      return handleSubscription(event);
    case EventName.TransactionCompleted:
      return handleTransactionCompleted(event);
    default:
      return;
  }
}
