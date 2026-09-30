/**
 * Tetos de segurança por usuário (auditoria de segurança, V08).
 *
 * O banco recusa criações acima do teto com a mensagem
 * `FINFLOW_TETO_SEGURANCA:<recurso>:<diario|total>:<teto>` (gatilho
 * private.aplicar_teto_antiabuso). Esses tetos valem em qualquer plano e ficam
 * muito acima do uso normal: servem para impedir abuso da API, não para vender
 * plano. Por isso a mensagem não oferece upgrade e sim o contato do suporte.
 * Não confundir com os limites de plano (`mensagemErroLimitePlano`).
 */

export const EMAIL_SUPORTE_TETO = "Finflowfinancas@gmail.com";

const PADRAO_TETO = /FINFLOW_TETO_SEGURANCA:([a-z_]+):(diario|total):(\d+)/i;

const NOMES_RECURSOS: Readonly<Record<string, string>> = {
  lancamentos: "lançamentos",
  compras_cartao: "compras no cartão",
  contas: "contas",
  objetivos: "objetivos",
  cartoes: "cartões",
  categorias: "categorias",
  convites_parceria: "convites de conta conjunta",
  feedbacks: "feedbacks",
  historico_finn: "mensagens no histórico do Finn",
};

type ErroComTexto = { message?: string | null; code?: string | null } | string | null | undefined;

export type TetoSeguranca = {
  recurso: string;
  periodo: "diario" | "total";
  teto: number;
};

/** Separador de milhar sem depender de Intl (o Hermes antigo não tem pt-BR). */
function formatarInteiro(valor: number): string {
  return String(valor).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Extrai o teto atingido de um erro do Supabase ou de um código da fila. */
export function lerTetoSeguranca(erro: ErroComTexto): TetoSeguranca | null {
  const texto = typeof erro === "string" ? erro : `${erro?.message ?? ""} ${erro?.code ?? ""}`;
  const encontrado = texto.match(PADRAO_TETO);
  if (!encontrado) return null;
  const teto = Number(encontrado[3]);
  if (!Number.isSafeInteger(teto) || teto <= 0) return null;
  return {
    recurso: encontrado[1].toLowerCase(),
    periodo: encontrado[2].toLowerCase() === "diario" ? "diario" : "total",
    teto,
  };
}

/**
 * Mensagem em linguagem natural para quem atingiu um teto de segurança, ou
 * null quando o erro é outro.
 */
export function mensagemTetoSeguranca(erro: ErroComTexto): string | null {
  const teto = lerTetoSeguranca(erro);
  if (!teto) return null;
  const recurso = NOMES_RECURSOS[teto.recurso] ?? "itens";
  const quantidade = formatarInteiro(teto.teto);
  if (teto.periodo === "diario") {
    return `Você atingiu o limite de segurança de ${quantidade} ${recurso} por dia.\n\n`
      + `Tente de novo amanhã. Se precisar de mais, fale com o suporte: ${EMAIL_SUPORTE_TETO}`;
  }
  return `Você atingiu o limite de segurança de ${quantidade} ${recurso}. Esse limite inclui os itens arquivados.\n\n`
    + `Exclua o que não usa mais ou fale com o suporte: ${EMAIL_SUPORTE_TETO}`;
}

/** Título usado nos alertas do teto de segurança. */
export const TITULO_TETO_SEGURANCA = "Limite de segurança";
