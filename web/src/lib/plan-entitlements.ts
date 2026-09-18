export type PlanId = "free" | "smart" | "premium";
export type PlanFeature = "daily_cash_flow" | "bank_reconciliation" | "full_category_reports" | "advanced_analysis" | "financial_ai";

export const PLAN_ORDER: Record<PlanId, number> = { free: 0, smart: 1, premium: 2 };

export const PLAN_DEFINITIONS = {
  free: {
    name: "Gratuito", description: "Para organizar o essencial", badge: undefined,
    limits: { transactions: 40, accounts: 2, cards: 1, goals: 1, categoriesPerType: 7, sharedLinks: 1, aiQueriesDaily: 0, aiActionsDaily: 0 },
    features: ["40 lançamentos por mês", "2 contas, 1 cartão e 1 objetivo", "7 categorias por tipo", "Fluxo mensal e relatórios resumidos", "1 vínculo compartilhado (conta ou objetivo)"],
  },
  smart: {
    name: "Pro", description: "Mais capacidade e automação para o dia a dia", badge: "Mais popular",
    limits: { transactions: 150, accounts: 5, cards: 3, goals: 3, categoriesPerType: 14, sharedLinks: 3, aiQueriesDaily: 60, aiActionsDaily: 15 },
    features: ["150 lançamentos por mês", "5 contas, 3 cartões e 3 objetivos", "14 categorias por tipo", "3 vínculos compartilhados (contas ou objetivos)", "Fluxo diário, extrato e conciliação", "Relatórios completos por categoria", "IA básica: 60 consultas e 15 ações por dia"],
  },
  premium: {
    name: "Plus", description: "Controle completo com análises avançadas", badge: "Completo",
    limits: { transactions: null, accounts: null, cards: null, goals: null, categoriesPerType: null, sharedLinks: null, aiQueriesDaily: 200, aiActionsDaily: 50 },
    features: ["Lançamentos e recursos ilimitados", "Todos os recursos do Pro", "Vínculos compartilhados ilimitados", "Projeções e análises avançadas", "IA completa: 200 consultas e 50 ações por dia"],
  },
} as const;

export function normalizePlan(value: unknown): PlanId { return value === "smart" || value === "premium" ? value : "free"; }

export function planHasFeature(plan: PlanId, feature: PlanFeature, limitsEnabled = true) {
  if (!limitsEnabled) return true;
  const minimum: Record<PlanFeature, PlanId> = { daily_cash_flow: "smart", bank_reconciliation: "smart", full_category_reports: "smart", advanced_analysis: "premium", financial_ai: "smart" };
  return PLAN_ORDER[plan] >= PLAN_ORDER[minimum[feature]];
}
