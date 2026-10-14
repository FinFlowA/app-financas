// Início do app: tocar numa categoria da Distribuição do Mês mostra os
// lançamentos e as compras do cartão que formam o valor, no modo escolhido
// (Concluídos ou Previstos), respeitando "ocultar valores".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("detalhe da categoria no Início do app", () => {
  const inicio = readFileSync(join(raiz, "app/(tabs)/index.tsx"), "utf8");

  it("cada linha do gráfico abre o detalhe", () => {
    expect(inicio).toContain("onPress={onSelecionar ? () => onSelecionar(item.chave) : undefined}");
    expect(inicio).toContain("onSelecionar={abrirDetalheDespesa}");
    expect(inicio).toContain("onSelecionar={abrirDetalheReceita}");
  });

  it("o detalhe lista o que forma o valor do grupo, no modo escolhido", () => {
    expect(inicio).toContain("existente.itens.push({ ...item, valor });");
    expect(inicio).toContain("somarCategoriaOuSemCategoria(compra.categoria_id, Number(compra.valor), itemDaCompra(compra))");
    expect(inicio).toContain("const grupoDetalhe = categoriaDetalhe ? dadosDoDetalhe.find((grupo) => grupo.chave === categoriaDetalhe.chave) : undefined;");
    expect(inicio).toContain("{formatarValorPrivado(item.valor)}");
  });
});
