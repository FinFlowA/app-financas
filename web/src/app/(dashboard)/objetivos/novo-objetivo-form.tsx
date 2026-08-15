"use client";

import { useState, useTransition } from "react";
import { criarObjetivo } from "./actions";

const CORES = ["#16966E", "#4D76E8", "#F28A55", "#805AD5", "#EE6B63", "#56D39B"];
const ICONES = ["🎯", "✈️", "🏠", "🚗", "🎓", "💻", "🏖️", "💍"];

export default function NovoObjetivoForm() {
  const [aberto, setAberto] = useState(false);
  const [cor, setCor] = useState(CORES[0]);
  const [icone, setIcone] = useState(ICONES[0]);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function enviar(formData: FormData) {
    setErro(null);
    startTransition(async () => {
      const resultado = await criarObjetivo(formData);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setAberto(false);
      setCor(CORES[0]);
      setIcone(ICONES[0]);
    });
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="mb-6 rounded-ff-md bg-primary px-4 py-2.5 text-sm font-bold text-white"
      >
        + Novo objetivo
      </button>
    );
  }

  return (
    <form
      action={enviar}
      className="mb-6 rounded-ff-lg border border-border bg-surface p-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
            Nome
          </label>
          <input
            name="nome"
            required
            placeholder="Ex: Viagem, Reserva de emergência"
            className="w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
            Meta (R$)
          </label>
          <input
            name="meta_valor"
            required
            inputMode="decimal"
            placeholder="0,00"
            className="w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
            Prazo (opcional)
          </label>
          <input
            type="date"
            name="data_prazo"
            className="w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary"
          />
        </div>

        <div>
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

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
            Ícone
          </label>
          <input type="hidden" name="icone" value={icone} />
          <div className="flex gap-2">
            {ICONES.map((opcao) => (
              <button
                type="button"
                key={opcao}
                onClick={() => setIcone(opcao)}
                className="flex h-9 w-9 items-center justify-center rounded-ff-sm border text-lg"
                style={{
                  borderColor: icone === opcao ? "var(--color-primary)" : "var(--color-border)",
                  backgroundColor: icone === opcao ? "var(--color-primary-soft)" : "transparent",
                }}
              >
                {opcao}
              </button>
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
          {pending ? "Criando..." : "Criar objetivo"}
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
