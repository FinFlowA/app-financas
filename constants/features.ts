/**
 * Trava exclusivamente visual da IA.
 *
 * Em desenvolvimento (limites globais desligados), a tela fica visível para
 * permitir o beta controlado pelo servidor. Em produção, somente planos com IA
 * exibem o acesso. A Edge Function continua sendo a autoridade final.
 */
export function usuarioPodeAcessarIA(
  planoPossuiIA = false,
  limitsEnabled = false,
): boolean {
  return planoPossuiIA || !limitsEnabled;
}
