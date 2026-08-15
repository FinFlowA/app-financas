"use client";

import { useState, useTransition } from "react";
import { criarCompra } from "./actions";
import type { Categoria } from "@/lib/types";

export default function NovaCompraForm({
  cartaoId,
  categorias,
}: {
  cartaoId: number;
  categorias: Categoria[];
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hoje = new Date().toISOString().slice(0, 10);

  function enviar(formData: FormData) {
    setErro(null);
    startTransition(async () => {
      const resultado = await criarCompra(formData);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setAberto(false);
    });
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        disabled={categorias.length === 0}
        className="rounded-ff-sm bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
      >
        + Nova compra
      </button>
    );
  }

  return (
    <form action={enviar} className="rounded-ff-md border border-border bg-surface-muted p-4">
      <input type="hidden" name="card_id" value={cartaoId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <input
            name="description"
            required
            placeholder="Descrição da compra"
            className="w-full rounded-ff-sm border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <input
          name="value"
          required
          inputMode="decimal"
          placeholder="0,00"
          className="w-full rounded-ff-sm border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <input
          type="date"
          name="purchase_date"
          required
          defaultValue={hoje}
          className="w-full rounded-ff-sm border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <select
          name="category_id"
          required
          defaultValue=""
          className="w-full rounded-ff-sm border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary sm:col-span-2"
        >
          <option value="" disabled>Categoria</option>
          {categorias.map((categoria) => (
            <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>
          ))}
        </select>
      </div>

      {erro && <p className="mt-3 text-xs font-medium text-red">{erro}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-ff-sm bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
        >
          {pending ? "Salvando..." : "Adicionar"}
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="rounded-ff-sm px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-surface"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
