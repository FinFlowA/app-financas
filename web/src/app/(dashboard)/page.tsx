import { redirect } from "next/navigation";
import { mesAtualEmSaoPaulo, hojeEmSaoPaulo } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import type { Categoria, Conta, FaturaItem, Transacao } from "@/lib/types";
import HomeDashboard from "./home-dashboard";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const parameters = await searchParams;
  const month = parameters.month && MONTH_PATTERN.test(parameters.month) ? parameters.month : mesAtualEmSaoPaulo();
  const supabase = await createClient();
  const [{ data: authData }, accountsResult, transactionsResult, categoriesResult, invoiceItemsResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("contas").select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado, version").order("id"),
    fetchAllRows((from, to) => supabase
      .from("transacoes")
      .select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status, transacao_pai_id, version")
      .order("id")
      .range(from, to)),
    supabase.from("categorias").select("id, user_id, nome, cor, icone, tipo, ativa, bloqueado_plano, version"),
    fetchAllRows((from, to) => supabase
      .from("fatura_itens")
      .select("id, cartao_id, user_id, descricao, valor, data_compra, mes_fatura, parcela_atual, total_parcelas, categoria_id, pago, grupo_parcela_id")
      .eq("mes_fatura", month)
      .order("id")
      .range(from, to)),
  ]);
  if (!authData.user) redirect("/login");
  if (accountsResult.error || transactionsResult.error || categoriesResult.error || invoiceItemsResult.error) throw new Error("Não foi possível carregar seu painel agora.");
  const metadata = authData.user.user_metadata as Record<string, unknown>;
  const displayName = typeof metadata.nome_usuario === "string" && metadata.nome_usuario.trim()
    ? metadata.nome_usuario.trim()
    : typeof metadata.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name.trim()
      : authData.user.email?.split("@")[0] ?? "Usuário";
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return <HomeDashboard userId={authData.user.id} displayName={displayName} greeting={greeting} month={month} today={hojeEmSaoPaulo()} accounts={(accountsResult.data ?? []) as Conta[]} transactions={(transactionsResult.data ?? []) as Transacao[]} categories={(categoriesResult.data ?? []) as Categoria[]} invoiceItems={(invoiceItemsResult.data ?? []) as FaturaItem[]} />;
}
