// Tela do Finn no site: apresentação com as mesmas sugestões do app e a ajuda
// aberta pelo cabeçalho (o botão flutuante cobriria o campo de mensagem).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("tela do Finn no site", () => {
  const tela = readFileSync(join(raiz, "web/src/app/(dashboard)/assistente/assistant-chat.tsx"), "utf8");

  it("a conversa nova mostra a apresentação com as sugestões do app", () => {
    const app = readFileSync(join(raiz, "app/chat-ia.tsx"), "utf8");
    for (const sugestao of ["Qual é meu saldo atual?", "Registrar uma despesa", "Quais despesas tenho neste mês?", "Criar um objetivo"]) {
      expect(tela).toContain(`text: "${sugestao}"`);
      expect(app).toContain(`text: "${sugestao}"`);
    }
    expect(tela).toMatch(/messages\.length <= 1 && messages\[0\]\?\.id === "welcome"/);
    // A cota de consultas usa a mesma leitura do app e fica num anel à esquerda do campo de mensagem.
    expect(tela).toContain("lerCotaConsultas(quota)");
    const campo = tela.slice(tela.indexOf("className={styles.composerRow}"));
    expect(campo.indexOf("className={styles.quotaWrap}")).toBeGreaterThan(-1);
    expect(campo.indexOf("className={styles.quotaWrap}")).toBeLessThan(campo.indexOf("<textarea"));
    expect(tela).toContain("consultas ao Finn restantes hoje");
  });

  it("apagar o histórico mostra o erro dentro da janela e não repete o cancelamento", () => {
    expect(tela).toMatch(/\{clearError && <p role="alert" className=\{styles\.clearError\}>\{clearError\}<\/p>\}/);
    const inicio = tela.indexOf("async function clearHistory()");
    const limpar = tela.slice(inicio, tela.indexOf("\n  }\n", inicio));
    // A proposta cancelada sai da tela antes da limpeza, para uma nova tentativa não cancelar de novo.
    expect(limpar.indexOf("persistPendingAction(null)")).toBeLessThan(limpar.indexOf('mode: "clear"'));
    expect(limpar).toContain("setClearError(");
  });

  it("a ajuda abre pelo botão do cabeçalho, sem o botão flutuante nesta tela", () => {
    expect(tela).toContain("window.dispatchEvent(new Event(ABRIR_AJUDA_EVENTO))");
    const ajuda = readFileSync(join(raiz, "web/src/components/layout/contextual-help.tsx"), "utf8");
    expect(ajuda).toMatch(/ROTAS_COM_BOTAO_PROPRIO = \["\/assistente"\]/);
    expect(ajuda).toContain("window.addEventListener(ABRIR_AJUDA_EVENTO, abrir)");
  });
});
