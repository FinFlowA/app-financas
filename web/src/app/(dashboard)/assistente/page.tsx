import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AssistantChat from "./assistant-chat";

const HOME_INSIGHT_PROMPT = "Analise meus dados financeiros atuais e me dê um insight objetivo sobre receitas, despesas, saldo e próximos compromissos, sem criar ou alterar nenhum registro.";

export default async function AssistentePage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const params = await searchParams;
  // Somente atalhos definidos pelo próprio FinFlow são executados
  // automaticamente. Isso evita que um link externo consuma a cota do usuário
  // ou tente iniciar uma ação por meio de texto arbitrário na URL.
  const initialPrompt = params.prompt === "insight-financeiro" ? HOME_INSIGHT_PROMPT : null;
  const supabase = await createClient();
  const [{ data: authData }, entitlementResult] = await Promise.all([supabase.auth.getUser(), supabase.rpc("get_my_entitlement")]);
  if (!authData.user) redirect("/login");
  const raw = Array.isArray(entitlementResult.data) ? entitlementResult.data[0] : entitlementResult.data;
  const entitlement = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const plan = entitlement.plan === "smart" || entitlement.plan === "premium" ? String(entitlement.plan) : "free";
  const limitsEnabled = Boolean(entitlement.limits_enabled);
  const entitlementAvailable = !entitlementResult.error && raw !== null && typeof raw === "object";
  const hasAccess = entitlementAvailable && (!limitsEnabled || plan === "smart" || plan === "premium");
  return <AssistantChat userId={authData.user.id} hasAccess={hasAccess} plan={plan} initialPrompt={initialPrompt} />;
}
