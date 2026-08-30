"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  confirmName?: string;
  confirmValue?: string;
  confirmFormId?: string;
  children?: ReactNode;
};

export default function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  pending = false,
  onClose,
  onConfirm,
  confirmName,
  confirmValue,
  confirmFormId,
  children,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const pendingRef = useRef(pending);

  useEffect(() => {
    closeRef.current = onClose;
    pendingRef.current = pending;
  }, [onClose, pending]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !panelRef.current?.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !panelRef.current?.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-[#02090c]/80 p-4 backdrop-blur-[5px]"
      onMouseDown={() => { if (!pending) onClose(); }}
      role="presentation"
    >
      <section
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[26px] border border-primary/20 bg-surface p-6 text-center shadow-[0_32px_100px_rgba(0,0,0,0.52)] sm:p-7"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-red/20 bg-red/10 text-red" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5M12 17h.01" /><path d="M10.3 3.6 2.4 17.2A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.8L13.7 3.6a2 2 0 0 0-3.4 0Z" /></svg>
        </span>
        <p className="mt-4 text-[10px] font-extrabold uppercase tracking-[0.16em] text-red">Confirmação necessária</p>
        <h2 id={titleId} className="mt-2 text-xl font-black text-foreground">{title}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-foreground-muted">{description}</p>
        {children}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button ref={cancelRef} type="button" disabled={pending} onClick={onClose} className="ff-focus rounded-full border border-border px-4 py-3 text-sm font-bold text-foreground-muted transition hover:bg-surface-muted disabled:opacity-50">Voltar</button>
          <button
            type={onConfirm ? "button" : "submit"}
            name={onConfirm ? undefined : confirmName}
            value={onConfirm ? undefined : confirmValue}
            form={onConfirm ? undefined : confirmFormId}
            disabled={pending}
            onClick={onConfirm}
            className="ff-focus rounded-full bg-red px-4 py-3 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(238,107,99,0.2)] transition hover:brightness-95 disabled:opacity-50"
          >
            {pending ? "Processando..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
