import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import WebPlatform from "@/components/platform/web-platform";
import "@fontsource/material-icons";
import "./globals.css";

// Precisa ficar em sincronia com THEME_KEY em
// src/components/layout/display-controls.tsx.
const THEME_STORAGE_KEY = "finflow_web_theme";

// Aplica a preferência salva antes da primeira pintura. O HTML do servidor
// sempre nasce com a classe "dark" (não há como saber a preferência no
// servidor); sem este script, quem escolheu o tema claro via
// ThemeInitializer só via a classe corrigida depois da hidratação — um
// flash escuro→claro perceptível, especialmente ao restaurar uma aba do
// cache do navegador (bfcache) ou trocar de aba rapidamente.
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var dark=s?s==="dark":true;document.documentElement.classList.toggle("dark",dark);}catch(e){}})();`;

export const metadata: Metadata = {
  title: { default: "FinFlow", template: "%s | FinFlow" },
  description: "Controle financeiro pessoal, compartilhado e assistido por IA.",
  applicationName: "FinFlow 2.0",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: "#0d1216",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // A CSP usa um nonce novo por resposta. Forçar renderização por requisição
  // garante que o Next aplique esse nonce também aos scripts das páginas que
  // seriam estaticamente otimizadas (login, cadastro e documentos legais).
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="pt-BR" className="dark h-full antialiased" suppressHydrationWarning>
      <head>
        {/* THEME_INIT_SCRIPT é uma string estática definida acima, sem
            interpolação de dado do usuário ou da requisição: nada aqui exige
            sanitização contra XSS. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}<WebPlatform /></body>
    </html>
  );
}
