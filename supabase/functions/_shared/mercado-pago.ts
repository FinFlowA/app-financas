import { serverSecret } from "./supabase.ts";

const API = "https://api.mercadopago.com";

export async function mercadoPago(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${serverSecret("MERCADO_PAGO_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Mercado Pago request failed", response.status, body);
    throw new Error(`MERCADO_PAGO_${response.status}`);
  }
  return body;
}

export function mapMercadoPagoStatus(status: string) {
  if (status === "authorized") return "active";
  if (status === "paused") return "paused";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "pending";
}

export async function verifyMercadoPagoSignature(req: Request, dataId: string) {
  const secret = serverSecret("MERCADO_PAGO_WEBHOOK_SECRET");
  const signature = req.headers.get("x-signature") ?? "";
  const requestId = req.headers.get("x-request-id") ?? "";
  const parts = Object.fromEntries(signature.split(",").map((part) => {
    const [key, value] = part.trim().split("=");
    return [key, value];
  }));
  if (!parts.ts || !parts.v1 || !requestId || !dataId) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== parts.v1.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return mismatch === 0;
}
