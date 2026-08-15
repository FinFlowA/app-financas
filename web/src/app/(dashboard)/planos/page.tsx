import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PlansClient, {
  type BillingProduct,
  type PlanId,
  type SubscriptionView,
} from "./plans-client";

export const metadata: Metadata = {
  title: "Planos | FinFlow",
  description: "Compare e gerencie os planos do FinFlow.",
};

export const dynamic = "force-dynamic";

const FALLBACK_PRODUCTS: BillingProduct[] = [
  { code: "smart_monthly", plan: "smart", billing_cycle: "monthly", amount_brl: 9.9 },
  { code: "smart_annual", plan: "smart", billing_cycle: "annual", amount_brl: 79.9 },
  { code: "premium_monthly", plan: "premium", billing_cycle: "monthly", amount_brl: 19.9 },
  { code: "premium_annual", plan: "premium", billing_cycle: "annual", amount_brl: 149.9 },
];
const ALLOWED_PRODUCT_CODES = new Set(FALLBACK_PRODUCTS.map((item) => item.code));
const MANAGEABLE_STATUSES = ["active", "grace_period", "past_due", "paused"];

type SubscriptionRow = {
  product_code: string;
  plan: string;
  status: string;
  provider: string;
  provider_subscription_id: string | null;
  access_until: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function productsFromDatabase(value: unknown): BillingProduct[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): BillingProduct[] => {
    const row = object(candidate);
    const amount = Number(row.amount_brl);
    if (!ALLOWED_PRODUCT_CODES.has(String(row.code))
      || !["smart", "premium"].includes(String(row.plan))
      || !["monthly", "annual"].includes(String(row.billing_cycle))
      || !Number.isFinite(amount)
      || amount <= 0) return [];
    return [{
      code: String(row.code),
      plan: String(row.plan) as BillingProduct["plan"],
      billing_cycle: String(row.billing_cycle) as BillingProduct["billing_cycle"],
      amount_brl: amount,
    }];
  });
}

function subscriptionForPage(rows: SubscriptionRow[], currentPlan: PlanId): SubscriptionRow | null {
  return rows.find((row) => MANAGEABLE_STATUSES.includes(row.status) && row.plan === currentPlan)
    ?? rows.find((row) => MANAGEABLE_STATUSES.includes(row.status))
    ?? rows.find((row) => row.status === "pending")
    ?? rows.find((row) => row.status === "cancelled" && row.plan === currentPlan)
    ?? null;
}

export default async function PlansPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [entitlementResult, productsResult, subscriptionsResult] = await Promise.all([
    supabase.rpc("get_my_entitlement"),
    supabase
      .from("billing_products")
      .select("code,plan,billing_cycle,amount_brl")
      .eq("active", true)
      .order("amount_brl", { ascending: true }),
    supabase
      .from("subscriptions")
      .select("product_code,plan,status,provider,provider_subscription_id,access_until,current_period_end,cancel_at_period_end")
      .eq("user_id", user.id)
      .in("status", ["pending", "active", "past_due", "grace_period", "paused", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const entitlementRaw = Array.isArray(entitlementResult.data)
    ? entitlementResult.data[0]
    : entitlementResult.data;
  const entitlement = object(entitlementRaw);
  const currentPlan = ["smart", "premium"].includes(String(entitlement.plan))
    ? String(entitlement.plan) as PlanId
    : "free";
  const products = productsResult.error
    ? FALLBACK_PRODUCTS
    : productsFromDatabase(productsResult.data);
  const subscriptionRow = subscriptionForPage(
    (subscriptionsResult.data ?? []) as SubscriptionRow[],
    currentPlan,
  );
  const subscription: SubscriptionView | null = subscriptionRow ? {
    product_code: subscriptionRow.product_code,
    plan: subscriptionRow.plan,
    status: subscriptionRow.status,
    provider: subscriptionRow.provider,
    access_until: subscriptionRow.access_until,
    current_period_end: subscriptionRow.current_period_end,
    cancel_at_period_end: subscriptionRow.cancel_at_period_end === true,
    can_sync: subscriptionRow.provider === "mercado_pago" && Boolean(subscriptionRow.provider_subscription_id),
  } : null;
  const requestIds = Object.fromEntries(products.map((product) => [
    product.code,
    `web:${randomUUID()}`,
  ]));

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-ff-lg bg-header p-6 text-white shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="text-sm font-bold text-white/75">Assinatura FinFlow</p>
            <h1 className="mt-1 text-3xl font-extrabold">Escolha o plano ideal</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">
              Compare recursos, abra o checkout oficial e acompanhe o status sem expor dados de pagamento ao FinFlow.
            </p>
          </div>
          <Link href="/configuracoes" className="ff-focus self-start rounded-full border border-white/25 bg-white/15 px-4 py-2 text-sm font-bold text-white hover:bg-white/20">
            Voltar às configurações
          </Link>
        </div>
      </section>

      {entitlementResult.error && (
        <p role="alert" className="rounded-ff-md border border-red/30 bg-red/10 px-4 py-3 text-sm font-bold text-red">
          Não foi possível confirmar seu plano. Novas contratações permanecem bloqueadas por segurança.
        </p>
      )}

      <PlansClient
        products={products}
        currentPlan={currentPlan}
        billingEnabled={!entitlementResult.error && !productsResult.error && entitlement.billing_enabled === true}
        limitsEnabled={entitlement.limits_enabled === true}
        subscription={subscription}
        requestIds={requestIds}
      />

      <section className="ff-card p-5 text-sm leading-6 text-foreground-muted sm:p-6">
        <h2 className="text-lg font-extrabold text-foreground">Cobrança segura e transparente</h2>
        <p className="mt-2">
          O pagamento é processado pelo Mercado Pago. O retorno do checkout nunca ativa um plano sozinho: o FinFlow confirma o status diretamente com o provedor antes de liberar os recursos.
        </p>
        <p className="mt-2">
          Ao assinar, você concorda com os <Link href="/termos" className="font-bold text-primary hover:underline">Termos de Uso</Link> e a <Link href="/privacidade" className="font-bold text-primary hover:underline">Política de Privacidade</Link>.
        </p>
      </section>
    </div>
  );
}
