import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mensagemTetoSeguranca, traduzirErro } from "../error-messages";

// Tetos de segurança por usuário (auditoria V08): o banco recusa com
// FINFLOW_TETO_SEGURANCA:<recurso>:<diario|total>:<teto>.
describe("teto de segurança por usuário", () => {
  it("explica o teto diário com o número formatado e o contato do suporte", () => {
    const mensagem = mensagemTetoSeguranca("FINFLOW_TETO_SEGURANCA:lancamentos:diario:5000");
    expect(mensagem).toContain("limite de segurança de 5.000 lançamentos por dia");
    expect(mensagem).toContain("Tente de novo amanhã");
    expect(mensagem).toContain("Finflowfinancas@gmail.com");
  });

  it("explica o teto total incluindo itens arquivados", () => {
    const mensagem = mensagemTetoSeguranca({ message: "FINFLOW_TETO_SEGURANCA:contas:total:100" });
    expect(mensagem).toContain("limite de segurança de 100 contas.");
    expect(mensagem).toContain("inclui os itens arquivados");
  });

  it("aceita o código em maiúsculas vindo da fila e recurso desconhecido", () => {
    expect(mensagemTetoSeguranca("FINFLOW_TETO_SEGURANCA:CONVITES_PARCERIA:DIARIO:10")).toContain("10 convites de conta conjunta por dia");
    expect(mensagemTetoSeguranca("FINFLOW_TETO_SEGURANCA:novo_recurso:total:7")).toContain("7 itens");
  });

  it("ignora erros que não são do teto", () => {
    expect(mensagemTetoSeguranca("plan limit reached")).toBeNull();
    expect(mensagemTetoSeguranca({ message: "P0001" })).toBeNull();
    expect(mensagemTetoSeguranca(null)).toBeNull();
  });

  it("traduzirErro usa a mensagem do teto em vez da genérica", () => {
    expect(traduzirErro("FINFLOW_TETO_SEGURANCA:compras_cartao:diario:3000")).toContain("3.000 compras no cartão por dia");
  });

  it("usa os mesmos recursos que a migration grava", () => {
    const migration = readFileSync(
      join(process.cwd(), "..", "supabase", "migrations", "20260930121216_endurece_banco_etapa7.sql"),
      "utf8",
    );
    const recursos = [...migration.matchAll(/aplicar_teto_antiabuso\('([a-z_]+)'/g)].map((m) => m[1]);
    expect(recursos).toHaveLength(9);
    for (const recurso of recursos) {
      expect(mensagemTetoSeguranca(`FINFLOW_TETO_SEGURANCA:${recurso}:total:1`)).not.toContain(" itens.");
    }
  });
});
