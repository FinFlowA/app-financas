"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import styles from "./auth.module.css";

const SPLASH_SESSION_KEY = "finflow-auth-splash-v1";

type SplashState = "loading" | "fading" | "off";

function subscribeReducedMotion(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getReducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getReducedMotionServerSnapshot() {
  return false;
}

/** Vinheta curta de marca, exibida no máximo uma vez por aba. Não simula uma
 * sincronização inexistente e não mantém o formulário bloqueado a cada visita. */
export function AuthSplash() {
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const [state, setState] = useState<SplashState>("loading");
  const [progress, setProgress] = useState(24);

  useEffect(() => {
    const stage = document.querySelector<HTMLElement>("[data-auth-stage]");
    const releaseStage = () => stage?.removeAttribute("inert");
    let alreadyShown = false;
    try {
      alreadyShown = sessionStorage.getItem(SPLASH_SESSION_KEY) === "1";
    } catch {
      // Navegadores que bloqueiam o armazenamento continuam normalmente.
    }
    if (prefersReducedMotion || alreadyShown) {
      releaseStage();
      const skipTimer = setTimeout(() => setState("off"), 0);
      return () => clearTimeout(skipTimer);
    }

    try {
      sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
    } catch {
      // A vinheta não depende de armazenamento para funcionar.
    }
    stage?.setAttribute("inert", "");

    const timers = [
      setTimeout(() => setProgress(100), 220),
      setTimeout(() => setState("fading"), 430),
      setTimeout(() => {
        setState("off");
        releaseStage();
      }, 700),
    ];

    return () => {
      timers.forEach(clearTimeout);
      releaseStage();
    };
  }, [prefersReducedMotion]);

  if (state === "off" || prefersReducedMotion) return null;

  return (
    <div
      className={styles.splash}
      style={{ opacity: state === "fading" ? 0 : 1 }}
      role="status"
      aria-live="polite"
      aria-label="Abrindo o FinFlow"
    >
      <div className={styles.splashMark}>
        <span className={styles.splashHalo} />
        <span className={styles.splashOrbit} />
        <Image
          className={styles.splashLogo}
          src="/finflow-logo.png"
          alt=""
          width={144}
          height={144}
          unoptimized
          loading="eager"
          fetchPriority="high"
          quality={100}
          sizes="72px"
        />
      </div>

      <div className={styles.splashTexts}>
        <span className={styles.splashBrand}>FinFlow</span>
        <span className={styles.splashLabel}>Seu dinheiro em um só fluxo</span>
      </div>

      <div className={styles.splashTrack}>
        <div className={styles.splashFill} style={{ width: `${progress}%` }} />
        <span className={styles.splashShine} />
      </div>
    </div>
  );
}
