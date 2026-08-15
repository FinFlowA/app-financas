/** Portado de lib/transacoes.ts (app mobile) — mesma regra para não contar
 * transferências entre contas próprias nem movimentos de objetivo como
 * receita/despesa real nos relatórios. */
export function isTransferencia(descricao?: string | null): boolean {
  return (descricao ?? "").includes("[Transf.]");
}

const OBJETIVO_TRANSFERENCIA_REGEX = /\[Objetivo:(\d+):(guardar|resgatar)\]/;
const MARCADORES_OBJETIVO = ["[Objetivo:", "Guardar em:", "Resgate de:"] as const;

export function isMovimentoObjetivo(descricao?: string | null): boolean {
  const texto = descricao ?? "";
  if (!MARCADORES_OBJETIVO.some((marcador) => texto.includes(marcador))) return false;
  if (OBJETIVO_TRANSFERENCIA_REGEX.test(texto)) return true;
  return /^\[Transf\.\]\s*(Guardar em|Resgate de):/.test(texto) || /^(Guardar em|Resgate de):/.test(texto);
}
