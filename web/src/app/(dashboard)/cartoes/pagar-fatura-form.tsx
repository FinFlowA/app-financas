"use client";

import { useState, useTransition } from "react";
import CurrencyInput from "@/components/ui/currency-input";
import { formatarReais } from "@/lib/format";
import type { Conta } from "@/lib/types";
import { pagarFatura } from "./actions";

function RequestId() {
  const [id] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="request_id" value={id} />;
}

function inputClass() {
  return "w-full rounded-ff-sm border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary";
}

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
  const [tipoPagamento, setTipoPagamento] = useState<"full" | "partial">("full");
  const [destinoSaldo, setDestinoSaldo] = useState<"keep_open" | "carry">("keep_open");
  const [tipoJuros, setTipoJuros] = useState<"valor" | "percentual">("valor");
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
      setTipoPagamento("full");
      setDestinoSaldo("keep_open");
    });
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        disabled={contas.length === 0 || totalAberto <= 0}
        className="rounded-ff-sm bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
      >
        Pagar fatura
      </button>
    );
  }

  const remainderMode = tipoPagamento === "full" ? "full" : destinoSaldo;

  return (
    <form action={enviar} className="mt-4 rounded-ff-md border border-primary/30 bg-surface-muted p-4">
      <RequestId />
      <input type="hidden" name="card_id" value={cartaoId} />
      <input type="hidden" name="invoice_month" value={mesFatura} />
      <input type="hidden" name="invoice_amount" value={totalAberto} />
      <input type="hidden" name="remainder_mode" value={remainderMode} />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-foreground">Registrar pagamento</h3>
          <p data-private-value="true" className="text-xs text-foreground-muted">Saldo em aberto: {formatarReais(totalAberto)}</p>
        </div>
        <button type="button" onClick={() => { setAberto(false); setErro(null); }} aria-label="Fechar" className="text-lg text-foreground-muted">×</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Conta de pagamento</span>
          <select name="account_id" required defaultValue={contas[0]?.id ?? ""} className={inputClass()}>
            {contas.map((conta) => <option key={conta.id} value={conta.id}>{conta.nome}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Pagamento</span>
          <select value={tipoPagamento} onChange={(event) => setTipoPagamento(event.target.value as typeof tipoPagamento)} className={inputClass()}>
            <option value="full">Integral</option>
            <option value="partial">Parcial</option>
          </select>
        </label>

        {tipoPagamento === "full" ? (
          <label>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Valor pago</span>
            <input type="hidden" name="payment_amount" value={totalAberto} />
            <span data-private-value="true" className="block rounded-ff-sm border border-border bg-surface px-3 py-2.5 text-sm font-bold text-foreground">
              {formatarReais(totalAberto)}
            </span>
          </label>
        ) : (
          <label>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Valor pago</span>
            <CurrencyInput key={totalAberto} name="payment_amount" required className="bg-surface" />
          </label>
        )}

        {tipoPagamento === "partial" && (
          <label>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Saldo restante</span>
            <select value={destinoSaldo} onChange={(event) => setDestinoSaldo(event.target.value as typeof destinoSaldo)} className={inputClass()}>
              <option value="keep_open">Manter nesta fatura</option>
              <option value="carry">Levar para a próxima</option>
            </select>
          </label>
        )}

        {tipoPagamento === "partial" && destinoSaldo === "carry" && (
          <>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Juros (opcional)</span>
              <select name="interest_mode" value={tipoJuros} onChange={(event) => setTipoJuros(event.target.value as typeof tipoJuros)} className={inputClass()}>
                <option value="valor">Valor fixo</option>
                <option value="percentual">Percentual</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
                {tipoJuros === "percentual" ? "Percentual de juros" : "Valor dos juros"}
              </span>
              {tipoJuros === "valor" ? (
                <CurrencyInput name="interest" className="bg-surface" />
              ) : (
                <div className="relative">
                  <input name="interest" type="number" min={0} max={1000} step="0.01" placeholder="0,00" className={`${inputClass()} pr-9`} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-foreground-muted">%</span>
                </div>
              )}
            </label>
          </>
        )}
      </div>

      {tipoPagamento === "partial" && destinoSaldo === "keep_open" && (
        <p className="mt-3 text-xs text-foreground-muted">O pagamento vira um crédito nesta mesma fatura; as compras continuam em aberto para pagamentos posteriores.</p>
      )}
      {tipoPagamento === "partial" && destinoSaldo === "carry" && (
        <p className="mt-3 text-xs text-foreground-muted">As cobranças atuais serão quitadas e o saldo restante, acrescido dos juros informados, irá para a próxima fatura.</p>
      )}
      {erro && <p role="alert" className="mt-3 text-xs font-semibold text-red">{erro}</p>}

      <div className="mt-4 flex gap-2">
        <button disabled={pending} className="rounded-ff-sm bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
          {pending ? "Pagando..." : "Confirmar pagamento"}
        </button>
        <button type="button" onClick={() => { setAberto(false); setErro(null); }} className="rounded-ff-sm px-3 py-2 text-xs font-semibold text-foreground-muted">Cancelar</button>
      </div>
    </form>
  );
}
