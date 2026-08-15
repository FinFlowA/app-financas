"use client";

import { useActionState, useState } from "react";
import {
  cancelSubscriptionAction,
  startCheckoutAction,
  syncSubscriptionAction,
  type PlanActionState,
} from "./actions";

const INITIAL_PLAN_STATE: PlanActionState = { status: "idle", message: "" };

export type PlanId = "free" | "smart" | "premium";
export type BillingCycle = "monthly" | "annual";

export type BillingProduct = {
  code: string;
  plan: Exclude<PlanId, "free">;
  billing_cycle: BillingCycle;
  amount_brl: number;
};

export type SubscriptionView = {
  product_code: string;
  plan: string;
  status: string;
  provider: string;
  access_until: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  can_sync: boolean;
};

type PlanDefinition = {
  id: PlanId;
  name: string;
  description: string;
  badge?: string;
  features: string[];
};

const PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    description: "Para organizar o essencial",
    features: [
      "2 contas e 1 cartão",
      "40 lançamentos por mês",
      "1 objetivo financeiro",
      "7 categorias por tipo",
      "Sem assistente de IA",
    ],
  },
  {
    id: "smart",
    name: "Smart",
    description: "Mais espaço e IA operacional",
    badge: "Mais popular",
    features: [
      "5 contas e 3 cartões",
      "300 lançamentos por mês",
      "5 objetivos financeiros",
      "14 categorias por tipo",
      "15 ações e até 60 consultas de IA por dia",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    description: "Controle completo e análises",
    badge: "Completo",
    features: [
      "Contas, cartões e lançamentos ilimitados",
      "Objetivos e categorias ilimitados",
      "IA operacional e analítica",
      "Projeções e análise de padrões",
      "50 ações e até 200 consultas de IA por dia",
    ],
  },
];

const STATUS_LABELS: Record<string, string> = {
  none: "Sem assinatura",
  pending: "Pagamento pendente",
  active: "Ativa",
  grace_period: "Período de tolerância",
  past_due: "Pagamento atrasado",
  paused: "Pausada",
  cancelled: "Renovação cancelada",
  expired: "Expirada",
  refunded: "Reembolsada",
};

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function date(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "America/Sao_Paulo",
  }).format(parsed);
}

function Feedback({ state }: { state: PlanActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`mt-3 rounded-ff-sm border px-3 py-2 text-sm font-semibold ${state.status === "error"
        ? "border-red/30 bg-red/10 text-red"
        : "border-primary/30 bg-primary-soft text-primary-dark"}`}
    >
      {state.message}
    </p>
  );
}

function CheckoutForm({
  product,
  requestId,
  disabledReason,
  continuing,
}: {
  product: BillingProduct;
  requestId: string;
  disabledReason: string | null;
  continuing: boolean;
}) {
  const [state, action, pending] = useActionState(startCheckoutAction, INITIAL_PLAN_STATE);

  return (
    <div className="mt-5">
      <form action={action}>
        <input type="hidden" name="product_code" value={product.code} />
        <input type="hidden" name="request_id" value={requestId} />
        <button
          disabled={pending || Boolean(disabledReason)}
          className="ff-focus w-full rounded-ff-sm bg-primary px-4 py-3 text-sm font-extrabold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Abrindo checkout seguro..." : continuing ? "Continuar checkout" : "Assinar este plano"}
        </button>
      </form>
      {disabledReason && <p className="mt-2 text-xs leading-5 text-foreground-muted">{disabledReason}</p>}
      <Feedback state={state} />
    </div>
  );
}

function SubscriptionControls({ subscription, billingEnabled }: { subscription: SubscriptionView | null; billingEnabled: boolean }) {
  const [syncState, syncAction, syncing] = useActionState(syncSubscriptionAction, INITIAL_PLAN_STATE);
  const [cancelState, cancelAction, cancelling] = useActionState(cancelSubscriptionAction, INITIAL_PLAN_STATE);
  const canCancel = subscription != null
    && subscription.provider === "mercado_pago"
    && ["active", "grace_period", "past_due", "paused"].includes(subscription.status)
    && !subscription.cancel_at_period_end;

  return (
    <section className="ff-card p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">Status da cobrança</p>
          <h2 className="mt-1 text-xl font-extrabold text-foreground">
            {STATUS_LABELS[subscription?.status ?? "none"] ?? "Em conferência"}
          </h2>
          {subscription && (
            <div className="mt-2 space-y-1 text-sm text-foreground-muted">
              <p className="capitalize">Plano {subscription.plan}</p>
              {date(subscription.access_until ?? subscription.current_period_end) && (
                <p>Acesso previsto até {date(subscription.access_until ?? subscription.current_period_end)}.</p>
              )}
              {subscription.cancel_at_period_end && <p className="font-bold text-orange">A renovação já está cancelada.</p>}
            </div>
          )}
          {!subscription && <p className="mt-2 text-sm text-foreground-muted">Nenhum pagamento ou renovação em andamento.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={syncAction}>
            <button
              disabled={syncing || !billingEnabled || (subscription != null && !subscription.can_sync)}
              className="ff-focus rounded-ff-sm border border-border bg-surface-muted px-4 py-2.5 text-sm font-bold text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing ? "Atualizando..." : "Atualizar assinatura"}
            </button>
          </form>
          {canCancel && (
            <form action={cancelAction}>
              <input type="hidden" name="confirmation" value="cancel_subscription" />
              <button
                disabled={cancelling}
                onClick={(event) => {
                  if (!confirm("Cancelar a renovação? O acesso pago permanece até o fim do período já quitado.")) {
                    event.preventDefault();
                  }
                }}
                className="ff-focus rounded-ff-sm border border-red/40 px-4 py-2.5 text-sm font-bold text-red disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelling ? "Cancelando..." : "Cancelar renovação"}
              </button>
            </form>
          )}
        </div>
      </div>
      <Feedback state={syncState} />
      <Feedback state={cancelState} />
    </section>
  );
}

export default function PlansClient({
  products,
  currentPlan,
  billingEnabled,
  limitsEnabled,
  subscription,
  requestIds,
}: {
  products: BillingProduct[];
  currentPlan: PlanId;
  billingEnabled: boolean;
  limitsEnabled: boolean;
  subscription: SubscriptionView | null;
  requestIds: Record<string, string>;
}) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const productByPlan = new Map(products
    .filter((item) => item.billing_cycle === cycle)
    .map((item) => [item.plan, item]));

  return (
    <div className="space-y-6">
      {!limitsEnabled && (
        <div className="rounded-ff-md border border-orange/30 bg-orange/10 px-4 py-3 text-sm leading-6 text-foreground">
          <strong>Ambiente de desenvolvimento:</strong> os limites estão temporariamente liberados, sem promover sua conta e sem gerar cobrança.
        </div>
      )}

      <SubscriptionControls subscription={subscription} billingEnabled={billingEnabled} />

      <div className="mx-auto flex max-w-sm rounded-ff-md border border-border bg-surface-muted p-1" aria-label="Periodicidade da assinatura">
        {(["monthly", "annual"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={cycle === item}
            onClick={() => setCycle(item)}
            className={`ff-focus flex-1 rounded-ff-sm px-4 py-2.5 text-sm font-extrabold transition ${cycle === item ? "bg-surface text-foreground shadow-sm" : "text-foreground-muted"}`}
          >
            {item === "monthly" ? "Mensal" : "Anual · economize"}
          </button>
        ))}
      </div>

      <div className="grid items-stretch gap-5 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const product = plan.id === "free" ? null : productByPlan.get(plan.id);
          const monthlyEquivalent = product && cycle === "annual" ? product.amount_brl / 12 : product?.amount_brl;
          const pendingSameProduct = subscription?.status === "pending" && subscription.product_code === product?.code;
          let disabledReason: string | null = null;
          if (!billingEnabled) disabledReason = "Cobranças desativadas: nenhuma compra será iniciada.";
          else if (currentPlan !== "free") disabledReason = "Gerencie a assinatura atual antes de contratar outro plano.";
          else if (subscription && !pendingSameProduct) disabledReason = "Há outra assinatura em andamento. Atualize o status antes de continuar.";

          return (
            <article
              key={plan.id}
              className={`relative flex flex-col rounded-ff-lg border bg-surface p-5 shadow-sm sm:p-6 ${isCurrent ? "border-primary ring-2 ring-primary/15" : plan.id === "premium" ? "border-orange/40" : "border-border"}`}
            >
              {plan.badge && <span className={`absolute right-4 top-4 rounded-full px-3 py-1 text-[11px] font-extrabold text-white ${plan.id === "premium" ? "bg-orange" : "bg-primary"}`}>{plan.badge}</span>}
              {isCurrent && <span className="mb-3 self-start rounded-full bg-primary-soft px-3 py-1 text-[11px] font-extrabold text-primary-dark">Plano atual</span>}
              <h2 className="text-2xl font-extrabold text-foreground">{plan.name}</h2>
              <p className="mt-1 text-sm text-foreground-muted">{plan.description}</p>
              <div className="mt-5 border-b border-border pb-5">
                {plan.id === "free" ? (
                  <p className="text-3xl font-extrabold text-foreground">Grátis</p>
                ) : product ? (
                  <>
                    <p className="text-3xl font-extrabold text-foreground">
                      {brl(monthlyEquivalent ?? 0)}<span className="text-sm font-semibold text-foreground-muted">/mês</span>
                    </p>
                    {cycle === "annual" && <p className="mt-1 text-xs text-foreground-muted">{brl(product.amount_brl)} cobrados por ano</p>}
                  </>
                ) : (
                  <p className="text-sm font-bold text-red">Preço indisponível</p>
                )}
              </div>
              <ul className="mt-5 flex-1 space-y-3 text-sm text-foreground">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2"><span aria-hidden="true" className="font-extrabold text-primary">✓</span><span>{feature}</span></li>
                ))}
              </ul>
              {plan.id === "free" ? (
                <p className="mt-5 rounded-ff-sm bg-surface-muted px-4 py-3 text-center text-sm font-bold text-foreground-muted">
                  {isCurrent ? "Seu plano atual" : "Disponível após o fim do acesso pago"}
                </p>
              ) : product ? (
                isCurrent ? (
                  <p className="mt-5 rounded-ff-sm bg-primary-soft px-4 py-3 text-center text-sm font-bold text-primary-dark">Assinatura atual</p>
                ) : (
                  <CheckoutForm
                    key={product.code}
                    product={product}
                    requestId={requestIds[product.code]}
                    disabledReason={disabledReason}
                    continuing={pendingSameProduct}
                  />
                )
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
