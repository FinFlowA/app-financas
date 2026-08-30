import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // O repositório tem outro package-lock.json na raiz (app mobile); isso fixa
  // a raiz do Turbopack neste diretório para não ficar ambíguo entre os dois.
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "object-src 'none'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
            "worker-src 'self' blob:",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mercadopago.com",
            "upgrade-insecure-requests",
          ].join("; "),
        },
      ],
    }];
  },
};

export default nextConfig;
