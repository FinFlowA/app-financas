// Gera os arquivos do relatório no navegador: nada sai do aparelho além do
// download. As bibliotecas (jsPDF e write-excel-file) só carregam ao clicar em
// gerar, para não pesar as outras páginas.
import { dataBr } from "./relatorio";
import type { ImagemGrafico } from "./relatorio-graficos";
import type { BlocoRelatorio, CelulaRelatorio, IndicadorRelatorio, SecaoRelatorio, TabelaRelatorio, TipoColuna } from "./relatorio-tipos";

export type CabecalhoRelatorio = { periodo: string; contas: string; filtros: string; geradoEm: string };

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Valor da célula como texto (PDF). */
export function textoDaCelula(valor: CelulaRelatorio, tipo: TipoColuna): string {
  if (valor === null || valor === "") return "";
  if (tipo === "data") return dataBr(String(valor));
  if (tipo === "moeda") return moeda.format(Math.abs(Number(valor)) < 0.005 ? 0 : Number(valor)).replace(/ /g, " ").replace(/−/g, "-");
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

/** Páginas do PDF: cada grupo começa numa página nova, na ordem abaixo. */
export const GRUPOS_DO_PDF: { titulo: string; secoes: SecaoRelatorio[] }[] = [
  { titulo: "Resumo financeiro", secoes: ["resumo", "comparacao"] },
  { titulo: "Evolução financeira", secoes: ["evolucao", "projecao"] },
  { titulo: "Contas", secoes: ["contas"] },
  { titulo: "Categorias", secoes: ["categorias", "maiores"] },
  { titulo: "Cartões", secoes: ["cartoes", "faturas", "compras_cartao"] },
  { titulo: "Detalhamento", secoes: ["receitas", "despesas", "transferencias", "pendencias", "objetivos"] },
];

/** Abas do Excel, na ordem abaixo. */
export const ABAS_DO_EXCEL: { nome: string; secoes: SecaoRelatorio[] }[] = [
  { nome: "Resumo", secoes: ["resumo", "comparacao"] },
  { nome: "Evolução Mensal", secoes: ["evolucao"] },
  { nome: "Contas", secoes: ["contas"] },
  { nome: "Categorias", secoes: ["categorias", "maiores"] },
  { nome: "Cartões", secoes: ["cartoes", "faturas", "compras_cartao"] },
  { nome: "Receitas", secoes: ["receitas"] },
  { nome: "Despesas", secoes: ["despesas"] },
  { nome: "Transferências", secoes: ["transferencias"] },
  { nome: "Pendências", secoes: ["pendencias"] },
  { nome: "Projeção", secoes: ["projecao"] },
  { nome: "Objetivos", secoes: ["objetivos"] },
];

const NUMERICAS: TipoColuna[] = ["moeda", "numero", "percentual"];
const VERDE: [number, number, number] = [22, 150, 110];
const VERMELHO: [number, number, number] = [200, 60, 50];
const ESCURO: [number, number, number] = [30, 42, 39];
const CINZA: [number, number, number] = [95, 110, 105];

const vazio = (tabela: TabelaRelatorio) => (tabela.secao === "contas" || tabela.secao === "objetivos" || tabela.secao === "cartoes" ? "Nada para mostrar." : "Nada neste período.");

function textoDoIndicador(indicador: IndicadorRelatorio): string {
  if (indicador.formato === "texto") return indicador.texto ?? "";
  if (indicador.valor === null) return "-";
  return textoDaCelula(indicador.valor, indicador.formato);
}

export async function baixarPdf(blocos: BlocoRelatorio[], cabecalho: CabecalhoRelatorio, nomeArquivo: string, graficos: Map<string, ImagemGrafico>): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
  const margem = 36;
  const altura = doc.internal.pageSize.getHeight();
  const largura = doc.internal.pageSize.getWidth();
  const util = largura - margem * 2;
  const limite = altura - margem - 10;

  doc.setTextColor(...ESCURO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Relatório FinFlow", margem, margem + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...CINZA);
  doc.text(textoParaPdf(`Período: ${cabecalho.periodo}    Contas: ${cabecalho.contas}    Gerado em: ${cabecalho.geradoEm}`), margem, margem + 22);
  doc.text(textoParaPdf(`Filtros: ${cabecalho.filtros}`), margem, margem + 34);
  let y = margem + 52;
  let primeiraPagina = true;

  const garantir = (espaco: number) => {
    if (y + espaco > limite) {
      doc.addPage();
      y = margem;
    }
  };
  const subtitulo = (texto: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...ESCURO);
    doc.text(textoParaPdf(texto), margem, y);
  };

  for (const grupo of GRUPOS_DO_PDF) {
    const doGrupo = blocos.filter((bloco) => grupo.secoes.includes(bloco.secao));
    if (doGrupo.length === 0) continue;
    if (!primeiraPagina) {
      doc.addPage();
      y = margem;
    }
    primeiraPagina = false;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...VERDE);
    doc.text(textoParaPdf(grupo.titulo), margem, y + 10);
    doc.setDrawColor(...VERDE);
    doc.setLineWidth(1);
    doc.line(margem, y + 17, largura - margem, y + 17);
    y += 38;

    for (const bloco of doGrupo) {
      if (bloco.tipo === "indicadores") {
        const porLinha = 4;
        const espaco = 8;
        const larguraCaixa = (util - espaco * (porLinha - 1)) / porLinha;
        const alturaCaixa = 50;
        garantir(20 + alturaCaixa);
        subtitulo(bloco.titulo);
        y += 10;
        bloco.itens.forEach((indicador, indice) => {
          const coluna = indice % porLinha;
          if (coluna === 0 && indice > 0) y += alturaCaixa + espaco;
          if (coluna === 0) garantir(alturaCaixa);
          const x = margem + coluna * (larguraCaixa + espaco);
          doc.setDrawColor(210, 218, 214);
          doc.setFillColor(246, 250, 248);
          doc.roundedRect(x, y, larguraCaixa, alturaCaixa, 4, 4, "FD");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(...CINZA);
          doc.text(textoParaPdf(indicador.rotulo), x + 9, y + 14);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(13);
          doc.setTextColor(...(indicador.tom === "positivo" ? VERDE : indicador.tom === "negativo" ? VERMELHO : ESCURO));
          doc.text(textoParaPdf(textoDoIndicador(indicador)), x + 9, y + 31);
          if (indicador.detalhe) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7);
            doc.setTextColor(...CINZA);
            const detalhe = doc.splitTextToSize(textoParaPdf(indicador.detalhe), larguraCaixa - 18)[0] ?? "";
            doc.text(detalhe, x + 9, y + 43);
          }
        });
        y += alturaCaixa + 22;
        continue;
      }

      if (bloco.tipo === "nota") {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(...CINZA);
        const linhas = doc.splitTextToSize(textoParaPdf(bloco.texto), util) as string[];
        garantir(linhas.length * 10 + 6);
        doc.text(linhas, margem, y);
        y += linhas.length * 10 + 12;
        continue;
      }

      if (bloco.tipo === "grafico") {
        const imagem = graficos.get(bloco.grafico.id);
        if (!imagem) continue;
        const larguraImagem = util;
        const alturaImagem = (imagem.altura / imagem.largura) * larguraImagem;
        garantir(alturaImagem + 22);
        subtitulo(bloco.grafico.titulo);
        y += 6;
        // Compactada: sem isso, cada gráfico ocupa alguns megabytes no PDF.
        doc.addImage(imagem.dataUrl, "PNG", margem, y, larguraImagem, alturaImagem, `grafico-${bloco.grafico.id}`, "MEDIUM");
        y += alturaImagem + 22;
        continue;
      }

      const { tabela } = bloco;
      garantir(64);
      subtitulo(tabela.titulo);
      const colunas = tabela.colunas.length;
      const fonte = colunas <= 8 ? 8 : colunas <= 11 ? 7 : 6.5;
      const texto = (linha: CelulaRelatorio[]) => linha.map((valor, indice) => textoParaPdf(textoDaCelula(valor, tabela.colunas[indice]?.tipo ?? "texto")));
      autoTable(doc, {
        startY: y + 6,
        head: [tabela.colunas.map((coluna) => textoParaPdf(coluna.titulo))],
        body: tabela.linhas.length
          ? tabela.linhas.map(texto)
          : [[{ content: vazio(tabela), colSpan: colunas }]],
        foot: tabela.total && tabela.linhas.length ? [texto(tabela.total)] : undefined,
        showFoot: "lastPage",
        theme: "grid",
        styles: { font: "helvetica", fontSize: fonte, cellPadding: 4, overflow: "linebreak", lineColor: [210, 218, 214], lineWidth: 0.5, textColor: ESCURO },
        headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold" },
        footStyles: { fillColor: [232, 243, 238], textColor: ESCURO, fontStyle: "bold" },
        columnStyles: Object.fromEntries(tabela.colunas.map((coluna, indice) => [indice, NUMERICAS.includes(coluna.tipo) ? { halign: "right" as const } : {}])),
        margin: { left: margem, right: margem, top: margem, bottom: margem },
        didParseCell: (dados) => {
          if (!tabela.negativosEmVermelho || dados.section === "head") return;
          const linha = dados.section === "foot" ? tabela.total : tabela.linhas[dados.row.index];
          const valor = linha?.[dados.column.index];
          if (typeof valor === "number" && valor < -0.004 && tabela.colunas[dados.column.index]?.tipo !== "texto") dados.cell.styles.textColor = VERMELHO;
        },
      });
      const fimDaTabela = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40;
      y = fimDaTabela + 24;
    }
  }

  const paginas = doc.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    doc.setPage(pagina);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    doc.text("Relatório FinFlow", margem, altura - 16);
    doc.text(`Página ${pagina} de ${paginas}`, largura - margem, altura - 16, { align: "right" });
  }
  doc.save(nomeArquivo);
}

type CelulaExcel = { value?: string | number | Date; type?: unknown; format?: string; fontWeight?: "bold"; fontStyle?: "italic"; fontSize?: number; textColor?: string; backgroundColor?: string; wrap?: boolean } | null;

function celulaExcel(valor: CelulaRelatorio, tipo: TipoColuna, vermelhoSeNegativo: boolean, negrito = false): CelulaExcel {
  if (valor === null || valor === "") return null;
  const estilo = negrito ? { fontWeight: "bold" as const } : {};
  if (tipo === "data") {
    const [ano, mes, dia] = String(valor).slice(0, 10).split("-").map(Number);
    return { value: new Date(Date.UTC(ano, mes - 1, dia)), type: Date, format: "dd/mm/yyyy", ...estilo };
  }
  const negativo = typeof valor === "number" && valor < -0.004 && vermelhoSeNegativo;
  const cor = negativo ? { textColor: "#C0392B" } : {};
  if (tipo === "moeda") return { value: Number(valor), type: Number, format: "\"R$\" #,##0.00", ...estilo, ...cor };
  if (tipo === "percentual") return { value: Number(valor), type: Number, format: "0.0%", ...estilo, ...cor };
  if (tipo === "numero") return { value: Number(valor), type: Number, ...estilo };
  return { value: String(valor), type: String, ...estilo };
}

const tituloDaColuna = (valor: string) => ({ value: valor, type: String, fontWeight: "bold" as const, backgroundColor: "#DCEFE6" });
const tituloDoBloco = (valor: string) => ({ value: valor, type: String, fontWeight: "bold" as const, fontSize: 12 });
const larguraDaColuna = (tipo: TipoColuna, titulo: string) => (tipo === "texto" ? Math.max(14, Math.min(46, titulo.length + 22)) : tipo === "data" ? 13 : Math.max(14, Math.min(24, titulo.length + 2)));

export type AbaDoExcel = {
  sheet: string;
  data: CelulaExcel[][];
  columns: { width: number }[];
  stickyRowsCount?: number;
  /** Gráficos: a imagem fica presa à célula (linha e coluna começam em 1). */
  graficos: { id: string; linha: number; coluna: number }[];
};

/** As abas do Excel (sem as imagens), montadas a partir dos blocos. */
export function abasDoExcel(blocos: BlocoRelatorio[], cabecalho: CabecalhoRelatorio, alturaDosGraficos: (id: string) => number): AbaDoExcel[] {
  const sobre: CelulaExcel[][] = [
    [tituloDaColuna("Informação"), tituloDaColuna("Detalhe")],
    [{ value: "Relatório", type: String }, { value: "FinFlow", type: String }],
    [{ value: "Período", type: String }, { value: cabecalho.periodo, type: String }],
    [{ value: "Contas", type: String }, { value: cabecalho.contas, type: String }],
    [{ value: "Filtros", type: String }, { value: cabecalho.filtros, type: String }],
    [{ value: "Gerado em", type: String }, { value: cabecalho.geradoEm, type: String }],
  ];
  const abas: AbaDoExcel[] = [];
  for (const aba of ABAS_DO_EXCEL) {
    const doGrupo = blocos.filter((bloco) => aba.secoes.includes(bloco.secao));
    if (doGrupo.length === 0) continue;
    const larguras: number[] = [];
    const ajustarLargura = (indice: number, valor: number) => {
      larguras[indice] = Math.max(larguras[indice] ?? 12, valor);
    };
    const tabelas = doGrupo.filter((bloco): bloco is Extract<BlocoRelatorio, { tipo: "tabela" }> => bloco.tipo === "tabela");
    const soUmaTabela = tabelas.length === 1 && doGrupo[0].tipo === "tabela" && doGrupo.every((bloco) => bloco.tipo === "tabela" || bloco.tipo === "nota");
    const dados: CelulaExcel[][] = [];
    const graficos: AbaDoExcel["graficos"] = [];

    // Na aba Resumo, as informações do relatório vêm primeiro.
    if (aba.nome === "Resumo") {
      dados.push(...sobre.slice(1), [null]);
      ajustarLargura(0, 16);
      ajustarLargura(1, 60);
    }

    for (const bloco of doGrupo) {
      if (bloco.tipo === "tabela") {
        const { tabela } = bloco;
        // Uma tabela só na aba: a primeira linha é a dos títulos das colunas (como antes).
        if (!soUmaTabela) dados.push([tituloDoBloco(tabela.titulo)]);
        dados.push(tabela.colunas.map((coluna) => tituloDaColuna(coluna.titulo)));
        tabela.colunas.forEach((coluna, indice) => ajustarLargura(indice, larguraDaColuna(coluna.tipo, coluna.titulo)));
        for (const linha of tabela.linhas) dados.push(linha.map((valor, indice) => celulaExcel(valor, tabela.colunas[indice]?.tipo ?? "texto", Boolean(tabela.negativosEmVermelho))));
        if (tabela.total && tabela.linhas.length) dados.push(tabela.total.map((valor, indice) => celulaExcel(valor, tabela.colunas[indice]?.tipo ?? "texto", Boolean(tabela.negativosEmVermelho), true)));
        dados.push([null]);
      } else if (bloco.tipo === "indicadores") {
        dados.push([tituloDoBloco(bloco.titulo)]);
        dados.push([tituloDaColuna("Indicador"), tituloDaColuna("Valor"), tituloDaColuna("Detalhe")]);
        for (const indicador of bloco.itens) {
          const valor = indicador.formato === "texto"
            ? { value: indicador.texto ?? "", type: String }
            : celulaExcel(indicador.valor, indicador.formato, true, true);
          dados.push([{ value: indicador.rotulo, type: String }, valor, indicador.detalhe ? { value: indicador.detalhe, type: String } : null]);
        }
        ajustarLargura(0, 30);
        ajustarLargura(1, 18);
        ajustarLargura(2, 44);
        dados.push([null]);
      } else if (bloco.tipo === "grafico") {
        dados.push([tituloDoBloco(bloco.grafico.titulo)]);
        graficos.push({ id: bloco.grafico.id, linha: dados.length + 1, coluna: 1 });
        // Linhas vazias embaixo da imagem (cada linha tem uns 20 pixels).
        const linhasDaImagem = Math.ceil(alturaDosGraficos(bloco.grafico.id) / 20) + 1;
        for (let indice = 0; indice < linhasDaImagem; indice += 1) dados.push([null]);
      } else {
        dados.push([{ value: bloco.texto, type: String, fontStyle: "italic", textColor: "#5F6E69" }]);
        dados.push([null]);
      }
    }
    while (dados.length > 0 && (dados[dados.length - 1]?.every((celula) => celula === null) ?? false)) dados.pop();
    abas.push({
      sheet: aba.nome.slice(0, 31),
      data: dados,
      columns: larguras.map((valor) => ({ width: valor })),
      stickyRowsCount: soUmaTabela ? 1 : undefined,
      graficos,
    });
  }
  // Sem a aba Resumo, as informações do relatório ficam numa aba própria, no começo.
  if (!abas.some((aba) => aba.sheet === "Resumo")) {
    abas.unshift({ sheet: "Sobre", data: sobre, columns: [{ width: 14 }, { width: 70 }], graficos: [] });
  }
  return abas;
}

export async function baixarExcel(blocos: BlocoRelatorio[], cabecalho: CabecalhoRelatorio, nomeArquivo: string, graficos: Map<string, ImagemGrafico>): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const abas = abasDoExcel(blocos, cabecalho, (id) => graficos.get(id)?.altura ?? 0).map((aba) => ({
    sheet: aba.sheet,
    data: aba.data,
    columns: aba.columns,
    ...(aba.stickyRowsCount ? { stickyRowsCount: aba.stickyRowsCount } : {}),
    images: aba.graficos.flatMap((posicao) => {
      const imagem = graficos.get(posicao.id);
      return imagem
        ? [{
          content: imagem.png,
          contentType: "image/png",
          width: imagem.largura * imagem.escala,
          height: imagem.altura * imagem.escala,
          dpi: 96 * imagem.escala,
          anchor: { row: posicao.linha, column: posicao.coluna },
          title: posicao.id,
        }]
        : [];
    }),
  }));
  await writeXlsxFile(abas as unknown as Parameters<typeof writeXlsxFile>[0]).toFile(nomeArquivo);
}
