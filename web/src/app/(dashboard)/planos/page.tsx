import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Planos",
  description: "Assinaturas do FinFlow em manutenção.",
};

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <section className="ff-page-hero p-6 sm:p-8">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[.14em] text-white/70">Assinatura FinFlow</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Planos em manutenção</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">
            Estamos ajustando os planos do FinFlow. Enquanto isso, todos os recursos, incluindo a IA, continuam liberados sem custo para sua conta.
          </p>
        </div>
      </section>

      <section className="ff-card p-6 text-sm leading-6 text-foreground-muted sm:p-8">
        <div className="flex items-start gap-4">
          <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-dark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <path d="M10.3 3.5 3.5 10.3a2 2 0 0 0 0 2.8l7.4 7.4a2 2 0 0 0 2.8 0l6.8-6.8a2 2 0 0 0 0-2.8l-7.4-7.4a2 2 0 0 0-2.8 0Z" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
          </span>
          <div>
            <h2 className="text-lg font-extrabold text-foreground">Voltamos em breve</h2>
            <p className="mt-2">Nenhuma cobrança será feita durante esse período. Se você já tinha uma assinatura ativa, ela continua valendo normalmente.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
