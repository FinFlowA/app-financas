import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { normalizePlan } from "@/lib/plan-entitlements";
import { getPaddleConfig } from "@/lib/paddle/pricing-tiers";
import { createClient } from "@/lib/supabase/server";
import PlansClient from "./plans-client";
import PortalButton from "./portal-button";

export const metadata: Metadata = { title: "Planos", description: "Compare os planos do FinFlow." };
export const dynamic = "force-dynamic";

function countryFromHeader(value: string | null): string | undefined {
  const country = value?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) ? country : undefined;
}

export default async function PlansPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: entitlementData }, requestHeaders] = await Promise.all([
    supabase.rpc("get_my_entitlement"),
    headers(),
  ]);
  const entitlement = Array.isArray(entitlementData) ? entitlementData[0] : entitlementData;
  const currentPlan = normalizePlan(entitlement && typeof entitlement === "object" && "plan" in entitlement ? entitlement.plan : null);
  const config = getPaddleConfig();

  return <div className="space-y-6">
    <section className="ff-page-hero p-6 sm:p-8">
      <p className="text-xs font-extrabold uppercase tracking-[.14em] text-white/70">Assinatura FinFlow</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Escolha o plano ideal</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">Comece grátis e evolua quando precisar de mais capacidade, conciliação ou inteligência financeira.</p>
    </section>

    <PlansClient
      tiers={config.tiers}
      environment={config.environment}
      clientToken={config.clientToken}
      country={countryFromHeader(requestHeaders.get("x-vercel-ip-country"))}
      customerEmail={user.email}
      userId={user.id}
      currentPlan={currentPlan}
    />

    <section className="ff-card p-5 text-sm leading-6 text-foreground-muted sm:p-6">
      <h2 className="text-lg font-extrabold text-foreground">Compra segura com Paddle</h2>
      <p className="mt-2">Os preços e impostos são calculados pela Paddle conforme sua localização. O valor exibido aqui é o mesmo enviado ao checkout.</p>
      <p className="mt-2">A ativação definitiva do plano será confirmada pelo servidor após o pagamento. Consulte os <Link href="/termos" className="font-bold text-primary hover:underline">Termos de Uso</Link>.</p>
      <div className="mt-4"><PortalButton /></div>
    </section>
  </div>;
}
