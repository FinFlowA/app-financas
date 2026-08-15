"use client";

import { useState, useTransition } from "react";
import { criarCartao } from "./actions";

const CORES = ["#457B9D", "#16966E", "#F28A55", "#805AD5", "#EE6B63", "#6D597A"];

export default function NovoCartaoForm() {
  const [aberto, setAberto] = useState(false);
  const [cor, setCor] = useState(CORES[0]);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function enviar(formData: FormData) {
    setErro(null);
    startTransition(async () => {
      const resultado = await criarCartao(formData);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setAberto(false);
      setCor(CORES[0]);
    });
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="mb-6 rounded-ff-md bg-primary px-4 py-2.5 text-sm font-bold text-white"
      >
        + Novo cartão
      </button>
    );
  }

  return (
    <form action={enviar} className="mb-6 rounded-ff-lg border border-border bg-surface p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
            Nome
          </label>
          <input
            name="nome"
            required
            placeholder="Ex: Nubank, Itaú Visa"
            className="w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
            Limite (R$)
          </label>
          <input
            name="limite"
            required
            inputMode="decimal"
            placeholder="0,00"
            className="w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
              Fecha dia
            </label>
            <input
              name="dia_fechamento"
              required
              type="number"
              min={1}
              max={31}
              defaultValue={3}
              className="w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
              Vence dia
            </label>
            <input
              name="dia_vencimento"
              required
              type="number"
              min={1}
              max={31}
              defaultValue={10}
              className="w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
            Cor
          </label>
          <input type="hidden" name="cor" value={cor} />
          <div className="flex gap-2">
            {CORES.map((opcao) => (
              <button
                type="button"
                key={opcao}
                onClick={() => setCor(opcao)}
                aria-label={`Cor ${opcao}`}
                className="h-8 w-8 rounded-full"
                style={{
                  backgroundColor: opcao,
                  outline: cor === opcao ? "2px solid var(--color-foreground)" : "none",
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {erro && <p className="mt-4 text-sm font-medium text-red">{erro}</p>}

      <div className="mt-5 flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-ff-md bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
        >
          {pending ? "Criando..." : "Criar cartão"}
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="rounded-ff-md px-4 py-2.5 text-sm font-semibold text-foreground-muted hover:bg-surface-muted"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
