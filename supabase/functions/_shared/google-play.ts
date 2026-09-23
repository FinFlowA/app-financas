import { serverSecret } from "./supabase.ts";

export type GooglePlaySubscription = Record<string, unknown> & {
  subscriptionState?: string;
  acknowledgementState?: string;
  startTime?: string;
  latestOrderId?: string;
  linkedPurchaseToken?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    offerDetails?: { basePlanId?: string };
  }>;
};

const encoder = new TextEncoder();

function base64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKeyBytes(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n");
  const beginMarker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const endMarker = ["-----END ", "PRIVATE KEY-----"].join("");
  const body = normalized.replace(beginMarker, "").replace(endMarker, "").replace(/\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: serverSecret("GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL"),
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(serverSecret("GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}`,
    }),
  });
  const body = await response.json();
  if (!response.ok || typeof body.access_token !== "string") throw new Error("GOOGLE_PLAY_AUTH_FAILED");
  return body.access_token as string;
}

export function googlePlayPackageName() {
  return serverSecret("GOOGLE_PLAY_PACKAGE_NAME");
}

export async function getGooglePlaySubscription(purchaseToken: string): Promise<GooglePlaySubscription> {
  const token = await accessToken();
  const packageName = encodeURIComponent(googlePlayPackageName());
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(response.status === 404 ? "GOOGLE_PLAY_PURCHASE_NOT_FOUND" : "GOOGLE_PLAY_VERIFY_FAILED");
  return await response.json() as GooglePlaySubscription;
}

export async function acknowledgeGooglePlaySubscription(productId: string, purchaseToken: string) {
  const token = await accessToken();
  const packageName = encodeURIComponent(googlePlayPackageName());
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" },
  );
  if (!response.ok && response.status !== 409) throw new Error("GOOGLE_PLAY_ACKNOWLEDGE_FAILED");
}

export function googlePlayAccountHash(userId: string) {
  return crypto.subtle.digest("SHA-256", encoder.encode(userId)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

export function normalizedSubscription(data: GooglePlaySubscription) {
  const item = data.lineItems?.[0];
  const state = data.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED";
  const status = state === "SUBSCRIPTION_STATE_ACTIVE" ? "active"
    : state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ? "grace_period"
    : state === "SUBSCRIPTION_STATE_ON_HOLD" ? "past_due"
    : state === "SUBSCRIPTION_STATE_PAUSED" ? "paused"
    : state === "SUBSCRIPTION_STATE_CANCELED" ? "cancelled"
    : state === "SUBSCRIPTION_STATE_EXPIRED" ? "expired"
    : "pending";
  return {
    state,
    status,
    productId: item?.productId ?? "",
    basePlanId: item?.offerDetails?.basePlanId ?? "",
    expiryAt: item?.expiryTime ?? null,
    autoRenewing: Boolean(item?.autoRenewingPlan?.autoRenewEnabled),
    startedAt: data.startTime ?? null,
    orderId: data.latestOrderId ?? null,
    linkedPurchaseToken: data.linkedPurchaseToken ?? null,
    acknowledgementState: data.acknowledgementState ?? null,
    obfuscatedAccountId: data.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
  };
}

export function productConfiguration(productId: string, basePlanId: string) {
  const pro = serverSecret("GOOGLE_PLAY_PRO_PRODUCT_ID");
  const plus = serverSecret("GOOGLE_PLAY_PLUS_PRODUCT_ID");
  const monthly = serverSecret("GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID");
  const annual = serverSecret("GOOGLE_PLAY_ANNUAL_BASE_PLAN_ID");
  const plan = productId === pro ? "smart" : productId === plus ? "premium" : null;
  const cycle = basePlanId === monthly ? "monthly" : basePlanId === annual ? "annual" : null;
  if (!plan || !cycle) throw new Error("GOOGLE_PLAY_PRODUCT_NOT_ALLOWED");
  return { plan, cycle };
}
