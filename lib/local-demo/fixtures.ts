/**
 * Dados determinísticos usados exclusivamente pelo modo de demonstração local.
 *
 * Este módulo não lê variáveis de ambiente, não usa armazenamento persistente
 * e não faz chamadas de rede. Cada cliente recebe uma cópia independente.
 */

export type LocalDemoRow = Record<string, unknown>;
export type LocalDemoDatabase = Record<string, LocalDemoRow[]>;

export const LOCAL_DEMO_USER_ID = "10000000-0000-4000-8000-000000000001";
export const LOCAL_DEMO_PARTNER_ID = "20000000-0000-4000-8000-000000000002";
export const LOCAL_DEMO_EMAIL = "gabriel.demo@finflow.local";

export type LocalDemoUser = {
  id: string;
  aud: "authenticated";
  role: "authenticated";
  email: string;
  phone: string;
  email_confirmed_at: string;
  phone_confirmed_at: string;
  confirmed_at: string;
  last_sign_in_at: string;
  created_at: string;
  updated_at: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: Record<string, unknown>[];
};

export type LocalDemoSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: "bearer";
  user: LocalDemoUser;
};

const CREATED_AT = "2026-01-01T12:00:00.000Z";
const CONFIRMED_AT = "2026-01-01T12:05:00.000Z";

export function createLocalDemoUser(): LocalDemoUser {
  return {
    id: LOCAL_DEMO_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: LOCAL_DEMO_EMAIL,
    phone: "+5511999999999",
    email_confirmed_at: CONFIRMED_AT,
    phone_confirmed_at: CONFIRMED_AT,
    confirmed_at: CONFIRMED_AT,
    last_sign_in_at: "2026-08-02T11:30:00.000Z",
    created_at: CREATED_AT,
    updated_at: "2026-08-02T11:30:00.000Z",
    app_metadata: { provider: "email", providers: ["email", "phone"] },
    user_metadata: {
      nome_usuario: "Gabriel",
      full_name: "Gabriel Henrique",
      telefone: "+5511999999999",
      data_nascimento: "1998-05-14",
      termos_aceitos_em: "2026-08-02T10:00:00.000Z",
      termos_versao: "2026-08-08-offline-seguranca-ia",
      categorias_iniciais_criadas: true,
      tutorial_pendente: false,
      tutorial_concluido_em: "2026-08-02T10:10:00.000Z",
    },
    identities: [{
      identity_id: "30000000-0000-4000-8000-000000000003",
      id: LOCAL_DEMO_USER_ID,
      user_id: LOCAL_DEMO_USER_ID,
      identity_data: { email: LOCAL_DEMO_EMAIL, email_verified: true },
      provider: "email",
      created_at: CREATED_AT,
      updated_at: CONFIRMED_AT,
    }],
  };
}

export function createLocalDemoSession(user = createLocalDemoUser()): LocalDemoSession {
  return {
    // Tokens deliberadamente inválidos fora do mock. Não são segredos e não
    // podem autenticar em nenhum projeto Supabase.
    access_token: "finflow-local-demo-access-token",
    refresh_token: "finflow-local-demo-refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  };
}

function categories(): LocalDemoRow[] {
  return [
    { id: 1, user_id: LOCAL_DEMO_USER_ID, nome: "Alimentação", tipo: "despesa", cor: "#E76F51", icone: "restaurant", ativa: 1, bloqueado_plano: false },
    { id: 2, user_id: LOCAL_DEMO_USER_ID, nome: "Moradia", tipo: "despesa", cor: "#457B9D", icone: "home", ativa: 1, bloqueado_plano: false },
    { id: 3, user_id: LOCAL_DEMO_USER_ID, nome: "Transporte", tipo: "despesa", cor: "#F4A261", icone: "directions-car", ativa: 1, bloqueado_plano: false },
    { id: 4, user_id: LOCAL_DEMO_USER_ID, nome: "Lazer", tipo: "despesa", cor: "#8A05BE", icone: "sports-esports", ativa: 1, bloqueado_plano: false },
    { id: 5, user_id: LOCAL_DEMO_USER_ID, nome: "Saúde", tipo: "despesa", cor: "#E63946", icone: "health-and-safety", ativa: 1, bloqueado_plano: false },
    { id: 6, user_id: LOCAL_DEMO_USER_ID, nome: "Outros", tipo: "despesa", cor: "#6C7D77", icone: "more-horiz", ativa: 1, bloqueado_plano: false },
    { id: 7, user_id: LOCAL_DEMO_USER_ID, nome: "Salário", tipo: "receita", cor: "#2A9D8F", icone: "payments", ativa: 1, bloqueado_plano: false },
    { id: 8, user_id: LOCAL_DEMO_USER_ID, nome: "Freelance", tipo: "receita", cor: "#3A86FF", icone: "laptop", ativa: 1, bloqueado_plano: false },
    { id: 9, user_id: LOCAL_DEMO_USER_ID, nome: "Investimentos", tipo: "receita", cor: "#8AB17D", icone: "trending-up", ativa: 1, bloqueado_plano: false },
    { id: 10, user_id: LOCAL_DEMO_USER_ID, nome: "Outros", tipo: "receita", cor: "#6C7D77", icone: "more-horiz", ativa: 1, bloqueado_plano: false },
    { id: 11, user_id: LOCAL_DEMO_USER_ID, nome: "Compras", tipo: "despesa", cor: "#EC7000", icone: "shopping-bag", ativa: 1, bloqueado_plano: false },
  ];
}

function accounts(): LocalDemoRow[] {
  return [
    { id: 1, user_id: LOCAL_DEMO_USER_ID, nome: "Conta Principal", saldo_inicial: 3850, cor: "#2A9D8F", compartilhado: false, arquivado: false, bloqueado_plano: false, criado_em: CREATED_AT },
    { id: 2, user_id: LOCAL_DEMO_USER_ID, nome: "Carteira", saldo_inicial: 250, cor: "#3A86FF", compartilhado: false, arquivado: false, bloqueado_plano: false, criado_em: CREATED_AT },
    { id: 3, user_id: LOCAL_DEMO_USER_ID, nome: "Conta de viagem", saldo_inicial: 0, cor: "#8A05BE", compartilhado: false, arquivado: true, bloqueado_plano: false, criado_em: CREATED_AT },
  ];
}

function transactions(): LocalDemoRow[] {
  const base = { user_id: LOCAL_DEMO_USER_ID, criado_em: "2026-08-02T12:00:00.000Z" };
  return [
    { ...base, id: 1, conta_id: 1, categoria_id: 7, tipo: "receita", valor: 6200, descricao: "Salário", data_vencimento: "2026-08-01", data_realizacao: "2026-08-01", status: "paga" },
    { ...base, id: 2, conta_id: 1, categoria_id: 1, tipo: "despesa", valor: 245.8, descricao: "Supermercado", data_vencimento: "2026-08-01", data_realizacao: "2026-08-02", status: "paga" },
    { ...base, id: 3, conta_id: 1, categoria_id: 2, tipo: "despesa", valor: 1450, descricao: "Aluguel (Fixa) [Serie:demo-aluguel]", data_vencimento: "2026-08-05", data_realizacao: null, status: "pendente" },
    { ...base, id: 4, conta_id: 1, categoria_id: 4, tipo: "despesa", valor: 39.9, descricao: "Netflix (Fixa) [Serie:demo-netflix]", data_vencimento: "2026-08-10", data_realizacao: null, status: "pendente" },
    { ...base, id: 5, conta_id: 1, categoria_id: 5, tipo: "despesa", valor: 89.9, descricao: "Farmácia", data_vencimento: "2026-07-30", data_realizacao: null, status: "pendente" },
    { ...base, id: 6, conta_id: 2, categoria_id: 3, tipo: "despesa", valor: 32.5, descricao: "Transporte por aplicativo", data_vencimento: "2026-08-02", data_realizacao: "2026-08-02", status: "paga" },
    { ...base, id: 7, conta_id: 1, categoria_id: null, tipo: "despesa", valor: 300, descricao: "[Transf.] Reserva do mês [Destino:2]", data_vencimento: "2026-08-08", data_realizacao: null, status: "pendente" },
    { ...base, id: 8, conta_id: 1, categoria_id: null, tipo: "despesa", valor: 250, descricao: "[Transf.] Aporte mensal · Guardar em: Reserva de emergência [Objetivo:1:guardar]", data_vencimento: "2026-08-15", data_realizacao: null, status: "pendente" },
    { ...base, id: 9, conta_id: 1, categoria_id: 8, tipo: "receita", valor: 900, descricao: "Projeto freelance", data_vencimento: "2026-08-20", data_realizacao: null, status: "pendente" },
    { ...base, id: 10, conta_id: 1, categoria_id: 2, tipo: "despesa", valor: 1400, descricao: "Aluguel", data_vencimento: "2026-07-05", data_realizacao: "2026-07-05", status: "paga" },
    { ...base, id: 11, conta_id: 1, categoria_id: 7, tipo: "receita", valor: 6000, descricao: "Salário", data_vencimento: "2026-07-01", data_realizacao: "2026-07-01", status: "paga" },
    { ...base, id: 12, conta_id: 1, categoria_id: 2, tipo: "despesa", valor: 1380, descricao: "Aluguel", data_vencimento: "2026-06-05", data_realizacao: "2026-06-05", status: "paga" },
    { ...base, id: 13, conta_id: 1, categoria_id: 7, tipo: "receita", valor: 6000, descricao: "Salário", data_vencimento: "2026-06-01", data_realizacao: "2026-06-01", status: "paga" },
    { ...base, id: 14, conta_id: 1, categoria_id: 11, tipo: "despesa", valor: 180, descricao: "Tênis (1/3) [Serie:demo-tenis]", data_vencimento: "2026-08-31", data_realizacao: null, status: "pendente" },
    { ...base, id: 15, conta_id: 1, categoria_id: 11, tipo: "despesa", valor: 180, descricao: "Tênis (2/3) [Serie:demo-tenis]", data_vencimento: "2026-09-30", data_realizacao: null, status: "pendente" },
  ];
}

function goals(): LocalDemoRow[] {
  return [
    { id: 1, user_id: LOCAL_DEMO_USER_ID, nome: "Reserva de emergência", meta_valor: 10000, saldo_atual: 6200, data_prazo: "2026-12-31", cor: "#2A9D8F", icone: "security", compartilhado: false, arquivado: false, bloqueado_plano: false, criado_em: CREATED_AT },
    { id: 2, user_id: LOCAL_DEMO_USER_ID, nome: "Viagem", meta_valor: 3000, saldo_atual: 1500, data_prazo: "2027-06-30", cor: "#3A86FF", icone: "flight", compartilhado: false, arquivado: false, bloqueado_plano: false, criado_em: CREATED_AT },
    { id: 3, user_id: LOCAL_DEMO_USER_ID, nome: "Notebook", meta_valor: 2000, saldo_atual: 750, data_prazo: "2027-03-31", cor: "#8A05BE", icone: "laptop", compartilhado: false, arquivado: false, bloqueado_plano: false, criado_em: CREATED_AT },
  ];
}

function cards(): LocalDemoRow[] {
  return [
    { id: 1, user_id: LOCAL_DEMO_USER_ID, nome: "FinFlow Visa", cor: "#457B9D", limite: 5000, dia_vencimento: 12, dia_fechamento: 5, ativo: true, bloqueado_plano: false, criado_em: CREATED_AT },
    { id: 2, user_id: LOCAL_DEMO_USER_ID, nome: "Cartão arquivado", cor: "#6D597A", limite: 1500, dia_vencimento: 20, dia_fechamento: 13, ativo: false, bloqueado_plano: false, criado_em: CREATED_AT },
  ];
}

function invoiceItems(): LocalDemoRow[] {
  const base = { cartao_id: 1, user_id: LOCAL_DEMO_USER_ID, criado_em: "2026-08-01T12:00:00.000Z" };
  return [
    { ...base, id: 1, descricao: "Supermercado", valor: 245.8, data_compra: "2026-07-25", mes_fatura: "2026-08", parcela_atual: 1, total_parcelas: 1, grupo_parcela_id: null, categoria_id: 1, pago: false },
    { ...base, id: 2, descricao: "Curso de finanças (1/3)", valor: 180, data_compra: "2026-07-20", mes_fatura: "2026-08", parcela_atual: 1, total_parcelas: 3, grupo_parcela_id: 2, categoria_id: 11, pago: false },
    { ...base, id: 3, descricao: "Curso de finanças (2/3)", valor: 180, data_compra: "2026-07-20", mes_fatura: "2026-09", parcela_atual: 2, total_parcelas: 3, grupo_parcela_id: 2, categoria_id: 11, pago: false },
    { ...base, id: 4, descricao: "Curso de finanças (3/3)", valor: 180, data_compra: "2026-07-20", mes_fatura: "2026-10", parcela_atual: 3, total_parcelas: 3, grupo_parcela_id: 2, categoria_id: 11, pago: false },
    { ...base, id: 5, descricao: "Streaming", valor: 39.9, data_compra: "2026-07-27", mes_fatura: "2026-08", parcela_atual: 1, total_parcelas: 1, grupo_parcela_id: null, categoria_id: 4, pago: false },
    { ...base, id: 6, descricao: "Fatura anterior quitada", valor: 980, data_compra: "2026-06-20", mes_fatura: "2026-07", parcela_atual: 1, total_parcelas: 1, grupo_parcela_id: null, categoria_id: 11, pago: true },
  ];
}

export function createLocalDemoFixtures(): LocalDemoDatabase {
  return {
    categorias: categories(),
    contas: accounts(),
    transacoes: transactions(),
    caixinhas: goals(),
    cartoes: cards(),
    fatura_itens: invoiceItems(),
    parcerias: [],
    notificacoes_sistema: [],
    feedbacks: [],
    chat_historico: [],
  };
}

export function cloneLocalDemoDatabase(database: LocalDemoDatabase): LocalDemoDatabase {
  return JSON.parse(JSON.stringify(database)) as LocalDemoDatabase;
}
