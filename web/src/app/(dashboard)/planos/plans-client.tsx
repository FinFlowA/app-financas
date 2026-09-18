"use client";

import { initializePaddle, type Environments, type Paddle, type PricePreviewParams } from "@paddle/paddle-js";
import { useEffect, useMemo, useState } from "react";
import type { PlanId } from "@/lib/plan-entitlements";
import type { BillingFrequency, Tier } from "@/lib/paddle/pricing-tiers";
import styles from "./plans.module.css";

type PriceMap = Record<string, string>;

function PlanIcon({ name }: { name: "check" | "crown" | "sparkle" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name === "check" && <path d="m5 12 4 4L19 6" />}
    {name === "crown" && <><path d="m3 7 4 4 5-7 5 7 4-4-2 11H5Z" /><path d="M5 21h14" /></>}
    {name === "sparkle" && <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2Z" /><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" /></>}
  </svg>;
}

export default function PlansClient({ tiers, environment, clientToken, country, customerEmail, userId, currentPlan }: {
  tiers: Tier[];
  environment: Environments;
  clientToken: string;
  country?: string;
  customerEmail?: string;
  userId: string;
  currentPlan: PlanId;
}) {
  const [frequency, setFrequency] = useState<BillingFrequency>("month");
  const [paddle, setPaddle] = useState<Paddle>();
  const [prices, setPrices] = useState<PriceMap>({});
  const [error, setError] = useState<string | null>(null);
  const priceIds = useMemo(() => tiers.flatMap((tier) => tier.priceId ? [tier.priceId.month, tier.priceId.year] : []), [tiers]);

  useEffect(() => {
    let active = true;
    initializePaddle({ token: clientToken, environment }).then((instance) => {
      if (active && instance) setPaddle(instance);
    }).catch(() => active && setError("Não consegui iniciar o checkout seguro. Atualize a página e tente novamente."));
    return () => { active = false; };
  }, [clientToken, environment]);

  useEffect(() => {
    if (!paddle || priceIds.length === 0) return;
    let active = true;
    const preview = (priceId: string) => {
      const params: PricePreviewParams = {
        items: [{ priceId, quantity: 1 }],
        ...(country ? { address: { countryCode: country } } : {}),
      };
      return paddle.PricePreview(params);
    };
    Promise.all(priceIds.map(preview)).then((responses) => {
      if (!active) return;
      const next: PriceMap = {};
      for (const response of responses) {
        for (const item of response.data.details.lineItems) next[item.price.id] = item.formattedTotals.total;
      }
      setPrices(next);
    }).catch(() => active && setError("Não consegui carregar os preços da Paddle agora. Tente novamente em instantes."));
    return () => { active = false; };
  }, [country, paddle, priceIds]);

  function subscribe(tier: Tier) {
    if (!paddle || !tier.priceId) return;
    paddle.Checkout.open({
      items: [{ priceId: tier.priceId[frequency], quantity: 1 }],
      ...(customerEmail ? { customer: { email: customerEmail } } : {}),
      customData: { finflow_plan: tier.id, billing_frequency: frequency, finflow_user_id: userId },
      settings: {
        displayMode: "overlay",
        variant: "one-page",
        successUrl: `${window.location.origin}/welcome`,
        allowLogout: !customerEmail,
      },
    });
  }

  return <div className="space-y-6">
    {environment === "sandbox" && <p className={styles.sandboxNotice}>Ambiente de teste Paddle — nenhum pagamento real será cobrado.</p>}
    {error && <p role="alert" className={styles.feedbackError}>{error}</p>}

    <div className={styles.cycleSwitch} aria-label="Periodicidade da assinatura">
      {(["month", "year"] as const).map((item) => <button key={item} type="button" aria-pressed={frequency === item} onClick={() => setFrequency(item)} className={`ff-focus ${styles.cycleButton} ${frequency === item ? styles.cycleButtonActive : ""}`}>
        {item === "month" ? "Mensal" : "Anual"}
      </button>)}
    </div>

    <div className={styles.planGrid}>
      {tiers.map((tier) => {
        const isCurrent = tier.id === currentPlan;
        const priceId = tier.priceId?.[frequency];
        const formattedPrice = priceId ? prices[priceId] : null;
        return <article key={tier.id} className={`${styles.planCard} ${isCurrent ? styles.planCurrent : ""} ${tier.id === "premium" ? styles.planPremium : ""}`}>
          <div className="mb-4 flex min-h-7 flex-wrap items-center justify-between gap-2">
            {isCurrent ? <span className={styles.badge}><PlanIcon name="check" />Plano atual</span> : <span />}
            {tier.badge && <span className={`${styles.badge} ${tier.id === "premium" ? styles.premiumBadge : ""}`}><PlanIcon name={tier.id === "premium" ? "crown" : "sparkle"} />{tier.badge}</span>}
          </div>
          <h2 className="text-2xl font-black tracking-tight text-foreground">{tier.name}</h2>
          <p className="mt-1 text-sm text-foreground-muted">{tier.description}</p>
          <div className={styles.priceBlock}>
            {tier.priceId ? <p className={styles.price}>{formattedPrice ?? <span className={styles.priceSkeleton} aria-label="Carregando preço" />}<span className="ml-1 text-sm font-semibold text-foreground-muted">/{frequency === "month" ? "mês" : "ano"}</span></p> : <p className={styles.price}>Grátis</p>}
          </div>
          <ul className={styles.featureList}>{tier.features.map((feature) => <li key={feature} className={styles.featureItem}><span aria-hidden="true" className={styles.check}>✓</span><span>{feature}</span></li>)}</ul>
          {tier.priceId ? <button type="button" disabled={!paddle || !formattedPrice || isCurrent} onClick={() => subscribe(tier)} className={`ff-focus mt-5 ${styles.checkoutButton}`}>
            {isCurrent ? "Seu plano atual" : formattedPrice ? `Assinar ${tier.name}` : "Carregando preço..."}
          </button> : <p className="mt-5 rounded-ff-sm border border-border bg-surface-muted/70 px-4 py-3 text-center text-sm font-bold text-foreground-muted">{isCurrent ? "Seu plano atual" : "Plano gratuito"}</p>}
        </article>;
      })}
    </div>
  </div>;
}
