export const LEGAL_DOCUMENT_VERSION = "2026-07-30";

export type PendenciaCadastro = "data_nascimento" | "termos";

export function listarPendenciasCadastro(
  metadata: Record<string, unknown> | null | undefined,
): PendenciaCadastro[] {
  const pendencias: PendenciaCadastro[] = [];

  if (typeof metadata?.data_nascimento !== "string" || !metadata.data_nascimento) {
    pendencias.push("data_nascimento");
  }

  if (
    typeof metadata?.termos_aceitos_em !== "string" ||
    metadata?.termos_versao !== LEGAL_DOCUMENT_VERSION
  ) {
    pendencias.push("termos");
  }

  return pendencias;
}

export function formatarDataNascimento(valor: string): string {
  const numeros = valor.replace(/\D/g, "").slice(0, 8);
  if (numeros.length <= 2) return numeros;
  if (numeros.length <= 4) return `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
  return `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4)}`;
}

export function dataNascimentoParaISO(valor: string): string | null {
  const [diaTexto, mesTexto, anoTexto] = valor.split("/");
  const dia = Number(diaTexto);
  const mes = Number(mesTexto);
  const ano = Number(anoTexto);
  if (!dia || !mes || !ano || anoTexto?.length !== 4) return null;

  const data = new Date(ano, mes - 1, dia);
  if (
    data.getFullYear() !== ano ||
    data.getMonth() !== mes - 1 ||
    data.getDate() !== dia
  ) return null;

  return `${anoTexto}-${mesTexto.padStart(2, "0")}-${diaTexto.padStart(2, "0")}`;
}

export function idadeEmAnos(dataISO: string, hoje = new Date()): number | null {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  if (!ano || !mes || !dia) return null;

  const nascimento = new Date(ano, mes - 1, dia);
  if (
    nascimento.getFullYear() !== ano ||
    nascimento.getMonth() !== mes - 1 ||
    nascimento.getDate() !== dia ||
    nascimento > hoje
  ) return null;

  let idade = hoje.getFullYear() - ano;
  const aindaNaoFezAniversario =
    hoje.getMonth() < mes - 1 ||
    (hoje.getMonth() === mes - 1 && hoje.getDate() < dia);
  if (aindaNaoFezAniversario) idade -= 1;
  return idade;
}
