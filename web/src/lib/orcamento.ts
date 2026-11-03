/**
 * Orçamentos (site): itens com valor, quantidade e, opcionalmente, custo.
 * Só gera o documento; nada é lançado no FinFlow nem guardado.
 */
export type ItemOrcamento = {
  id: string;
  descricao: string;
  /** Valor unitário cobrado. */
  valor: number;
  quantidade: number;
  /** Custo unitário (opcional): com ele, a tela mostra a margem de lucro. */
  custo: number | null;
  /** Imagem do item, só no navegador (vai para o PDF, nunca para o banco). */
  imagem?: import("./imagem-local").ImagemLocal | null;
};

const centavos = (valor: number) => Math.round(valor * 100) / 100;

export function totalDoItem(item: ItemOrcamento): number {
  return centavos(item.valor * item.quantidade);
}

/** Lucro e margem (sobre o valor cobrado) do item; nulos sem custo. */
export function lucroDoItem(item: ItemOrcamento): { lucro: number; margem: number } | null {
  if (item.custo === null) return null;
  const lucro = centavos((item.valor - item.custo) * item.quantidade);
  const total = totalDoItem(item);
  return { lucro, margem: total > 0 ? (lucro / total) * 100 : 0 };
}

export function resumoDoOrcamento(itens: readonly ItemOrcamento[]) {
  const total = centavos(itens.reduce((soma, item) => soma + totalDoItem(item), 0));
  const comCusto = itens.filter((item) => item.custo !== null);
  const totalComCusto = centavos(comCusto.reduce((soma, item) => soma + totalDoItem(item), 0));
  const custo = centavos(comCusto.reduce((soma, item) => soma + (item.custo ?? 0) * item.quantidade, 0));
  const lucro = centavos(totalComCusto - custo);
  return {
    total,
    /** Margem só dos itens com custo informado. */
    custo: comCusto.length ? custo : null,
    lucro: comCusto.length ? lucro : null,
    margem: comCusto.length && totalComCusto > 0 ? (lucro / totalComCusto) * 100 : null,
    itensSemCusto: itens.length - comCusto.length,
  };
}
