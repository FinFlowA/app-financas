import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  invoiceClosingDate,
  invoiceIsClosed,
  invoicePresentationStatus,
} from "../invoice-status";
import { isStrongPassword, normalizeBrazilPhone } from "../auth/validation";
import { parseMoney, moneyIsPositive } from "../money";
import { calcularSaldoProjetadoPorMes } from "../saldo-projetado";
import { fetchAllRows } from "../supabase/pagination";
import { historyFinancialTotals } from "../history-totals";
import { collectPaymentSummaryRows } from "../payment-summaries";
import { nextReportAccountSelection, parseReportAccountSelection } from "../report-scope";
import { isAttentionDueDate } from "../date";
import {
  filterInvoiceGroupItems,
  groupInvoiceItems,
  invoiceDueDate,
  invoicePurchasesInMonth,
} from "../invoices";
import type { Cartao, FaturaItem } from "../types";
import {
  calcularSaldosPorConta,
  dataEfetivaTransacao,
  descricaoVisivel,
  getContaDestinoTransferencia,
  getReferenciaPagamentoFatura,
  isMovimentoObjetivo,
  resumirFluxoMensal,
  transacoesNoEscopo,
} from "../transacoes";

describe("valores monetários", () => {
  it("aceita os formatos brasileiros e internacionais usados nos formulários", () => {
    expect(parseMoney("R$ 1.234,56")).toBe(1234.56);
    expect(parseMoney("1234.56")).toBe(1234.56);
    expect(parseMoney("1,25")).toBe(1.25);
    expect(Number.isNaN(parseMoney(""))).toBe(true);
  });

  it("rejeita zero, negativos e valores fora do domínio", () => {
    expect(moneyIsPositive(0.01)).toBe(true);
    expect(moneyIsPositive(0)).toBe(false);
    expect(moneyIsPositive(-1)).toBe(false);
    expect(moneyIsPositive(1_000_000_000_000)).toBe(false);
  });
});

describe("cadastro e credenciais", () => {
  it("normaliza celular brasileiro e aplica a política de senha forte", () => {
    expect(normalizeBrazilPhone("(11) 99999-1234")).toBe("+5511999991234");
    expect(normalizeBrazilPhone("1234")).toBeNull();
    expect(isStrongPassword("FinFlow#2026")).toBe(true);
    expect(isStrongPassword("senha-fraca")).toBe(false);
  });
});

describe("transferências e objetivos", () => {
  const transfer = {
    id: 10,
    conta_id: 1,
    categoria_id: null,
    tipo: "despesa" as const,
    valor: 30,
    descricao: "[Transf.] Reserva mensal [Destino:2]",
    status: "paga" as const,
    data_vencimento: "2026-08-10",
    data_realizacao: "2026-08-10",
  };

  it("armazena uma linha, debita a origem e credita o destino", () => {
    const balances = calcularSaldosPorConta([
      { id: 1, saldo_inicial: 100 },
      { id: 2, saldo_inicial: 50 },
    ], [transfer]);
    expect(balances.get(1)).toBe(70);
    expect(balances.get(2)).toBe(80);
    expect(getContaDestinoTransferencia(transfer.descricao)).toBe(2);
    expect(descricaoVisivel(transfer.descricao)).toBe("Reserva mensal");
  });

  it("anula transferência interna e preserva cruzamentos da seleção", () => {
    expect(transacoesNoEscopo([transfer], new Set([1, 2]), 2)).toEqual([]);
    expect(transacoesNoEscopo([transfer], new Set([1]), 1)[0]?.tipo).toBe("despesa");
    const incoming = transacoesNoEscopo([transfer], new Set([2]), 1)[0];
    expect(incoming?.tipo).toBe("receita");
    expect(incoming?.conta_id).toBe(2);
  });

  it("reconhece objetivo como movimento interno", () => {
    expect(isMovimentoObjetivo("[Transf.] Guardar em: Notebook [Objetivo:7:guardar]")).toBe(true);
    expect(isMovimentoObjetivo("Aluguel")).toBe(false);
  });
});

describe("filtro de contas do fluxo", () => {
  it("valida IDs, remove duplicados e preserva somente contas disponíveis", () => {
    expect(parseReportAccountSelection("2,999,2", [1, 2, 3])).toEqual([2]);
    expect(parseReportAccountSelection(["1", "3"], [1, 2, 3])).toEqual([1, 3]);
    expect(parseReportAccountSelection("", [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("ao sair de Todas seleciona somente a conta tocada, igual ao app", () => {
    expect(nextReportAccountSelection([1, 2, 3], [1, 2, 3], 2)).toEqual([2]);
    expect(nextReportAccountSelection([2], [1, 2, 3], 3)).toEqual([2, 3]);
    expect(nextReportAccountSelection([2, 3], [1, 2, 3], 2)).toEqual([3]);
  });
});

describe("datas realizadas e projeção", () => {
  it("agrupa atrasados, hoje e os próximos sete dias no filtro de atenção", () => {
    expect(isAttentionDueDate("2026-08-01", "2026-08-15")).toBe(true);
    expect(isAttentionDueDate("2026-08-15", "2026-08-15")).toBe(true);
    expect(isAttentionDueDate("2026-08-22", "2026-08-15")).toBe(true);
    expect(isAttentionDueDate("2026-08-23", "2026-08-15")).toBe(false);
  });

  it("usa data de realização para concluída e vencimento para pendente", () => {
    expect(dataEfetivaTransacao({ status: "paga", data_vencimento: "2026-01-01", data_realizacao: "2026-02-03" })).toBe("2026-02-03");
    expect(dataEfetivaTransacao({ status: "pendente", data_vencimento: "2026-03-04", data_realizacao: null })).toBe("2026-03-04");
  });

  it("mantém meses passados realizados e projeta pendências futuras", () => {
    const result = calcularSaldoProjetadoPorMes(100, [
      { tipo: "despesa", valor: 20, status: "paga", data_vencimento: "2026-01-05", data_realizacao: "2026-01-10" },
      { tipo: "receita", valor: 50, status: "pendente", data_vencimento: "2026-02-20", data_realizacao: null },
    ], 2026, new Date("2026-02-15T12:00:00-03:00"));
    expect(result[0]).toMatchObject({ saldo: 80, projetado: false });
    expect(result[1]).toMatchObject({ saldo: 130, projetado: true });
    expect(result[2]).toMatchObject({ saldo: 130, projetado: true });
  });
});

describe("resumo mensal da Home", () => {
  it("soma pendentes nas entradas e saídas, mas mantém o balanço apenas realizado", () => {
    const result = resumirFluxoMensal([
      { conta_id: 1, tipo: "receita", valor: 100, descricao: "Salário", status: "paga" },
      { conta_id: 1, tipo: "receita", valor: 50, descricao: "Freela", status: "pendente" },
      { conta_id: 1, tipo: "despesa", valor: 20, descricao: "Mercado", status: "paga" },
      { conta_id: 1, tipo: "despesa", valor: 30, descricao: "Internet", status: "pendente" },
    ]);
    expect(result).toEqual({ receitas: 150, despesas: 50, balancoRealizado: 80 });
  });
});

describe("paginação financeira", () => {
  it("carrega todas as páginas sem truncar no limite do PostgREST", async () => {
    const source = Array.from({ length: 2_205 }, (_, index) => index + 1);
    const calls: Array<[number, number]> = [];
    const result = await fetchAllRows<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: source.slice(from, to + 1), error: null };
    });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(source.length);
    expect(result.data?.at(-1)).toBe(2_205);
    expect(calls).toEqual([[0, 999], [1_000, 1_999], [2_000, 2_999]]);
  });

  it("falha fechado quando uma página retorna erro", async () => {
    const result = await fetchAllRows<number>(async () => ({
      data: null,
      error: { message: "consulta negada" },
    }));
    expect(result).toEqual({ data: null, error: { message: "consulta negada" } });
  });
});

describe("resumos de baixas parciais", () => {
  it("combina os lotes somente quando todos foram carregados", () => {
    expect(collectPaymentSummaryRows([
      { data: [{ id: 1 }], error: null },
      { data: [{ id: 2 }], error: null },
    ])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("falha fechado se qualquer lote falhar ou vier malformado", () => {
    expect(() => collectPaymentSummaryRows([
      { data: [{ id: 1 }], error: null },
      { data: null, error: { message: "consulta negada" } },
    ])).toThrow("TRANSACTION_PAYMENT_SUMMARIES_UNAVAILABLE");
  });
});

describe("compras e faturas", () => {
  const card: Cartao = {
    id: 5,
    user_id: "user",
    nome: "FinFlow Visa",
    cor: "#805AD5",
    limite: 5_000,
    dia_vencimento: 31,
    dia_fechamento: 20,
    ativo: true,
    version: 1,
  };
  const baseItem: FaturaItem = {
    id: 1,
    cartao_id: card.id,
    user_id: "user",
    descricao: "Mercado",
    valor: 250,
    data_compra: "2026-02-03",
    mes_fatura: "2026-02",
    parcela_atual: 1,
    total_parcelas: 1,
    categoria_id: 10,
    pago: false,
    grupo_parcela_id: null,
  };

  it("conta cada parcela no mês da fatura e ignora linhas técnicas de pagamento", () => {
    const items = [
      baseItem,
      { ...baseItem, id: 2, descricao: "Pagamento parcial da fatura", valor: -100 },
      { ...baseItem, id: 3, descricao: "Saldo da fatura anterior (2026-01)", valor: 100 },
      { ...baseItem, id: 4, descricao: "Curso (1/3)", data_compra: "2026-02-03", mes_fatura: "2026-03", parcela_atual: 1, total_parcelas: 3 },
      { ...baseItem, id: 5, descricao: "Curso (2/3)", data_compra: "2026-02-03", mes_fatura: "2026-04", parcela_atual: 2, total_parcelas: 3 },
    ];
    expect(invoicePurchasesInMonth(items, "2026-02").map((item) => item.id)).toEqual([1]);
    expect(invoicePurchasesInMonth(items, "2026-03").map((item) => item.id)).toEqual([4]);
    expect(invoicePurchasesInMonth(items, "2026-04").map((item) => item.id)).toEqual([5]);
  });

  it("mantém o vencimento no mês e agrupa faturas de cartão arquivado", () => {
    expect(invoiceDueDate("2026-02", 31)).toBe("2026-02-28");
    const [group] = groupInvoiceItems([
      baseItem,
      { ...baseItem, id: 2, descricao: "Streaming", valor: 50, categoria_id: 11, pago: true },
    ], [{ ...card, ativo: false }]);
    expect(group).toMatchObject({ total: 300, paid: false, dueDate: "2026-02-28", cardActive: false });
  });

  it("deriva fatura zerada como paga somente depois do fechamento, sem criar débito", () => {
    expect(invoiceClosingDate("2026-02", 31)).toBe("2026-02-28");
    expect(invoiceIsClosed("2026-02", 28, "2026-02-28")).toBe(false);
    expect(invoiceIsClosed("2026-02", 28, "2026-03-01")).toBe(true);
    expect(invoicePresentationStatus({
      invoiceMonth: "2026-02",
      closingDay: 28,
      itemCount: 0,
      openTotal: 0,
      allItemsPaid: false,
      today: "2026-02-28",
    })).toBe("zero");
    expect(invoicePresentationStatus({
      invoiceMonth: "2026-02",
      closingDay: 28,
      itemCount: 0,
      openTotal: 0,
      allItemsPaid: false,
      today: "2026-03-01",
    })).toBe("paid");
  });

  it("mantém saldo em aberto como fechado e itens quitados como pagos", () => {
    expect(invoicePresentationStatus({
      invoiceMonth: "2026-02",
      closingDay: 20,
      itemCount: 1,
      openTotal: 120,
      allItemsPaid: false,
      today: "2026-02-21",
    })).toBe("closed");
    expect(invoicePresentationStatus({
      invoiceMonth: "2026-02",
      closingDay: 20,
      itemCount: 1,
      openTotal: 0,
      allItemsPaid: true,
      today: "2026-02-10",
    })).toBe("paid");
  });

  it("só exibe a fatura na busca quando um item corresponde e recalcula o card", () => {
    const [group] = groupInvoiceItems([
      baseItem,
      { ...baseItem, id: 2, descricao: "Streaming", valor: 50, categoria_id: 11 },
    ], [card]);
    const categories = new Map([[10, "Alimentação"], [11, "Assinaturas"]]);
    expect(filterInvoiceGroupItems(group, "inexistente", [], categories)).toBeNull();
    expect(filterInvoiceGroupItems(group, "stream", [], categories)).toMatchObject({ total: 50, filtered: true });
    expect(filterInvoiceGroupItems(group, "alimentacao", [10], categories)).toMatchObject({ total: 250, filtered: true });
  });

  it("soma faturas visíveis no Histórico sem duplicar o pagamento técnico", () => {
    const [invoice] = groupInvoiceItems([baseItem], [card]);
    const payment = {
      id: 40,
      user_id: "user",
      conta_id: 1,
      categoria_id: null,
      tipo: "despesa" as const,
      valor: 250,
      descricao: "Pagamento FinFlow [PagFatura:5:2026-02:total]",
      data_vencimento: "2026-02-28",
      data_realizacao: "2026-02-28",
      status: "paga",
      transacao_pai_id: null,
      version: 1,
    };
    const ordinaryExpense = {
      ...payment,
      id: 41,
      categoria_id: 10,
      valor: 20,
      descricao: "Padaria",
    };
    expect(getReferenciaPagamentoFatura(payment.descricao)).toEqual({ cartaoId: 5, mes: "2026-02" });
    expect(historyFinancialTotals([payment, ordinaryExpense], [invoice])).toEqual({ receita: 0, despesa: 270 });
    expect(historyFinancialTotals([], [invoice])).toEqual({ receita: 0, despesa: 250 });
  });
});

describe("executor financeiro manual", () => {
  it("permanece idempotente, autenticado e sem acesso anônimo", () => {
    const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/20260815000100_secure_manual_financial_actions.sql"), "utf8");
    expect(migration).toContain("caller uuid := auth.uid()");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("private.ai_action_state_fingerprint");
    expect(migration).toMatch(/ai_execute_financial_action\([\s\S]*?p_idempotency_key\s*\)/);
    expect(migration).toMatch(/revoke all on function public\.execute_manual_financial_action[\s\S]*?from public, anon, authenticated/);
    expect(migration).not.toContain("service_role");
  });

  it("encaminha faturas pelas RPCs manuais sem usar a chave como action_id da IA", () => {
    const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/20260815000100_secure_manual_financial_actions.sql"), "utf8");
    const invoiceBranch = migration.slice(
      migration.indexOf("if p_action_type = 'pay_invoice'"),
      migration.indexOf("else\n    -- A leitura com lock"),
    );

    expect(invoiceBranch).toContain("public.finance_pay_invoice(");
    expect(invoiceBranch).toContain("public.finance_reverse_invoice_payment(");
    expect(invoiceBranch).not.toContain("private.ai_execute_financial_action(");
    expect(invoiceBranch).not.toContain("private.ai_action_state_fingerprint(");
  });

  it("falha fechado quando o banco não devolve um envelope explícito de sucesso", () => {
    const financeAction = readFileSync(resolve(process.cwd(), "src/lib/finance-action.ts"), "utf8");
    expect(financeAction).toContain("function isSuccessfulEnvelope");
    expect(financeAction).toMatch(/\.ok === true/);
    expect(financeAction.match(/if \(!isSuccessfulEnvelope\(data\)\) return invalidBackendResponse\(\);/g)).toHaveLength(3);
  });

  it("reutiliza a chave da criação manual quando a resposta da rede se perde", () => {
    const manager = readFileSync(resolve(process.cwd(), "src/app/(dashboard)/transacoes/transaction-manager.tsx"), "utf8");
    expect(manager).toContain("const [requestId] = useRequestId()");
    expect(manager).toContain('formData.set("request_id", requestId)');
  });
});

describe("confirmação segura da IA web", () => {
  it("sobrevive ao recarregamento apenas na sessão da aba e é removida ao concluir", () => {
    const assistant = readFileSync(resolve(process.cwd(), "src/app/(dashboard)/assistente/assistant-chat.tsx"), "utf8");
    expect(assistant).toContain("sessionStorage.setItem(pendingKey");
    expect(assistant).toContain("sessionStorage.removeItem(pendingKey)");
    expect(assistant).toContain("parseStoredPendingAction");
    expect(assistant).not.toContain("localStorage.setItem(pendingKey");
  });
});
