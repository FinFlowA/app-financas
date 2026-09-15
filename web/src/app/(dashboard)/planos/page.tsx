import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { normalizePlan } from "@/lib/plan-entitlements";
import { createClient } from "@/lib/supabase/server";
import PlansClient, { type BillingProduct, type SubscriptionView } from "./plans-client";

export const metadata: Metadata = { title: "Planos", description: "Compare os planos do FinFlow." };
export const dynamic = "force-dynamic";
const FALLBACK_PRODUCTS: BillingProduct[] = [
  { code: "smart_monthly", plan: "smart", billing_cycle: "monthly", amount_brl: 9.9 },
  { code: "smart_annual", plan: "smart", billing_cycle: "annual", amount_brl: 79.9 },
  { code: "premium_monthly", plan: "premium", billing_cycle: "monthly", amount_brl: 19.9 },
  { code: "premium_annual", plan: "premium", billing_cycle: "annual", amount_brl: 149.9 },
];
const CODES = new Set(FALLBACK_PRODUCTS.map((item) => item.code));
const MANAGEABLE = ["active", "grace_period", "past_due", "paused"];
type SubscriptionRow = Omit<SubscriptionView, "can_sync"> & { provider_subscription_id: string | null };
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export default async function PlansPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [entitlementResult, productsResult, subscriptionsResult] = await Promise.all([
    supabase.rpc("get_my_entitlement"),
    supabase.from("billing_products").select("code,plan,billing_cycle,amount_brl").eq("active", true).order("amount_brl"),
    supabase.from("subscriptions").select("product_code,plan,status,provider,provider_subscription_id,access_until,current_period_end,cancel_at_period_end").eq("user_id", user.id).in("status", ["pending", ...MANAGEABLE, "cancelled"]).order("created_at", { ascending: false }).limit(10),
  ]);
  const entitlement = asRecord(Array.isArray(entitlementResult.data) ? entitlementResult.data[0] : entitlementResult.data);
  const currentPlan = normalizePlan(entitlement.plan);
  const databaseProducts = Array.isArray(productsResult.data) ? productsResult.data.flatMap((candidate): BillingProduct[] => {
    const row = asRecord(candidate); const amount = Number(row.amount_brl);
    return CODES.has(String(row.code)) && (row.plan === "smart" || row.plan === "premium") && (row.billing_cycle === "monthly" || row.billing_cycle === "annual") && amount > 0
      ? [{ code: String(row.code), plan: row.plan, billing_cycle: row.billing_cycle, amount_brl: amount }] : [];
  }) : [];
  const products = productsResult.error || databaseProducts.length === 0 ? FALLBACK_PRODUCTS : databaseProducts;
  const rows = (subscriptionsResult.data ?? []) as SubscriptionRow[];
  const row = rows.find((item) => MANAGEABLE.includes(item.status) && item.plan === currentPlan) ?? rows.find((item) => MANAGEABLE.includes(item.status)) ?? rows.find((item) => item.status === "pending") ?? null;
  const subscription: SubscriptionView | null = row ? { ...row, cancel_at_period_end: row.cancel_at_period_end === true, can_sync: row.provider === "mercado_pago" && Boolean(row.provider_subscription_id) } : null;
  const requestIds = Object.fromEntries(products.map((product) => [product.code, `web:${randomUUID()}`]));

  return <div className="space-y-6">
    <section className="ff-page-hero p-6 sm:p-8"><p className="text-xs font-extrabold uppercase tracking-[.14em] text-white/70">Assinatura FinFlow</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Escolha o plano ideal</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">Comece grátis e evolua quando precisar de mais capacidade, conciliação ou inteligência financeira.</p></section>
    {entitlementResult.error && <p role="alert" className="rounded-ff-md border border-red/30 bg-red/10 px-4 py-3 text-sm font-bold text-red">Não foi possível confirmar seu plano. Contratações permanecem bloqueadas por segurança.</p>}
    <PlansClient products={products} currentPlan={currentPlan} billingEnabled={!entitlementResult.error && entitlement.billing_enabled === true} limitsEnabled={entitlement.limits_enabled === true} subscription={subscription} requestIds={requestIds} />
    <section className="ff-card p-5 text-sm leading-6 text-foreground-muted sm:p-6"><h2 className="text-lg font-extrabold text-foreground">Como os limites funcionam</h2><p className="mt-2">Cada parcela ou recorrência conta no mês do vencimento. Transferências contam uma única vez; pagamentos parciais, conciliações e registros técnicos não aumentam o consumo.</p><p className="mt-2">Contas compartilhadas estão em todos os planos e ocupam uma vaga para cada participante após o aceite. Ao reduzir o plano, seus dados permanecem intactos; apenas novas criações ficam bloqueadas até haver espaço.</p><p className="mt-2">A cobrança continua desativada nesta implementação local. Consulte os <Link href="/termos" className="font-bold text-primary hover:underline">Termos de Uso</Link>.</p></section>
  </div>;
}
