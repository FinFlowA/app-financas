// Orçamentos (total, lucro e margem) e a calculadora flutuante do site.
import { describe, expect, it } from "vitest";
import { apagar, CALCULADORA_INICIAL, digitar, igual, operar, porcento, type EstadoCalculadora } from "../calculadora";
import { lucroDoItem, resumoDoOrcamento, totalDoItem, type ItemOrcamento } from "../orcamento";

const item = (valor: number, quantidade: number, custo: number | null, id = String(valor)): ItemOrcamento => ({ id, descricao: "Item", valor, quantidade, custo });

describe("orçamento", () => {
  it("total do item é valor vezes quantidade", () => {
    expect(totalDoItem(item(19.9, 3, null))).toBe(59.7);
  });

  it("lucro e margem só com custo", () => {
    expect(lucroDoItem(item(50, 2, null))).toBeNull();
    expect(lucroDoItem(item(50, 2, 30))).toEqual({ lucro: 40, margem: 40 });
  });

  it("resumo: margem considera só os itens com custo", () => {
    const resumo = resumoDoOrcamento([item(100, 1, 60, "a"), item(50, 2, null, "b")]);
    expect(resumo).toEqual({ total: 200, custo: 60, lucro: 40, margem: 40, itensSemCusto: 1 });
    expect(resumoDoOrcamento([item(10, 1, null)]).margem).toBeNull();
  });
});

describe("calculadora", () => {
  const teclar = (sequencia: string[]): EstadoCalculadora => sequencia.reduce<EstadoCalculadora>((estado, tecla) => {
    if (/^[\d,]$/.test(tecla)) return digitar(estado, tecla);
    if (tecla === "=") return igual(estado);
    if (tecla === "%") return porcento(estado);
    if (tecla === "⌫") return apagar(estado);
    return operar(estado, tecla as "+" | "-" | "×" | "÷");
  }, CALCULADORA_INICIAL);

  it("faz contas em sequência, com vírgula decimal", () => {
    expect(teclar(["1", "2", ",", "5", "+", "7", ",", "5", "="]).visor).toBe("20");
    expect(teclar(["1", "0", "0", "0", "×", "3", "="]).visor).toBe("3.000");
    expect(teclar(["9", "÷", "4", "="]).visor).toBe("2,25");
    expect(teclar(["2", "+", "3", "×", "4", "="]).visor).toBe("20");
  });

  it("porcentagem, divisão por zero e apagar", () => {
    expect(teclar(["2", "0", "0", "+", "1", "0", "%", "="]).visor).toBe("220");
    expect(teclar(["5", "÷", "0", "="]).visor).toBe("Erro");
    expect(teclar(["1", "2", "3", "⌫"]).visor).toBe("12");
  });
});
