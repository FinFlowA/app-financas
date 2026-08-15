"use client";

import { useEffect, useState } from "react";
import DisplayControls from "@/components/layout/display-controls";
import {
  readWebNotificationPreferences,
  saveWebNotificationPreferences,
  WEB_NOTIFICATION_DEFAULTS,
  WEB_NOTIFICATION_ITEMS,
  WEB_NOTIFICATION_PREFERENCES_CHANGED_EVENT,
  type WebNotificationPreferenceKey,
} from "@/lib/web-notifications";
import styles from "./settings.module.css";

function PreferenceIcon({ name }: { name: "appearance" | "bell" | "browser" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {name === "appearance" && <><path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-1.5a2 2 0 0 1-2-2V6.5A3.5 3.5 0 0 0 12 3Z" /><circle cx="7.5" cy="11.5" r=".7" fill="currentColor" /><circle cx="10" cy="7.5" r=".7" fill="currentColor" /><circle cx="8.5" cy="16" r=".7" fill="currentColor" /></>}
      {name === "browser" && <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /><path d="m9 14 2 2 4-4" /></>}
      {name === "bell" && <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>}
    </svg>
  );
}

export default function PreferencesPanel({ userId }: { userId: string }) {
  const [preferences, setPreferences] = useState(WEB_NOTIFICATION_DEFAULTS);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      try {
        setPreferences(readWebNotificationPreferences(localStorage, userId));
      } catch {
        setPreferences({ ...WEB_NOTIFICATION_DEFAULTS });
      }
      setPermission("Notification" in window ? Notification.permission : "unsupported");
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, [userId]);

  function toggle(key: WebNotificationPreferenceKey) {
    setSaveStatus("idle");
    setPreferences((current) => {
      switch (key) {
        case "overdue": return { ...current, overdue: !current.overdue };
        case "today": return { ...current, today: !current.today };
        case "invoiceClosing": return { ...current, invoiceClosing: !current.invoiceClosing };
        case "invoiceDue": return { ...current, invoiceDue: !current.invoiceDue };
        case "cardLimit": return { ...current, cardLimit: !current.cardLimit };
        case "goalDeadline": return { ...current, goalDeadline: !current.goalDeadline };
      }
    });
  }

  function save() {
    try {
      saveWebNotificationPreferences(localStorage, userId, preferences);
      window.dispatchEvent(new CustomEvent(WEB_NOTIFICATION_PREFERENCES_CHANGED_EVENT, { detail: { userId } }));
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }

  async function requestBrowserPermission() {
    if (!("Notification" in window)) return;
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission === "granted") {
        window.dispatchEvent(new CustomEvent(WEB_NOTIFICATION_PREFERENCES_CHANGED_EVENT, { detail: { userId } }));
      }
    } catch {
      setPermission(Notification.permission);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className={`ff-card p-5 sm:p-6 ${styles.panel}`}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className={styles.headingGroup}>
            <span className={styles.iconBox}><PreferenceIcon name="appearance" /></span>
            <div>
              <h2 className="text-lg font-extrabold text-foreground">Aparência</h2>
              <p className="mt-1 text-sm leading-6 text-foreground-muted">Escolha o tema do site. A preferência fica salva neste navegador.</p>
            </div>
          </div>
        </div>
        <div className="rounded-ff-md border border-border bg-surface-muted/60 p-3"><DisplayControls /></div>
      </section>

      <section className={`ff-card p-5 sm:p-6 ${styles.panel}`}>
        <div className={styles.headingGroup}>
          <span className={styles.iconBox}><PreferenceIcon name="browser" /></span>
          <div>
            <h2 className="text-lg font-extrabold text-foreground">Permissão do navegador</h2>
            <p className="mt-1 text-sm leading-6 text-foreground-muted">
              Os alertas locais funcionam enquanto o FinFlow estiver aberto, online e com esta permissão ativa.
            </p>
          </div>
        </div>
        <p className="mt-4 rounded-ff-md border border-border bg-surface-muted/60 p-3 text-xs leading-5 text-foreground-muted">
          Com o navegador fechado, nenhum alerta será enviado. O Web Push ainda não está disponível.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className={`${styles.permissionState} ${permission === "granted" ? styles.permissionGranted : ""}`}>
            {permission === "granted" ? "Permitidas" : permission === "denied" ? "Bloqueadas" : permission === "unsupported" ? "Não disponível" : "Ainda não decidida"}
          </span>
          {permission === "default" && (
            <button type="button" onClick={requestBrowserPermission} className={`ff-focus ${styles.primaryButton}`}>
              Permitir neste navegador
            </button>
          )}
        </div>
      </section>

      <section className={`ff-card p-5 sm:p-6 xl:col-span-2 ${styles.panel}`}>
        <div className={styles.panelHeader}>
          <div className={styles.headingGroup}>
            <span className={styles.iconBox}><PreferenceIcon name="bell" /></span>
            <div>
              <h2 className="text-lg font-extrabold text-foreground">Alertas financeiros</h2>
              <p className="mt-1 text-sm leading-6 text-foreground-muted">Estas preferências são locais, por usuário, e não alteram outros dispositivos.</p>
            </div>
          </div>
          <span className={styles.statusBadge}>Parceria sempre ativa</span>
        </div>
        <div className={styles.preferenceGrid}>
          {WEB_NOTIFICATION_ITEMS.map((item) => (
            <label key={item.key} className={styles.preferenceItem}>
              <span className="min-w-0">
                <span className="block text-sm font-extrabold text-foreground">{item.title}</span>
                <span className="mt-1 block text-xs leading-5 text-foreground-muted">{item.description}</span>
              </span>
              <input
                type="checkbox"
                checked={preferences[item.key]}
                onChange={() => toggle(item.key)}
                className="sr-only"
              />
              <span aria-hidden="true" className={`${styles.toggle} ${preferences[item.key] ? styles.toggleOn : ""}`} />
            </label>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} className={`ff-focus ${styles.primaryButton}`}>Salvar preferências</button>
          {saveStatus === "saved" && <p role="status" className="text-sm font-bold text-primary">Preferências salvas neste navegador.</p>}
          {saveStatus === "error" && <p role="alert" className="text-sm font-bold text-red">O navegador não permitiu salvar as preferências.</p>}
        </div>
      </section>
    </div>
  );
}
