export interface Conta {
  id: number;
  user_id: string;
  nome: string;
  cor: string;
  saldo_inicial: number;
  arquivado: boolean;
  compartilhado: boolean;
  version: number;
}

export interface Categoria {
  id: number;
  user_id: string;
  nome: string;
  cor: string;
  icone: string;
  tipo: "receita" | "despesa" | "ambos";
  ativa: number | boolean;
  bloqueado_plano?: boolean;
  version: number;
}

export interface Caixinha {
  id: number;
  user_id: string;
  nome: string;
  meta_valor: number;
  saldo_atual: number;
  cor: string;
  icone: string;
  compartilhado: boolean;
  data_prazo: string | null;
  arquivado: boolean;
  version: number;
}

export interface Cartao {
  id: number;
  user_id: string;
  nome: string;
  cor: string;
  limite: number;
  dia_vencimento: number;
  dia_fechamento: number;
  ativo: boolean;
  version: number;
}

export interface FaturaItem {
  id: number;
  cartao_id: number;
  user_id: string;
  descricao: string;
  valor: number;
  data_compra: string;
  mes_fatura: string;
  parcela_atual: number;
  total_parcelas: number;
  categoria_id: number | null;
  pago: boolean;
  grupo_parcela_id: number | null;
}

export interface Transacao {
  id: number;
  user_id: string;
  conta_id: number;
  categoria_id: number | null;
  tipo: "receita" | "despesa";
  valor: number;
  descricao: string;
  data_vencimento: string;
  data_realizacao: string | null;
  status: "pendente" | "paga";
  version: number;
  transacao_pai_id: number | null;
}

export interface Parceria {
  id: number;
  solicitante_id: string | null;
  convidado_id: string | null;
  convidado_email: string;
  status: "pendente" | "aceito" | string | null;
}

export interface NotificacaoSistema {
  id: number;
  tipo: string;
  titulo: string;
  mensagem: string;
  referencia_id: number;
  dados: Record<string, unknown> | null;
  criada_em: string;
  lida_em: string | null;
}
