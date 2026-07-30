/**
 * Acesso temporário a funcionalidades em desenvolvimento.
 *
 * A lista é somente uma trava de interface, não uma regra de segurança.
 * Para liberar outro testador, adicione o e-mail normalizado abaixo.
 */
const IA_BETA_EMAILS = new Set([
  "henrique0limah@gmail.com",
]);

const IA_BETA_ATIVA = false;

export function usuarioPodeAcessarIA(email?: string | null): boolean {
  return IA_BETA_ATIVA && IA_BETA_EMAILS.has((email ?? "").trim().toLowerCase());
}
