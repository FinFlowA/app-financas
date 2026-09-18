const DEVELOPMENT_SCRIPT_POLICY = " 'unsafe-eval'";

/**
 * Gera a política por requisição. O Next.js lê o nonce no cabeçalho recebido e
 * o aplica automaticamente aos scripts de runtime e hidratação.
 */
export function buildContentSecurityPolicy(nonce: string, isDevelopment: boolean) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://*.paddle.com",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? DEVELOPMENT_SCRIPT_POLICY : ""}`,
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mercadopago.com https://*.paddle.com",
    "frame-src https://*.paddle.com",
    "upgrade-insecure-requests",
  ].join("; ");
}
