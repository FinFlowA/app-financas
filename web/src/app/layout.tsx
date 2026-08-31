import type { Metadata, Viewport } from "next";
import WebPlatform from "@/components/platform/web-platform";
import "@fontsource/material-icons";
import "./globals.css";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full">{children}<WebPlatform /></body>
    </html>
  );
}
