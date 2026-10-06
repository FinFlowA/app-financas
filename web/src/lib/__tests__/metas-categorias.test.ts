import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  largurasDaBarra,
  progressoDasCategorias,
  progressoDoAlvo,
  totaisDasCategoriasNoMes,
  valorDoAlvo,
  type ItemCartaoParaAlvo,
  type TransacaoParaAlvo,
} from "../metas-categorias";

const raiz = join(__dirname, "..", "..", "..", "..");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- só caminhos fixos deste teste
const ler = (arquivo: string) => readFileSync(join(raiz, arquivo), "utf8");

const lancamento = (dados: Partial<TransacaoParaAlvo>): TransacaoParaAlvo => ({
  tipo: "despesa",
  valor: 100,
  status: "paga",
  data_vencimento: "2026-10-05",
  data_realizacao: "2026-10-05",
  descricao: "Mercado",
  categoria_id: 1,
  ...dados,
});

describe("metas e limites por categoria: o que conta no mês", () => {
  it("separa o realizado do agendado pela data efetiva", () => {
    const totais = totaisDasCategoriasNoMes([
      lancamento({ valor: 100 }),
      // Venceu em setembro, mas foi paga em outubro: conta em outubro.
      lancamento({ valor: 40, data_vencimento: "2026-09-28", data_realizacao: "2026-10-02" }),
      lancamento({ valor: 60, status: "pendente", data_vencimento: "2026-10-20", data_realizacao: null }),
      // Outro mês: fica de fora.
      lancamento({ valor: 999, data_vencimento: "2026-11-05", data_realizacao: "2026-11-05" }),
      lancamento({ valor: 999, status: "pendente", data_vencimento: "2026-09-30", data_realizacao: null }),
    ], [], "2026-10");
    expect(totais.get(1)).toEqual({ receitaRealizada: 0, receitaAgendada: 0, despesaRealizada: 140, despesaAgendada: 60 });
  });

  it("deixa de fora transferências, objetivos e o pagamento da fatura", () => {
    const totais = totaisDasCategoriasNoMes([
      lancamento({ valor: 10 }),
      lancamento({ valor: 300, descricao: "[Transf.] Reserva [Destino:2]" }),
      lancamento({ valor: 250, descricao: "[Transf.] Aporte · Guardar em: Viagem [Objetivo:1:guardar]" }),
      lancamento({ valor: 500, descricao: "Fatura Nubank [PagFatura:3:2026-10:total]" }),
    ], [], "2026-10");
    expect(totais.get(1)?.despesaRealizada).toBe(10);
  });

  it("conta cada compra do cartão no mês da fatura, sem os ajustes de pagamento parcial", () => {
    const itens: ItemCartaoParaAlvo[] = [
      { valor: 120, mes_fatura: "2026-10", categoria_id: 1, descricao: "Tênis (2/3)" },
      { valor: 120, mes_fatura: "2026-11", categoria_id: 1, descricao: "Tênis (3/3)" },
      { valor: 50, mes_fatura: "2026-10", categoria_id: 1, descricao: "Pagamento parcial da fatura" },
      { valor: 70, mes_fatura: "2026-10", categoria_id: 1, descricao: "Saldo da fatura anterior (2026-09)" },
      { valor: 80, mes_fatura: "2026-10", categoria_id: null, descricao: "Sem categoria" },
    ];
    expect(totaisDasCategoriasNoMes([], itens, "2026-10").get(1)?.despesaRealizada).toBe(120);
  });

  it("receitas contam para a meta e despesas para o limite", () => {
    const progresso = progressoDasCategorias(
      [
        { id: 1, tipo: "despesa", limite_mensal: 800, meta_mensal: 999 },
        { id: 2, tipo: "receita", meta_mensal: "5000", limite_mensal: 1 },
        { id: 3, tipo: "ambos", meta_mensal: 100, limite_mensal: 50 },
        { id: 4, tipo: "despesa", limite_mensal: null },
      ],
      [
        lancamento({ categoria_id: 1, valor: 600 }),
        lancamento({ categoria_id: 2, tipo: "receita", valor: 3000 }),
        lancamento({ categoria_id: 2, tipo: "receita", valor: 1000, status: "pendente", data_realizacao: null }),
        lancamento({ categoria_id: 3, tipo: "receita", valor: 30 }),
        lancamento({ categoria_id: 3, valor: 60 }),
      ],
      [],
      "2026-10",
    );
    // Despesa ignora meta; receita ignora limite; "ambos" pode ter os dois.
    expect(progresso.get(1)?.meta).toBeUndefined();
    expect(progresso.get(1)?.limite).toMatchObject({ alvo: 800, realizado: 600, agendado: 0, situacao: "ok" });
    expect(progresso.get(2)?.limite).toBeUndefined();
    expect(progresso.get(2)?.meta).toMatchObject({ alvo: 5000, realizado: 3000, agendado: 1000, situacao: "andamento", restante: 2000 });
    expect(progresso.get(3)?.meta).toMatchObject({ realizado: 30 });
    expect(progresso.get(3)?.limite).toMatchObject({ realizado: 60, situacao: "estourado", restante: -10 });
    expect(progresso.has(4)).toBe(false);
  });
});

describe("metas e limites por categoria: situação e barra", () => {
  it("limite: ok abaixo de 80%, alerta até 100% e estourado acima", () => {
    expect(progressoDoAlvo("limite", 100, 79.99, 0).situacao).toBe("ok");
    expect(progressoDoAlvo("limite", 100, 80, 0).situacao).toBe("alerta");
    expect(progressoDoAlvo("limite", 100, 100, 0).situacao).toBe("alerta");
    expect(progressoDoAlvo("limite", 100, 100.01, 0).situacao).toBe("estourado");
  });

  it("meta: atingida a partir de 100%", () => {
    expect(progressoDoAlvo("meta", 1000, 999, 500).situacao).toBe("andamento");
    expect(progressoDoAlvo("meta", 1000, 1000, 0).situacao).toBe("atingida");
  });

  it("a barra nunca passa de 100% e mostra o agendado à parte", () => {
    expect(largurasDaBarra(progressoDoAlvo("limite", 800, 400, 200))).toEqual({ realizado: 50, agendado: 25 });
    expect(largurasDaBarra(progressoDoAlvo("limite", 800, 700, 400))).toEqual({ realizado: 87.5, agendado: 12.5 });
    expect(largurasDaBarra(progressoDoAlvo("limite", 100, 150, 10))).toEqual({ realizado: 100, agendado: 0 });
  });

  it("valor vazio, zero ou inválido é sem meta", () => {
    expect(valorDoAlvo(null)).toBeNull();
    expect(valorDoAlvo("")).toBeNull();
    expect(valorDoAlvo(0)).toBeNull();
    expect(valorDoAlvo(-5)).toBeNull();
    expect(valorDoAlvo("abc")).toBeNull();
    expect(valorDoAlvo("800.505")).toBe(800.51);
  });
});

describe("telas do site", () => {
  it("Categorias: campo de meta/limite ao criar e editar, e a barra do mês", () => {
    const tela = ler("web/src/app/(dashboard)/categorias/category-manager.tsx");
    expect(tela).toMatch(/<TargetField key=\{type\} field=\{type === "receita" \? "monthly_goal" : "monthly_limit"\} name="monthly_target"/);
    expect(tela).toMatch(/name="original_monthly_goal"/);
    expect(tela).toMatch(/name="original_monthly_limit"/);
    expect(tela).toMatch(/progress=\{type === "receita" \? progress\[category\.id\]\?\.meta : progress\[category\.id\]\?\.limite\}/);
    const acoes = ler("web/src/app/(dashboard)/categorias/actions.ts");
    expect(acoes).toMatch(/payload\[targetField\] = target;/);
    expect(acoes).toMatch(/buildTargetChange\(/);
    const pagina = ler("web/src/app/(dashboard)/categorias/page.tsx");
    expect(pagina).toMatch(/progressoDasCategorias\(/);
    expect(pagina).toMatch(/\.eq\("mes_fatura", mes\)/);
  });

  it("Novo lançamento: duas colunas em tela grande e Parcelas ao lado do modo do valor", () => {
    const formulario = ler("web/src/app/(dashboard)/transacoes/transaction-manager.tsx");
    expect(formulario).toMatch(/<Modal title="Novo lançamento" [^>]*wide="extra">/);
    expect(formulario).toMatch(/<form onSubmit=\{submit\} className="grid gap-4 lg:grid-cols-2 lg:gap-x-7">/);
    expect(formulario).toMatch(/grid-cols-\[minmax\(6\.5rem,8rem\)_minmax\(0,1fr\)\][^"]*">\s*<Field label="Parcelas">/);
    expect(formulario).toMatch(/wide === "extra" \? "sm:max-w-3xl lg:max-w-5xl"/);
  });

  it("Histórico: o mês abre a escolha de mês e ano", () => {
    const historico = ler("web/src/app/(dashboard)/transacoes/transaction-manager.tsx");
    expect(historico).toMatch(/<MonthPicker month=\{month\} currentMonth=\{today\.slice\(0, 7\)\} label=\{monthTitle\(month\)\} onChange=\{chooseMonth\} \/>/);
    const seletor = ler("web/src/app/(dashboard)/transacoes/month-picker.tsx");
    expect(seletor).toMatch(/role="dialog"\s+aria-label="Escolher mês e ano"/);
    expect(seletor).toMatch(/Voltar para o mês atual/);
  });

  it("Início: atrasados em colunas de receitas, despesas e transferências", () => {
    const inicio = ler("web/src/app/(dashboard)/home-dashboard.tsx");
    expect(inicio).toMatch(/\{ kind: "receita", label: "Receitas"/);
    expect(inicio).toMatch(/\{ kind: "despesa", label: "Despesas"/);
    expect(inicio).toMatch(/\{ kind: "transferencia", label: "Transferências"/);
    expect(inicio).toMatch(/<div className="grid gap-5 md:grid-cols-3 md:gap-4">\{overdueColumns\.map/);
    // Cada coluna mantém a ordem de vencimento da lista de atrasados.
    expect(inicio).toMatch(/\.sort\(\(a, b\) => a\.data_vencimento\.localeCompare\(b\.data_vencimento\) \|\| a\.id - b\.id\)/);
  });
});
