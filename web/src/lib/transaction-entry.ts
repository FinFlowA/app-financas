export type HomeTransactionKind = "receita" | "despesa" | "transferencia";

/**
 * Mantém a origem do atalho explícita sem aceitar uma URL de retorno livre.
 * Assim, o fluxo pode voltar à Home sem criar uma possibilidade de redirecionamento externo.
 */
export function homeTransactionCreationHref(kind: HomeTransactionKind): string {
  const parameters = new URLSearchParams({ new: "1", kind, source: "home" });
  return `/transacoes?${parameters.toString()}`;
}

export function shouldReturnHomeAfterCreation(source: string): boolean {
  return source === "home";
}
