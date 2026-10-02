/**
 * Lembretes de vencimento agendados com antecedência.
 *
 * Notificações locais só existem se o app as agendar. Antes, só o dia corrente
 * era agendado, então o aviso de uma conta de amanhã dependia de o usuário
 * abrir o app amanhã. Agora cada abertura agenda os próximos dias de uma vez.
 * Puro (sem módulos nativos) para rodar nos testes em Node.
 */

type TransacaoAgendavel = { status: string; data_vencimento: string; tipo: string };

export type VencimentosDoDia = { dia: Date; despesas: number; receitas: number };

export type LembreteVencimento = {
  quando: Date;
  titulo: string;
  corpo: string;
};

/** Até quantos dias à frente os vencimentos viram lembrete. */
export const DIAS_LEMBRETE_VENCIMENTO = 30;
/** Nos primeiros dias também há o lembrete da noite (19h). */
export const DIAS_COM_LEMBRETE_NOTURNO = 7;
/**
 * Teto de lembretes de vencimento por agenda. O iOS guarda no máximo 64
 * notificações pendentes por app, divididas com objetivos e cartões.
 */
export const LIMITE_LEMBRETES_VENCIMENTO = 20;
/** Teto dos avisos de atraso (o primeiro e os "venceu ontem" seguintes). */
export const LIMITE_LEMBRETES_ATRASO = 8;

function dataLocal(iso: string): Date | null {
  const partes = iso.split("-");
  if (partes.length < 3) return null;
  const data = new Date(Number(partes[0]), Number(partes[1]) - 1, Number.parseInt(partes[2], 10));
  return Number.isNaN(data.getTime()) ? null : data;
}

/** Contas pendentes de despesa/receita por dia, de hoje até `dias` à frente. */
export function agruparVencimentosPorDia(
  transacoes: TransacaoAgendavel[],
  agora: Date,
  dias = DIAS_LEMBRETE_VENCIMENTO,
): VencimentosDoDia[] {
  const inicio = new Date(agora);
  inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + dias);
  const porDia = new Map<number, VencimentosDoDia>();
  for (const transacao of transacoes) {
    if (transacao.status !== "pendente") continue;
    if (transacao.tipo !== "despesa" && transacao.tipo !== "receita") continue;
    const dia = dataLocal(transacao.data_vencimento || "");
    if (!dia || dia < inicio || dia > fim) continue;
    const grupo = porDia.get(dia.getTime()) ?? { dia, despesas: 0, receitas: 0 };
    if (transacao.tipo === "despesa") grupo.despesas += 1;
    else grupo.receitas += 1;
    porDia.set(dia.getTime(), grupo);
  }
  return [...porDia.values()].sort((a, b) => a.dia.getTime() - b.dia.getTime());
}

/** Despesa e receita são femininas: "resolvida(s)", "concluída(s)". */
function pedidoDeConclusao(total: number): string {
  return total > 1
    ? "Caso já tenham sido resolvidas, marque-as como concluídas no FinFlow."
    : "Caso já tenha sido resolvida, marque-a como concluída no FinFlow.";
}

export function descreverVencimentos({ despesas, receitas }: Pick<VencimentosDoDia, "despesas" | "receitas">): string {
  const partes: string[] = [];
  if (despesas > 0) partes.push(`${despesas} despesa${despesas > 1 ? "s" : ""}`);
  if (receitas > 0) partes.push(`${receitas} receita${receitas > 1 ? "s" : ""}`);
  return partes.join(" e ");
}

/**
 * Lembretes das 8h (e 19h nos primeiros dias) de cada dia com contas, em
 * ordem cronológica, só os que ainda vão acontecer e até o teto.
 */
export function montarLembretesVencimento(
  transacoes: TransacaoAgendavel[],
  agora: Date,
  limite = LIMITE_LEMBRETES_VENCIMENTO,
): LembreteVencimento[] {
  const hoje = new Date(agora);
  hoje.setHours(0, 0, 0, 0);
  const ultimoDiaNoturno = new Date(hoje);
  ultimoDiaNoturno.setDate(ultimoDiaNoturno.getDate() + DIAS_COM_LEMBRETE_NOTURNO - 1);

  const lembretes: LembreteVencimento[] = [];
  for (const grupo of agruparVencimentosPorDia(transacoes, agora)) {
    const descricao = descreverVencimentos(grupo);
    if (!descricao) continue;
    const total = grupo.despesas + grupo.receitas;
    const manha = new Date(grupo.dia);
    manha.setHours(8, 0, 0, 0);
    lembretes.push({
      quando: manha,
      titulo: "Vencimentos de hoje",
      corpo: `Hoje ${total > 1 ? "vencem" : "vence"} ${descricao}. Confira os detalhes no FinFlow.`,
    });
    if (grupo.dia <= ultimoDiaNoturno) {
      const noite = new Date(grupo.dia);
      noite.setHours(19, 0, 0, 0);
      lembretes.push({
        quando: noite,
        titulo: "Lembrete de vencimentos",
        corpo: `Ainda há ${descricao} com vencimento hoje. ${pedidoDeConclusao(total)}`,
      });
    }
  }
  return lembretes
    .filter((lembrete) => lembrete.quando.getTime() > agora.getTime())
    .sort((a, b) => a.quando.getTime() - b.quando.getTime())
    .slice(0, Math.max(0, limite));
}

/** Próximo horário às `hora`:00 depois de `agora` (hoje, se ainda não passou). */
export function proximoHorario(agora: Date, hora: number): Date {
  const alvo = new Date(agora);
  alvo.setHours(hora, 0, 0, 0);
  if (alvo.getTime() <= agora.getTime()) alvo.setDate(alvo.getDate() + 1);
  return alvo;
}

/**
 * Avisos de atraso, sempre agendados (nunca disparados ao abrir o app):
 * - na próxima manhã (9h), os lançamentos que já estarão vencidos;
 * - para cada dia com contas nos próximos 30 dias, às 9h do dia seguinte, os
 *   que venceram naquele dia ("venceu ontem").
 * Pagar pelo app refaz a agenda e o aviso sai junto.
 */
export function montarLembretesAtraso(
  transacoes: TransacaoAgendavel[],
  agora: Date,
  limite = LIMITE_LEMBRETES_ATRASO,
): LembreteVencimento[] {
  const primeiro = proximoHorario(agora, 9);
  const diaDoPrimeiro = new Date(primeiro);
  diaDoPrimeiro.setHours(0, 0, 0, 0);

  const vencidos = { despesas: 0, receitas: 0 };
  for (const transacao of transacoes) {
    if (transacao.status !== "pendente") continue;
    if (transacao.tipo !== "despesa" && transacao.tipo !== "receita") continue;
    const dia = dataLocal(transacao.data_vencimento || "");
    if (!dia || dia >= diaDoPrimeiro) continue;
    if (transacao.tipo === "despesa") vencidos.despesas += 1;
    else vencidos.receitas += 1;
  }

  const lembretes: LembreteVencimento[] = [];
  const totalVencidos = vencidos.despesas + vencidos.receitas;
  if (totalVencidos > 0) {
    lembretes.push({
      quando: primeiro,
      titulo: "Lançamentos em atraso",
      corpo: totalVencidos > 1
        ? `Você tem ${descreverVencimentos(vencidos)} vencidas que ainda não foram concluídas. Confira no FinFlow.`
        : `Você tem ${descreverVencimentos(vencidos)} vencida que ainda não foi concluída. Confira no FinFlow.`,
    });
  }
  for (const grupo of agruparVencimentosPorDia(transacoes, agora)) {
    if (grupo.dia < diaDoPrimeiro) continue; // já entra no primeiro aviso
    const total = grupo.despesas + grupo.receitas;
    if (total === 0) continue;
    const quando = new Date(grupo.dia);
    quando.setDate(quando.getDate() + 1);
    quando.setHours(9, 0, 0, 0);
    lembretes.push({
      quando,
      titulo: "Vencimentos de ontem",
      corpo: total > 1
        ? `Ontem venceram ${descreverVencimentos(grupo)}, que ainda estão pendentes. ${pedidoDeConclusao(total)}`
        : `Ontem venceu ${descreverVencimentos(grupo)}, que ainda está pendente. ${pedidoDeConclusao(total)}`,
    });
  }
  return lembretes
    .filter((lembrete) => lembrete.quando.getTime() > agora.getTime())
    .sort((a, b) => a.quando.getTime() - b.quando.getTime())
    .slice(0, Math.max(0, limite));
}

/** "2026-11-30" → "30/11/2026". */
export function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/**
 * Lembrete de prazo do objetivo sem valores em reais: quanto falta, em
 * porcentagem da meta, e a data do prazo.
 */
export function mensagemPrazoObjetivo(
  objetivo: { nome: string; meta_valor: number; saldo_atual: number; data_prazo: string },
  diasParaOPrazo: number,
): { titulo: string; corpo: string } {
  const meta = Number(objetivo.meta_valor);
  const falta = Math.max(0, meta - Number(objetivo.saldo_atual));
  // Arredonda para cima: com qualquer valor faltando, nunca mostra "faltam 0%".
  const porcentagem = meta > 0 ? Math.min(100, Math.max(1, Math.ceil((falta / meta) * 100))) : 100;
  return {
    titulo: diasParaOPrazo === 0
      ? "O prazo do seu objetivo termina hoje"
      : diasParaOPrazo === 1
        ? "O prazo do seu objetivo termina amanhã"
        : `O prazo do seu objetivo termina em ${diasParaOPrazo} dias`,
    corpo: `Ainda ${porcentagem === 1 ? "falta" : "faltam"} ${porcentagem}% da meta de "${objetivo.nome}", com prazo até ${formatarDataBr(objetivo.data_prazo)}.`,
  };
}

/**
 * Aviso de limite do cartão sem valores em reais: quanto já foi usado e
 * quanto ainda resta, em porcentagem do limite.
 */
export function mensagemLimiteCartao(
  cartao: { nome: string; limite: number; limite_usado: number },
): { titulo: string; corpo: string } {
  const limite = Number(cartao.limite);
  const usado = Math.max(0, Number(cartao.limite_usado));
  const pct = limite > 0 ? Math.round((usado / limite) * 100) : 100;
  // O que resta é arredondado para baixo, para nunca prometer limite que não existe.
  const resta = limite > 0 ? Math.max(0, Math.floor(((limite - usado) / limite) * 100)) : 0;
  return {
    titulo: `Cartão ${cartao.nome} com ${pct}% do limite usado`,
    corpo: resta > 0
      ? `Ainda ${resta === 1 ? "resta" : "restam"} ${resta}% do limite disponível.`
      : "Não há mais limite disponível neste cartão.",
  };
}

/**
 * Limite usado do cartão, como a tela de Cartões calcula: compras não pagas da
 * fatura atual em diante; compras fixas só contam na fatura atual.
 */
export function limiteUsadoDoCartao(
  itens: { cartao_id: number; mes_fatura: string; pago: boolean; descricao: string; valor: number | string }[],
  cartaoId: number,
  mesAtual: string,
): number {
  return itens
    .filter((item) => item.cartao_id === cartaoId
      && item.mes_fatura >= mesAtual
      && !item.pago
      && (!item.descricao.endsWith("(Fixa)") || item.mes_fatura === mesAtual))
    .reduce((total, item) => total + Number(item.valor), 0);
}
