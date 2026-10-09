import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AssistantChat from "./assistant-chat";

const HOME_INSIGHT_PROMPT = "Analise meus dados financeiros atuais e me dê um insight objetivo sobre receitas, despesas, saldo e próximos compromissos, sem criar ou alterar nenhum registro.";

export default async function AssistentePage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const params = await searchParams;
  const initialPrompt = params.prompt === "insight-financeiro" ? HOME_INSIGHT_PROMPT : null;
  const supabase = await createClient();
  const [{ data: authData }, entitlementResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("get_my_entitlement"),
  ]);
  if (!authData.user) redirect("/login");
  const raw = Array.isArray(entitlementResult.data) ? entitlementResult.data[0] : entitlementResult.data;
  const entitlement = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const plan = entitlement.plan === "smart" || entitlement.plan === "premium" ? String(entitlement.plan) : "free";
  const limitsEnabled = Boolean(entitlement.limits_enabled);
  const entitlementAvailable = !entitlementResult.error && raw !== null && typeof raw === "object";
  const hasAccess = entitlementAvailable && (!limitsEnabled || plan === "smart" || plan === "premium");
  // Nome e saudação com a mesma regra do Início, para a boas-vindas do Finn.
  const metadata = authData.user.user_metadata as Record<string, unknown>;
  const displayName = typeof metadata.nome_usuario === "string" && metadata.nome_usuario.trim()
    ? metadata.nome_usuario.trim()
    : typeof metadata.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name.trim()
      : authData.user.email?.split("@")[0] ?? "";
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return <AssistantChat userId={authData.user.id} hasAccess={hasAccess} plan={plan} initialPrompt={initialPrompt} firstName={displayName.split(/\s+/)[0] ?? ""} greeting={greeting} />;
}
