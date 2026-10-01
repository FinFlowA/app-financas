/** Opção de um seletor com busca (contas, objetivos, categorias). */
export type OpcaoSeletor = {
  id: number | string;
  titulo: string;
  /** Agrupa a lista (por exemplo, "Contas" e "Objetivos" no destino). */
  grupo?: string;
  /** Bolinha colorida à esquerda (categorias, objetivos). */
  cor?: string;
  /** Ícone do MaterialIcons à esquerda. */
  icone?: string;
};

/** Minúsculas e sem acentos, para "mercado" achar "Mercado" e "cafe" achar "Café". */
export function normalizarBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Filtra as opções cujo título contém todas as palavras digitadas, em qualquer ordem. */
export function filtrarOpcoesSeletor<T extends OpcaoSeletor>(opcoes: readonly T[], busca: string): T[] {
  const palavras = normalizarBusca(busca).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return [...opcoes];
  return opcoes.filter((opcao) => {
    const titulo = normalizarBusca(opcao.titulo);
    return palavras.every((palavra) => titulo.includes(palavra));
  });
}
