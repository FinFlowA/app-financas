"use client";

import { useState } from "react";

function formatCents(digits: string): string {
  const cents = Number(digits || "0");
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function initialValue(value: number | string | undefined): string {
  if (value === undefined || value === "") return "";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "";
  return numeric.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CurrencyInput({
  name,
  defaultValue,
  required = false,
  className = "",
  ariaLabel,
}: {
  name: string;
  defaultValue?: number | string;
  required?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [value, setValue] = useState(() => initialValue(defaultValue));

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-foreground-muted">R$</span>
      <input
        name={name}
        required={required}
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 14);
          setValue(digits ? formatCents(digits) : "");
        }}
        onFocus={(event) => {
          const input = event.currentTarget;
          requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
        }}
        placeholder="0,00"
        aria-label={ariaLabel}
        className={`w-full rounded-ff-sm border border-border bg-surface-muted py-2.5 pl-10 pr-3 text-foreground outline-none focus:border-primary ${className}`}
      />
    </div>
  );
}
