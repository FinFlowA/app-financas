import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FinFlow 2.0",
    short_name: "FinFlow",
    description: "Controle financeiro pessoal, compartilhado e assistido por IA.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e1416",
    theme_color: "#34A164",
    lang: "pt-BR",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
