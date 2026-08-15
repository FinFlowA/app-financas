export type InvoicePresentationStatus = "open" | "closed" | "zero" | "paid";

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** Retorna a data local de São Paulo sem depender do fuso do dispositivo. */
export function todayInSaoPaulo(now = new Date()): string {
  const values = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

/** Mantém o fechamento dentro do mês para cartões configurados nos dias 29, 30 ou 31. */
export function invoiceClosingDate(invoiceMonth: string, requestedDay: number): string | null {
  const match = MONTH_PATTERN.exec(invoiceMonth);
  if (!match || !Number.isInteger(requestedDay) || requestedDay < 1 || requestedDay > 31) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return `${invoiceMonth}-${twoDigits(Math.min(requestedDay, lastDay))}`;
}

/**
 * A fatura fecha ao terminar o dia de fechamento em São Paulo. Esta é a
 * mesma fronteira usada pelas RPCs financeiras: compras feitas no próprio dia
 * ainda pertencem à fatura; a partir do dia seguinte ela está fechada.
 */
export function invoiceIsClosed(
  invoiceMonth: string,
  closingDay: number,
  today = todayInSaoPaulo(),
): boolean {
  const closingDate = invoiceClosingDate(invoiceMonth, closingDay);
  if (!closingDate || !DATE_PATTERN.test(today)) return false;
  return today > closingDate;
}

export function invoicePresentationStatus({
  invoiceMonth,
  closingDay,
  itemCount,
  openTotal,
  allItemsPaid,
  today = todayInSaoPaulo(),
}: {
  invoiceMonth: string;
  closingDay: number;
  itemCount: number;
  openTotal: number;
  allItemsPaid: boolean;
  today?: string;
}): InvoicePresentationStatus {
  const settled = Math.abs(openTotal) <= 0.005;
  if (!settled) return invoiceIsClosed(invoiceMonth, closingDay, today) ? "closed" : "open";
  if ((itemCount > 0 && allItemsPaid) || invoiceIsClosed(invoiceMonth, closingDay, today)) return "paid";
  return "zero";
}
