"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { completeRequiredProfile, completeTutorial, type ProfileActionState } from "@/app/(dashboard)/profile-actions";

const INITIAL: ProfileActionState = { status: "idle" };
const STEPS = [
  { title: "Seu painel", text: "Veja saldo, entradas, saídas e previsão. Use o olho para ocultar valores e selecione quais contas entram somente nesta visão." },
  { title: "Transações", text: "Registre receitas, despesas e transferências. Você pode parcelar ou criar recorrências semanais, mensais e anuais." },
  { title: "Histórico", text: "Pesquise, filtre, conclua pagamentos, registre valores parciais e edite somente os itens em aberto de uma série." },
  { title: "Objetivos", text: "Crie caixinhas, guarde ou resgate valores e acompanhe quanto estará acumulado na data da meta." },
  { title: "Cartões", text: "Controle compras, parcelas e faturas. Pagamentos parciais podem manter o restante aberto ou levá-lo à próxima fatura." },
  { title: "Fluxo de caixa", text: "Compare realizado e previsto no mesmo gráfico e filtre uma ou várias contas sem alterar as demais telas." },
  { title: "IA financeira", text: "Peça análises ou ações em linguagem natural. A IA prepara uma prévia e só executa depois da sua confirmação." },
  { title: "Ajustes e segurança", text: "Edite perfil, preferências, parceria e plano. Nunca compartilhe senha, código recebido ou dados bancários no chat." },
];

export default function ProfileAndTutorial({ missingBirth, missingTerms, tutorialPending }: { missingBirth: boolean; missingTerms: boolean; tutorialPending: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profileState, profileAction, profilePending] = useActionState(completeRequiredProfile, INITIAL);
  const [tutorialState, tutorialAction, tutorialSaving] = useActionState(completeTutorial, INITIAL);
  const profileDone = (!missingBirth && !missingTerms) || profileState.status === "success";
  const tutorialDone = !tutorialPending || tutorialState.status === "success";
  useEffect(() => {
    // Atualiza o metadata lido pelo layout e permite que inicializações
    // protegidas (como as categorias padrão) sejam tentadas após o aceite.
    if (profileState.status === "success") router.refresh();
  }, [profileState.status, router]);
  if (profileDone && tutorialDone) return null;

  if (!profileDone) return <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="profile-title" className="my-auto w-full max-w-lg rounded-ff-lg border border-border bg-surface p-6 shadow-2xl"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-3xl text-primary">♙</div><h1 id="profile-title" className="mt-4 text-center text-2xl font-black">Complete seu cadastro</h1><p className="mt-2 text-center text-sm text-foreground-muted">Novas informações obrigatórias sempre aparecem aqui, sem impedir o acesso aos Ajustes.</p><form action={profileAction} className="mt-5 grid gap-4">{missingBirth && <label className="text-sm font-bold">Data de nascimento<input type="date" name="data_nascimento" required className="mt-1 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-3 font-normal outline-none focus:border-primary" /></label>}{missingTerms && <label className="flex items-start gap-3 rounded-ff-sm border border-border p-3 text-sm"><input type="checkbox" name="aceite_legal" required className="mt-1" /><span>Li e concordo com os <Link href="/termos" target="_blank" className="font-bold text-primary">Termos de Uso</Link> e a <Link href="/privacidade" target="_blank" className="font-bold text-primary">Política de Privacidade</Link>.</span></label>}{profileState.status === "error" && <p role="alert" className="rounded-ff-sm bg-red/10 p-3 text-sm font-semibold text-red">{profileState.message}</p>}<button disabled={profilePending} className="rounded-ff-sm bg-primary px-5 py-3 font-extrabold text-white disabled:opacity-50">{profilePending ? "Salvando..." : "Salvar e continuar"}</button></form></section></div>;

  const current = STEPS[step];
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="tutorial-title" className="w-full max-w-xl rounded-ff-lg border border-border bg-surface p-6 shadow-2xl"><div className="flex items-center justify-between"><span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-black text-primary">{step + 1} de {STEPS.length}</span><form action={tutorialAction}><button disabled={tutorialSaving} className="text-xs font-bold text-foreground-muted">Pular tutorial</button></form></div><div className="mt-8 text-center"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary-soft to-mint/30 text-4xl text-primary">✦</div><h1 id="tutorial-title" className="mt-5 text-2xl font-black">{current.title}</h1><p className="mx-auto mt-3 max-w-md leading-relaxed text-foreground-muted">{current.text}</p></div><div className="mt-8 flex gap-3"><button type="button" disabled={step === 0} onClick={() => setStep((value) => value - 1)} className="flex-1 rounded-ff-sm border border-border px-4 py-3 font-bold disabled:opacity-30">Voltar</button>{step < STEPS.length - 1 ? <button type="button" onClick={() => setStep((value) => value + 1)} className="flex-[1.4] rounded-ff-sm bg-primary px-4 py-3 font-extrabold text-white">Próximo</button> : <form action={tutorialAction} className="flex-[1.4]"><button disabled={tutorialSaving} className="h-full w-full rounded-ff-sm bg-primary px-4 py-3 font-extrabold text-white">{tutorialSaving ? "Concluindo..." : "Começar a usar"}</button></form>}</div>{tutorialState.status === "error" && <p role="alert" className="mt-3 text-center text-sm font-semibold text-red">{tutorialState.message}</p>}</section></div>;
}
