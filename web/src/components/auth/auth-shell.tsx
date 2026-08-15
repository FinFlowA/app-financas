import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./auth.module.css";

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />
      <section className={styles.stage} aria-labelledby="auth-page-title">
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
                sizes="50px"
              />
            </span>
            <span className={styles.brandName}>FinFlow</span>
            <span className={styles.brandVersion}>2.0</span>
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

            <ul className={styles.featureList} aria-label="Benefícios do FinFlow">
              <li className={styles.featureItem}>
                <span className={styles.featureIcon} aria-hidden="true">↗</span>
                <span className={styles.featureLabel}>Visão completa</span>
              </li>
              <li className={styles.featureItem}>
                <span className={styles.featureIcon} aria-hidden="true">◎</span>
                <span className={styles.featureLabel}>Metas no controle</span>
              </li>
              <li className={styles.featureItem}>
                <span className={styles.featureIcon} aria-hidden="true">✓</span>
                <span className={styles.featureLabel}>Acesso protegido</span>
              </li>
            </ul>

            <div className={styles.preview} aria-hidden="true">
              <div className={styles.previewTop}>
                <div>
                  <span className={styles.previewLabel}>Evolução financeira</span>
                  <strong className={styles.previewValue}>+18,4%</strong>
                </div>
                <span className={styles.previewBadge}>Últimos 6 meses</span>
              </div>
              <svg className={styles.chart} viewBox="0 0 520 90" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="auth-chart-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#31d7a1" stopOpacity="0.28" />
                    <stop offset="1" stopColor="#31d7a1" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  className={styles.chartArea}
                  d="M0,75 C52,68 72,73 111,59 C155,43 177,53 221,44 C270,34 294,44 338,27 C378,12 414,31 452,17 C475,9 497,11 520,4 L520,90 L0,90 Z"
                />
                <path
                  className={styles.chartLine}
                  d="M0,75 C52,68 72,73 111,59 C155,43 177,53 221,44 C270,34 294,44 338,27 C378,12 414,31 452,17 C475,9 497,11 520,4"
                />
                <circle className={styles.chartDot} cx="520" cy="4" r="5" />
              </svg>
            </div>
          </div>

          <div className={styles.brandFooter}>
            <span className={styles.brandFooterIcon} aria-hidden="true">⌾</span>
            <span>Conexão protegida e nenhuma movimentação sem sua confirmação.</span>
          </div>
        </aside>

        <section className={styles.formSide}>
          <div className={styles.formColumn}>
            <div className={styles.securePill}>
              <span className={styles.secureDot} aria-hidden="true" />
              Ambiente seguro FinFlow
            </div>
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
      </section>
    </main>
  );
}
