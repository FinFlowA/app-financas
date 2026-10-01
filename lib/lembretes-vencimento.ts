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
export const LIMITE_LEMBRETES_VENCIMENTO = 24;

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
    const manha = new Date(grupo.dia);
    manha.setHours(8, 0, 0, 0);
    lembretes.push({
      quando: manha,
      titulo: "📅 FinFlow — Vencimento Hoje",
      corpo: `Você tem ${descricao} vencendo hoje. Não esqueça!`,
    });
    if (grupo.dia <= ultimoDiaNoturno) {
      const noite = new Date(grupo.dia);
      noite.setHours(19, 0, 0, 0);
      lembretes.push({
        quando: noite,
        titulo: "⏰ FinFlow — Lembrete de Hoje",
        corpo: `Ainda constam ${descricao} vencendo hoje. Se já pagou, marque como paga no FinFlow.`,
      });
    }
  }
  return lembretes
    .filter((lembrete) => lembrete.quando.getTime() > agora.getTime())
    .sort((a, b) => a.quando.getTime() - b.quando.getTime())
    .slice(0, Math.max(0, limite));
}
