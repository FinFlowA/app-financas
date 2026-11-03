"use client";

import { useState, type FormEvent } from "react";
import { formatarReais } from "@/lib/format";
import { parseMoney } from "@/lib/money";
import { lucroDoItem, resumoDoOrcamento, totalDoItem, type ItemOrcamento } from "@/lib/orcamento";
import { gerarPdfOrcamento } from "@/lib/orcamento-pdf";

const INPUT = "ff-focus w-full rounded-xl border border-border bg-surface-muted px-3 py-2.5 text-sm outline-none transition focus:border-primary";
const porcentagem = (valor: number) => `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export default function QuoteBuilder() {
  const [itens, setItens] = useState<ItemOrcamento[]>([]);
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [custo, setCusto] = useState("");
  const [cliente, setCliente] = useState("");
  const [validade, setValidade] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const resumo = resumoDoOrcamento(itens);

  function adicionar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const valorNum = parseMoney(valor);
    const qtd = Number(quantidade.replace(",", "."));
    const custoNum = custo.trim() ? parseMoney(custo) : null;
    if (!descricao.trim()) return setErro("Informe o item.");
    if (!Number.isFinite(valorNum) || valorNum <= 0) return setErro("Informe um valor maior que zero.");
    if (!Number.isFinite(qtd) || qtd <= 0) return setErro("Informe uma quantidade maior que zero.");
    if (custoNum !== null && (!Number.isFinite(custoNum) || custoNum < 0)) return setErro("O custo precisa ser um valor válido.");
    setItens((atual) => [...atual, { id: crypto.randomUUID(), descricao: descricao.trim(), valor: valorNum, quantidade: qtd, custo: custoNum }]);
    setDescricao(""); setValor(""); setQuantidade("1"); setCusto(""); setErro(null);
  }

  async function gerar(modo: "baixar" | "imprimir") {
    if (!itens.length || gerando) return;
    setGerando(true);
    try {
      const doc = await gerarPdfOrcamento({ cliente, observacoes, validadeDias: Number(validade) > 0 ? Number(validade) : null, itens });
      if (modo === "baixar") doc.save(`orcamento-${new Date().toISOString().slice(0, 10)}.pdf`);
      else {
        doc.autoPrint();
        window.open(doc.output("bloburl"), "_blank");
      }
    } finally { setGerando(false); }
  }

  return <div className="grid gap-5">
    <header className="ff-page-hero px-5 py-6 sm:px-7">
      <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-mint">Ferramentas</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Orçamentos</h1>
      <p className="mt-2 max-w-2xl text-sm text-white/72">Monte um orçamento, veja a sua margem e gere um PDF formal para o cliente. Nada aqui é lançado nas suas contas.</p>
    </header>

    <section className="ff-card grid gap-4 p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <label className="text-sm font-bold">Cliente (opcional)<input value={cliente} onChange={(e) => setCliente(e.target.value)} maxLength={120} className={`${INPUT} mt-1.5 font-normal`} /></label>
        <label className="text-sm font-bold">Validade em dias (opcional)<input value={validade} onChange={(e) => setValidade(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={3} className={`${INPUT} mt-1.5 font-normal`} /></label>
      </div>

      <form onSubmit={adicionar} className="grid gap-3 rounded-2xl bg-surface-muted/40 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6rem_minmax(0,1fr)]">
        <label className="text-xs font-bold">Item<input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={120} placeholder="Ex.: Camiseta personalizada" className={`${INPUT} mt-1`} /></label>
        <label className="text-xs font-bold">Valor (R$)<input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${INPUT} mt-1`} /></label>
        <label className="text-xs font-bold">Quantidade<input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} inputMode="decimal" className={`${INPUT} mt-1`} /></label>
        <label className="text-xs font-bold">Custo (opcional)<input value={custo} onChange={(e) => setCusto(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${INPUT} mt-1`} /></label>
        <div className="sm:col-span-4"><button className="ff-focus rounded-full bg-primary px-6 py-2.5 text-sm font-extrabold text-white transition hover:bg-primary-dark">+ Adicionar</button>{erro && <span role="alert" className="ml-3 text-sm font-semibold text-red">{erro}</span>}</div>
      </form>

      {itens.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-foreground-muted">Nenhum item ainda. Adicione o primeiro acima.</p> : <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-border text-left text-xs uppercase text-foreground-muted"><th className="py-2">Item</th><th className="text-right">Valor</th><th className="text-center">Qtd.</th><th className="text-right">Total</th><th className="text-right">Custo</th><th className="text-right">Lucro</th><th className="text-right">Margem</th><th /></tr></thead>
          <tbody>{itens.map((item) => { const lucro = lucroDoItem(item); return <tr key={item.id} className="border-b border-border/60">
            <td className="py-2.5 font-semibold">{item.descricao}</td>
            <td className="text-right">{formatarReais(item.valor)}</td>
            <td className="text-center">{item.quantidade.toLocaleString("pt-BR")}</td>
            <td className="text-right font-bold">{formatarReais(totalDoItem(item))}</td>
            <td className="text-right text-foreground-muted">{item.custo === null ? "—" : formatarReais(item.custo)}</td>
            <td className={`text-right ${lucro && lucro.lucro < 0 ? "text-red" : "text-primary"}`}>{lucro ? formatarReais(lucro.lucro) : "—"}</td>
            <td className={`text-right font-bold ${lucro && lucro.margem < 0 ? "text-red" : "text-primary"}`}>{lucro ? porcentagem(lucro.margem) : "—"}</td>
            <td className="text-right"><button type="button" onClick={() => setItens((atual) => atual.filter((i) => i.id !== item.id))} className="ff-focus rounded-full border border-red/40 px-3 py-1 text-xs font-bold text-red">Excluir</button></td>
          </tr>; })}</tbody>
        </table>
      </div>}

      {itens.length > 0 && <div className="grid gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-surface-muted/60 p-3"><p className="text-xs text-foreground-muted">Total do orçamento</p><p className="text-lg font-black">{formatarReais(resumo.total)}</p></div>
        {resumo.custo !== null && <>
          <div className="rounded-xl bg-surface-muted/60 p-3"><p className="text-xs text-foreground-muted">Custo</p><p className="text-lg font-black">{formatarReais(resumo.custo)}</p></div>
          <div className="rounded-xl bg-surface-muted/60 p-3"><p className="text-xs text-foreground-muted">Lucro</p><p className={`text-lg font-black ${(resumo.lucro ?? 0) < 0 ? "text-red" : "text-primary"}`}>{formatarReais(resumo.lucro ?? 0)}</p></div>
          <div className="rounded-xl bg-surface-muted/60 p-3"><p className="text-xs text-foreground-muted">Margem</p><p className={`text-lg font-black ${(resumo.margem ?? 0) < 0 ? "text-red" : "text-primary"}`}>{porcentagem(resumo.margem ?? 0)}</p></div>
        </>}
        {resumo.custo !== null && resumo.itensSemCusto > 0 && <p className="text-xs text-foreground-muted sm:col-span-4">Lucro e margem consideram só os {itens.length - resumo.itensSemCusto} itens com custo informado.</p>}
      </div>}

      <label className="text-sm font-bold">Observações (opcional)<textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={1000} rows={3} placeholder="Ex.: prazo de entrega, forma de pagamento" className={`${INPUT} mt-1.5 font-normal`} /></label>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!itens.length || gerando} onClick={() => void gerar("baixar")} className="ff-focus rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white disabled:opacity-50">Baixar PDF</button>
        <button type="button" disabled={!itens.length || gerando} onClick={() => void gerar("imprimir")} className="ff-focus rounded-full border border-border px-6 py-3 text-sm font-bold disabled:opacity-50">Imprimir</button>
        <p className="self-center text-xs text-foreground-muted">O PDF sai em preto e branco, sem custo e margem: ele é para o cliente.</p>
      </div>
    </section>
  </div>;
}
