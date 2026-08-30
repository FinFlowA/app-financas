"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

type HelpContent = {
  title: string;
  description: string;
  items: readonly string[];
  note?: string;
};

const HELP_BY_ROUTE: ReadonlyArray<{ route: string; exact?: boolean; content: HelpContent }> = [
  {
    route: "/cartoes/",
    content: {
      title: "Detalhes do cartão",
      description: "Acompanhe as compras, parcelas, faturas e pagamentos deste cartão.",
      items: [
        "Consulte o fechamento, o vencimento e a situação de cada fatura.",
        "Compras parceladas entram no mês correspondente a cada parcela.",
        "Registre o pagamento da fatura para refletir o valor nas suas contas.",
      ],
    },
  },
  {
    route: "/transacoes",
    content: {
      title: "Histórico",
      description: "Aqui ficam seus lançamentos realizados, pendentes e atrasados.",
      items: [
        "Use os filtros para localizar receitas, despesas e transferências.",
        "Abra um lançamento para editar, concluir, registrar pagamento parcial, reabrir ou excluir.",
        "Agendamentos continuam pendentes até que o valor seja efetivamente realizado.",
      ],
    },
  },
  {
    route: "/contas",
    content: {
      title: "Contas",
      description: "Cadastre e acompanhe as contas que compõem seu saldo financeiro.",
      items: [
        "Consulte o saldo disponível e as movimentações de cada conta.",
        "Crie, edite, arquive ou compartilhe contas quando a função estiver disponível.",
        "Transferências movem dinheiro entre contas sem virar receita ou despesa.",
      ],
    },
  },
  {
    route: "/conciliacao",
    content: {
      title: "Extrato e conciliação",
      description: "Compare o extrato do banco com os lançamentos do FinFlow.",
      items: [
        "Envie um arquivo CSV ou OFX e escolha a conta correspondente.",
        "Concilie com um lançamento existente, crie um novo ou ignore o item do extrato.",
        "Pagamentos parciais mantêm a diferença pendente; valores excedentes podem ser registrados como juros.",
      ],
      note: "O arquivo original é lido localmente e não é salvo. Apenas suas decisões de conciliação são registradas.",
    },
  },
  {
    route: "/categorias",
    content: {
      title: "Categorias",
      description: "Organize receitas e despesas para entender de onde o dinheiro vem e para onde vai.",
      items: [
        "Crie categorias com nome, cor e ícone para facilitar a identificação.",
        "Editar uma categoria atualiza sua apresentação nos relatórios e lançamentos vinculados.",
        "Categorias em uso podem precisar ser arquivadas em vez de excluídas.",
      ],
    },
  },
  {
    route: "/objetivos",
    content: {
      title: "Objetivos",
      description: "Planeje metas financeiras e acompanhe o dinheiro guardado em cada caixinha.",
      items: [
        "Defina uma meta e uma data para acompanhar a projeção até o prazo.",
        "Use Guardar e Resgatar para movimentar valores entre a conta e o objetivo.",
        "O histórico mostra as movimentações da caixinha separadas por período.",
      ],
    },
  },
  {
    route: "/cartoes",
    exact: true,
    content: {
      title: "Cartões",
      description: "Gerencie cartões de crédito, limites, compras parceladas e faturas.",
      items: [
        "Cadastre os dados básicos e as datas de fechamento e vencimento.",
        "Abra um cartão para conferir compras, parcelas e faturas por mês.",
        "O pagamento da fatura deve sair da conta escolhida apenas uma vez.",
      ],
    },
  },
  {
    route: "/relatorios",
    content: {
      title: "Fluxo de caixa",
      description: "Visualize o saldo realizado e a projeção das suas finanças ao longo do tempo.",
      items: [
        "Passe o cursor ou toque em um mês para ver receitas, despesas e saldo projetado.",
        "Alterne ano, mês e contas para analisar somente o período desejado.",
        "O saldo projetado considera o saldo atual e os valores que ainda estão a receber e a pagar.",
      ],
      note: "Transferências entre suas contas não são tratadas como receita ou despesa.",
    },
  },
  {
    route: "/assistente",
    content: {
      title: "Assistente IA",
      description: "Converse com a IA financeira para analisar dados e preparar ações no FinFlow.",
      items: [
        "Peça resumos, comparações, explicações ou ajuda para organizar as finanças.",
        "Quando houver uma ação financeira, confira todos os dados antes de confirmar.",
        "Limpar a conversa apaga o histórico daquele atendimento.",
      ],
      note: "Nenhuma alteração financeira deve ser aplicada sem sua confirmação.",
    },
  },
  {
    route: "/planos",
    content: {
      title: "Planos",
      description: "Compare os recursos e limites disponíveis em cada plano do FinFlow.",
      items: [
        "Confira o que cada opção inclui além dos recursos do plano anterior.",
        "Analise limites de contas, consultas e funcionalidades antes de escolher.",
        "Seu plano atual aparece identificado nesta tela.",
      ],
    },
  },
  {
    route: "/seguranca",
    content: {
      title: "Segurança",
      description: "Revise os recursos usados para proteger sua conta e seus dados.",
      items: [
        "Atualize sua senha e confira as opções de acesso disponíveis.",
        "Nunca compartilhe senhas, códigos de acesso ou chaves privadas.",
        "Encerre a sessão em dispositivos que não estiver usando.",
      ],
    },
  },
  {
    route: "/configuracoes",
    content: {
      title: "Configurações",
      description: "Personalize sua conta, aparência e preferências do FinFlow.",
      items: [
        "Atualize os dados do perfil e as preferências de exibição.",
        "Acesse as opções de segurança e os documentos legais.",
        "A exclusão da conta é permanente e deve ser confirmada com atenção.",
      ],
    },
  },
  {
    route: "/",
    exact: true,
    content: {
      title: "Início",
      description: "Veja um resumo da sua vida financeira e acesse rapidamente as ações mais usadas.",
      items: [
        "O saldo geral reúne as contas selecionadas e as movimentações realizadas.",
        "Os próximos agendamentos destacam compromissos dos próximos sete dias.",
        "Os gráficos ajudam a comparar receitas e despesas por categoria e período.",
      ],
    },
  },
];

function findHelp(pathname: string) {
  return HELP_BY_ROUTE.find(({ route, exact }) => exact ? pathname === route : pathname.startsWith(route))?.content;
}

export default function ContextualHelp() {
  const pathname = usePathname();
  const content = findHelp(pathname);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  if (!content) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ff-focus fixed bottom-24 right-4 z-40 grid h-12 w-12 place-items-center rounded-full border border-primary/40 bg-surface-raised text-xl font-black text-primary-dark shadow-[0_16px_38px_rgba(0,0,0,0.28)] transition hover:-translate-y-0.5 hover:border-primary hover:bg-primary-soft lg:bottom-6 lg:right-6"
        aria-label={`Ajuda sobre a tela ${content.title}`}
        title={`Ajuda: ${content.title}`}
        onClick={() => setOpen(true)}
      >
        ?
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-[#02090c]/80 p-4 backdrop-blur-[5px]"
          role="presentation"
          onMouseDown={() => setOpen(false)}
        >
          <section
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[28px] border border-primary/30 bg-surface p-6 shadow-[0_32px_100px_rgba(0,0,0,0.55)] sm:p-8"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              ref={closeRef}
              type="button"
              className="ff-focus absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-surface-muted text-xl text-foreground-muted transition hover:text-foreground"
              aria-label="Fechar ajuda"
              onClick={() => setOpen(false)}
            >
              ×
            </button>

            <span className="grid h-14 w-14 place-items-center rounded-2xl border border-primary/30 bg-primary-soft text-2xl font-black text-primary-dark" aria-hidden="true">?</span>
            <p className="mt-5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-primary-dark">Ajuda desta tela</p>
            <h2 id={titleId} className="mt-2 pr-12 text-2xl font-black text-foreground">{content.title}</h2>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-foreground-muted">{content.description}</p>

            <ul className="mt-6 space-y-3">
              {content.items.map((item) => (
                <li key={item} className="flex gap-3 rounded-2xl border border-border bg-surface-muted/60 px-4 py-3 text-sm leading-6 text-foreground">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            {content.note && (
              <p className="mt-4 rounded-2xl border border-primary/25 bg-primary-soft px-4 py-3 text-xs font-semibold leading-5 text-primary-dark">{content.note}</p>
            )}

            <button
              type="button"
              className="ff-focus mt-6 w-full rounded-full bg-primary px-5 py-3 text-sm font-extrabold text-white transition hover:brightness-95"
              onClick={() => setOpen(false)}
            >
              Entendi
            </button>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
