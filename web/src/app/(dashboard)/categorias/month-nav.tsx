"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { PeriodNavigator } from "../transacoes/month-picker";
import { monthTitle, shiftMonth } from "../transacoes/transaction-model";

/** Mês das metas e limites: setas e escolha de mês e ano (passado ou futuro). */
export default function CategoryMonthNav({ month, currentMonth }: { month: string; currentMonth: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (next: string) => startTransition(() => router.push(next === currentMonth ? "/categorias" : `/categorias?mes=${next}`, { scroll: false }));
  return <div className={`transition-opacity ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
    <PeriodNavigator month={month} currentMonth={currentMonth} label={monthTitle(month)} onChange={go} onStep={(delta) => go(shiftMonth(month, delta))} />
  </div>;
}
