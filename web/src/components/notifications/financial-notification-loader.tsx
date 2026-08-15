"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { WEB_NOTIFICATION_PREFERENCES_CHANGED_EVENT } from "@/lib/web-notifications";

const FinancialNotificationScheduler = dynamic(
  () => import("./financial-notification-scheduler"),
  { ssr: false, loading: () => null },
);

function notificationsCanRun(): boolean {
  if (typeof window === "undefined") return false;
  const secureOrigin = window.location.protocol === "https:"
    || window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1";
  return secureOrigin
    && "Notification" in window
    && "serviceWorker" in navigator
    && Notification.permission === "granted";
}

/**
 * Mantém o SDK do Supabase fora do bundle inicial do painel quando as
 * notificações ainda não foram autorizadas. O scheduler é carregado assim
 * que a permissão for concedida, inclusive sem recarregar a página.
 */
export default function FinancialNotificationLoader({ userId }: { userId: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const refresh = () => setEnabled(notificationsCanRun());
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(WEB_NOTIFICATION_PREFERENCES_CHANGED_EVENT, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(WEB_NOTIFICATION_PREFERENCES_CHANGED_EVENT, refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return enabled ? <FinancialNotificationScheduler userId={userId} /> : null;
}
