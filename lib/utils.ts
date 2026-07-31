/** Formata um valor monetário em reais com separador de milhar e vírgula decimal.
 *  Ex: 1500.5 → "R$ 1.500,50" | 50000 → "R$ 50.000,00"
 */
export const fmtReais = (valor: number): string => {
  return `R$ ${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

/** Igual ao fmtReais mas omite os centavos quando o valor é inteiro.
 *  Ex: 50000 → "R$ 50.000" | 1500.5 → "R$ 1.500,50"
 */
export const fmtReaisSemCentavo = (valor: number): string => {
  const cents = Math.round((valor % 1) * 100);
  if (cents === 0) {
    return `R$ ${Math.floor(valor).toLocaleString("pt-BR")}`;
  }
  return `R$ ${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

/** Formata a digitação como centavos: 1 -> 0,01; 123456 -> 1.234,56. */
export const formatarEntradaMoeda = (texto: string): string => {
  const digitos = texto.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const centavos = Number(digitos || "0");
  return (centavos / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const valorDaEntradaMoeda = (texto: string): number => {
  const normalizado = texto.replace(/\./g, "").replace(",", ".");
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : 0;
};
