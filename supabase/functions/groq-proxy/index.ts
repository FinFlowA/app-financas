import { handleOptions, json } from "../_shared/http.ts";

// Endpoint legado desativado. A versão antiga aceitava prompt de sistema e
// contexto enviados pelo cliente, o que não é uma fronteira segura para ações
// financeiras. Toda integração deve usar `finance-ai`.
Deno.serve((req) => {
  const options = handleOptions(req);
  if (options) return options;
  return json({
    error: "ENDPOINT_RETIRED",
    message: "Atualize o FinFlow para usar a nova IA financeira segura.",
  }, 410, req);
});
