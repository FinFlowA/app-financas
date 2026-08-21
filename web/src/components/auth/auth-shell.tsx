import Image from "next/image";
import Link from "next/link";
import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import type { ReactNode } from "react";
import { AuthSplash } from "./auth-splash";
import { ParallaxStage } from "./parallax-stage";
import styles from "./auth.module.css";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-auth-display",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-auth-body",
});

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
  showSplash?: boolean;
};

export function AuthShell({ title, description, children, showSplash = false }: AuthShellProps) {
  return (
    <main className={`${styles.page} ${sora.variable} ${plusJakartaSans.variable}`}>
      {showSplash ? <AuthSplash /> : null}
      <ParallaxStage className={showSplash ? `${styles.stage} ${styles.stageEnter}` : styles.stage}>
        <aside className={styles.brandPanel} aria-label="FinFlow">
          <div className={styles.brandLockup}>
            <span className={styles.logoSurface}>
              <Image
                className={styles.logoImage}
                src="/icon.png"
                alt=""
                width={512}
                height={512}
                unoptimized
                loading="eager"
                fetchPriority="high"
                quality={100}
                sizes="46px"
              />
            </span>
            <span className={styles.brandName}>FinFlow</span>
          </div>

          <div className={styles.brandContent}>
            <p className={styles.brandEyebrow}>Controle financeiro inteligente</p>
            <h2 className={styles.brandTitle}>
              Seu dinheiro em um <span className={styles.brandTitleAccent}>só fluxo.</span>
            </h2>
            <p className={styles.brandDescription}>
              Planeje, acompanhe e decida com clareza. Seus dados ficam sincronizados
              entre o site e o aplicativo FinFlow.
            </p>
          </div>

          <ul className={styles.featureList} aria-label="Benefícios do FinFlow">
            <li className={styles.featureItem}>
              <span className={styles.featureIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17 17 7" />
                  <path d="M9 7h8v8" />
                </svg>
              </span>
              <span>
                <span className={styles.featureLabel}>Visão completa</span>
                <span className={styles.featureDescription}>Entradas, saídas e saldo em um só painel.</span>
              </span>
            </li>
            <li className={styles.featureItem}>
              <span className={styles.featureIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="8" />
                  <circle cx="12" cy="12" r="2.6" />
                </svg>
              </span>
              <span>
                <span className={styles.featureLabel}>Metas no controle</span>
                <span className={styles.featureDescription}>Acompanhe cada objetivo no seu ritmo.</span>
              </span>
            </li>
          </ul>
        </aside>

        <div className={styles.columnDivider} aria-hidden="true" />

        <section className={styles.formSide}>
          <div className={styles.formColumn}>
            <div className={styles.formCard}>
              <header className={styles.formHeader}>
                <p className={styles.formEyebrow}>Sua conta FinFlow</p>
                <h1 id="auth-page-title" className={styles.formTitle}>{title}</h1>
                <p className={styles.formDescription}>{description}</p>
              </header>
              <div className={styles.formBody}>{children}</div>
            </div>
            <footer className={styles.legalFooter}>
              <Link className={styles.legalLink} href="/termos">Termos de Uso</Link>
              <Link className={styles.legalLink} href="/privacidade">Privacidade</Link>
              <span aria-hidden="true">© {new Date().getFullYear()}</span>
            </footer>
          </div>
        </section>
      </ParallaxStage>
    </main>
  );
}
