"use client";

import { useState, useTransition } from "react";
import { movimentarObjetivo } from "./actions";
import type { Conta } from "@/lib/types";

export default function MovimentoObjetivoForm({
  objetivoId,
  objetivoNome,
  contas,
}: {
  objetivoId: number;
  objetivoNome: string;
  contas: Conta[];
}) {
  const [aberto, setAberto] = useState<"guardar" | "resgatar" | null>(null);
  const [valor, setValor] = useState("");
  const [contaId, setContaId] = useState<number | "">(contas[0]?.id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function enviar(formData: FormData) {
    setErro(null);
    startTransition(async () => {
      const resultado = await movimentarObjetivo(formData);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setAberto(null);
      setValor("");
    });
  }

  if (!aberto) {
    return (
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setAberto("guardar")}
          className="flex-1 rounded-ff-sm bg-primary-soft py-2 text-xs font-bold text-primary-dark"
        >
          Guardar
        </button>
        <button
          onClick={() => setAberto("resgatar")}
          disabled={contas.length === 0}
          className="flex-1 rounded-ff-sm border border-border py-2 text-xs font-bold text-foreground-muted disabled:opacity-50"
        >
          Resgatar
        </button>
      </div>
    );
  }

  return (
    <form action={enviar} className="mt-4 border-t border-border pt-4">
      <input type="hidden" name="goal_id" value={objetivoId} />
      <input type="hidden" name="goal_name" value={objetivoNome} />
      <input type="hidden" name="operation" value={aberto} />

      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-foreground-muted">
        {aberto === "guardar" ? "Guardar nesta meta" : "Resgatar desta meta"}
      </p>

      <select
        name="account_id"
        value={contaId}
        onChange={(event) => setContaId(Number(event.target.value))}
        className="mb-2 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
      >
        {contas.map((conta) => (
          <option key={conta.id} value={conta.id}>{conta.nome}</option>
        ))}
      </select>

      <input
        name="value"
        required
        inputMode="decimal"
        placeholder="0,00"
        value={valor}
        onChange={(event) => setValor(event.target.value)}
        className="mb-2 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
      />

      {erro && <p className="mb-2 text-xs font-medium text-red">{erro}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || contaId === ""}
          className="flex-1 rounded-ff-sm bg-primary py-2 text-xs font-bold text-white disabled:opacity-60"
        >
          {pending ? "Enviando..." : "Confirmar"}
        </button>
        <button
          type="button"
          onClick={() => { setAberto(null); setErro(null); }}
          className="rounded-ff-sm px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-surface-muted"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
