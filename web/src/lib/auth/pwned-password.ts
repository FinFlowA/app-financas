import "server-only";

import { createHash } from "node:crypto";

/**
 * Verificação de senha vazada no HaveIBeenPwned (modelo k-anonymity), feita
 * no servidor antes de cadastrar, definir ou redefinir senha.
 *
 * Substitui a "Leaked password protection" da Supabase, que só existe no
 * plano Pro. Só os 5 primeiros caracteres do SHA-1 saem do servidor e a
 * comparação é local. Se a API estiver indisponível o resultado é "unknown"
 * e o fluxo segue: falha de terceiro não pode bloquear cadastro ou troca.
 */

export const PWNED_PASSWORD_MESSAGE =
  "Esta senha já apareceu em vazamentos de dados públicos e pode ser descoberta por invasores. Escolha outra senha.";

export type PwnedPasswordStatus = "safe" | "pwned" | "unknown";

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 4000;

export async function checkPwnedPassword(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PwnedPasswordStatus> {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    // Add-Padding faz a resposta ter tamanho parecido para qualquer prefixo;
    // as linhas de preenchimento vêm com contagem 0.
    const response = await fetchImpl(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return "unknown";
    const body = await response.text();
    for (const line of body.split("\n")) {
      const [candidate, count] = line.trim().split(":");
      if (candidate === suffix && Number(count) > 0) return "pwned";
    }
    return "safe";
  } catch {
    return "unknown";
  }
}

export async function isPwnedPassword(password: string): Promise<boolean> {
  return (await checkPwnedPassword(password)) === "pwned";
}
