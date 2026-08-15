import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FinFlow 2.0",
    short_name: "FinFlow",
    description: "Controle financeiro pessoal, compartilhado e assistido por IA.",
    start_url: "/",
    display: "standalone",
    background_color: "#081116",
    theme_color: "#16966E",
    lang: "pt-BR",
    orientation: "portrait-primary",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
