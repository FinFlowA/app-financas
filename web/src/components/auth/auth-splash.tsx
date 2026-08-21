"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import styles from "./auth.module.css";

const STEPS = [26, 52, 71, 88, 100] as const;
const STEP_LABELS: Record<number, string> = {
  8: "Iniciando",
  26: "Iniciando",
  52: "Sincronizando dados",
  71: "Sincronizando dados",
  88: "Preparando seu acesso",
  100: "Tudo pronto",
};

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

/** Splash de entrada decorativo (sem relação com carregamento real). Pula
 * direto para o conteúdo sob prefers-reduced-motion. */
export function AuthSplash() {
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const [state, setState] = useState<SplashState>("loading");
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    STEPS.forEach((value, index) => {
      timers.push(setTimeout(() => setProgress(value), 220 + index * 300));
    });
    timers.push(setTimeout(() => setState("fading"), 1780));
    timers.push(setTimeout(() => setState("off"), 2280));

    return () => timers.forEach(clearTimeout);
  }, [prefersReducedMotion]);

  if (state === "off" || prefersReducedMotion) return null;

  return (
    <div
      className={styles.splash}
      style={{ opacity: state === "fading" ? 0 : 1 }}
      aria-hidden="true"
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
        <span className={styles.splashLabel}>{STEP_LABELS[progress] ?? "Carregando"}</span>
      </div>

      <div className={styles.splashTrack}>
        <div className={styles.splashFill} style={{ width: `${progress}%` }} />
        <span className={styles.splashShine} />
      </div>
    </div>
  );
}
