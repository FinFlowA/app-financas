// Gera os arquivos do relatório no navegador: nada sai do aparelho além do
// download. As bibliotecas (jsPDF e write-excel-file) só carregam ao clicar em
// gerar, para não pesar as outras páginas.
import { dataBr, type CelulaRelatorio, type TabelaRelatorio, type TipoColuna } from "./relatorio";

export type CabecalhoRelatorio = { periodo: string; contas: string; geradoEm: string };

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Valor da célula como texto (PDF). */
export function textoDaCelula(valor: CelulaRelatorio, tipo: TipoColuna): string {
  if (valor === null || valor === "") return "";
  if (tipo === "data") return dataBr(String(valor));
  if (tipo === "moeda") return moeda.format(Number(valor)).replace(/ /g, " ").replace(/−/g, "-");
  if (tipo === "percentual") return `${(Number(valor) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (tipo === "numero") return Number(valor).toLocaleString("pt-BR");
  return String(valor);
}

/**
 * As fontes padrão do PDF só têm o alfabeto latino (acentos do português
 * incluídos). Traços e aspas tipográficas viram os simples; emojis e outros
 * símbolos saem, em vez de aparecerem como caracteres estranhos.
 */
export function textoParaPdf(texto: string): string {
  return texto
    .replace(/[‒-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/…/g, "...")
    // Remove o que a fonte do PDF não desenha (fora do Latin-1).
    .replace(/[^\u0000-ÿ]/g, "");
}

const NUMERICAS: TipoColuna[] = ["moeda", "numero", "percentual"];

export async function baixarPdf(tabelas: TabelaRelatorio[], cabecalho: CabecalhoRelatorio, nomeArquivo: string): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const margem = 36;
  const altura = doc.internal.pageSize.getHeight();
  const largura = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Relatório FinFlow", margem, margem + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(textoParaPdf(`Período: ${cabecalho.periodo}    Contas: ${cabecalho.contas}    Gerado em: ${cabecalho.geradoEm}`), margem, margem + 20);

  let y = margem + 44;
  for (const tabela of tabelas) {
    // O título da seção não fica sozinho no pé da página.
    if (y > altura - 90) {
      doc.addPage();
      y = margem;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(textoParaPdf(tabela.titulo), margem, y);
    autoTable(doc, {
      startY: y + 6,
      head: [tabela.colunas.map((coluna) => textoParaPdf(coluna.titulo))],
      body: tabela.linhas.length
        ? tabela.linhas.map((linha) => linha.map((valor, indice) => textoParaPdf(textoDaCelula(valor, tabela.colunas[indice].tipo))))
        // Contas e objetivos mostram o estado atual, não dependem do período.
        : [[{ content: tabela.secao === "contas" || tabela.secao === "objetivos" ? "Nada para mostrar." : "Nada neste período.", colSpan: tabela.colunas.length }]],
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 4, overflow: "linebreak", lineColor: [210, 218, 214], lineWidth: 0.5 },
      headStyles: { fillColor: [22, 150, 110], textColor: 255, fontStyle: "bold" },
      columnStyles: Object.fromEntries(tabela.colunas.map((coluna, indice) => [indice, NUMERICAS.includes(coluna.tipo) ? { halign: "right" as const } : {}])),
      margin: { left: margem, right: margem, top: margem, bottom: margem },
    });
    const fimDaTabela = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40;
    y = fimDaTabela + 26;
  }

  const paginas = doc.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    doc.setPage(pagina);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Página ${pagina} de ${paginas}`, largura - margem, altura - 16, { align: "right" });
  }
  doc.save(nomeArquivo);
}

function celulaExcel(valor: CelulaRelatorio, tipo: TipoColuna) {
  if (valor === null || valor === "") return null;
  if (tipo === "data") {
    const [ano, mes, dia] = String(valor).slice(0, 10).split("-").map(Number);
    return { value: new Date(Date.UTC(ano, mes - 1, dia)), type: Date, format: "dd/mm/yyyy" };
  }
  if (tipo === "moeda") return { value: Number(valor), type: Number, format: "\"R$\" #,##0.00" };
  if (tipo === "percentual") return { value: Number(valor), type: Number, format: "0.0%" };
  if (tipo === "numero") return { value: Number(valor), type: Number };
  return { value: String(valor), type: String };
}

const titulo = (valor: string) => ({ value: valor, type: String, fontWeight: "bold" as const, backgroundColor: "#DCEFE6" });
const largura = (tipo: TipoColuna, tituloColuna: string) =>
  tipo === "texto" ? Math.max(14, Math.min(42, tituloColuna.length + 22)) : tipo === "data" ? 13 : 16;

export async function baixarExcel(tabelas: TabelaRelatorio[], cabecalho: CabecalhoRelatorio, nomeArquivo: string): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  // Cada seção vira uma aba: na primeira linha, o que é cada coluna; embaixo, os dados.
  const sobre = {
    sheet: "Sobre",
    data: [
      [titulo("Informação"), titulo("Detalhe")],
      ["Relatório", "FinFlow"],
      ["Período", cabecalho.periodo],
      ["Contas", cabecalho.contas],
      ["Gerado em", cabecalho.geradoEm],
      ["Seções", tabelas.map((tabela) => tabela.titulo).join(", ")],
    ],
    columns: [{ width: 14 }, { width: 70 }],
  };
  const abas = tabelas.map((tabela) => ({
    sheet: tabela.titulo.slice(0, 31),
    data: [
      tabela.colunas.map((coluna) => titulo(coluna.titulo)),
      ...tabela.linhas.map((linha) => linha.map((valor, indice) => celulaExcel(valor, tabela.colunas[indice].tipo))),
    ],
    columns: tabela.colunas.map((coluna) => ({ width: largura(coluna.tipo, coluna.titulo) })),
    stickyRowsCount: 1,
  }));
  await writeXlsxFile([sobre, ...abas] as Parameters<typeof writeXlsxFile>[0]).toFile(nomeArquivo);
}
