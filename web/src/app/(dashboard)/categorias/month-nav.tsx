"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import MonthPicker from "../transacoes/month-picker";
import { monthTitle, shiftMonth } from "../transacoes/transaction-model";

/** Mês das metas e limites: setas e escolha de mês e ano (passado ou futuro). */
export default function CategoryMonthNav({ month, currentMonth }: { month: string; currentMonth: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (next: string) => startTransition(() => router.push(next === currentMonth ? "/categorias" : `/categorias?mes=${next}`, { scroll: false }));
  const arrow = "ff-focus grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/10 text-xl font-black text-white transition hover:bg-white/10";
  return <div className={`flex items-center gap-2 transition-opacity ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
    <button type="button" onClick={() => go(shiftMonth(month, -1))} aria-label="Mês anterior" className={arrow}>‹</button>
    <MonthPicker month={month} currentMonth={currentMonth} label={monthTitle(month)} onChange={go} />
    <button type="button" onClick={() => go(shiftMonth(month, 1))} aria-label="Próximo mês" className={arrow}>›</button>
  </div>;
}
