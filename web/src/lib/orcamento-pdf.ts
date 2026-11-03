"use client";

import { formatarReais } from "./format";
import { totalDoItem, resumoDoOrcamento, type ItemOrcamento } from "./orcamento";

export type DadosOrcamentoPdf = {
  cliente: string;
  observacoes: string;
  validadeDias: number | null;
  itens: ItemOrcamento[];
};

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

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(20, 20, 20);
  doc.text("ORÇAMENTO", margem, 26);
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
  if (dados.validadeDias) {
    const validade = new Date(hoje.getTime() + dados.validadeDias * 86_400_000).toLocaleDateString("pt-BR");
    doc.setFont("helvetica", "bold");
    doc.text("Validade:", margem, y);
    doc.setFont("helvetica", "normal");
    doc.text(`${dados.validadeDias} dias (até ${validade})`, margem + 19, y);
    y += 6;
  }

  autoTable(doc, {
    startY: y + 2,
    margin: { left: margem, right: margem },
    head: [["Item", "Qtd.", "Valor unitário", "Total"]],
    body: dados.itens.map((item) => [
      item.descricao,
      item.quantidade.toLocaleString("pt-BR"),
      formatarReais(item.valor),
      formatarReais(totalDoItem(item)),
    ]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 10, textColor: [30, 30, 30], lineColor: [190, 190, 190], lineWidth: 0.2, cellPadding: 2.6 },
    headStyles: { fillColor: [235, 235, 235], textColor: [20, 20, 20], fontStyle: "bold" },
    columnStyles: { 1: { halign: "center", cellWidth: 18 }, 2: { halign: "right", cellWidth: 36 }, 3: { halign: "right", cellWidth: 36 } },
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
