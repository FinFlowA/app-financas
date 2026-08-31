"use client";

import { useEffect, useSyncExternalStore } from "react";

const THEME_KEY = "finflow_web_theme";

function subscribeTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("finflow-display-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("finflow-display-change", callback);
  };
}

function useThemePreference() {
  return useSyncExternalStore(subscribeTheme, () => {
    const stored = localStorage.getItem(THEME_KEY);
    return stored ? stored === "dark" : true;
  }, () => true);
}

/** Aplica a preferência sem adicionar controles ao menu lateral. */
export function ThemeInitializer() {
  const dark = useThemePreference();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return null;
}

/** Controle de aparência exibido somente dentro de Configurações. */
export default function DisplayControls() {
  const dark = useThemePreference();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  function toggleTheme() {
    const applyTheme = () => {
      localStorage.setItem(THEME_KEY, dark ? "light" : "dark");
      window.dispatchEvent(new Event("finflow-display-change"));
    };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const documentWithTransition = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };

    if (!reducedMotion && documentWithTransition.startViewTransition) {
      void documentWithTransition.startViewTransition(applyTheme).finished;
      return;
    }

    if (!reducedMotion) {
      document.documentElement.classList.add("ff-theme-transition");
      window.setTimeout(() => document.documentElement.classList.remove("ff-theme-transition"), 420);
    }
    applyTheme();
  }

  return (
    <div className="ff-display-controls">
      <button
        type="button"
        onClick={toggleTheme}
        className="ff-display-control ff-focus"
        aria-pressed={dark}
        aria-label={dark ? "Ativar tema claro" : "Ativar tema escuro"}
      >
        <svg data-active={!dark || undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        <svg data-active={dark || undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20.4 15.5A8.4 8.4 0 0 1 8.5 3.6 8.5 8.5 0 1 0 20.4 15.5Z" /></svg>
        <span>{dark ? "Ativar tema claro" : "Ativar tema escuro"}</span>
      </button>
    </div>
  );
}
