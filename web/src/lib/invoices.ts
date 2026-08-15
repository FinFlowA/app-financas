import type { Cartao, FaturaItem } from "@/lib/types";

export type InvoiceHistoryGroup = {
  cardId: number;
  cardName: string;
  cardColor: string;
  cardActive: boolean;
  invoiceMonth: string;
  dueDate: string;
  total: number;
  paid: boolean;
  orderId: number;
  items: FaturaItem[];
  filtered: boolean;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizedText(value: string): string {
  return value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Linhas de controle criadas por pagamentos parciais nÃ£o sÃ£o novas compras.
 * ExcluÃ­-las do balanÃ§o por data da compra evita contabilizar a mesma despesa
 * novamente quando o restante Ã© mantido ou levado para a prÃ³xima fatura.
 */
export function isSyntheticInvoiceItem(item: Pick<FaturaItem, "descricao">): boolean {
  const description = item.descricao.trim();
  return description === "Pagamento parcial da fatura"
    || description.startsWith("Saldo da fatura anterior");
}

export function invoicePurchasesInMonth(items: FaturaItem[], month: string): FaturaItem[] {
  return items.filter((item) => item.data_compra.slice(0, 7) === month && !isSyntheticInvoiceItem(item));
}

/** MantÃ©m o vencimento dentro do mÃªs, inclusive para dias 29, 30 e 31. */
export function invoiceDueDate(month: string, dueDay: number): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return `${month}-01`;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0, 12)).getUTCDate();
  const safeDay = Math.min(Math.max(Math.trunc(dueDay) || 1, 1), lastDay);
  return `${month}-${String(safeDay).padStart(2, "0")}`;
}

export function groupInvoiceItems(items: FaturaItem[], cards: Cartao[]): InvoiceHistoryGroup[] {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const groups = new Map<string, InvoiceHistoryGroup>();

  for (const item of items) {
    const card = cardsById.get(item.cartao_id);
    // RLS jÃ¡ restringe as linhas ao usuÃ¡rio. A checagem tambÃ©m impede exibir
    // uma linha Ã³rfÃ£ caso o cartÃ£o tenha sido removido por dados legados.
    if (!card) continue;
    const key = `${item.cartao_id}:${item.mes_fatura}`;
    const existing = groups.get(key);
    const value = Number(item.valor);
    if (existing) {
      existing.items.push(item);
      existing.total = roundMoney(existing.total + (Number.isFinite(value) ? value : 0));
      existing.paid = existing.paid && item.pago === true;
      existing.orderId = Math.max(existing.orderId, item.id);
      continue;
    }
    groups.set(key, {
      cardId: card.id,
      cardName: card.nome,
      cardColor: card.cor,
      cardActive: card.ativo,
      invoiceMonth: item.mes_fatura,
      dueDate: invoiceDueDate(item.mes_fatura, card.dia_vencimento),
      total: roundMoney(Number.isFinite(value) ? value : 0),
      paid: item.pago === true,
      orderId: item.id,
      items: [item],
      filtered: false,
    });
  }

  return [...groups.values()];
}

/**
 * A busca de uma fatura Ã© deliberadamente feita nos itens, nunca no tÃ­tulo
 * genÃ©rico do card ou no nome do cartÃ£o. Assim, procurar qualquer texto nÃ£o
 * faz todas as faturas aparecerem. O total retornado Ã© apenas o dos itens que
 * satisfazem simultaneamente busca e categoria.
 */
export function filterInvoiceGroupItems(
  group: InvoiceHistoryGroup,
  searchTerm: string,
  categoryIds: number[],
  categoriesById: Map<number, string>,
): InvoiceHistoryGroup | null {
  const normalizedSearch = normalizedText(searchTerm.trim());
  const matching = group.items.filter((item) => {
    if (categoryIds.length > 0 && (item.categoria_id === null || !categoryIds.includes(item.categoria_id))) return false;
    if (!normalizedSearch) return true;
    const categoryName = item.categoria_id === null ? "" : categoriesById.get(item.categoria_id) ?? "";
    return normalizedText(`${item.descricao} ${categoryName}`).includes(normalizedSearch);
  });
  if (matching.length === 0) return null;
  const filtered = normalizedSearch.length > 0 || categoryIds.length > 0;
  return {
    ...group,
    items: matching,
    total: filtered
      ? roundMoney(matching.reduce((sum, item) => sum + (Number(item.valor) || 0), 0))
      : group.total,
    filtered,
  };
}
