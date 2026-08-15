import Link from "next/link";
import type { ReactNode } from "react";

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="scroll-mt-6 border-t border-border pt-7 first:border-0 first:pt-0">
      <h2 className="text-xl font-extrabold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-foreground-muted sm:text-[15px]">
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
    <main className="min-h-screen bg-background px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="overflow-hidden rounded-ff-lg bg-header p-6 text-white shadow-sm sm:p-9">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <p className="text-sm font-bold text-white/75">{eyebrow}</p>
              <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">{title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80">{description}</p>
              <p className="mt-3 text-xs font-bold text-white/70">Última atualização: {updatedAt}</p>
            </div>
            <Link href="/configuracoes" className="ff-focus self-start rounded-full border border-white/25 bg-white/15 px-4 py-2 text-sm font-bold text-white hover:bg-white/20">
              Voltar ao FinFlow
            </Link>
          </div>
        </header>

        <article className="mt-6 space-y-8 rounded-ff-lg border border-border bg-surface p-5 shadow-sm sm:p-8">
          {children}
        </article>

        <footer className="py-8 text-center text-xs text-foreground-muted">
          FinFlow · Organização financeira pessoal e compartilhada
        </footer>
      </div>
    </main>
  );
}
