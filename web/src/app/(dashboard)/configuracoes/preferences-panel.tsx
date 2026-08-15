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
      <section className="ff-card p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-foreground">Aparência e privacidade</h2>
            <p className="mt-1 text-sm text-foreground-muted">Tema e ocultação de valores ficam salvos neste navegador.</p>
          </div>
        </div>
        <DisplayControls />
      </section>

      <section className="ff-card p-5 sm:p-6">
        <h2 className="text-lg font-extrabold text-foreground">Permissão do navegador</h2>
        <p className="mt-1 text-sm leading-6 text-foreground-muted">
          As notificações financeiras locais funcionam somente enquanto o FinFlow estiver aberto, online e com esta permissão ativa.
          Com o navegador fechado, nenhum alerta será enviado; Web Push ainda não está disponível.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-surface-muted px-3 py-1.5 text-xs font-bold text-foreground-muted">
            {permission === "granted" ? "Permitidas" : permission === "denied" ? "Bloqueadas" : permission === "unsupported" ? "Não disponível" : "Ainda não decidida"}
          </span>
          {permission === "default" && (
            <button type="button" onClick={requestBrowserPermission} className="ff-focus rounded-ff-sm bg-primary px-4 py-2 text-sm font-bold text-white">
              Permitir neste navegador
            </button>
          )}
        </div>
      </section>

      <section className="ff-card p-5 sm:p-6 xl:col-span-2">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-lg font-extrabold text-foreground">Alertas financeiros</h2>
            <p className="mt-1 text-sm text-foreground-muted">Estas preferências são locais, por usuário, e não alteram outros dispositivos.</p>
          </div>
          <span className="rounded-full bg-primary-soft px-3 py-1.5 text-xs font-bold text-primary-dark">Avisos de parceria são obrigatórios</span>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {WEB_NOTIFICATION_ITEMS.map((item) => (
            <label key={item.key} className="flex cursor-pointer items-start justify-between gap-4 rounded-ff-md border border-border bg-surface-muted p-4">
              <span>
                <span className="block text-sm font-extrabold text-foreground">{item.title}</span>
                <span className="mt-1 block text-xs leading-5 text-foreground-muted">{item.description}</span>
              </span>
              <input
                type="checkbox"
                checked={preferences[item.key]}
                onChange={() => toggle(item.key)}
                className="mt-1 h-5 w-5 accent-primary"
              />
            </label>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button type="button" onClick={save} className="ff-focus rounded-ff-sm bg-primary px-5 py-2.5 text-sm font-bold text-white">Salvar preferências</button>
          {saveStatus === "saved" && <p role="status" className="text-sm font-bold text-primary">Preferências salvas neste navegador.</p>}
          {saveStatus === "error" && <p role="alert" className="text-sm font-bold text-red">O navegador não permitiu salvar as preferências.</p>}
        </div>
      </section>
    </div>
  );
}
