import { serverSecret } from "./supabase.ts";

const API = "https://api.mercadopago.com";

export class MercadoPagoRequestError extends Error {
  readonly status: number | null;
  readonly providerCode: string;

  constructor(status: number | null, providerCode = "UNKNOWN") {
    super(status == null ? "MERCADO_PAGO_NETWORK" : `MERCADO_PAGO_${status}`);
    this.name = "MercadoPagoRequestError";
    this.status = status;
    this.providerCode = providerCode;
  }
}

function safeProviderCode(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "UNKNOWN";
  const source = body as Record<string, unknown>;
  const candidate = [source.error, source.code, source.status]
    .find((value) => typeof value === "string");
  if (typeof candidate !== "string") return "UNKNOWN";
  const normalized = candidate.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 60);
  return normalized || "UNKNOWN";
}

export async function mercadoPago(path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${serverSecret("MERCADO_PAGO_ACCESS_TOKEN")}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    console.error("Mercado Pago request failed", "NETWORK");
    throw new MercadoPagoRequestError(null, "NETWORK");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerCode = safeProviderCode(body);
    console.error("Mercado Pago request failed", response.status, providerCode);
    throw new MercadoPagoRequestError(response.status, providerCode);
  }
  return body;
}

export function mapMercadoPagoStatus(status: string) {
  if (status === "authorized") return "active";
  if (status === "paused") return "paused";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "pending";
}

const WEBHOOK_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/** Mercado Pago envia "ts" em segundos Unix; aceita milissegundos também sem
 * depender de adivinhar o formato de um payload específico. */
function parseEpochMillis(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > 1e12 ? value : value * 1000;
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

  // Uma assinatura capturada não pode ser reproduzida indefinidamente: o
  // manifesto inclui "ts", mas nada antes checava sua idade contra o relógio.
  const tsMillis = parseEpochMillis(parts.ts);
  if (tsMillis === null || Math.abs(Date.now() - tsMillis) > WEBHOOK_FRESHNESS_WINDOW_MS) {
    return false;
  }

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
