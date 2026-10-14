/**
 * Saudação pela hora do aparelho: a mesma no Início e na apresentação do Finn.
 */
export function saudacaoPorHora(agora: Date = new Date()): "Bom dia" | "Boa tarde" | "Boa noite" {
  const hora = agora.getHours();
  if (hora >= 5 && hora < 12) return "Bom dia";
  if (hora >= 12 && hora < 18) return "Boa tarde";
  return "Boa noite";
}
