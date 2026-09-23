import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Preços e planos",
  description: "Compare os planos Gratuito, Pro e Plus do FinFlow.",
};

const plans = [
  {
    name: "Gratuito",
    description: "Para organizar o essencial.",
    monthly: "Grátis",
    annual: null,
    annualSavings: null,
    features: ["40 lançamentos por mês", "2 contas, 1 cartão e 1 objetivo", "1 vínculo compartilhado"],
  },
  {
    name: "Pro",
    description: "Mais capacidade e automação para o dia a dia.",
    monthly: "R$ 19,90/mês",
    annual: "R$ 199,00/ano",
    annualSavings: "R$ 39,80",
    features: ["150 lançamentos por mês", "5 contas, 3 cartões e 3 objetivos", "3 vínculos compartilhados", "IA básica"],
  },
  {
    name: "Plus",
    description: "Controle completo com análises avançadas.",
    monthly: "R$ 39,90/mês",
    annual: "R$ 399,00/ano",
    annualSavings: "R$ 79,80",
    features: ["Lançamentos e recursos ilimitados", "Vínculos compartilhados ilimitados", "Projeções avançadas", "IA completa"],
  },
] as const;

export default function PublicPricingPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/login" className="ff-focus inline-flex items-center gap-3 rounded-ff-sm">
            <Image src="/icon.png" alt="" width={42} height={42} className="rounded-xl" />
            <span className="text-2xl font-black">FinFlow</span>
          </Link>
          <div className="flex gap-3">
            <Link href="/login" className="ff-focus rounded-ff-sm border border-border px-4 py-2 text-sm font-bold">Entrar</Link>
            <Link href="/cadastro" className="ff-focus rounded-ff-sm bg-primary px-4 py-2 text-sm font-extrabold text-white">Criar conta</Link>
          </div>
        </header>

        <section className="ff-page-hero mt-8 p-6 sm:p-10">
          <p className="text-xs font-extrabold uppercase tracking-[.14em] text-white/70">Planos FinFlow</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Organize hoje. Evolua quando precisar.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/80 sm:text-base">Controle contas, despesas, objetivos e cartões em um só lugar. Os planos pagos adicionam capacidade, relatórios e assistência financeira.</p>
        </section>

        <section aria-label="Comparação de planos" className="mt-8 grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <article key={plan.name} className="ff-card flex flex-col p-6">
              <h2 className="text-2xl font-black">{plan.name}</h2>
              <p className="mt-1 min-h-10 text-sm text-foreground-muted">{plan.description}</p>
              <p className="mt-5 text-3xl font-black">{plan.monthly}</p>
              {plan.annual ? <div className="mt-1 text-sm font-bold text-primary">
                <p>ou {plan.annual}</p>
                <p className="mt-1 text-xs font-extrabold">Economize {plan.annualSavings} por ano</p>
              </div> : <p className="mt-1 text-sm text-foreground-muted">sem cobrança</p>}
              <ul className="mt-6 flex-1 space-y-3 text-sm">
                {plan.features.map((feature) => <li key={feature} className="flex gap-2"><span aria-hidden="true" className="font-black text-primary">✓</span><span>{feature}</span></li>)}
              </ul>
              <Link href="/cadastro" className="ff-focus mt-6 rounded-ff-sm bg-primary px-4 py-3 text-center text-sm font-extrabold text-white">Começar no FinFlow</Link>
            </article>
          ))}
        </section>

        <p className="mt-6 text-center text-xs leading-5 text-foreground-muted">Impostos e moeda final são confirmados pela Paddle conforme a localização no checkout. Nenhuma cobrança ocorre nesta página.</p>

        <footer className="mt-10 flex flex-wrap justify-center gap-x-5 gap-y-3 border-t border-border pt-6 text-sm font-semibold text-foreground-muted">
          <Link href="/termos" className="hover:text-primary">Termos de Uso</Link>
          <Link href="/privacidade" className="hover:text-primary">Privacidade</Link>
          <Link href="/reembolso" className="hover:text-primary">Cancelamento e reembolso</Link>
          <a href="mailto:Finflowfinancas@gmail.com?subject=%5BFinFlow%20-%20Contato%5D" className="hover:text-primary">Contato</a>
        </footer>
      </div>
    </main>
  );
}
