/** Parte da cota de consultas ao Finn que ainda resta no dia. */
export type CotaConsultas = {
  restantes: number;
  limite: number;
  /** De 0 (esgotada) a 1 (cheia). */
  fracao: number;
  nivel: "folgada" | "atencao" | "critica";
};

/**
 * Lê a cota de consultas (model_remaining/model_limit) devolvida pelo
 * servidor. Retorna null quando o limite não existe ou não é válido, e aí o
 * círculo não aparece.
 */
export function lerCotaConsultas(quota: { model_limit?: unknown; model_remaining?: unknown } | null | undefined): CotaConsultas | null {
  if (!quota) return null;
  const limite = Number(quota.model_limit);
  const restantesBrutos = Number(quota.model_remaining);
  if (!Number.isFinite(limite) || limite <= 0 || !Number.isFinite(restantesBrutos)) return null;
  const restantes = Math.min(limite, Math.max(0, Math.floor(restantesBrutos)));
  const fracao = restantes / limite;
  return {
    restantes,
    limite,
    fracao,
    nivel: fracao > 0.5 ? "folgada" : fracao > 0.2 ? "atencao" : "critica",
  };
}

/**
 * Rotação (em graus) das duas metades do anel desenhado com Views: cada metade
 * é um arco de 180° que gira dentro de um recorte. Começa no topo e cresce no
 * sentido horário.
 */
export function rotacoesAnel(fracao: number): { direita: number; esquerda: number | null } {
  const f = Math.min(1, Math.max(0, fracao));
  return {
    direita: -135 + 360 * Math.min(f, 0.5),
    esquerda: f > 0.5 ? 45 + 360 * (f - 0.5) : null,
  };
}
