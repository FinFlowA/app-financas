"use client";

import { formatarReais } from "./format";
import type { ImagemLocal } from "./imagem-local";
import { totalDoItem, resumoDoOrcamento, type ItemOrcamento } from "./orcamento";

export type DadosOrcamentoPdf = {
  cliente: string;
  observacoes: string;
  /** Data de entrega (AAAA-MM-DD), opcional. */
  entrega: string | null;
  itens: ItemOrcamento[];
  logo: ImagemLocal | null;
};

/** Tamanho que cabe em largura x altura máximas, mantendo a proporção. */
function caber(imagem: ImagemLocal, maxL: number, maxA: number) {
  const escala = Math.min(maxL / imagem.largura, maxA / imagem.altura);
  return { l: imagem.largura * escala, a: imagem.altura * escala };
}

/**
 * PDF do orçamento em formato formal (preto e cinza, sem as cores do site).
 * Custo e margem não entram: o documento é para o cliente.
 */
export async function gerarPdfOrcamento(dados: DadosOrcamentoPdf) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const largura = doc.internal.pageSize.getWidth();
  const margem = 18;
  const hoje = new Date();
  const dataTexto = hoje.toLocaleDateString("pt-BR");

  // Logo no canto esquerdo; o título vem logo depois dela.
  let xTitulo = margem;
  if (dados.logo) {
    const { l, a } = caber(dados.logo, 40, 16);
    doc.addImage(dados.logo.dataUrl, "JPEG", margem, 28 - a, l, a);
    xTitulo = margem + l + 6;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(20, 20, 20);
  doc.text("ORÇAMENTO", xTitulo, 26);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`Data: ${dataTexto}`, largura - margem, 26, { align: "right" });
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.5);
  doc.line(margem, 31, largura - margem, 31);

  let y = 40;
  doc.setTextColor(30, 30, 30);
  if (dados.cliente.trim()) {
    doc.setFont("helvetica", "bold");
    doc.text("Cliente:", margem, y);
    doc.setFont("helvetica", "normal");
    doc.text(dados.cliente.trim(), margem + 17, y);
    y += 6;
  }
  if (dados.entrega) {
    doc.setFont("helvetica", "bold");
    doc.text("Entrega:", margem, y);
    doc.setFont("helvetica", "normal");
    doc.text(dados.entrega.split("-").reverse().join("/"), margem + 17, y);
    y += 6;
  }

  const comImagem = dados.itens.some((item) => item.imagem);
  autoTable(doc, {
    startY: y + 2,
    margin: { left: margem, right: margem },
    head: [[...(comImagem ? [""] : []), "Item", "Qtd.", "Valor unitário", "Total"]],
    body: dados.itens.map((item) => [
      ...(comImagem ? [""] : []),
      item.descricao,
      item.quantidade.toLocaleString("pt-BR"),
      formatarReais(item.valor),
      formatarReais(totalDoItem(item)),
    ]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 10, textColor: [30, 30, 30], lineColor: [190, 190, 190], lineWidth: 0.2, cellPadding: 2.6 },
    headStyles: { fillColor: [235, 235, 235], textColor: [20, 20, 20], fontStyle: "bold" },
    columnStyles: comImagem
      ? { 0: { cellWidth: 22, minCellHeight: 20 }, 2: { halign: "center", cellWidth: 18 }, 3: { halign: "right", cellWidth: 36 }, 4: { halign: "right", cellWidth: 36 } }
      : { 1: { halign: "center", cellWidth: 18 }, 2: { halign: "right", cellWidth: 36 }, 3: { halign: "right", cellWidth: 36 } },
    // Miniatura do item na primeira coluna.
    didDrawCell: (celula) => {
      if (!comImagem || celula.section !== "body" || celula.column.index !== 0) return;
      const imagem = dados.itens[celula.row.index]?.imagem;
      if (!imagem) return;
      const { l, a } = caber(imagem, celula.cell.width - 4, celula.cell.height - 4);
      doc.addImage(imagem.dataUrl, "JPEG", celula.cell.x + (celula.cell.width - l) / 2, celula.cell.y + (celula.cell.height - a) / 2, l, a);
    },
  });

  const fimTabela = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const { total } = resumoDoOrcamento(dados.itens);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text(`Total: ${formatarReais(total)}`, largura - margem, fimTabela + 10, { align: "right" });

  if (dados.observacoes.trim()) {
    doc.setFontSize(10);
    doc.text("Observações", margem, fimTabela + 22);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    doc.text(doc.splitTextToSize(dados.observacoes.trim(), largura - margem * 2), margem, fimTabela + 28);
  }
  return doc;
}
