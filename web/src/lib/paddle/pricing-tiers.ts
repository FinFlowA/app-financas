import { PLAN_DEFINITIONS, type PlanId } from "@/lib/plan-entitlements";

export type BillingFrequency = "month" | "year";

export interface Tier {
  id: PlanId;
  name: string;
  description: string;
  features: string[];
  badge?: string;
  priceId: { month: string; year: string } | null;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

export function getPaddleConfig() {
  const environment = requiredEnv("NEXT_PUBLIC_PADDLE_ENV");
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("NEXT_PUBLIC_PADDLE_ENV deve ser 'sandbox' ou 'production'.");
  }

  const tier = (id: PlanId, priceId: Tier["priceId"]): Tier => ({
    id,
    name: PLAN_DEFINITIONS[id].name,
    description: PLAN_DEFINITIONS[id].description,
    features: [...PLAN_DEFINITIONS[id].features],
    badge: PLAN_DEFINITIONS[id].badge,
    priceId,
  });

  return {
    environment: environment as "sandbox" | "production",
    clientToken: requiredEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN"),
    tiers: [
      tier("free", null),
      tier("smart", {
        month: requiredEnv("NEXT_PUBLIC_PADDLE_SMART_MONTHLY_PRICE_ID"),
        year: requiredEnv("NEXT_PUBLIC_PADDLE_SMART_YEARLY_PRICE_ID"),
      }),
      tier("premium", {
        month: requiredEnv("NEXT_PUBLIC_PADDLE_PREMIUM_MONTHLY_PRICE_ID"),
        year: requiredEnv("NEXT_PUBLIC_PADDLE_PREMIUM_YEARLY_PRICE_ID"),
      }),
    ] satisfies Tier[],
  };
}
