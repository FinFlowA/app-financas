import { redirect } from "next/navigation";
import { hojeEmSaoPaulo } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import type { Caixinha, Categoria, Conta, Transacao } from "@/lib/types";
import CalendarManager from "./calendar-manager";

export default async function CalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [accountsResult, goalsResult, categoriesResult, transactionsResult] = await Promise.all([
    supabase.from("contas").select("id,user_id,nome,cor,saldo_inicial,arquivado,compartilhado,version").order("nome"),
    supabase.from("caixinhas").select("id,user_id,nome,meta_valor,saldo_atual,cor,icone,compartilhado,data_prazo,arquivado,version").order("nome"),
    supabase.from("categorias").select("id,user_id,nome,cor,icone,tipo,ativa,bloqueado_plano,version").order("nome"),
    fetchAllRows((from, to) => supabase.from("transacoes")
      .select("id,user_id,conta_id,categoria_id,tipo,valor,descricao,data_vencimento,data_realizacao,status,transacao_pai_id,version")
      .is("transacao_pai_id", null).order("data_vencimento").range(from, to)),
  ]);
  if (accountsResult.error || goalsResult.error || categoriesResult.error || transactionsResult.error) throw new Error("Não foi possível carregar o calendário agora.");
  return <CalendarManager today={hojeEmSaoPaulo()} accounts={(accountsResult.data ?? []) as Conta[]} goals={(goalsResult.data ?? []) as Caixinha[]} categories={(categoriesResult.data ?? []) as Categoria[]} transactions={(transactionsResult.data ?? []) as Transacao[]} />;
}
