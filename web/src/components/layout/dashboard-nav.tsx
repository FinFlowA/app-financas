"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type IconName = "home" | "history" | "goals" | "cards" | "flow" | "ai" | "settings" | "accounts" | "reconciliation" | "categories" | "plans" | "security" | "menu" | "close";

export const NAV_ITEMS = [
  { href: "/", label: "Início", icon: "home", exact: true },
  { href: "/transacoes", label: "Histórico", icon: "history" },
  { href: "/contas", label: "Contas", icon: "accounts" },
  { href: "/conciliacao", label: "Extrato e conciliação", shortLabel: "Extrato", icon: "reconciliation" },
  { href: "/categorias", label: "Categorias", icon: "categories" },
  { href: "/objetivos", label: "Objetivos", icon: "goals" },
  { href: "/cartoes", label: "Cartões", icon: "cards" },
  { href: "/relatorios", label: "Fluxo de caixa", shortLabel: "Fluxo", icon: "flow" },
  { href: "/assistente", label: "Assistente IA", shortLabel: "IA", icon: "ai" },
  { href: "/planos", label: "Planos", icon: "plans" },
  { href: "/configuracoes", label: "Configurações", shortLabel: "Ajustes", icon: "settings" },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  shortLabel?: string;
  icon: IconName;
  exact?: boolean;
}>;

export function NavIcon({ name, className = "" }: { name: IconName; className?: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    goals: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="M12 2v3M22 12h-3" /></>,
    cards: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 9h19M6 15h4" /></>,
    flow: <><path d="M4 19V9M10 19V4M16 19v-7M22 19V7" /><path d="M2 19h22" /></>,
    ai: <><path d="m12 2 1.2 3.8L17 7l-3.8 1.2L12 12l-1.2-3.8L7 7l3.8-1.2L12 2Z" /><path d="m19 13 .8 2.2L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.8L19 13ZM5 12l.8 2.2L8 15l-2.2.8L5 18l-.8-2.2L2 15l2.2-.8L5 12Z" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    accounts: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M16 10h5v5h-5a2.5 2.5 0 0 1 0-5ZM7 9h4" /></>,
    reconciliation: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h3" /><path d="m14 15 1.5 1.5L19 13" /></>,
    categories: <><path d="m3 11 8-8h7l3 3v7l-8 8L3 11Z" /><circle cx="16" cy="8" r="1" /></>,
    plans: <><path d="m4 8 3 3 5-7 5 7 3-3-2 11H6L4 8Z" /><path d="M7 15h10" /></>,
    security: <><path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></>,
    menu: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function isActive(pathname: string, item: (typeof NAV_ITEMS)[number]) {
  return "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="ff-sidebar-nav" aria-label="Navegação principal">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className="ff-sidebar-link ff-focus" data-active={active || undefined}>
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileDashboardNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const primaryRouteSet: ReadonlySet<string> = new Set(["/", "/transacoes", "/objetivos", "/relatorios"]);
  const primaryItems = NAV_ITEMS.filter((item) => primaryRouteSet.has(item.href));
  const primaryHrefs: ReadonlySet<string> = new Set(primaryItems.map((item) => item.href));
  const drawerActive = NAV_ITEMS.some((item) => !primaryHrefs.has(item.href) && pathname.startsWith(item.href));

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(menuPanelRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !menuPanelRef.current?.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !menuPanelRef.current?.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      menuButton?.focus();
    };
  }, [menuOpen]);

  return (
    <>
      <nav className="ff-mobile-nav" aria-label="Navegação principal móvel">
        {primaryItems.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className="ff-mobile-nav__item ff-focus" data-active={active || undefined}>
              <NavIcon name={item.icon} />
              <span>{"shortLabel" in item ? item.shortLabel : item.label}</span>
            </Link>
          );
        })}
        <button ref={menuButtonRef} type="button" className="ff-mobile-nav__item ff-focus" data-active={drawerActive || menuOpen || undefined} onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="finflow-mobile-menu">
          <NavIcon name="menu" />
          <span>Menu</span>
        </button>
      </nav>

      {menuOpen && (
        <div className="ff-mobile-menu" id="finflow-mobile-menu" role="dialog" aria-modal="true" aria-label="Todas as áreas do FinFlow">
          <button type="button" tabIndex={-1} className="ff-mobile-menu__backdrop" onClick={() => setMenuOpen(false)} aria-label="Fechar menu" />
          <section ref={menuPanelRef} className="ff-mobile-menu__sheet">
            <div className="ff-mobile-menu__handle" aria-hidden="true" />
            <header className="ff-mobile-menu__header">
              <div><p className="ff-eyebrow">Navegação</p><h2>Todas as áreas</h2></div>
              <button ref={closeButtonRef} type="button" onClick={() => setMenuOpen(false)} className="ff-icon-button ff-focus" aria-label="Fechar menu"><NavIcon name="close" /></button>
            </header>
            <div className="ff-mobile-menu__grid">
              {NAV_ITEMS.filter((item) => !primaryHrefs.has(item.href)).map((item) => {
                const active = pathname.startsWith(item.href);
                return <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="ff-mobile-menu__link ff-focus" data-active={active || undefined}><NavIcon name={item.icon} /><span>{item.label}</span></Link>;
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
