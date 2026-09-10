import "server-only";

import { headers } from "next/headers";

function asHttpOrigin(value: string | null | undefined): string | null {
  if (!value || /[\r\n]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Retorna apenas uma origem validada; nunca incorpora caminhos enviados pelo cliente. */
export async function getAppOrigin(): Promise<string> {
  const configuredOrigin = asHttpOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (configuredOrigin) return configuredOrigin;

  // Em producao, nunca monte links de autenticacao a partir do header Origin:
  // ele e controlado pelo cliente e poderia apontar a confirmacao/recuperacao
  // para outro dominio. O deploy deve declarar explicitamente a origem publica.
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_ORIGIN_NOT_CONFIGURED");
  }

  const requestHeaders = await headers();
  const requestOrigin = asHttpOrigin(requestHeaders.get("origin"));
  if (requestOrigin) return requestOrigin;

  // Server Actions podem chegar sem o header Origin. Nesse caso, durante o
  // desenvolvimento, derive a origem da própria requisição para que o OAuth
  // volte à porta em que o Next realmente está rodando.
  const forwardedHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto") === "https" ? "https" : "http";
  const requestHostOrigin = forwardedHost && !/[\r\n/\\]/.test(forwardedHost)
    ? asHttpOrigin(`${forwardedProtocol}://${forwardedHost}`)
    : null;
  if (requestHostOrigin) return requestHostOrigin;

  return "http://localhost:3000";
}

export function callbackUrl(origin: string, flow: "signup" | "recovery" | "oauth"): string {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("flow", flow);
  return url.toString();
}
