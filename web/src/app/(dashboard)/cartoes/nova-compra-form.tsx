"use client";

import { useState, useTransition } from "react";
import CurrencyInput from "@/components/ui/currency-input";
import { hojeEmSaoPaulo } from "@/lib/date";
import type { Categoria } from "@/lib/types";
import { criarCompra } from "./actions";
import { formatarMesAno, mesDaCompra } from "./card-utils";
import styles from "./cartoes.module.css";

function RequestId() {
  const [id] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="request_id" value={id} />;
}

function inputClass() {
  return styles.input;
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
        className={styles.primaryButton}
      >
        + Nova compra
      </button>
    );
  }

  return (
    <form action={enviar} className={styles.panel}>
      <RequestId />
      <input type="hidden" name="card_id" value={cartaoId} />
      <div className={styles.panelHeader}>
        <div>
          <h2>Adicionar compra</h2>
          <p className={styles.helperText}>
            {mesPrevisto ? `Com a data informada, entra em ${mesPrevisto}.` : "Informe a data para calcular a primeira fatura."}
          </p>
        </div>
        <button type="button" onClick={() => { setAberto(false); setErro(null); }} aria-label="Fechar" className={styles.closeButton}>×</button>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.formFull}>
          <span className={styles.fieldLabel}>Descrição</span>
          <input name="description" required maxLength={100} placeholder="Ex.: Supermercado" className={inputClass()} />
        </label>
        <label>
          <span className={styles.fieldLabel}>
            {frequencia === "parcelada" && modoValor === "parcela" ? "Valor de cada parcela" : frequencia === "mensal" ? "Valor mensal" : "Valor total"}
          </span>
          <CurrencyInput name="value" required className="bg-surface" />
        </label>
        <label>
          <span className={styles.fieldLabel}>Data da compra</span>
          <input type="date" name="purchase_date" required value={dataCompra} onChange={(event) => setDataCompra(event.target.value)} className={inputClass()} />
        </label>
        <label>
          <span className={styles.fieldLabel}>Categoria</span>
          <select name="category_id" required defaultValue="" className={inputClass()}>
            <option value="" disabled>Selecione</option>
            {categoriasAtivas.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}
          </select>
        </label>
        <label>
          <span className={styles.fieldLabel}>Tipo</span>
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
              <span className={styles.fieldLabel}>Parcelas</span>
              <input name="installments" type="number" min={2} max={48} defaultValue={2} required className={inputClass()} />
            </label>
            <label>
              <span className={styles.fieldLabel}>Valor informado</span>
              <select name="value_mode" value={modoValor} onChange={(event) => setModoValor(event.target.value as typeof modoValor)} className={inputClass()}>
                <option value="total">Total da compra</option>
                <option value="parcela">Valor de cada parcela</option>
              </select>
            </label>
          </>
        )}

        {frequencia === "mensal" && (
          <label>
            <span className={styles.fieldLabel}>Cobranças mensais</span>
            <input name="recurrence_count" type="number" min={2} max={60} defaultValue={12} required className={inputClass()} />
          </label>
        )}
      </div>

      {frequencia === "parcelada" && (
        <p className={styles.helperText}>O total é distribuído em centavos entre as parcelas; todas as cobranças são criadas atomicamente.</p>
      )}
      {frequencia === "mensal" && (
        <p className={styles.helperText}>Compras fixas reservam limite apenas no mês corrente e podem ser encerradas nas cobranças futuras.</p>
      )}
      {erro && <p role="alert" className={styles.errorText}>{erro}</p>}

      <div className={styles.formActions}>
        <button disabled={pending} className={styles.primaryButton}>
          {pending ? "Salvando..." : "Adicionar compra"}
        </button>
        <button type="button" onClick={() => { setAberto(false); setErro(null); }} className={styles.ghostButton}>Cancelar</button>
      </div>
    </form>
  );
}
