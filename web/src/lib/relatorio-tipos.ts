// Tipos do relatório da aba Relatórios do site (PDF e Excel).
import type { Caixinha, Cartao, Categoria, Conta, FaturaItem, Transacao } from "./types";

/** Seções na ordem em que aparecem nos arquivos. */
export const SECOES_RELATORIO = [
  { id: "resumo", titulo: "Resumo financeiro", grupo: "analise" },
  { id: "evolucao", titulo: "Evolução mensal", grupo: "analise" },
  { id: "projecao", titulo: "Projeção do saldo", grupo: "analise" },
  { id: "contas", titulo: "Contas", grupo: "analise" },
  { id: "categorias", titulo: "Categorias", grupo: "analise" },
  { id: "maiores", titulo: "Maiores despesas e receitas", grupo: "analise" },
  { id: "cartoes", titulo: "Cartões", grupo: "analise" },
  { id: "comparacao", titulo: "Comparação com o período anterior", grupo: "analise" },
  { id: "receitas", titulo: "Receitas", grupo: "detalhe" },
  { id: "despesas", titulo: "Despesas", grupo: "detalhe" },
  { id: "transferencias", titulo: "Transferências", grupo: "detalhe" },
  { id: "faturas", titulo: "Faturas", grupo: "detalhe" },
  { id: "compras_cartao", titulo: "Compras no cartão", grupo: "detalhe" },
  { id: "pendencias", titulo: "Pendências", grupo: "detalhe" },
  { id: "objetivos", titulo: "Objetivos", grupo: "detalhe" },
] as const;

export type SecaoRelatorio = (typeof SECOES_RELATORIO)[number]["id"];
export type TipoColuna = "texto" | "data" | "moeda" | "numero" | "percentual";
export type ColunaRelatorio = { titulo: string; tipo: TipoColuna };
/** Data como "AAAA-MM-DD"; moeda, número e percentual como número (percentual: 0,75 = 75%). */
export type CelulaRelatorio = string | number | null;

export type TabelaRelatorio = {
  secao: SecaoRelatorio;
  titulo: string;
  colunas: ColunaRelatorio[];
  linhas: CelulaRelatorio[][];
  /** Linha final em negrito (totais). */
  total?: CelulaRelatorio[];
  /** Valores em reais abaixo de zero aparecem em vermelho. */
  negativosEmVermelho?: boolean;
};

export type TomIndicador = "positivo" | "negativo" | "neutro";
export type IndicadorRelatorio = {
  rotulo: string;
  /** Moeda ou percentual (0,2 = 20%); null quando não se aplica. */
  valor: number | null;
  formato: "moeda" | "percentual" | "texto";
  texto?: string;
  detalhe?: string;
  tom?: TomIndicador;
};

export type GraficoRelatorio =
  | {
    tipo: "linha";
    id: string;
    titulo: string;
    rotulos: string[];
    valores: number[];
    /** A partir deste índice, os pontos são projetados (linha tracejada). */
    projetadoDesde?: number;
  }
  | {
    tipo: "barras";
    id: string;
    titulo: string;
    rotulos: string[];
    series: { nome: string; tom: "receita" | "despesa"; valores: number[] }[];
  }
  | {
    tipo: "barras_horizontais";
    id: string;
    titulo: string;
    rotulos: string[];
    valores: number[];
    percentuais: number[];
  };

export type BlocoRelatorio =
  | { tipo: "indicadores"; secao: SecaoRelatorio; titulo: string; itens: IndicadorRelatorio[] }
  | { tipo: "tabela"; secao: SecaoRelatorio; tabela: TabelaRelatorio }
  | { tipo: "grafico"; secao: SecaoRelatorio; grafico: GraficoRelatorio }
  | { tipo: "nota"; secao: SecaoRelatorio; texto: string };

export type DadosRelatorio = {
  contas: Pick<Conta, "id" | "nome" | "saldo_inicial" | "arquivado">[];
  categorias: Pick<Categoria, "id" | "nome" | "tipo" | "meta_mensal" | "limite_mensal">[];
  objetivos: Pick<Caixinha, "id" | "nome" | "meta_valor" | "saldo_atual" | "data_prazo" | "arquivado">[];
  cartoes: Cartao[];
  transacoes: Pick<Transacao, "id" | "conta_id" | "categoria_id" | "tipo" | "valor" | "descricao" | "data_vencimento" | "data_realizacao" | "status">[];
  itensFatura: FaturaItem[];
  /** Hoje em São Paulo, "AAAA-MM-DD". */
  hoje: string;
};

export type TipoFiltro = "todos" | "receita" | "despesa";
export type SituacaoFiltro = "concluido" | "a_vencer" | "atrasado";

export type OpcoesRelatorio = {
  inicio: string;
  fim: string;
  /** Contas escolhidas; vazio = todas as contas ativas. */
  contaIds: number[];
  secoes: SecaoRelatorio[];
  /** Filtros de receitas, despesas e listas (os saldos seguem só as contas). Vazio = todos. */
  categoriaIds?: number[];
  tipo?: TipoFiltro;
  situacoes?: SituacaoFiltro[];
  cartaoIds?: number[];
  /** Quantos itens no ranking de maiores despesas e receitas. Padrão: 10. */
  maiores?: number;
};
