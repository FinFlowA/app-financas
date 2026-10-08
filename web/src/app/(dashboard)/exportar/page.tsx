import FeatureGate from "@/components/plans/feature-gate";
import { hojeEmSaoPaulo, mesAtualEmSaoPaulo } from "@/lib/date";
import { normalizePlan, planHasFeature } from "@/lib/plan-entitlements";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { filtroTransacoesDoUsuario } from "@/lib/supabase/transacoes-visiveis";
import type { DadosRelatorio } from "@/lib/relatorio";
import ReportBuilder from "./report-builder";

export default async function ExportarPage() {
  const supabase = await createClient();
  // O plano vem antes dos dados: sem o recurso, nada além disso é carregado.
  const entitlementResult = await supabase.rpc("get_my_entitlement");
  const entitlementRaw = Array.isArray(entitlementResult.data) ? entitlementResult.data[0] : entitlementResult.data;
  const entitlement = entitlementRaw && typeof entitlementRaw === "object" ? entitlementRaw as Record<string, unknown> : {};
  if (!planHasFeature(normalizePlan(entitlement.plan), "report_export", entitlement.limits_enabled === true)) {
    return <FeatureGate title="Relatórios" description="Gere relatórios em PDF e Excel com a análise do seu dinheiro (saldo, resultado, evolução mês a mês, projeção, categorias e cartões) e o detalhamento dos lançamentos com o plano Pro ou Plus." />;
  }

  // Filtro explícito das transações visíveis: o banco usa os índices em vez
  // de ler a tabela inteira (ver lib/transacoes-visiveis.ts).
  const filtro = await filtroTransacoesDoUsuario(supabase);
  const [accountsResult, categoriesResult, goalsResult, cardsResult, transactionsResult, invoiceItemsResult] = await Promise.all([
    supabase.from("contas").select("id, nome, saldo_inicial, arquivado").order("nome"),
    fetchAllRows((from, to) => supabase.from("categorias").select("id, nome, tipo, meta_mensal, limite_mensal").order("nome").range(from, to)),
    supabase.from("caixinhas").select("id, nome, meta_valor, saldo_atual, data_prazo, arquivado").order("nome"),
    supabase.from("cartoes").select("id, user_id, nome, cor, limite, dia_vencimento, dia_fechamento, ativo, version").order("nome"),
    fetchAllRows((from, to) => supabase
      .from("transacoes")
      .select("id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status")
      .or(filtro)
      .order("id")
      .range(from, to)),
    fetchAllRows((from, to) => supabase
      .from("fatura_itens")
      .select("id, cartao_id, user_id, descricao, valor, data_compra, mes_fatura, parcela_atual, total_parcelas, categoria_id, pago, grupo_parcela_id")
      .order("id")
      .range(from, to)),
  ]);
  if (accountsResult.error || categoriesResult.error || goalsResult.error || cardsResult.error || transactionsResult.error || invoiceItemsResult.error) {
    throw new Error("Não foi possível carregar os dados do relatório agora.");
  }

  const dados: DadosRelatorio = {
    contas: (accountsResult.data ?? []) as DadosRelatorio["contas"],
    categorias: (categoriesResult.data ?? []) as DadosRelatorio["categorias"],
    objetivos: (goalsResult.data ?? []) as DadosRelatorio["objetivos"],
    cartoes: (cardsResult.data ?? []) as DadosRelatorio["cartoes"],
    transacoes: (transactionsResult.data ?? []) as DadosRelatorio["transacoes"],
    itensFatura: (invoiceItemsResult.data ?? []) as DadosRelatorio["itensFatura"],
    hoje: hojeEmSaoPaulo(),
  };

  return <ReportBuilder dados={dados} mesAtual={mesAtualEmSaoPaulo()} />;
}
