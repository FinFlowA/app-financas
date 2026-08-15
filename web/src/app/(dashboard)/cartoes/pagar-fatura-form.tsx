"use client";

import { useState, useTransition } from "react";
import { pagarFatura } from "./actions";
import { formatarReais } from "@/lib/format";
import type { Conta } from "@/lib/types";

export default function PagarFaturaForm({
  cartaoId,
  mesFatura,
  totalAberto,
  contas,
}: {
  cartaoId: number;
  mesFatura: string;
  totalAberto: number;
  contas: Conta[];
}) {
  const [aberto, setAberto] = useState(false);
  const [contaId, setContaId] = useState<number | "">(contas[0]?.id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function enviar(formData: FormData) {
    setErro(null);
    startTransition(async () => {
      const resultado = await pagarFatura(formData);
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
        disabled={contas.length === 0}
        className="rounded-ff-sm bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
      >
        Pagar fatura
      </button>
    );
  }

  return (
    <form action={enviar} className="rounded-ff-md border border-border bg-surface-muted p-4">
      <input type="hidden" name="card_id" value={cartaoId} />
      <input type="hidden" name="invoice_month" value={mesFatura} />
      <input type="hidden" name="payment_amount" value={totalAberto} />

      <p className="mb-2 text-sm text-foreground">
        Pagar fatura completa de <strong>{formatarReais(totalAberto)}</strong> com:
      </p>

      <select
        name="account_id"
        value={contaId}
        onChange={(event) => setContaId(Number(event.target.value))}
        className="mb-3 w-full rounded-ff-sm border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
      >
        {contas.map((conta) => (
          <option key={conta.id} value={conta.id}>{conta.nome}</option>
        ))}
      </select>

      {erro && <p className="mb-3 text-xs font-medium text-red">{erro}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || contaId === ""}
          className="rounded-ff-sm bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
        >
          {pending ? "Pagando..." : "Confirmar pagamento"}
        </button>
        <button
          type="button"
          onClick={() => { setAberto(false); setErro(null); }}
          className="rounded-ff-sm px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-surface"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
