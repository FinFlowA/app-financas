import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- só caminhos fixos deste teste
const ler = (arquivo: string) => readFileSync(join(raiz, arquivo), "utf8");

describe("periodicidade das parcelas", () => {
  it("a ação do servidor envia a periodicidade das parcelas, sem repetição diária", () => {
    const acoes = ler("web/src/app/(dashboard)/transacoes/actions.ts");
    expect(acoes).toMatch(/const FREQUENCIES = \["unica", "parcelada", "semanal", "mensal", "anual"\]/);
    expect(acoes).toMatch(/const INSTALLMENT_FREQUENCIES = \["semanal", "mensal", "anual"\]/);
    expect(acoes).toMatch(/if \(installmentFrequency !== "mensal"\) payload\.installment_frequency = installmentFrequency;/);
    expect(acoes).not.toMatch(/diaria/);
  });

  it("o formulário do site separa Repetição e Periodicidade, como o app", () => {
    const formulario = ler("web/src/app/(dashboard)/transacoes/transaction-manager.tsx");
    expect(formulario).toMatch(/<legend className="mb-2 text-sm font-bold">Repetição<\/legend>/);
    expect(formulario).toMatch(/<legend className="mb-2 text-sm font-bold">Periodicidade<\/legend>/);
    expect(formulario).toMatch(/\(\["semanal", "mensal", "anual"\] as const\)/);
    expect(formulario).not.toMatch(/diaria/);
    expect(formulario).toMatch(/name="installment_frequency" value=\{repetition === "parcelada" \? period : "mensal"\}/);
    expect(formulario).not.toMatch(/label: "Fixa semanal"/);
  });
});

describe("Visão do mês com o que já aconteceu", () => {
  it("site: Entradas e Saídas são o realizado (Entradas − Saídas = Balanço)", () => {
    const inicio = ler("web/src/app/(dashboard)/home-dashboard.tsx");
    expect(inicio).toMatch(/<SummaryValue label="Entradas" value=\{calculations\.realizedIncome\}/);
    expect(inicio).toMatch(/<SummaryValue label="Saídas" value=\{calculations\.realizedExpense\}/);
    expect(inicio).toMatch(/realizedExpense: realizedExpense \+ cardMonth/);
    expect(inicio).toMatch(/monthBalance: monthSummary\.balancoRealizado - cardMonth/);
  });

  it("app: Entradas e Saídas são o realizado, com o cartão do mês nas Saídas", () => {
    const inicio = ler("app/(tabs)/index.tsx");
    expect(inicio).toMatch(/>Entradas<\/Text><Text[^>]*>\{formatarValorPrivado\(entradasRealizadasDoMes\)\}/);
    expect(inicio).toMatch(/>Saídas<\/Text><Text[^>]*>\{formatarValorPrivado\(saidasRealizadasDoMes \+ cartaoDoMes\)\}/);
    expect(inicio).toMatch(/balancoMensal: entradasRealizadasMes - saidasRealizadasMes - cartaoMes/);
  });
});
