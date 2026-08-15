"use client";

import { useState, useTransition } from "react";
import CurrencyInput from "@/components/ui/currency-input";
import { hojeEmSaoPaulo } from "@/lib/date";
import type { Categoria } from "@/lib/types";
import { criarCompra } from "./actions";
import { formatarMesAno, mesDaCompra } from "./card-utils";

function RequestId() {
  const [id] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="request_id" value={id} />;
}

function inputClass() {
  return "w-full rounded-ff-sm border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary";
}

export default function NovaCompraForm({
  cartaoId,
  diaFechamento,
  categorias,
}: {
  cartaoId: number;
  diaFechamento: number;
  categorias: Categoria[];
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [frequencia, setFrequencia] = useState<"unica" | "parcelada" | "mensal">("unica");
  const [modoValor, setModoValor] = useState<"total" | "parcela">("total");
  const [dataCompra, setDataCompra] = useState(hojeEmSaoPaulo());
  const [pending, startTransition] = useTransition();
  const categoriasAtivas = categorias.filter((categoria) => Boolean(categoria.ativa));
  const mesPrevisto = /^\d{4}-\d{2}-\d{2}$/.test(dataCompra)
    ? formatarMesAno(mesDaCompra(dataCompra, diaFechamento))
    : null;

  function enviar(formData: FormData) {
    setErro(null);
    startTransition(async () => {
      const resultado = await criarCompra(formData);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setAberto(false);
      setFrequencia("unica");
      setModoValor("total");
      setDataCompra(hojeEmSaoPaulo());
    });
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        disabled={categoriasAtivas.length === 0}
        className="rounded-ff-sm bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
      >
        + Nova compra
      </button>
    );
  }

  return (
    <form action={enviar} className="rounded-ff-md border border-primary/30 bg-surface p-4">
      <RequestId />
      <input type="hidden" name="card_id" value={cartaoId} />
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-extrabold text-foreground">Adicionar compra</h3>
          <p className="text-xs text-foreground-muted">
            {mesPrevisto ? `Com a data informada, entra em ${mesPrevisto}.` : "Informe a data para calcular a primeira fatura."}
          </p>
        </div>
        <button type="button" onClick={() => { setAberto(false); setErro(null); }} aria-label="Fechar" className="text-lg text-foreground-muted">×</button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Descrição</span>
          <input name="description" required maxLength={100} placeholder="Ex.: Supermercado" className={inputClass()} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
            {frequencia === "parcelada" && modoValor === "parcela" ? "Valor de cada parcela" : frequencia === "mensal" ? "Valor mensal" : "Valor total"}
          </span>
          <CurrencyInput name="value" required className="bg-surface" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Data da compra</span>
          <input type="date" name="purchase_date" required value={dataCompra} onChange={(event) => setDataCompra(event.target.value)} className={inputClass()} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Categoria</span>
          <select name="category_id" required defaultValue="" className={inputClass()}>
            <option value="" disabled>Selecione</option>
            {categoriasAtivas.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Tipo</span>
          <select
            name="frequency"
            value={frequencia}
            onChange={(event) => setFrequencia(event.target.value as typeof frequencia)}
            className={inputClass()}
          >
            <option value="unica">Compra única</option>
            <option value="parcelada">Compra parcelada</option>
            <option value="mensal">Compra fixa mensal</option>
          </select>
        </label>

        {frequencia === "parcelada" && (
          <>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Parcelas</span>
              <input name="installments" type="number" min={2} max={48} defaultValue={2} required className={inputClass()} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Valor informado</span>
              <select name="value_mode" value={modoValor} onChange={(event) => setModoValor(event.target.value as typeof modoValor)} className={inputClass()}>
                <option value="total">Total da compra</option>
                <option value="parcela">Valor de cada parcela</option>
              </select>
            </label>
          </>
        )}

        {frequencia === "mensal" && (
          <label>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Cobranças mensais</span>
            <input name="recurrence_count" type="number" min={2} max={60} defaultValue={12} required className={inputClass()} />
          </label>
        )}
      </div>

      {frequencia === "parcelada" && (
        <p className="mt-3 text-xs text-foreground-muted">O total é distribuído em centavos entre as parcelas; todas as cobranças são criadas atomicamente.</p>
      )}
      {frequencia === "mensal" && (
        <p className="mt-3 text-xs text-foreground-muted">Compras fixas reservam limite apenas no mês corrente e podem ser encerradas nas cobranças futuras.</p>
      )}
      {erro && <p role="alert" className="mt-3 text-xs font-semibold text-red">{erro}</p>}

      <div className="mt-4 flex gap-2">
        <button disabled={pending} className="rounded-ff-sm bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
          {pending ? "Salvando..." : "Adicionar compra"}
        </button>
        <button type="button" onClick={() => { setAberto(false); setErro(null); }} className="rounded-ff-sm px-3 py-2 text-xs font-semibold text-foreground-muted">Cancelar</button>
      </div>
    </form>
  );
}
