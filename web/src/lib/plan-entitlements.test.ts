import { describe, expect, it } from "vitest";
import { PLAN_DEFINITIONS, normalizePlan, planHasFeature } from "./plan-entitlements";

describe("matriz de planos", () => {
  it("mantém os limites comerciais aprovados", () => {
    expect(PLAN_DEFINITIONS.free.limits.transactions).toBe(40);
    expect(PLAN_DEFINITIONS.smart.limits.transactions).toBe(150);
    expect(PLAN_DEFINITIONS.smart.limits.goals).toBe(3);
    expect(PLAN_DEFINITIONS.premium.limits.transactions).toBeNull();
  });

  it("libera os recursos conforme a hierarquia", () => {
    expect(planHasFeature("free", "daily_cash_flow")).toBe(false);
    expect(planHasFeature("smart", "daily_cash_flow")).toBe(true);
    expect(planHasFeature("smart", "advanced_analysis")).toBe(false);
    expect(planHasFeature("premium", "advanced_analysis")).toBe(true);
  });

  it("mantém tudo liberado durante o período local sem limites", () => {
    expect(planHasFeature(normalizePlan("free"), "bank_reconciliation", false)).toBe(true);
  });
});
