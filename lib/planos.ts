/**
 * lib/planos.ts
 * Sistema centralizado de planos do FinFlow.
 *
 * Planos disponíveis: Free | Smart | Premium
 * Este arquivo é a fonte única da verdade para todos os limites,
 * preços e permissões de IA do app.
 *
 * Para adicionar um novo plano ou alterar um limite:
 * - edite apenas este arquivo
 * - todas as telas e hooks leem daqui automaticamente
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type TipoPlano = "free" | "smart" | "premium";

export interface LimitesPlano {
  /** Número máximo de contas. -1 = ilimitado */
  contas: number;
  /** Lançamentos por mês. -1 = ilimitado */
  lancamentosMes: number;
  /** Cartões de crédito. -1 = ilimitado */
  cartoes: number;
  /** Caixinhas/objetivos. -1 = ilimitado */
  caixinhas: number;
  /** Categorias de receita. -1 = ilimitado */
  categoriasReceita: number;
  /** Categorias de despesa. -1 = ilimitado */
  categoriasDespesa: number;
  /** Permite IA operacional (criar/editar itens via chat) */
  iaOperacional: boolean;
  /** Permite IA analítica (análises, projeções, sugestões) */
  iaAnalitica: boolean;
  /** Ações de IA por dia. 0 = sem IA. -1 = ilimitado */
  iaAcoesDia: number;
  /** Consultas ao modelo por dia, separadas das ações confirmadas. */
  iaConsultasDia: number;
}

export interface InfoPlano {
  id: TipoPlano;
  nome: string;
  descricao: string;
  badge?: string;
  precoMensal: number;
  precoAnual: number;
  limites: LimitesPlano;
  destaque: string[];
}

// ─── Limites por plano ────────────────────────────────────────────────────────

export const LIMITES_PLANOS: Record<TipoPlano, LimitesPlano> = {
  free: {
    contas: 2,
    lancamentosMes: 40,
    cartoes: 1,
    caixinhas: 1,
    categoriasReceita: 7,
    categoriasDespesa: 7,
    iaOperacional: false,
    iaAnalitica: false,
    iaAcoesDia: 0,
    iaConsultasDia: 0,
  },
  smart: {
    contas: 5,
    lancamentosMes: 300,
    cartoes: 3,
    caixinhas: 5,
    categoriasReceita: 14,
    categoriasDespesa: 14,
    iaOperacional: true,
    iaAnalitica: false,
    iaAcoesDia: 15,
    iaConsultasDia: 60,
  },
  premium: {
    contas: -1,
    lancamentosMes: -1,
    cartoes: -1,
    caixinhas: -1,
    categoriasReceita: -1,
    categoriasDespesa: -1,
    iaOperacional: true,
    iaAnalitica: true,
    iaAcoesDia: 50,
    iaConsultasDia: 200,
  },
};

/** Acesso temporariamente irrestrito durante o desenvolvimento, sem conceder plano pago. */
export const LIMITES_DESENVOLVIMENTO: LimitesPlano = {
  contas: -1,
  lancamentosMes: -1,
  cartoes: -1,
  caixinhas: -1,
  categoriasReceita: -1,
  categoriasDespesa: -1,
  iaOperacional: true,
  iaAnalitica: true,
  iaAcoesDia: -1,
  iaConsultasDia: 300,
};

// ─── Informações completas dos planos ────────────────────────────────────────

export const PLANOS: InfoPlano[] = [
  {
    id: "free",
    nome: "Free",
    descricao: "Para quem está começando",
    precoMensal: 0,
    precoAnual: 0,
    limites: LIMITES_PLANOS.free,
    destaque: [
      "2 contas",
      "40 lançamentos/mês",
      "1 cartão de crédito",
      "1 caixinha",
      "7 categorias por tipo",
      "Sem IA",
    ],
  },
  {
    id: "smart",
    nome: "Smart",
    descricao: "Para quem quer mais controle",
    badge: "Mais Popular",
    precoMensal: 9.9,
    precoAnual: 79.9,
    limites: LIMITES_PLANOS.smart,
    destaque: [
      "5 contas",
      "300 lançamentos/mês",
      "3 cartões de crédito",
      "5 caixinhas",
      "14 categorias por tipo",
      "IA: 15 ações e até 60 consultas/dia",
    ],
  },
  {
    id: "premium",
    nome: "Premium",
    descricao: "Controle financeiro completo",
    badge: "Premium",
    precoMensal: 19.9,
    precoAnual: 149.9,
    limites: LIMITES_PLANOS.premium,
    destaque: [
      "Contas e lançamentos ilimitados",
      "IA operacional completa",
      "IA analítica e de insights",
      "IA: 50 ações e até 200 consultas/dia",
      "Projeções financeiras",
      "Análise de padrões de gastos",
    ],
  },
];

// ─── Preços formatados ────────────────────────────────────────────────────────

export const PRECOS = {
  smart: {
    mensal: 9.9,
    anual: 79.9,
    anualPorMes: +(79.9 / 12).toFixed(2),
    economiaAnual: +(9.9 * 12 - 79.9).toFixed(2), // ~R$ 38,90
    mesesGratis: 2,
  },
  premium: {
    mensal: 19.9,
    anual: 149.9,
    anualPorMes: +(149.9 / 12).toFixed(2),
    economiaAnual: +(19.9 * 12 - 149.9).toFixed(2), // ~R$ 88,90
    mesesGratis: 2,
  },
};

// ─── Helpers de verificação ───────────────────────────────────────────────────

/** Verifica se um valor está dentro do limite do plano (true = pode, false = atingiu) */
export function dentroDoLimite(limite: number, qtdAtual: number): boolean {
  if (limite === -1) return true; // ilimitado
  return qtdAtual < limite;
}

/** Retorna o nome do plano seguinte que libera o recurso */
export function proxPlanoParaRecurso(recurso: keyof LimitesPlano): TipoPlano {
  if (LIMITES_PLANOS.smart[recurso] !== 0 && LIMITES_PLANOS.smart[recurso] !== false) {
    return "smart";
  }
  return "premium";
}

/** Retorna mensagem humanizada do limite atingido */
export function msgLimiteAtingido(tipo: keyof LimitesPlano, plano: TipoPlano): string {
  const mapa: Record<string, string> = {
    contas: "contas",
    lancamentosMes: "lançamentos neste mês",
    cartoes: "cartões de crédito",
    caixinhas: "caixinhas",
    categoriasReceita: "categorias de receita",
    categoriasDespesa: "categorias de despesa",
    iaOperacional: "uso da IA operacional",
    iaAnalitica: "uso da IA analítica",
    iaAcoesDia: "ações de IA por dia",
    iaConsultasDia: "consultas à IA por dia",
  };
  const nomeTipo = mapa[tipo] ?? tipo;
  const limite = Reflect.get(LIMITES_PLANOS[plano], tipo);
  const descricaoLimite = typeof limite === "number" && limite > 0
    ? `O plano ${nomePlano(plano)} permite até ${limite} ${nomeTipo}, e você já chegou a esse limite.`
    : `Você atingiu o limite de ${nomeTipo} do plano ${nomePlano(plano)}.`;

  if (plano === "free") {
    return `${descricaoLimite}\n\nMelhore seu plano para continuar.`;
  }
  if (plano === "smart") {
    if (tipo === "iaAcoesDia" || tipo === "iaConsultasDia") {
      return `${descricaoLimite}\n\nNo Premium sua franquia diária é maior.`;
    }
    return `${descricaoLimite}\n\nNo Premium esse recurso é ilimitado.`;
  }
  return descricaoLimite;
}

type ErroServidor = { message?: string | null; code?: string | null } | string | null | undefined;

/**
 * Traduz as recusas de limite de plano feitas pelo servidor (triggers de
 * `contas`, `transacoes` etc.) para uma mensagem em linguagem natural. Retorna
 * null quando o erro não é de limite de plano.
 */
export function mensagemErroLimitePlano(
  erro: ErroServidor,
  tipo: keyof LimitesPlano,
  plano: TipoPlano,
): string | null {
  const texto = typeof erro === "string" ? erro : `${erro?.message ?? ""} ${erro?.code ?? ""}`;
  if (/shared account exceeds partner plan limit/i.test(texto)) {
    return "Não foi possível criar esta conta conjunta porque seu parceiro(a) já chegou ao limite de contas do plano dele(a).\n\n"
      + "Contas conjuntas contam no limite de vocês dois. Crie como conta individual ou melhore o plano para liberar mais contas.";
  }
  // Os erros de domínio do servidor usam prefixos OFFLINE_/AI_; um P0001 sem
  // prefixo é a recusa do trigger de limite de plano ("plan limit reached").
  if (/plan limit reached/i.test(texto) || /^\s*P0001\s*$/.test(texto)) {
    return msgLimiteAtingido(tipo, plano);
  }
  return null;
}

/** Retorna o nome do plano formatado */
export function nomePlano(plano: TipoPlano): string {
  return { free: "Free", smart: "Smart", premium: "Premium" }[plano];
}

/** Formata preço em BRL */
export function fmtPreco(valor: number): string {
  if (valor === 0) return "Grátis";
  return `R$ ${valor.toFixed(2).replace(".", ",")}`;
}
