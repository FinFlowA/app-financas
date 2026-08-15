import { notFound } from "next/navigation";
import { mesAtualEmSaoPaulo } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import type { Cartao, Categoria, Conta, FaturaItem, Transacao } from "@/lib/types";
import { adicionarMeses } from "../card-utils";
import CartaoDetalheManager, { type PagamentoDaFatura } from "../cartao-detalhe-manager";

type CartaoDetalhePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fatura?: string | string[] }>;
};

// Entrada limitada pelo banco e expressão ancorada; não há texto livre sem limite.
// eslint-disable-next-line security/detect-unsafe-regex
const MARCADOR_PAGAMENTO = /\[PagFatura:(\d+):(\d{4}-\d{2}):(total|parcial|saldo_transferido)(?::\d+)?\]\s*$/;

function mesValido(value: string | undefined): value is string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "");
}

export default async function CartaoDetalhePage({ params, searchParams }: CartaoDetalhePageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const cartaoId = Number(id);
  if (!Number.isInteger(cartaoId) || cartaoId <= 0) notFound();

  const mesAtual = mesAtualEmSaoPaulo();
  const faturaInformada = Array.isArray(query.fatura) ? query.fatura[0] : query.fatura;
  const mesSelecionado = mesValido(faturaInformada) ? faturaInformada : mesAtual;
  const supabase = await createClient();

  const [
    { data: cartaoData, error: cartaoErro },
    { data: itensData, error: itensErro },
    { data: categoriasData, error: categoriasErro },
    { data: contasData, error: contasErro },
    { data: pagamentosData, error: pagamentosErro },
  ] = await Promise.all([
    supabase
      .from("cartoes")
      .select("id, user_id, nome, cor, limite, dia_vencimento, dia_fechamento, ativo, version")
      .eq("id", cartaoId)
      .maybeSingle(),
    fetchAllRows((from, to) => supabase
      .from("fatura_itens")
      .select("id, cartao_id, user_id, descricao, valor, data_compra, mes_fatura, parcela_atual, total_parcelas, categoria_id, pago, grupo_parcela_id")
      .eq("cartao_id", cartaoId)
      .order("data_compra", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)),
    supabase
      .from("categorias")
      .select("id, user_id, nome, cor, icone, tipo, ativa, version")
      .in("tipo", ["despesa", "ambos"])
      .order("ativa", { ascending: false })
      .order("nome"),
    supabase
      .from("contas")
      .select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado, version")
      .eq("arquivado", false)
      .order("nome"),
    fetchAllRows((from, to) => supabase
      .from("transacoes")
      .select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status, version, transacao_pai_id")
      .like("descricao", `%[PagFatura:${cartaoId}:%`)
      .order("data_realizacao", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)),
  ]);

  if (cartaoErro) throw new Error("Não foi possível carregar este cartão agora.");
  if (!cartaoData) notFound();
  if (itensErro || categoriasErro || contasErro || pagamentosErro) {
    throw new Error("Não foi possível carregar todos os dados desta fatura agora.");
  }

  const cartao = cartaoData as Cartao;
  const itens = (itensData ?? []) as FaturaItem[];
  const categorias = (categoriasData ?? []) as Categoria[];
  const contas = (contasData ?? []) as Conta[];
  const transacoes = (pagamentosData ?? []) as Transacao[];
  const contasPorId = new Map(contas.map((conta) => [conta.id, conta.nome]));
  const pagamentos: Array<PagamentoDaFatura & { mes: string }> = [];

  for (const transacao of transacoes) {
    const marcador = transacao.descricao.match(MARCADOR_PAGAMENTO);
    if (!marcador || Number(marcador[1]) !== cartaoId) continue;
    pagamentos.push({
      id: transacao.id,
      valor: Number(transacao.valor),
      data: transacao.data_realizacao || transacao.data_vencimento,
      conta: contasPorId.get(transacao.conta_id) ?? "Conta arquivada",
      modo: marcador[3] === "total"
        ? "Integral"
        : marcador[3] === "parcial"
          ? "Parcial"
          : "Saldo transferido",
      mes: marcador[2],
    });
  }

  const mesesDisponiveis = [...new Set([
    ...itens.map((item) => item.mes_fatura),
    ...pagamentos.map((pagamento) => pagamento.mes),
    mesAtual,
    adicionarMeses(mesAtual, 1),
    mesSelecionado,
  ])].sort((a, b) => b.localeCompare(a));

  return (
    <CartaoDetalheManager
      cartao={cartao}
      itens={itens}
      categorias={categorias}
      contas={contas}
      pagamentos={pagamentos
        .filter((pagamento) => pagamento.mes === mesSelecionado)
        .map((pagamento) => ({
          id: pagamento.id,
          valor: pagamento.valor,
          data: pagamento.data,
          conta: pagamento.conta,
          modo: pagamento.modo,
        }))}
      mesSelecionado={mesSelecionado}
      mesesDisponiveis={mesesDisponiveis}
    />
  );
}
