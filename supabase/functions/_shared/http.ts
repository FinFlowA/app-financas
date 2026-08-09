const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type, x-signature, x-request-id, x-idempotency-key";
const ALLOWED_METHODS = "POST, OPTIONS";

export class HttpRequestError extends Error {
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "HttpRequestError";
    this.status = status;
  }
}

function configuredOrigins(): Set<string> {
  const configured = (Deno.env.get("FINFLOW_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origins = new Set<string>();
  for (const candidate of configured) {
    if (candidate === "*") continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      console.warn("finflow-cors: origem ignorada por ser inválida");
    }
  }
  return origins;
}

function requestOrigin(req?: Request): string | null {
  const origin = req?.headers.get("origin")?.trim();
  if (!origin || origin === "null") return null;
  try {
    return new URL(origin).origin;
  } catch {
    return "invalid";
  }
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:")
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function isRequestOriginAllowed(req?: Request): boolean {
  const origin = requestOrigin(req);
  // Aplicativos nativos não enviam Origin e não dependem de CORS.
  if (origin === null) return true;
  if (origin === "invalid") return false;
  return isLocalOrigin(origin) || configuredOrigins().has(origin);
}

export function corsHeadersFor(req?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
  };
  const origin = requestOrigin(req);
  if (origin && origin !== "invalid" && isRequestOriginAllowed(req)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

export function json(
  body: unknown,
  status = 200,
  req?: Request,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersFor(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function handleOptions(req: Request) {
  if (req.method !== "OPTIONS") return null;
  if (!isRequestOriginAllowed(req)) {
    return json({ error: "ORIGIN_NOT_ALLOWED" }, 403, req);
  }
  return new Response(null, { status: 204, headers: corsHeadersFor(req) });
}

export async function readJsonRequest(
  req: Request,
  options: { maxBytes: number; allowedFields?: readonly string[] },
): Promise<{ raw: string; body: Record<string, unknown> }> {
  const contentType = req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpRequestError("UNSUPPORTED_MEDIA_TYPE", 415);
  }

  const declaredLengthHeader = req.headers.get("content-length");
  const declaredLength = declaredLengthHeader == null ? null : Number(declaredLengthHeader);
  if (declaredLength != null && (!Number.isFinite(declaredLength) || declaredLength < 0)) {
    throw new HttpRequestError("INVALID_CONTENT_LENGTH", 400);
  }
  if (declaredLength != null && declaredLength > options.maxBytes) {
    throw new HttpRequestError("REQUEST_TOO_LARGE", 413);
  }

  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > options.maxBytes) {
        await reader.cancel("REQUEST_TOO_LARGE").catch(() => undefined);
        throw new HttpRequestError("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HttpRequestError("INVALID_JSON", 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpRequestError("INVALID_JSON", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpRequestError("INVALID_JSON", 400);
  }

  const body = parsed as Record<string, unknown>;
  if (options.allowedFields) {
    const allowed = new Set(options.allowedFields);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      throw new HttpRequestError("INVALID_REQUEST_FIELDS", 400);
    }
  }
  return { raw, body };
}
