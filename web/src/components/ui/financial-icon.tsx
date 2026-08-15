import type { ReactNode } from "react";

type FinancialIconProps = {
  name?: string | null;
  size?: number;
  className?: string;
};

const ICON_ALIASES: Record<string, string> = {
  "shopping-bag": "shopping-cart",
  "laptop-mac": "laptop",
  smartphone: "phone-android",
  wallet: "payments",
  "more-horiz": "label",
};

/**
 * Renderiza os nomes de Material Icons salvos pelo aplicativo sem depender de
 * fonte externa. Assim, o mesmo valor persistido no mobile funciona no site e
 * nunca aparece como texto cru (por exemplo, `directions-car`).
 */
export default function FinancialIcon({ name, size = 22, className = "" }: FinancialIconProps) {
  const raw = (name ?? "label").trim();
  if (!raw || !/^[a-z][a-z0-9-]*$/i.test(raw)) {
    return <span className={className} aria-hidden="true" style={{ fontSize: size * 0.82, lineHeight: 1 }}>{raw || "•"}</span>;
  }

  const icon = ICON_ALIASES[raw] ?? raw;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  let content: ReactNode;
  switch (icon) {
    case "restaurant":
      content = <><path d="M7 3v7M4.5 3v4.5A2.5 2.5 0 0 0 7 10M9.5 3v4.5A2.5 2.5 0 0 1 7 10v11" /><path d="M16 3c2 0 3.5 2.1 3.5 5.2V13H16V3Zm0 10v8" /></>;
      break;
    case "directions-car":
    case "commute":
    case "two-wheeler":
      content = <><path d="m5 16-1.5-1.5V10l2-5h13l2 5v4.5L19 16" /><path d="M5 11h14M7 16v3M17 16v3M7.5 13h.01M16.5 13h.01" /></>;
      break;
    case "home":
      content = <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>;
      break;
    case "favorite":
      content = <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />;
      break;
    case "shopping-cart":
    case "local-grocery-store":
      content = <><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.7L21 8H6" /></>;
      break;
    case "school":
      content = <><path d="m2 10 10-5 10 5-10 5L2 10Z" /><path d="M6 12.5V17c3 2 9 2 12 0v-4.5M22 10v6" /></>;
      break;
    case "fitness-center":
      content = <><path d="M6 7v10M3.5 9v6M18 7v10M20.5 9v6M6 12h12" /></>;
      break;
    case "local-hospital":
    case "medical-services":
      content = <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M9 5V3h6v2M12 9v8M8 13h8" /></>;
      break;
    case "health-and-safety":
      content = <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path d="M12 8v7M8.5 11.5h7" /></>;
      break;
    case "security":
      content = <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-5" /></>;
      break;
    case "flight":
      content = <path d="m3 14 8-3V4.5a1.5 1.5 0 0 1 3 0V11l7 3v2l-7-1v4l2 1.5V22l-3.5-1-3.5 1v-1.5L11 19v-4l-8 1v-2Z" />;
      break;
    case "beach-access":
      content = <><path d="M4 11a8.5 8.5 0 0 1 16 0L4 11Z" /><path d="m12 11 4 10M3 21h18" /></>;
      break;
    case "pets":
      content = <><circle cx="7" cy="8" r="2" /><circle cx="17" cy="8" r="2" /><circle cx="4" cy="13" r="1.5" /><circle cx="20" cy="13" r="1.5" /><path d="M8 19c0-3 2-5 4-5s4 2 4 5c-2 2-6 2-8 0Z" /></>;
      break;
    case "work":
    case "business-center":
      content = <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2" /></>;
      break;
    case "sports-esports":
      content = <><path d="M8 7h8a5 5 0 0 1 4.7 6.7l-1.2 3.4a2.6 2.6 0 0 1-4.3 1L13.5 16h-3l-1.7 2.1a2.6 2.6 0 0 1-4.3-1l-1.2-3.4A5 5 0 0 1 8 7Z" /><path d="M7 11v4M5 13h4M16.5 12h.01M18.5 14h.01" /></>;
      break;
    case "music-note":
      content = <><path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>;
      break;
    case "local-movies":
      content = <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 10h18M7 5l3 5M14 5l3 5" /></>;
      break;
    case "attach-money":
    case "payments":
    case "savings":
      content = <><circle cx="12" cy="12" r="9" /><path d="M15 8.5c-.7-.7-1.7-1-3-1-1.7 0-3 .8-3 2s1 1.8 3 2.3 3 1.1 3 2.5-1.3 2.2-3 2.2c-1.3 0-2.5-.4-3.2-1.2M12 5.5v13" /></>;
      break;
    case "card-giftcard":
      content = <><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13M3 12h18M12 8H8.5A2.5 2.5 0 1 1 11 5.5L12 8Zm0 0h3.5A2.5 2.5 0 1 0 13 5.5L12 8Z" /></>;
      break;
    case "build":
      content = <path d="M14.5 6.5a4 4 0 0 0-5-5L12 4l-3 3-2.5-2.5a4 4 0 0 0 5 5L19 17a2 2 0 0 1-2 2l-7.5-7.5" />;
      break;
    case "coffee":
      content = <><path d="M4 8h13v6a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V8Z" /><path d="M17 10h2a2 2 0 0 1 0 4h-2M7 3v2M11 3v2M15 3v2" /></>;
      break;
    case "local-gas-station":
      content = <><rect x="4" y="3" width="11" height="18" rx="2" /><path d="M7 7h5M15 8h2l3 3v7a2 2 0 0 1-4 0v-3M6 21h11" /></>;
      break;
    case "child-care":
      content = <><circle cx="12" cy="12" r="8" /><path d="M8 10h.01M16 10h.01M9 15c1.5 1.3 4.5 1.3 6 0M5 6l2 2M19 6l-2 2" /></>;
      break;
    case "spa":
      content = <><path d="M12 21c-4-2-6-5.5-6-9 3 0 5 1 6 3 1-2 3-3 6-3 0 3.5-2 7-6 9Z" /><path d="M12 15c-2-3-2-7 0-11 2 4 2 8 0 11Z" /></>;
      break;
    case "book":
      content = <><path d="M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4V4Z" /><path d="M20 4h-4a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h4V4Z" /></>;
      break;
    case "camera-alt":
      content = <><path d="M4 7h4l2-3h4l2 3h4v13H4V7Z" /><circle cx="12" cy="13" r="4" /></>;
      break;
    case "palette":
      content = <><path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h5a4 4 0 0 0 4-4c0-3.3-4-6-9-6Z" /><circle cx="7" cy="10" r="1" /><circle cx="9" cy="6.5" r="1" /><circle cx="14" cy="6" r="1" /></>;
      break;
    case "electrical-services":
      content = <><path d="M8 3v6M16 3v6M6 9h12v3a6 6 0 0 1-12 0V9ZM12 18v3" /></>;
      break;
    case "water-drop":
      content = <path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z" />;
      break;
    case "wifi":
      content = <><path d="M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a3.5 3.5 0 0 1 4 0" /><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" /></>;
      break;
    case "phone-android":
      content = <><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M10 5h4M11 18h2" /></>;
      break;
    case "laptop":
      content = <><rect x="5" y="4" width="14" height="11" rx="1.5" /><path d="m3 19 2-4h14l2 4H3Z" /></>;
      break;
    case "checkroom":
      content = <><path d="M12 7a2.5 2.5 0 1 0-2.5-2.5" /><path d="m12 7-9 7h18l-9-7ZM5 14v5h14v-5" /></>;
      break;
    case "bakery-dining":
      content = <><path d="M4 14a8 8 0 0 1 16 0v5H4v-5Z" /><path d="m8 8 2 5M16 8l-2 5M12 6v7" /></>;
      break;
    case "trending-up":
      content = <><path d="m3 17 6-6 4 4 8-9" /><path d="M15 6h6v6" /></>;
      break;
    case "volunteer-activism":
      content = <><path d="M12 20 4 13a3.5 3.5 0 0 1 5-5l3 3 3-3a3.5 3.5 0 0 1 5 5l-8 7Z" /><path d="M8 15h8" /></>;
      break;
    case "celebration":
      content = <><path d="m4 20 5-13 8 8-13 5Z" /><path d="M13 5V2M17 7l3-3M19 11h3" /></>;
      break;
    case "label":
    default:
      content = <><path d="m3 11 8-8h7l3 3v7l-8 8L3 11Z" /><circle cx="16" cy="8" r="1" /></>;
  }

  return <svg {...common}>{content}</svg>;
}
