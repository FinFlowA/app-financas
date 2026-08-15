import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { mesAtualEmSaoPaulo } from "@/lib/date";
import { invoicePresentationStatus } from "@/lib/invoice-status";
import type { Cartao, FaturaItem } from "@/lib/types";
import { adicionarMeses } from "./card-utils";
import CartoesManager, { type CartaoResumo } from "./cartoes-manager";

export default async function CartoesPage() {
  const supabase = await createClient();
  const mesAtual = mesAtualEmSaoPaulo();
  const proximoMes = adicionarMeses(mesAtual, 1);

  const [
    { data: cartoesData, error: cartoesErro },
    { data: itensData, error: itensErro },
  ] = await Promise.all([
    supabase
      .from("cartoes")
      .select("id, user_id, nome, cor, limite, dia_vencimento, dia_fechamento, ativo, version")
      .order("ativo", { ascending: false })
      .order("id"),
    fetchAllRows((from, to) => supabase
      .from("fatura_itens")
      .select("id, cartao_id, user_id, descricao, valor, data_compra, mes_fatura, parcela_atual, total_parcelas, categoria_id, pago, grupo_parcela_id")
      .order("id")
      .range(from, to)),
  ]);

  if (cartoesErro || itensErro) {
    throw new Error("Não foi possível carregar seus cartões agora.");
  }

  const cartoes = (cartoesData ?? []) as Cartao[];
  const itens = (itensData ?? []) as FaturaItem[];
  const resumos: CartaoResumo[] = cartoes.map((cartao) => {
    const itensDaFaturaAtual = itens.filter((item) => item.cartao_id === cartao.id && item.mes_fatura === mesAtual);
    const itensDoCartao = itens.filter((item) => item.cartao_id === cartao.id && !item.pago);
    const limiteUsado = Math.max(0, itensDoCartao
      .filter((item) => item.mes_fatura >= mesAtual)
      .filter((item) => !item.descricao.endsWith("(Fixa)") || item.mes_fatura === mesAtual)
      .reduce((total, item) => total + Number(item.valor), 0));
    const totalDoMes = (mes: string) => Math.max(0, itensDoCartao
      .filter((item) => item.mes_fatura === mes)
      .reduce((total, item) => total + Number(item.valor), 0));

    return {
      ...cartao,
      limiteUsado,
      faturaAtual: totalDoMes(mesAtual),
      faturaAtualPaga: invoicePresentationStatus({
        invoiceMonth: mesAtual,
        closingDay: cartao.dia_fechamento,
        itemCount: itensDaFaturaAtual.length,
        openTotal: totalDoMes(mesAtual),
        allItemsPaid: itensDaFaturaAtual.length > 0 && itensDaFaturaAtual.every((item) => item.pago),
      }) === "paid",
      proximaFatura: totalDoMes(proximoMes),
    };
  });

  return <CartoesManager cartoes={resumos} />;
}
