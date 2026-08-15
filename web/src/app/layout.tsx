import type { Metadata } from "next";
import WebPlatform from "@/components/platform/web-platform";
import "./globals.css";

export const metadata: Metadata = {
  title: "FinFlow",
  description: "Organização financeira pessoal e compartilhada.",
  applicationName: "FinFlow 2.0",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon", apple: "/icon" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">{children}<WebPlatform /></body>
    </html>
  );
}
