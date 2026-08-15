"use client";

import { useEffect, useSyncExternalStore } from "react";
import styles from "./web-platform.module.css";

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
  return (
    <div className={styles.region} aria-live="polite" aria-atomic="true">
      <div role="status" className={styles.notice}>
        <span className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 8.6A11 11 0 0 1 17.4 7" />
            <path d="M8.3 12a6.5 6.5 0 0 1 5.6-1.2" />
            <path d="M11.5 15.6a1 1 0 0 1 1 0" />
            <path d="m3 3 18 18" />
          </svg>
        </span>
        <span className={styles.copy}>
          <strong>Você está offline</strong>
          <small>Dados financeiros privados não são armazenados no cache do navegador; reconecte para salvar alterações.</small>
        </span>
        <span className={styles.statusDot} aria-hidden="true" />
      </div>
    </div>
  );
}
