import Link from "next/link";
import BrandLogo from "@/components/layout/brand-logo";
import styles from "./app-states.module.css";

export default function NotFound() {
  return (
    <main className={`${styles.statePage} ${styles.notFoundPage}`}>
      <BrandLogo className={styles.floatingBrand} priority />
      <section aria-labelledby="not-found-title" className={`${styles.stateCard} ${styles.notFoundCard}`}>
        <div className={styles.stateGlow} aria-hidden="true" />
        <div className={styles.notFoundArt} aria-hidden="true">
          <span>4</span>
          <i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15c2.2-5 5.4-7.7 9.5-8.2"/><path d="M9 18c1.7-3.9 4.4-6.3 8-7.1"/><path d="M14 20c.8-2.1 2.4-3.7 4.7-4.6"/></svg></i>
          <span>4</span>
        </div>
        <span className={styles.stateEyebrow}>Caminho não encontrado</span>
        <h1 id="not-found-title">Página não encontrada</h1>
        <p>O endereço pode ter mudado ou não pertence ao FinFlow.</p>
        <Link href="/" className={styles.stateButton}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>
          Voltar ao início
        </Link>
      </section>
      <p className={styles.stateFooter}>FinFlow · Seu controle financeiro em um só lugar</p>
    </main>
  );
}
