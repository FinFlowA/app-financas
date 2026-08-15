"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useActionState, useEffect, useRef, useState } from "react";
import { completeRequiredProfile, completeTutorial, type ProfileActionState } from "@/app/(dashboard)/profile-actions";
import BrandLogo from "@/components/layout/brand-logo";
import styles from "./profile-and-tutorial.module.css";

const INITIAL: ProfileActionState = { status: "idle" };
const STEPS = [
  { title: "Seu painel na web", label: "Painel", text: "Acompanhe saldo, entradas, saídas e previsão. Use o seletor de contas no card principal para montar apenas esta visão." },
  { title: "Contas e transações", label: "Transações", text: "Cadastre contas e categorias pelo menu. Depois registre receitas, despesas e transferências, à vista, parceladas ou recorrentes." },
  { title: "Histórico", label: "Histórico", text: "Pesquise, filtre, conclua pagamentos, registre valores parciais e edite somente os itens em aberto de uma série." },
  { title: "Objetivos", label: "Objetivos", text: "Crie caixinhas, guarde ou resgate valores e acompanhe quanto estará acumulado na data da meta." },
  { title: "Cartões", label: "Cartões", text: "Controle compras, parcelas e faturas. Pagamentos parciais podem manter o restante aberto ou levá-lo à próxima fatura." },
  { title: "Fluxo de caixa", label: "Fluxo", text: "Compare realizado e previsto no mesmo gráfico e filtre uma ou várias contas sem alterar as demais telas." },
  { title: "IA financeira", label: "IA", text: "Peça análises ou ações em linguagem natural. A IA prepara uma prévia e só executa depois da sua confirmação." },
  { title: "Ajustes e segurança", label: "Ajustes", text: "Edite perfil, preferências, parceria e plano. Nunca compartilhe senha, código recebido ou dados bancários no chat." },
];

function Icon({ name, className = "" }: { name: "profile" | "shield" | "arrow" | "check" | "spark" | "back" | "calendar"; className?: string }) {
  const paths = {
    profile: <><circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/></>,
    shield: <><path d="M12 3 5.5 5.8v5.5c0 4.1 2.7 7.8 6.5 9.7 3.8-1.9 6.5-5.6 6.5-9.7V5.8L12 3Z"/><path d="m9.2 12 1.8 1.8 3.8-4"/></>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    back: <><path d="M19 12H5"/><path d="m10 7-5 5 5 5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    spark: <><path d="m12 2 1.2 4.1L17 8l-3.8 1.9L12 14l-1.2-4.1L7 8l3.8-1.9L12 2Z"/><path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z"/></>,
    calendar: <><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></>,
  };
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function StepVisual({ step }: { step: number }) {
  return <div className={styles.stepVisual} aria-hidden="true">
    <span className={styles.visualGlow} />
    <div className={styles.productPreview} data-step={step}>
      {step === 0 && <><div className={styles.previewHero}><small>Saldo geral</small><strong>R$ 8.450,00</strong><span>2 contas ⌄</span></div><div className={styles.previewStats}><i /><i /><i /></div></>}
      {step === 1 && <><div className={styles.previewTabs}><b>Receita</b><b>Despesa</b><b>Transferir</b></div><div className={styles.previewInput}>R$ 245,80</div><div className={styles.previewButton}>Revisar lançamento</div></>}
      {step === 2 && <><div className={styles.previewTabs}><b>Todos</b><b>Pendentes</b><b>Atrasados</b></div><div className={styles.previewRows}><span><i />Salário <em>Concluído</em></span><span><i />Aluguel <em>Pendente</em></span><span><i />Internet <em>Atrasado</em></span></div></>}
      {step === 3 && <><div className={styles.previewGoal}><Icon name="spark"/><div><b>Reserva de emergência</b><small>R$ 6.200 de R$ 10.000</small></div></div><div className={styles.previewProgress}><span /></div><div className={styles.previewActions}><b>Guardar</b><b>Resgatar</b><b>Histórico</b></div></>}
      {step === 4 && <><div className={styles.previewCard}><small>FinFlow Visa</small><b>R$ 1.350,00</b><span>Vence 28 AGO</span></div><div className={styles.previewActions}><b>Comprar</b><b>Pagar fatura</b></div></>}
      {step === 5 && <><div className={styles.previewChart}>{[43, 66, 51, 78, 61, 86].map((height) => <span key={height} style={{ height: `${height}%` }} />)}</div><div className={styles.previewLegend}><i /> Realizado <i /> Previsto</div></>}
      {step === 6 && <><div className={styles.previewChat}><span>Como estão meus gastos?</span><span><Icon name="spark"/> Veja sua análise financeira.</span></div><div className={styles.previewButton}>Confirmar somente após revisar</div></>}
      {step === 7 && <><div className={styles.previewSettings}><span><Icon name="shield"/> Segurança <i /></span><span>Notificações <i /></span><span>Preferências <b>›</b></span></div></>}
    </div>
  </div>;
}

function keepFocusInside(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getAttribute("aria-hidden") !== "true");
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
  if (activeIndex === -1) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function ProfileAndTutorial({ missingBirth, missingTerms, tutorialPending }: { missingBirth: boolean; missingTerms: boolean; tutorialPending: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const profileDialogRef = useRef<HTMLElement>(null);
  const tutorialTitleRef = useRef<HTMLHeadingElement>(null);
  const [profileState, profileAction, profilePending] = useActionState(completeRequiredProfile, INITIAL);
  const [tutorialState, tutorialAction, tutorialSaving] = useActionState(completeTutorial, INITIAL);
  const profileDone = (!missingBirth && !missingTerms) || profileState.status === "success";
  const tutorialDone = !tutorialPending || tutorialState.status === "success";

  useEffect(() => {
    // Atualiza o metadata lido pelo layout e permite que inicializações
    // protegidas (como as categorias padrão) sejam tentadas após o aceite.
    if (profileState.status === "success") router.refresh();
  }, [profileState.status, router]);

  useEffect(() => {
    if (profileDone && tutorialDone) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      if (!profileDone) profileDialogRef.current?.focus();
      else tutorialTitleRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [profileDone, tutorialDone, step]);

  if (profileDone && tutorialDone) return null;

  if (!profileDone) {
    return (
      <div className={styles.overlay}>
        <section
          ref={profileDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-title"
          aria-describedby="profile-description"
          tabIndex={-1}
          onKeyDown={keepFocusInside}
          className={`${styles.dialog} ${styles.profileDialog}`}
        >
          <div className={styles.dialogAccent} aria-hidden="true" />
          <aside className={styles.profileIntro}>
            <BrandLogo className={styles.brand} priority />
            <span className={styles.eyebrow}><Icon name="shield" /> Cadastro protegido</span>
            <h1 id="profile-title">Complete seu cadastro</h1>
            <p id="profile-description">Novas informações obrigatórias sempre aparecem aqui, sem impedir o acesso aos Ajustes.</p>
            <div className={styles.trustCard}>
              <span><Icon name="shield" /></span>
              <div><strong>Seus dados, suas regras</strong><small>Usamos estas informações apenas para proteger e personalizar sua experiência.</small></div>
            </div>
          </aside>

          <div className={styles.formPanel}>
            <div className={styles.profileIcon}><Icon name="profile" /></div>
            <div className={styles.mobileTitle} aria-hidden="true">
              <strong>Complete seu cadastro</strong>
              <span>Leva menos de um minuto.</span>
            </div>
            <form action={profileAction} className={styles.form}>
              {missingBirth && (
                <label className={styles.field}>
                  <span>Data de nascimento</span>
                  <span className={styles.inputWrap}><Icon name="calendar" /><input type="date" name="data_nascimento" required /></span>
                  <small>O FinFlow é exclusivo para maiores de 18 anos.</small>
                </label>
              )}
              {missingTerms && (
                <label className={styles.consent}>
                  <input type="checkbox" name="aceite_legal" required />
                  <span className={styles.checkbox} aria-hidden="true"><Icon name="check" /></span>
                  <span>Li e concordo com os <Link href="/termos" target="_blank" rel="noreferrer">Termos de Uso<span className={styles.srOnly}> (abre em uma nova aba)</span></Link> e a <Link href="/privacidade" target="_blank" rel="noreferrer">Política de Privacidade<span className={styles.srOnly}> (abre em uma nova aba)</span></Link>.</span>
                </label>
              )}
              {profileState.status === "error" && <p role="alert" className={styles.errorMessage}>{profileState.message}</p>}
              <button disabled={profilePending} className={styles.primaryButton}>
                <span>{profilePending ? "Salvando..." : "Salvar e continuar"}</span>
                {!profilePending && <Icon name="arrow" />}
              </button>
            </form>
          </div>
        </section>
      </div>
    );
  }

  const current = STEPS[step];
  return (
    <div className={styles.overlay}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-description"
        onKeyDown={keepFocusInside}
        className={`${styles.dialog} ${styles.tutorialDialog}`}
      >
        <div className={styles.dialogAccent} aria-hidden="true" />
        <div className={styles.tutorialTopbar}>
          <BrandLogo className={styles.brand} />
          <form action={tutorialAction}>
            <button disabled={tutorialSaving} className={styles.skipButton}>Pular tutorial</button>
          </form>
        </div>

        <div className={styles.tutorialBody}>
          <aside className={styles.tutorialRail} aria-label="Progresso do tutorial">
            <span className={styles.progressLabel}>Primeiros passos</span>
            <ol>
              {STEPS.map((item, index) => (
                <li key={item.title} data-current={index === step} data-complete={index < step} aria-current={index === step ? "step" : undefined}>
                  <span>{index < step ? <Icon name="check" /> : index + 1}</span>
                  <small>{item.label}</small>
                </li>
              ))}
            </ol>
          </aside>

          <div className={styles.tutorialContent}>
            <span className={styles.counter}>{String(step + 1).padStart(2, "0")} <i /> {String(STEPS.length).padStart(2, "0")}</span>
            <StepVisual step={step} />
            <h1 id="tutorial-title" ref={tutorialTitleRef} tabIndex={-1}>{current.title}</h1>
            <p id="tutorial-description">{current.text}</p>
            <div className={styles.mobileProgress} aria-hidden="true">
              {STEPS.map((item, index) => <span key={item.title} data-active={index <= step} />)}
            </div>
          </div>
        </div>

        <div className={styles.tutorialFooter}>
          <button type="button" disabled={step === 0} onClick={() => setStep((value) => value - 1)} className={styles.secondaryButton}>
            <Icon name="back" /> Voltar
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={() => setStep((value) => value + 1)} className={styles.primaryButton}>
              Próximo <Icon name="arrow" />
            </button>
          ) : (
            <form action={tutorialAction}>
              <button disabled={tutorialSaving} className={styles.primaryButton}>
                {tutorialSaving ? "Concluindo..." : "Começar a usar"}
                {!tutorialSaving && <Icon name="check" />}
              </button>
            </form>
          )}
        </div>
        {tutorialState.status === "error" && <p role="alert" className={`${styles.errorMessage} ${styles.tutorialError}`}>{tutorialState.message}</p>}
      </section>
    </div>
  );
}
