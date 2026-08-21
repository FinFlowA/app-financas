"use client";

import { useEffect } from "react";
import { hojeEmSaoPaulo } from "@/lib/date";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/pagination";
import {
  evaluateFinancialNotificationEvents,
  markNotificationAsShown,
  notificationPreferencesKey,
  notificationWasShown,
  readWebNotificationPreferences,
  WEB_NOTIFICATION_PREFERENCES_CHANGED_EVENT,
  type WebNotificationCard,
  type WebNotificationGoal,
  type WebNotificationInvoiceItem,
  type WebNotificationTransaction,
} from "@/lib/web-notifications";

const REEVALUATION_INTERVAL_MS = 5 * 60 * 1_000;
const LOCAL_NOTIFICATION_TAG_PREFIX = "finflow-web-local:";

function notificationsAreAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const secureOrigin = window.location.protocol === "https:"
    || window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1";
  return secureOrigin
    && "Notification" in window
    && "serviceWorker" in navigator
    && Notification.permission === "granted";
}

async function notificationRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!notificationsAreAvailable()) return null;
  try {
    return await navigator.serviceWorker.getRegistration("/")
      ?? await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

async function closeLocalFinancialNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const notifications = await registration?.getNotifications() ?? [];
    for (const notification of notifications) {
      if (notification.tag.startsWith(LOCAL_NOTIFICATION_TAG_PREFIX)) notification.close();
    }
  } catch {
    // A sessão já foi invalidada. Falha do navegador ao fechar uma notificação
    // previamente exibida não autoriza nenhum novo acesso ou aviso.
  }
}

export default function FinancialNotificationScheduler({ userId }: { userId: string }) {
  useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    let sessionGeneration = 0;
    let running = false;
    let rerunRequested = false;

    async function sessionStillBelongsToUser(expectedGeneration: number): Promise<boolean> {
      if (
        stopped
        || expectedGeneration !== sessionGeneration
        || document.visibilityState !== "visible"
        || !navigator.onLine
        || !notificationsAreAvailable()
      ) {
        return false;
      }
      const { data } = await supabase.auth.getSession();
      return !stopped
        && expectedGeneration === sessionGeneration
        && data.session?.user.id === userId
        && document.visibilityState === "visible"
        && navigator.onLine
        && notificationsAreAvailable();
    }

    async function evaluateAndNotify(expectedGeneration: number): Promise<void> {
      if (!await sessionStillBelongsToUser(expectedGeneration)) return;

      const today = hojeEmSaoPaulo();
      const currentMonth = today.slice(0, 7);
      let preferences;
      try {
        preferences = readWebNotificationPreferences(localStorage, userId);
      } catch {
        return;
      }

      const needsTransactions = preferences.overdue || preferences.today;
      const needsCards = preferences.invoiceClosing || preferences.invoiceDue || preferences.cardLimit;
      const emptyResult = { data: [] as unknown[], error: null };
      const [transactionsResult, cardsResult, goalsResult] = await Promise.all([
        needsTransactions ? fetchAllRows((from, to) => supabase
          .from("transacoes")
          .select("id, status, tipo, data_vencimento")
          .eq("status", "pendente")
          .lte("data_vencimento", today)
          .order("id")
          .range(from, to)) : Promise.resolve(emptyResult),
        needsCards ? supabase
          .from("cartoes")
          .select("id, nome, limite, dia_vencimento, dia_fechamento, ativo")
          .eq("ativo", true)
          .order("id") : Promise.resolve(emptyResult),
        preferences.goalDeadline ? supabase
          .from("caixinhas")
          .select("id, nome, meta_valor, saldo_atual, data_prazo, arquivado")
          .eq("arquivado", false)
          .not("data_prazo", "is", null)
          .order("id") : Promise.resolve(emptyResult),
      ]);

      if (
        transactionsResult.error
        || cardsResult.error
        || goalsResult.error
        || !await sessionStillBelongsToUser(expectedGeneration)
      ) return;

      const cards = (cardsResult.data ?? []) as WebNotificationCard[];
      let invoiceItems: WebNotificationInvoiceItem[] = [];
      if ((preferences.invoiceDue || preferences.cardLimit) && cards.length > 0) {
        const activeCardIds = cards.map((card) => card.id);
        const invoiceItemsResult = await fetchAllRows((from, to) => supabase
          .from("fatura_itens")
          .select("cartao_id, mes_fatura, valor, pago, descricao")
          .in("cartao_id", activeCardIds)
          .eq("pago", false)
          // Faturas passadas não entram nos marcos futuros nem no cálculo de
          // limite adotado pelas telas web; evita reler todo o histórico.
          .gte("mes_fatura", currentMonth)
          .order("id")
          .range(from, to));
        if (invoiceItemsResult.error || !await sessionStillBelongsToUser(expectedGeneration)) return;
        invoiceItems = (invoiceItemsResult.data ?? []) as WebNotificationInvoiceItem[];
      }

      const events = evaluateFinancialNotificationEvents({
        today,
        preferences,
        transactions: (transactionsResult.data ?? []) as WebNotificationTransaction[],
        cards,
        invoiceItems,
        goals: (goalsResult.data ?? []) as WebNotificationGoal[],
      });
      if (events.length === 0 || !await sessionStillBelongsToUser(expectedGeneration)) return;

      const registration = await notificationRegistration();
      if (!registration || !await sessionStillBelongsToUser(expectedGeneration)) return;

      for (const event of events) {
        let alreadyShown = true;
        try {
          alreadyShown = notificationWasShown(localStorage, userId, event.key, today);
        } catch {
          // Sem armazenamento disponível não há deduplicação segura; por isso o
          // evento não é exibido repetidamente a cada reavaliação.
          continue;
        }
        if (alreadyShown || !await sessionStillBelongsToUser(expectedGeneration)) continue;

        try {
          // Texto genérico por padrão: título/corpo específicos (nome do
          // cartão, valores, percentual do limite) podem ficar visíveis na
          // tela bloqueada, fora do controle do FinFlow. O detalhe completo
          // continua disponível ao abrir o app autenticado — a rota de
          // navegação (event.route) e a deduplicação (event.key) não mudam.
          await registration.showNotification("FinFlow", {
            body: "Você tem uma atualização financeira. Abra o app para ver os detalhes.",
            icon: "/icon.png",
            badge: "/icon.png",
            tag: `${LOCAL_NOTIFICATION_TAG_PREFIX}${event.key}`,
            data: { route: event.route },
          });
          if (!await sessionStillBelongsToUser(expectedGeneration)) {
            await closeLocalFinancialNotifications();
            return;
          }
          markNotificationAsShown(localStorage, userId, event.key, today);
        } catch {
          // Permissão revogada, storage bloqueado ou falha do Service Worker:
          // nenhum marcador é gravado e a próxima reavaliação pode tentar de novo.
        }
      }
    }

    function requestEvaluation() {
      if (stopped || document.visibilityState !== "visible") return;
      if (running) {
        rerunRequested = true;
        return;
      }
      running = true;
      const expectedGeneration = sessionGeneration;
      void evaluateAndNotify(expectedGeneration).finally(() => {
        running = false;
        if (rerunRequested && !stopped) {
          rerunRequested = false;
          requestEvaluation();
        }
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        requestEvaluation();
        return;
      }
      // Invalida com segurança uma avaliação que estava em andamento. Ao
      // voltar para a aba, uma nova geração consulta apenas dados atuais.
      sessionGeneration += 1;
      rerunRequested = false;
    }

    function handlePreferenceChange(event: Event) {
      const detail = (event as CustomEvent<{ userId?: unknown }>).detail;
      if (!detail || detail.userId === userId) requestEvaluation();
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === notificationPreferencesKey(userId)) requestEvaluation();
    }

    const authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId) {
        sessionGeneration += 1;
        rerunRequested = false;
        void closeLocalFinancialNotifications();
        return;
      }
      requestEvaluation();
    });

    window.addEventListener("online", requestEvaluation);
    window.addEventListener(WEB_NOTIFICATION_PREFERENCES_CHANGED_EVENT, handlePreferenceChange);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const interval = window.setInterval(requestEvaluation, REEVALUATION_INTERVAL_MS);
    requestEvaluation();

    return () => {
      stopped = true;
      sessionGeneration += 1;
      window.clearInterval(interval);
      window.removeEventListener("online", requestEvaluation);
      window.removeEventListener(WEB_NOTIFICATION_PREFERENCES_CHANGED_EVENT, handlePreferenceChange);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      authSubscription.data.subscription.unsubscribe();
      void closeLocalFinancialNotifications();
    };
  }, [userId]);

  return null;
}
