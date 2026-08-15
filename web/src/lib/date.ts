const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

function parts(date: Date) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    values.find((part) => part.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function hojeEmSaoPaulo(date = new Date()): string {
  const { year, month, day } = parts(date);
  return `${year}-${month}-${day}`;
}

export function mesAtualEmSaoPaulo(date = new Date()): string {
  const { year, month } = parts(date);
  return `${year}-${month}`;
}

export function anoAtualEmSaoPaulo(date = new Date()): number {
  return Number(parts(date).year);
}

export function adicionarDiasISO(iso: string, quantidade: number): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + quantidade, 12));
  return data.toISOString().slice(0, 10);
}

export function compararISO(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "");
}

export { SAO_PAULO_TIME_ZONE };
