// Cenário de auditoria do relatório (ver relatorio-auditoria.test.ts): cartão
// com parcelas futuras, fatura vencida e fatura paga, transferências (entre
// contas, para conta arquivada e no formato antigo, em duas linhas),
// objetivos, atrasados de antes do período e dados do ano anterior.
import type { DadosRelatorio } from "../../relatorio";
import type { Cartao, FaturaItem } from "../../types";

type Lancamento = DadosRelatorio["transacoes"][number];
const lanc = (id: number, dados: Partial<Lancamento>): Lancamento => ({
  id, conta_id: 1, categoria_id: null, tipo: "despesa", valor: 0, descricao: "Lançamento", data_vencimento: "2026-10-01",
  data_realizacao: null, status: "pendente", ...dados,
});
const pago = (data: string) => ({ status: "paga" as const, data_vencimento: data, data_realizacao: data });
const pendente = (data: string) => ({ status: "pendente" as const, data_vencimento: data, data_realizacao: null });
const cartao: Cartao = { id: 7, user_id: "u", nome: "Nubank", cor: "#8A05BE", limite: 5000, dia_vencimento: 10, dia_fechamento: 3, ativo: true, version: 1 };
const item = (id: number, dados: Partial<FaturaItem>): FaturaItem => ({
  id, cartao_id: 7, user_id: "u", descricao: "Compra", valor: 0, data_compra: "2026-09-28", mes_fatura: "2026-10",
  parcela_atual: 1, total_parcelas: 1, categoria_id: null, pago: false, grupo_parcela_id: null, ...dados,
});

export const cenario: DadosRelatorio = {
  hoje: "2026-10-15",
  contas: [
    { id: 1, nome: "Corrente", saldo_inicial: 1000, arquivado: false },
    { id: 2, nome: "Poupança", saldo_inicial: 0, arquivado: false },
    { id: 3, nome: "Antiga", saldo_inicial: 0, arquivado: true },
    { id: 4, nome: "Investimentos", saldo_inicial: 0, arquivado: false },
  ],
  categorias: [
    { id: 1, nome: "Salário", tipo: "receita", meta_mensal: 6000, limite_mensal: null },
    { id: 2, nome: "Alimentação", tipo: "despesa", meta_mensal: null, limite_mensal: 800 },
    { id: 3, nome: "Moradia", tipo: "despesa", meta_mensal: null, limite_mensal: 2000 },
    { id: 4, nome: "Compras", tipo: "despesa", meta_mensal: null, limite_mensal: null },
    { id: 5, nome: "Educação", tipo: "despesa", meta_mensal: null, limite_mensal: null },
    { id: 6, nome: "Saúde", tipo: "despesa", meta_mensal: null, limite_mensal: null },
    { id: 7, nome: "Outros", tipo: "receita", meta_mensal: null, limite_mensal: null },
  ],
  objetivos: [{ id: 9, nome: "Viagem", meta_valor: 2000, saldo_atual: 500, data_prazo: null, arquivado: false }],
  cartoes: [cartao],
  transacoes: [
    lanc(1, { tipo: "receita", categoria_id: 1, valor: 3000, descricao: "Salário 2025", ...pago("2025-06-10") }),
    lanc(2, { tipo: "receita", categoria_id: 1, valor: 1000, descricao: "Bônus 2025", ...pago("2025-11-20") }),
    lanc(3, { tipo: "receita", categoria_id: 1, valor: 5000, descricao: "Salário", ...pago("2026-09-05") }),
    lanc(4, { tipo: "receita", categoria_id: 1, valor: 5000, descricao: "Salário", ...pago("2026-10-05") }),
    lanc(5, { categoria_id: 2, valor: 300, descricao: "Mercado", ...pago("2026-10-08") }),
    lanc(6, { categoria_id: 3, valor: 1500, descricao: "Aluguel", ...pendente("2026-10-20") }),
    lanc(7, { categoria_id: 3, valor: 80, descricao: "Luz", ...pendente("2026-09-25") }),
    lanc(8, { tipo: "receita", categoria_id: 7, valor: 400, descricao: "Freela", ...pendente("2026-10-12") }),
    lanc(9, { categoria_id: 3, valor: 120, descricao: "IPTU", ...pendente("2025-12-15") }),
    lanc(10, { valor: 1000, descricao: "[Transf.] Reserva [Destino:2]", ...pago("2026-10-06") }),
    lanc(11, { valor: 200, descricao: "[Transf.] Reserva de novembro [Destino:2]", ...pendente("2026-11-02") }),
    lanc(12, { valor: 500, descricao: "[Transf.] Aporte · Guardar em: Viagem [Objetivo:9:guardar]", ...pago("2026-10-07") }),
    lanc(13, { valor: 300, descricao: "[Transf.] Aporte · Guardar em: Viagem [Objetivo:9:guardar]", ...pendente("2026-11-07") }),
    lanc(14, { valor: 600, descricao: "Fatura Nubank - 2026-10 [PagFatura:7:2026-10:total]", ...pago("2026-10-10") }),
    lanc(15, { valor: 50, descricao: "[Transf.] Para a conta antiga [Destino:3]", ...pago("2026-10-09") }),
    // Transferência do formato antigo: duas linhas, sem o destino marcado.
    lanc(16, { valor: 100, descricao: "[Transf.] Transferência antiga", ...pago("2026-08-10") }),
    lanc(17, { conta_id: 2, tipo: "receita", valor: 100, descricao: "[Transf.] Transferência antiga", ...pago("2026-08-10") }),
  ],
  itensFatura: [
    item(1, { descricao: "Livro", valor: 150, data_compra: "2026-08-25", mes_fatura: "2026-09", categoria_id: 5 }),
    item(2, { descricao: "Restaurante", valor: 400, mes_fatura: "2026-10", categoria_id: 2, pago: true }),
    item(3, { descricao: "Tênis (1/3)", valor: 200, mes_fatura: "2026-10", categoria_id: 4, pago: true, parcela_atual: 1, total_parcelas: 3, grupo_parcela_id: 11 }),
    item(4, { descricao: "Tênis (2/3)", valor: 200, mes_fatura: "2026-11", categoria_id: 4, parcela_atual: 2, total_parcelas: 3, grupo_parcela_id: 11 }),
    item(5, { descricao: "Tênis (3/3)", valor: 200, mes_fatura: "2026-12", categoria_id: 4, parcela_atual: 3, total_parcelas: 3, grupo_parcela_id: 11 }),
    item(6, { descricao: "Farmácia", valor: 100, data_compra: "2026-10-05", mes_fatura: "2026-11", categoria_id: 6 }),
  ],
};
