function normalizeGuidanceText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function finnProductGuidance(message: string, recentContext = ""): string | null {
  const normalized = normalizeGuidanceText(message);
  const contextualized = `${normalized} ${normalizeGuidanceText(recentContext)}`;
  const asksForInstructions = /\b(como|onde|ensine|explique|quero saber|qual (?:e|seria) a forma)\b/.test(normalized)
    && /\b(crio|criar|cadastro|cadastrar|adiciono|adicionar|abro|abrir|faco|fazer|lanco|lancar|registro|registrar)\b/.test(normalized);
  if (!asksForInstructions) return null;

  const hasCurrentResource = /\b(conta|categoria|objetivo|meta|caixinha|cartao|receita|despesa|lancamento)\b/.test(normalized);
  const resourceText = hasCurrentResource ? normalized : contextualized;

  if (/\b(receita|despesa|lancamento)\b/.test(resourceText)) {
    return "Para registrar uma receita ou despesa no site, abra Histórico e selecione Novo lançamento. Escolha o tipo, preencha descrição, valor, conta, categoria e data, revise e salve. Se quiser que eu prepare o lançamento, diga diretamente o que aconteceu, por exemplo: \"Recebi 200 reais de um serviço hoje\".";
  }
  if (/\bconta\b/.test(resourceText)) {
    return "Para criar uma conta no site, abra Contas no menu lateral e selecione Nova conta. Informe o nome, o saldo inicial e a cor; depois revise os dados e salve. Se preferir que eu prepare a criação, diga explicitamente: \"Crie uma conta\".";
  }
  if (/\bcategoria\b/.test(resourceText)) {
    return "Para criar uma categoria no site, abra Categorias e selecione Nova categoria. Escolha se ela é de receita ou despesa, informe nome, cor e ícone e salve.";
  }
  if (/\b(objetivo|meta|caixinha)\b/.test(resourceText)) {
    return "Para criar um objetivo no site, abra Objetivos e selecione Novo objetivo. Informe o nome e o valor da meta; a data é opcional.";
  }
  if (/\bcartao\b/.test(resourceText)) {
    return "Para cadastrar um cartão no site, abra Cartões e selecione Novo cartão. Informe nome, limite, fechamento e vencimento, revise e salve.";
  }
  return null;
}
