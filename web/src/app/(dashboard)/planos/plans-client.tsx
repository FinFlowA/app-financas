"use client";

import { useActionState, useState } from "react";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import {
  cancelSubscriptionAction,
  startCheckoutAction,
  syncSubscriptionAction,
  type PlanActionState,
} from "./actions";
import styles from "./plans.module.css";

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

function PlanIcon({ name }: { name: "check" | "crown" | "shield" | "sparkle" | "sync" | "warning" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {name === "check" && <path d="m5 12 4 4L19 6" />}
      {name === "crown" && <><path d="m3 7 4 4 5-7 5 7 4-4-2 11H5Z" /><path d="M5 21h14" /></>}
      {name === "shield" && <><path d="M12 3 4.5 6v5.5c0 4.5 3 7.7 7.5 9.5 4.5-1.8 7.5-5 7.5-9.5V6Z" /><path d="m9 12 2 2 4-4" /></>}
      {name === "sparkle" && <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2Z" /><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" /></>}
      {name === "sync" && <><path d="M20 7h-5V2" /><path d="M20 7a8 8 0 1 0 1 8" /></>}
      {name === "warning" && <><path d="M10.3 4.5 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>}
    </svg>
  );
}

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
      className={`${styles.feedback} ${state.status === "error" ? styles.feedbackError : ""}`}
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
          className={`ff-focus ${styles.checkoutButton}`}
        >
          {pending ? "Abrindo checkout seguro..." : continuing ? "Continuar checkout" : "Assinar este plano"}
        </button>
      </form>
      {disabledReason && <p className="mt-2 text-xs leading-5 text-foreground-muted">{disabledReason}</p>}
      <Feedback state={state} />
    </div>
  );
}

function CancelDialog({ pending, onClose }: { pending: boolean; onClose: () => void }) {
  return (
    <ConfirmationDialog
      title="Cancelar a renovação?"
      description="O acesso pago permanece disponível até o fim do período já quitado. Nenhuma cobrança futura será iniciada."
      confirmLabel="Confirmar cancelamento"
      pending={pending}
      onClose={onClose}
    />
  );
}

function SubscriptionControls({ subscription, billingEnabled }: { subscription: SubscriptionView | null; billingEnabled: boolean }) {
  const [syncState, syncAction, syncing] = useActionState(syncSubscriptionAction, INITIAL_PLAN_STATE);
  const [cancelState, cancelAction, cancelling] = useActionState(cancelSubscriptionAction, INITIAL_PLAN_STATE);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const canCancel = subscription != null
    && subscription.provider === "mercado_pago"
    && ["active", "grace_period", "past_due", "paused"].includes(subscription.status)
    && !subscription.cancel_at_period_end;

  return (
    <section className={`ff-card p-5 sm:p-6 ${styles.statusPanel}`}>
      <div className={`flex flex-col justify-between gap-5 lg:flex-row lg:items-center ${styles.statusContent}`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={styles.statusIcon}><PlanIcon name="shield" /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.12em] text-foreground-muted">Status da cobrança</p>
            <h2 className="mt-1 text-xl font-black text-foreground">
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
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={syncAction}>
            <button
              disabled={syncing || !billingEnabled || (subscription != null && !subscription.can_sync)}
              className={`ff-focus ${styles.secondaryButton}`}
            >
              <PlanIcon name="sync" />
              {syncing ? "Atualizando..." : "Atualizar assinatura"}
            </button>
          </form>
          {canCancel && (
            <form action={cancelAction}>
              <input type="hidden" name="confirmation" value="cancel_subscription" />
              <button
                type="button"
                disabled={cancelling}
                onClick={() => setConfirmCancel(true)}
                className={`ff-focus ${styles.dangerButton}`}
              >
                {cancelling ? "Cancelando..." : "Cancelar renovação"}
              </button>
              {confirmCancel && (
                <CancelDialog
                  pending={cancelling}
                  onClose={() => setConfirmCancel(false)}
                />
              )}
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
        <div className="flex items-start gap-3 rounded-ff-md border border-orange/30 bg-orange/10 px-4 py-3 text-sm leading-6 text-foreground">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange/10 text-orange [&>svg]:h-4 [&>svg]:w-4"><PlanIcon name="warning" /></span>
          <p><strong>Ambiente de desenvolvimento:</strong> os limites estão temporariamente liberados, sem promover sua conta e sem gerar cobrança.</p>
        </div>
      )}

      <SubscriptionControls subscription={subscription} billingEnabled={billingEnabled} />

      <div className={styles.cycleSwitch} aria-label="Periodicidade da assinatura">
        {(["monthly", "annual"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={cycle === item}
            onClick={() => setCycle(item)}
            className={`ff-focus ${styles.cycleButton} ${cycle === item ? styles.cycleButtonActive : ""}`}
          >
            {item === "monthly" ? "Mensal" : "Anual · economize"}
          </button>
        ))}
      </div>

      <div className={styles.planGrid}>
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
              className={`${styles.planCard} ${isCurrent ? styles.planCurrent : ""} ${plan.id === "premium" ? styles.planPremium : ""}`}
            >
              <div className="mb-4 flex min-h-7 flex-wrap items-center justify-between gap-2">
                {isCurrent ? <span className={styles.badge}><PlanIcon name="check" />Plano atual</span> : <span />}
                {plan.badge && <span className={`${styles.badge} ${plan.id === "premium" ? styles.premiumBadge : ""}`}>
                  <PlanIcon name={plan.id === "premium" ? "crown" : "sparkle"} />{plan.badge}
                </span>}
              </div>
              <h2 className="text-2xl font-black tracking-tight text-foreground">{plan.name}</h2>
              <p className="mt-1 text-sm text-foreground-muted">{plan.description}</p>
              <div className={styles.priceBlock}>
                {plan.id === "free" ? (
                  <p className={styles.price}>Grátis</p>
                ) : product ? (
                  <>
                    <p className={styles.price}>
                      {brl(monthlyEquivalent ?? 0)}<span className="text-sm font-semibold text-foreground-muted">/mês</span>
                    </p>
                    {cycle === "annual" && <p className="mt-1 text-xs text-foreground-muted">{brl(product.amount_brl)} cobrados por ano</p>}
                  </>
                ) : (
                  <p className="text-sm font-bold text-red">Preço indisponível</p>
                )}
              </div>
              <ul className={styles.featureList}>
                {plan.features.map((feature) => (
                  <li key={feature} className={styles.featureItem}><span aria-hidden="true" className={styles.check}>✓</span><span>{feature}</span></li>
                ))}
              </ul>
              {plan.id === "free" ? (
                <p className="mt-5 rounded-ff-sm border border-border bg-surface-muted/70 px-4 py-3 text-center text-sm font-bold text-foreground-muted">
                  {isCurrent ? "Seu plano atual" : "Disponível após o fim do acesso pago"}
                </p>
              ) : product ? (
                isCurrent ? (
                  <p className="mt-5 rounded-ff-sm border border-primary/20 bg-primary-soft px-4 py-3 text-center text-sm font-bold text-primary-dark">Assinatura atual</p>
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
