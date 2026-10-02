import { createClient } from "@/lib/supabase/server";
import { filtroTransacoesDoUsuario } from "@/lib/supabase/transacoes-visiveis";
import { anoAtualEmSaoPaulo } from "@/lib/date";
import { fetchAllRows } from "@/lib/supabase/pagination";
import type { Caixinha, Conta, Transacao } from "@/lib/types";
import ObjetivosManager, { type ObjetivoComPrevisao } from "./objetivos-manager";

function movimentoDoObjetivo(transacao: Transacao, objetivo: Caixinha): boolean {
  if (transacao.descricao.includes(`[Objetivo:${objetivo.id}:`)) return true;
  if (/\[Objetivo:\d+:(?:guardar|resgatar)\]/.test(transacao.descricao)) return false;
  return transacao.descricao.includes(`Guardar em: ${objetivo.nome}`)
    || transacao.descricao.includes(`Resgate de: ${objetivo.nome}`);
}

function ehResgate(descricao: string): boolean {
  return descricao.includes(":resgatar]") || descricao.includes("Resgate de:");
}

export default async function ObjetivosPage() {
  const supabase = await createClient();
  // Filtro explícito das transações visíveis: o banco usa os índices em vez
  // de ler a tabela inteira (ver lib/transacoes-visiveis.ts).
  const filtroVisiveis = filtroTransacoesDoUsuario(supabase);
  // Se a página sair antes de usar o filtro (sessão inválida), a falha dele
  // não vira erro solto no servidor; quem usa o filtro continua recebendo o erro.
  filtroVisiveis.catch(() => undefined);
  const { data: { user }, error: userErro } = await supabase.auth.getUser();
  if (userErro || !user) throw new Error("Sua sessão expirou. Entre novamente.");
  const [
    { data: objetivosData, error: objetivosErro },
    { data: contasData, error: contasErro },
    { data: transacoesData, error: transacoesErro },
    partnershipResult,
  ] = await Promise.all([
    supabase.from("caixinhas")
      .select("id, user_id, nome, meta_valor, saldo_atual, cor, icone, compartilhado, data_prazo, arquivado, version")
      .order("arquivado").order("id"),
    supabase.from("contas")
      .select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado, version")
      .eq("arquivado", false).order("nome"),
    filtroVisiveis.then((filtro) => fetchAllRows((from, to) => supabase.from("transacoes")
      .select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status, version, transacao_pai_id")
      .or(filtro)
      .order("id")
      .range(from, to))),
    supabase.from("parcerias")
      .select("id, solicitante_id, convidado_id")
      .eq("status", "aceito")
      .limit(1)
      .maybeSingle(),
  ]);

  if (objetivosErro || contasErro || transacoesErro) {
    throw new Error("Não foi possível carregar seus objetivos agora.");
  }

  const objetivos = (objetivosData ?? []) as Caixinha[];
  const contas = (contasData ?? []) as Conta[];
  const transacoes = (transacoesData ?? []) as Transacao[];
  const partnership = partnershipResult.error ? null : partnershipResult.data;
  const partnerId = partnership
    ? partnership.solicitante_id === user.id
      ? partnership.convidado_id
      : partnership.solicitante_id
    : null;
  const partnerNameResult = partnerId
    ? await supabase.rpc("get_user_name", { user_id: partnerId })
    : null;
  const partnerName = typeof partnerNameResult?.data === "string"
    ? partnerNameResult.data
    : partnerId ? "seu parceiro" : null;
  const fimDoAno = `${anoAtualEmSaoPaulo()}-12-31`;

  const completos: ObjetivoComPrevisao[] = objetivos.map((objetivo) => {
    const movimentos = transacoes.filter((item) => movimentoDoObjetivo(item, objetivo));
    const pendentes = movimentos.filter((item) => item.status === "pendente");
    const projetarAte = (limite: string) => Number(objetivo.saldo_atual) + pendentes
      .filter((item) => item.data_vencimento <= limite)
      .reduce((total, item) => total + (ehResgate(item.descricao) ? -Number(item.valor) : Number(item.valor)), 0);
    return {
      ...objetivo,
      previstoMeta: objetivo.data_prazo ? Math.max(0, projetarAte(objetivo.data_prazo)) : null,
      previstoFimAno: Math.max(0, projetarAte(fimDoAno)),
      movimentos: movimentos.filter((item) => item.status === "paga").map((item) => ({
        id: item.id,
        descricao: item.descricao
          .replace(/^\[Transf\.\]\s*/, "")
          .replace(/\s*\[(?:Serie:[^\]]+|Objetivo:[^\]]+)\]/g, "")
          .trim(),
        valor: Number(item.valor),
        operacao: ehResgate(item.descricao) ? "resgatar" as const : "guardar" as const,
        data: item.data_realizacao || item.data_vencimento,
        status: item.status,
      })),
    };
  });

  return <ObjetivosManager objetivos={completos} contas={contas} userId={user.id} partnerName={partnerName} />;
}
