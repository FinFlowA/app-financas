/**
 * Calculadora flutuante do site: estado simples de calculadora de mesa
 * (número no visor, valor guardado e operação pendente), sem avaliar texto.
 */
export type Operacao = "+" | "-" | "×" | "÷";
export type EstadoCalculadora = {
  visor: string;
  guardado: number | null;
  operacao: Operacao | null;
  /** O próximo dígito começa um número novo (depois de operação ou "="). */
  novoNumero: boolean;
};

export const CALCULADORA_INICIAL: EstadoCalculadora = { visor: "0", guardado: null, operacao: null, novoNumero: false };

const paraNumero = (visor: string) => Number(visor.replace(/\./g, "").replace(",", "."));
export function formatarVisor(valor: number): string {
  if (!Number.isFinite(valor)) return "Erro";
  const arredondado = Math.round(valor * 1e10) / 1e10;
  return arredondado.toLocaleString("pt-BR", { maximumFractionDigits: 10 });
}

function aplicar(a: number, b: number, operacao: Operacao): number {
  if (operacao === "+") return a + b;
  if (operacao === "-") return a - b;
  if (operacao === "×") return a * b;
  return b === 0 ? Number.NaN : a / b;
}

export function digitar(estado: EstadoCalculadora, digito: string): EstadoCalculadora {
  if (estado.visor === "Erro" || estado.novoNumero) {
    return { ...estado, visor: digito === "," ? "0," : digito, novoNumero: false };
  }
  if (digito === ",") return estado.visor.includes(",") ? estado : { ...estado, visor: `${estado.visor},` };
  const semPontos = estado.visor.replace(/\./g, "");
  if (semPontos.replace(/[-,]/g, "").length >= 15) return estado;
  const bruto = semPontos === "0" ? digito : semPontos + digito;
  if (bruto.includes(",")) {
    const [inteiro, decimal] = bruto.split(",");
    return { ...estado, visor: `${formatarVisor(Number(inteiro))},${decimal}` };
  }
  return { ...estado, visor: formatarVisor(Number(bruto)) };
}

export function operar(estado: EstadoCalculadora, operacao: Operacao): EstadoCalculadora {
  if (estado.visor === "Erro") return estado;
  const atual = paraNumero(estado.visor);
  // Trocar a operação antes de digitar o segundo número só substitui a operação.
  if (estado.operacao && estado.novoNumero) return { ...estado, operacao };
  const resultado = estado.guardado !== null && estado.operacao ? aplicar(estado.guardado, atual, estado.operacao) : atual;
  return { visor: formatarVisor(resultado), guardado: Number.isFinite(resultado) ? resultado : null, operacao: Number.isFinite(resultado) ? operacao : null, novoNumero: true };
}

export function igual(estado: EstadoCalculadora): EstadoCalculadora {
  if (estado.guardado === null || !estado.operacao || estado.visor === "Erro") return { ...estado, novoNumero: true };
  const resultado = aplicar(estado.guardado, paraNumero(estado.visor), estado.operacao);
  return { visor: formatarVisor(resultado), guardado: null, operacao: null, novoNumero: true };
}

/** "%": com operação pendente, vira a porcentagem do valor guardado (100 + 10% = 110). */
export function porcento(estado: EstadoCalculadora): EstadoCalculadora {
  if (estado.visor === "Erro") return estado;
  const atual = paraNumero(estado.visor);
  const valor = estado.guardado !== null && (estado.operacao === "+" || estado.operacao === "-") ? (estado.guardado * atual) / 100 : atual / 100;
  return { ...estado, visor: formatarVisor(valor), novoNumero: false };
}

export function apagar(estado: EstadoCalculadora): EstadoCalculadora {
  if (estado.novoNumero || estado.visor === "Erro") return estado;
  const semPontos = estado.visor.replace(/\./g, "");
  const curto = semPontos.slice(0, -1);
  if (!curto || curto === "-") return { ...estado, visor: "0" };
  if (curto.endsWith(",") || curto.includes(",")) {
    const [inteiro, decimal] = curto.split(",");
    return { ...estado, visor: `${formatarVisor(Number(inteiro))},${decimal}` };
  }
  return { ...estado, visor: formatarVisor(Number(curto)) };
}

export function inverterSinal(estado: EstadoCalculadora): EstadoCalculadora {
  if (estado.visor === "0" || estado.visor === "Erro") return estado;
  return { ...estado, visor: estado.visor.startsWith("-") ? estado.visor.slice(1) : `-${estado.visor}` };
}
