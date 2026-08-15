"use client";

import { useEffect, useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); };
}

export default function WebPlatform() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  useEffect(() => {
    const secureOrigin = location.protocol === "https:"
      || location.hostname === "localhost"
      || location.hostname === "127.0.0.1";
    if ("serviceWorker" in navigator && secureOrigin) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
  }, []);
  if (online) return null;
  return <div role="status" className="fixed inset-x-0 top-0 z-[120] bg-orange px-4 py-2 text-center text-xs font-extrabold text-white shadow-lg">Você está offline. Dados financeiros privados não são armazenados no cache do navegador; reconecte para salvar alterações.</div>;
}
