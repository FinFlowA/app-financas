import { describe, expect, it } from "vitest";
import { parseBankStatement, parseStatementDate, parseStatementMoney } from "../bank-statement";

describe("bank statement parser", () => {
  it("interpreta moeda brasileira e americana", () => {
    expect(parseStatementMoney("R$ 1.234,56")).toBe(1234.56);
    expect(parseStatementMoney("-82,20")).toBe(-82.2);
    expect(parseStatementMoney("1,234.56")).toBe(1234.56);
  });

  it("valida datas sem inverter dia e mês", () => {
    expect(parseStatementDate("29/08/2026")).toBe("2026-08-29");
    expect(parseStatementDate("2026-08-30")).toBe("2026-08-30");
    expect(parseStatementDate("31/02/2026")).toBeNull();
  });

  it("lê CSV com crédito e débito separados", () => {
    const result = parseBankStatement("agosto.csv", "Data;Descrição;Crédito;Débito;Documento\n29/08/2026;Salário;50,00;;abc\n30/08/2026;Mercado;;20,40;def");
    expect(result).toMatchObject([
      { date: "2026-08-29", description: "Salário", amount: 50, type: "receita", sourceId: "abc" },
      { date: "2026-08-30", description: "Mercado", amount: 20.4, type: "despesa", sourceId: "def" },
    ]);
  });

  it("lê OFX e preserva FITID", () => {
    const result = parseBankStatement("conta.ofx", `<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260829120000<TRNAMT>-35.90<FITID>x-1<MEMO>Padaria</STMTTRN></BANKTRANLIST></OFX>`);
    expect(result[0]).toMatchObject({ date: "2026-08-29", amount: 35.9, type: "despesa", sourceId: "x-1" });
  });
});
