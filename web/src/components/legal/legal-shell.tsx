import Link from "next/link";
import type { ReactNode } from "react";
import BrandLogo from "@/components/layout/brand-logo";
import styles from "./legal.module.css";

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={`${styles.sectionTitle} text-foreground`}>{title}</h2>
      <div className={`${styles.body} space-y-3 text-sm leading-7 sm:text-[15px]`}>
        {children}
      </div>
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-primary">{children}</ul>;
}

export default function LegalShell({
  eyebrow,
  title,
  updatedAt,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  updatedAt: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className={`min-h-screen bg-background px-4 py-5 sm:px-6 sm:py-9 ${styles.page}`}>
      <div className="mx-auto max-w-5xl">
        <div className={`mb-5 flex items-center justify-between gap-4 ${styles.topbar}`}>
          <BrandLogo priority />
          <Link href="/" className="ff-focus rounded-full border border-border bg-surface/80 px-4 py-2 text-sm font-bold text-foreground-muted hover:border-primary hover:text-foreground">Abrir FinFlow</Link>
        </div>
        <header className={`ff-page-hero p-6 sm:p-9 ${styles.hero}`}>
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.14em] text-white/70">{eyebrow}</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80">{description}</p>
              <p className="mt-3 text-xs font-bold text-white/70">Última atualização: {updatedAt}</p>
            </div>
            <Link href="/configuracoes" className="ff-focus self-start rounded-full border border-white/25 bg-white/15 px-4 py-2 text-sm font-bold text-white hover:bg-white/20">
              Configurações
            </Link>
          </div>
        </header>

        <article className={`ff-card mt-6 space-y-8 p-5 sm:p-8 ${styles.document}`}>
          {children}
        </article>

        <footer className={`py-8 text-center text-xs text-foreground-muted ${styles.footer}`}>
          FinFlow 2.0 · Organização financeira pessoal, compartilhada e assistida por IA
        </footer>
      </div>
    </main>
  );
}
