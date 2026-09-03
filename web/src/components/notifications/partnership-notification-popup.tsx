"use client";

import { useEffect, useState, useTransition } from "react";
import { markSystemNotificationAction } from "@/app/(dashboard)/configuracoes/actions";

export type PartnershipNotification = {
  id: number;
  tipo: string;
  titulo: string;
  mensagem: string;
  criada_em: string;
};

export default function PartnershipNotificationPopup({ notifications }: { notifications: PartnershipNotification[] }) {
  const [queue, setQueue] = useState(notifications);
  const [pending, startTransition] = useTransition();
  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [current]);

  if (!current) return null;
  const ended = current.tipo === "parceria_encerrada" || current.tipo === "parceria_recusada";

  function acknowledge() {
    if (pending) return;
    const formData = new FormData();
    formData.set("notification_id", String(current.id));
    startTransition(async () => {
      await markSystemNotificationAction(formData);
      setQueue((items) => items.slice(1));
    });
  }

  return <div className="fixed inset-0 z-[10050] grid h-[100dvh] w-screen place-items-center overflow-hidden bg-[#02090c]/82 p-4 backdrop-blur-[6px]" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="partnership-notification-title" className={`w-full max-w-lg rounded-[26px] border bg-surface p-6 text-center shadow-[0_32px_100px_rgba(0,0,0,.55)] ${ended ? "border-orange/30" : "border-primary/30"}`}>
      <span aria-hidden="true" className={`mx-auto grid h-16 w-16 place-items-center rounded-2xl text-3xl ${ended ? "bg-orange/10 text-orange" : "bg-primary/10 text-primary"}`}>{ended ? "↔" : "✓"}</span>
      <p className={`mt-5 text-[10px] font-extrabold uppercase tracking-[.16em] ${ended ? "text-orange" : "text-primary"}`}>Atualização de parceria</p>
      <h2 id="partnership-notification-title" className="mt-2 text-2xl font-black text-foreground">{current.titulo}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-foreground-muted">{current.mensagem}</p>
      {queue.length > 1 && <p className="mt-3 text-xs font-bold text-foreground-muted">Mais {queue.length - 1} {queue.length === 2 ? "aviso" : "avisos"} em seguida</p>}
      <button type="button" disabled={pending} onClick={acknowledge} className="ff-focus mt-6 min-w-44 rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white disabled:opacity-50">{pending ? "Confirmando..." : "Entendi"}</button>
    </section>
  </div>;
}
