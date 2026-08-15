"use client";

import { useEffect } from "react";
import BrandLogo from "@/components/layout/brand-logo";
import styles from "../app-states.module.css";

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error("FinFlow dashboard error", error.digest ?? "sem-digest"); }, [error.digest]);
  return (
    <div className={styles.statePage}>
      <section role="alert" aria-labelledby="dashboard-error-title" className={styles.stateCard}>
        <div className={styles.stateGlow} aria-hidden="true" />
        <BrandLogo className={styles.stateBrand} />
        <div className={`${styles.stateIcon} ${styles.errorIcon}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v5" /><path d="M12 17.2v.1" /><path d="M10.3 3.5 2.4 17.2A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.8L13.7 3.5a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <span className={styles.stateEyebrow}>Interrupção temporária</span>
        <h1 id="dashboard-error-title">Algo deu errado</h1>
        <p>Nenhuma alteração financeira foi repetida automaticamente. Verifique sua conexão e tente carregar a tela novamente.</p>
        <div className={styles.safetyNote}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 5.5 5.8v5.5c0 4.1 2.7 7.8 6.5 9.7 3.8-1.9 6.5-5.6 6.5-9.7V5.8L12 3Z"/><path d="m9.2 12 1.8 1.8 3.8-4"/></svg>
          <span>Seus dados permanecem protegidos.</span>
        </div>
        <button type="button" onClick={retry} className={styles.stateButton}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.4 5.7"/><path d="M20 5v6h-6"/></svg>
          Tentar novamente
        </button>
      </section>
    </div>
  );
}
