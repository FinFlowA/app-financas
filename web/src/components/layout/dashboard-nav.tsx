"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/", label: "Início", icon: "⌂", exact: true },
  { href: "/transacoes", label: "Histórico", icon: "≡" },
  { href: "/objetivos", label: "Objetivos", icon: "◎" },
  { href: "/cartoes", label: "Cartões", icon: "▣" },
  { href: "/relatorios", label: "Fluxo", icon: "▥" },
  { href: "/assistente", label: "IA", icon: "✦" },
  { href: "/configuracoes", label: "Ajustes", icon: "⚙" },
] as const;

export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 md:flex-col" aria-label="Navegação principal">
      {NAV_ITEMS.map((item) => {
        const active = "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`ff-focus flex min-w-0 items-center gap-3 rounded-ff-sm px-3 py-2.5 text-sm font-semibold transition ${
              active
                ? "bg-primary-soft text-primary-dark"
                : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            <span className="w-5 text-center text-lg leading-none" aria-hidden>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileDashboardNav() {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => item.href !== "/cartoes" && item.href !== "/assistente");
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface/95 px-1 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:hidden" aria-label="Navegação principal móvel">
      {items.map((item) => {
        const active = "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`ff-focus flex flex-col items-center gap-1 rounded-lg py-1 text-[10px] font-bold ${active ? "text-primary" : "text-foreground-muted"}`}>
            <span className="text-xl leading-none" aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
