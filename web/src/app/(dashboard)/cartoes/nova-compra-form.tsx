"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import CurrencyInput from "@/components/ui/currency-input";
import FinFlowDatePicker from "@/components/ui/finflow-date-picker";
import FinFlowSelect from "@/components/ui/finflow-select";
import { hojeEmSaoPaulo } from "@/lib/date";
import type { Categoria } from "@/lib/types";
import { useRequestId } from "@/lib/use-request-id";
import { criarCompra } from "./actions";
import { formatarMesAno, mesDaCompra } from "./card-utils";
import styles from "./cartoes.module.css";

function RequestId() {
  const [id] = useRequestId();
  return <input type="hidden" name="request_id" value={id} readOnly />;
}

export default function NovaCompraForm({ cartaoId, diaFechamento, categorias, initiallyOpen = false }: {
  cartaoId: number;
  diaFechamento: number;
  categorias: Categoria[];
  initiallyOpen?: boolean;
}) {
  const [aberto, setAberto] = useState(initiallyOpen);
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [erro, setErro] = useState<string | null>(null);
  const [frequencia, setFrequencia] = useState<"unica" | "parcelada" | "mensal">("unica");
  const [modoValor, setModoValor] = useState<"total" | "parcela">("total");
  const [dataCompra, setDataCompra] = useState(hojeEmSaoPaulo());
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const categoriasAtivas = categorias.filter((categoria) => Boolean(categoria.ativa));
  const mesPrevisto = /^\d{4}-\d{2}-\d{2}$/.test(dataCompra) ? formatarMesAno(mesDaCompra(dataCompra, diaFechamento)) : null;

  const fechar = useCallback(() => {
    if (pending) return;
    setAberto(false);
    setErro(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [pending]);

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

  useEffect(() => {
    if (!aberto || !mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) fechar();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [aberto, fechar, mounted, pending]);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setAberto(true)} disabled={categoriasAtivas.length === 0} className={styles.heroPurchaseButton}>
        <span className={styles.heroPurchaseIcon} aria-hidden>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </span>
        <span className={styles.heroPurchaseCopy}><strong>Nova compra</strong><small>Adicionar à fatura</small></span>
      </button>

      {aberto && mounted && createPortal(
        <div className={styles.purchaseModalBackdrop} onMouseDown={fechar}>
          <section role="dialog" aria-modal="true" aria-labelledby="nova-compra-title" className={styles.purchaseModal} onMouseDown={(event) => event.stopPropagation()}>
            <form action={enviar}>
              <RequestId />
              <input type="hidden" name="card_id" value={cartaoId} />
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.modalEyebrow}>Cartão de crédito</p>
                  <h2 id="nova-compra-title">Adicionar compra</h2>
                  <p className={styles.helperText}>{mesPrevisto ? `Com a data informada, entra na fatura de ${mesPrevisto}.` : "Informe a data para calcular a primeira fatura."}</p>
                </div>
                <button type="button" onClick={fechar} disabled={pending} aria-label="Fechar" className={styles.closeButton}>×</button>
              </div>

              <div className={styles.formGrid}>
                <label className={styles.formFull}>
                  <span className={styles.fieldLabel}>Descrição</span>
                  <input ref={firstFieldRef} name="description" required maxLength={100} placeholder="Ex.: Supermercado" className={styles.input} />
                </label>
                <label>
                  <span className={styles.fieldLabel}>{frequencia === "parcelada" && modoValor === "parcela" ? "Valor de cada parcela" : frequencia === "mensal" ? "Valor mensal" : "Valor total"}</span>
                  <CurrencyInput name="value" required className="bg-surface" />
                </label>
                <label>
                  <span className={styles.fieldLabel}>Data da compra</span>
                  <FinFlowDatePicker name="purchase_date" required value={dataCompra} defaultValue={dataCompra} onChange={setDataCompra} />
                </label>
                <label>
                  <span className={styles.fieldLabel}>Categoria</span>
                  <FinFlowSelect name="category_id" required options={categoriasAtivas.map((categoria) => ({ value: String(categoria.id), label: categoria.nome }))} />
                </label>
                <label>
                  <span className={styles.fieldLabel}>Tipo</span>
                  <FinFlowSelect name="frequency" value={frequencia} onChange={(value) => setFrequencia(value as typeof frequencia)} options={[
                    { value: "unica", label: "Compra única" },
                    { value: "parcelada", label: "Compra parcelada" },
                    { value: "mensal", label: "Compra fixa mensal" },
                  ]} />
                </label>
                {frequencia === "parcelada" && (
                  <>
                    <label><span className={styles.fieldLabel}>Parcelas</span><input name="installments" type="number" min={2} max={48} defaultValue={2} required className={styles.input} /></label>
                    <label>
                      <span className={styles.fieldLabel}>Valor informado</span>
                      <FinFlowSelect name="value_mode" value={modoValor} onChange={(value) => setModoValor(value as typeof modoValor)} options={[
                        { value: "total", label: "Total da compra" },
                        { value: "parcela", label: "Valor de cada parcela" },
                      ]} />
                    </label>
                  </>
                )}
              </div>

              {frequencia === "parcelada" && <p className={styles.helperText}>O total é distribuído em centavos entre as parcelas; todas as cobranças são criadas atomicamente.</p>}
              {frequencia === "mensal" && <p className={styles.helperText}>O FinFlow mantém automaticamente cinco anos de cobranças mensais. Compras fixas reservam limite apenas no mês corrente e podem ser encerradas nas cobranças futuras.</p>}
              {erro && <p role="alert" className={styles.errorText}>{erro}</p>}
              <div className={styles.formActions}>
                <button disabled={pending} className={styles.primaryButton}>{pending ? "Salvando..." : "Adicionar compra"}</button>
                <button type="button" disabled={pending} onClick={fechar} className={styles.ghostButton}>Cancelar</button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
