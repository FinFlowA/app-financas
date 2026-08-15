import { mesAtualEmSaoPaulo } from "@/lib/date";

export function adicionarMeses(mes: string, quantidade: number): string {
  const [ano, numeroMes] = mes.split("-").map(Number);
  const data = new Date(Date.UTC(ano, numeroMes - 1 + quantidade, 1, 12));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatarMesAno(mes: string): string {
  const [ano, numeroMes] = mes.split("-").map(Number);
  const nome = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(ano, numeroMes - 1, 1, 12)));
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} ${ano}`;
}

export function dataVencimento(mes: string, dia: number): string {
  const [ano, numeroMes] = mes.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, numeroMes, 0, 12)).getUTCDate();
  return `${ano}-${String(numeroMes).padStart(2, "0")}-${String(Math.min(dia, ultimoDia)).padStart(2, "0")}`;
}

export function faturaEstaFechada(mes: string, diaFechamento: number, hoje = new Date()): boolean {
  const atual = mesAtualEmSaoPaulo(hoje);
  if (mes < atual) return true;
  if (mes > atual) return false;
  const diaAtual = Number(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", day: "2-digit",
  }).format(hoje));
  return diaAtual > diaFechamento;
}

export function mesDaCompra(dataCompra: string, diaFechamento: number): string {
  const [ano, mes, dia] = dataCompra.split("-").map(Number);
  const base = `${ano}-${String(mes).padStart(2, "0")}`;
  return dia > diaFechamento ? adicionarMeses(base, 1) : base;
}
