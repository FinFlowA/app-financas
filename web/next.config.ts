import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // O repositório tem outro package-lock.json na raiz (app mobile); isso fixa
  // a raiz do Turbopack neste diretório para não ficar ambíguo entre os dois.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
