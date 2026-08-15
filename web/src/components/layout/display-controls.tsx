"use client";

import { useEffect, useSyncExternalStore } from "react";

const THEME_KEY = "finflow_web_theme";
const PRIVACY_KEY = "finflow_web_hide_values";

export default function DisplayControls() {
  const subscribe = (callback: () => void) => {
    window.addEventListener("storage", callback);
    window.addEventListener("finflow-display-change", callback);
    return () => { window.removeEventListener("storage", callback); window.removeEventListener("finflow-display-change", callback); };
  };
  const dark = useSyncExternalStore(subscribe, () => {
    const stored = localStorage.getItem(THEME_KEY);
    return stored ? stored === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  }, () => false);
  const hidden = useSyncExternalStore(subscribe, () => localStorage.getItem(PRIVACY_KEY) === "true", () => false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("values-hidden", hidden);
  }, [dark, hidden]);

  function toggleTheme() {
    const next = !dark;
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    window.dispatchEvent(new Event("finflow-display-change"));
  }

  function togglePrivacy() {
    const next = !hidden;
    localStorage.setItem(PRIVACY_KEY, String(next));
    window.dispatchEvent(new Event("finflow-display-change"));
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={togglePrivacy}
        className="ff-focus rounded-full border border-border bg-surface-muted px-3 py-2 text-xs font-bold text-foreground"
        aria-pressed={hidden}
        aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
        title={hidden ? "Mostrar valores" : "Ocultar valores"}
      >
        {hidden ? "◉ Mostrar" : "◌ Ocultar"}
      </button>
      <button
        type="button"
        onClick={toggleTheme}
        className="ff-focus rounded-full border border-border bg-surface-muted px-3 py-2 text-xs font-bold text-foreground"
        aria-pressed={dark}
        aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}
        title={dark ? "Tema claro" : "Tema escuro"}
      >
        {dark ? "☀ Claro" : "☾ Escuro"}
      </button>
    </div>
  );
}
