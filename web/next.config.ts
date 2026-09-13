import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // O repositório tem outro package-lock.json na raiz (app mobile); isso fixa
  // a raiz do Turbopack neste diretório para não ficar ambíguo entre os dois.
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  // O logo e o ícone do app usam quality={100} de propósito (peças pequenas
  // e importantes de marca); o Next 16 exige listar explicitamente
  // qualidades além do padrão [75].
  images: {
    qualities: [100, 75],
    remotePatterns: [{ protocol: "https", hostname: "**.googleusercontent.com" }],
  },
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
      ],
    }];
  },
};

export default nextConfig;
