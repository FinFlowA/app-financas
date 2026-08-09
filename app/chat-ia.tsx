import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FinFlowColors, FinFlowRadius, FinFlowShadow, finFlowTheme } from "../constants/finflow-design";
import { usuarioPodeAcessarIA } from "../constants/features";
import { parseFinanceAiHttpResponse } from "../lib/finance-ai/validation";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "./_layout";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
};

type AiQuota = {
  plan?: "free" | "smart" | "premium" | string;
  limit?: number;
  used?: number;
  remaining?: number;
  model_limit?: number;
  model_used?: number;
  model_remaining?: number;
  limits_enabled?: boolean;
  window_end?: string;
};

type PendingAction = {
  id: string;
  confirmationToken: string;
  actionType: string;
  expiresAt: string;
  preview?: {
    title?: string;
    summary?: string;
    consequences?: string[];
  };
};

type FinanceAiResponse = {
  kind?: "answer" | "clarify" | "proposal" | "navigate" | "executed" | "cancelled";
  conversationId?: string | null;
  message?: string;
  route?: string;
  quota?: AiQuota;
  messages?: {
    id: string;
    role: "user" | "assistant";
    text: string;
    createdAt?: string;
  }[];
  pendingAction?: PendingAction;
  action?: {
    ok?: boolean;
    error_code?: string;
  };
  cleared?: boolean;
  error?: string;
};

class FinanceAiRequestError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "FinanceAiRequestError";
    this.code = code;
    this.status = status;
  }
}

const WELCOME_MESSAGE = "Olá! Sou a IA financeira do FinFlow. Posso consultar seus dados e preparar ações financeiras para você revisar. Nenhuma alteração é feita sem você tocar em Confirmar.";
function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function planLabel(plan?: string): string {
  if (plan === "premium") return "Premium";
  if (plan === "smart") return "Smart";
  if (plan === "free") return "Free";
  return "Beta";
}

function actionTitle(action: PendingAction): string {
  return action.preview?.title?.trim() || "Revise a ação financeira";
}

function actionSummary(action: PendingAction): string {
  return action.preview?.summary?.trim() || "Confira todas as informações antes de confirmar.";
}

const volatileWebStorage = new Map<string, string>();

function browserSessionStorage(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

async function secureStorageGetItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return browserSessionStorage()?.getItem(key) ?? volatileWebStorage.get(key) ?? null;
    } catch {
      return volatileWebStorage.get(key) ?? null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureStorageSetItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    volatileWebStorage.set(key, value);
    try {
      browserSessionStorage()?.setItem(key, value);
    } catch {
      // A memória da aba permanece como fallback sem persistência duradoura.
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // O servidor continua sendo a fonte de verdade da conversa e da proposta.
  }
}

async function secureStorageRemoveItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    volatileWebStorage.delete(key);
    try {
      browserSessionStorage()?.removeItem(key);
    } catch {
      // O fallback em memória já foi limpo.
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // A expiração e o cancelamento continuam protegidos no servidor.
  }
}

async function migrateLegacyNativeStorage(legacyKey: string, secureKey: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const legacyValue = await AsyncStorage.getItem(legacyKey);
    // Remove primeiro o texto simples; se o cofre falhar, o valor permanece
    // apenas em memória nesta abertura e será recuperado do servidor depois.
    await AsyncStorage.removeItem(legacyKey);
    if (legacyValue) await secureStorageSetItem(secureKey, legacyValue);
    return legacyValue;
  } catch {
    try {
      await AsyncStorage.removeItem(legacyKey);
    } catch {
      // Nova tentativa ocorrerá na próxima abertura.
    }
    return null;
  }
}

async function removeLegacyNativeStorage(key: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // A remoção será tentada novamente na próxima abertura.
  }
}

function parseCachedPendingAction(value: string | null): PendingAction | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const preview = parsed.preview && typeof parsed.preview === "object" && !Array.isArray(parsed.preview)
      ? parsed.preview as Record<string, unknown>
      : undefined;
    const action: PendingAction = {
      id: typeof parsed.id === "string" ? parsed.id : "",
      confirmationToken: typeof parsed.confirmationToken === "string" ? parsed.confirmationToken : "",
      actionType: typeof parsed.actionType === "string" ? parsed.actionType : "",
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : "",
      ...(preview ? {
        preview: {
          ...(typeof preview.title === "string" ? { title: preview.title } : {}),
          ...(typeof preview.summary === "string" ? { summary: preview.summary } : {}),
          ...(Array.isArray(preview.consequences) && preview.consequences.every((item) => typeof item === "string")
            ? { consequences: preview.consequences.slice(0, 20) as string[] }
            : {}),
        },
      } : {}),
    };
    if (!/^[0-9a-f-]{36}$/i.test(action.id)
      || !/^[0-9a-f-]{36}$/i.test(action.confirmationToken)
      || !action.actionType
      || !Number.isFinite(Date.parse(action.expiresAt))
      || Date.parse(action.expiresAt) <= Date.now()) return null;
    return action;
  } catch {
    return null;
  }
}

async function invokeFinanceAi(body: Record<string, unknown>, accessToken?: string): Promise<FinanceAiResponse> {
  const { data, error } = await supabase.functions.invoke("finance-ai", {
    body,
    // Vincula toda a operação ao usuário que a iniciou. Sem isso, uma troca
    // de conta durante uma chamada composta (cancelar + limpar, por exemplo)
    // poderia fazer a etapa seguinte usar a sessão nova.
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
  });
  if (error) {
    let message = body.mode === "confirm"
      ? "Não foi possível confirmar o resultado. Toque novamente em Confirmar: o FinFlow verificará a mesma ação sem duplicá-la."
      : "Não foi possível acessar a IA agora. Nenhuma nova alteração financeira foi iniciada.";
    let code: string | undefined;
    let status: number | undefined;
    const context = (error as { context?: unknown }).context;
    if (typeof Response !== "undefined" && context instanceof Response) {
      status = context.status;
      try {
        const payload = await context.clone().json() as FinanceAiResponse;
        if (typeof payload?.error === "string") code = payload.error;
        if (payload?.message) message = payload.message;
      } catch {
        // Mantém a mensagem segura; nunca exibe detalhes internos do servidor.
      }
    }
    throw new FinanceAiRequestError(message, code, status);
  }
  const validation = parseFinanceAiHttpResponse(data);
  if (!validation.ok) throw new Error("A IA retornou uma resposta inválida. Nenhuma ação foi realizada.");
  const response = validation.value as FinanceAiResponse;
  if (response.error) {
    throw new FinanceAiRequestError(
      response.message || "A solicitação não pôde ser concluída.",
      response.error,
    );
  }
  return response;
}

function isTerminalConfirmationError(error: unknown): boolean {
  if (!(error instanceof FinanceAiRequestError)) return false;
  return error.status === 404
    || error.status === 409
    || error.code === "AI_PLAN_RESOURCE_LIMIT"
    || error.code === "AI_ACTION_STATE_CHANGED"
    || error.code === "AI_ACTION_EXPIRED"
    || error.code === "AI_ACTION_CANCELLED"
    || error.code === "AI_ACTION_NOT_EXECUTABLE"
    || error.code === "AI_ACTION_NOT_FOUND"
    || error.code === "PENDING_ACTION_EXPIRED"
    || error.code === "PENDING_ACTION_NOT_FOUND";
}

export default function ChatIAScreen() {
  const router = useRouter();
  const { isDark, session, limites, limitsEnabled, showToast } = useAppTheme();
  const theme = finFlowTheme(isDark);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const sendingRef = useRef(false);
  const clearingRef = useRef(false);
  const previousUserIdRef = useRef<string | null>(session?.user?.id ?? null);
  const mountedRef = useRef(true);
  const sessionEpochRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(session?.user?.id ?? null);
  const activeAccessTokenRef = useRef<string | undefined>(
    typeof session?.access_token === "string" ? session.access_token : undefined,
  );

  const sessionUserId = session?.user?.id ?? null;
  activeAccessTokenRef.current = typeof session?.access_token === "string" ? session.access_token : undefined;
  if (activeUserIdRef.current !== sessionUserId) {
    activeUserIdRef.current = sessionUserId;
    sessionEpochRef.current += 1;
  }

  const userId = session?.user?.id ?? "anonymous";
  const conversationStorageKey = `finflow_ai_conversation_${userId}`;
  const legacyConversationStorageKey = `@finflow_ai_conversation_${userId}`;
  const pendingStorageKey = `finflow_ai_pending_${userId}`;
  const hasAccess = usuarioPodeAcessarIA(
    limitsEnabled && limites.iaOperacional,
    limitsEnabled,
  );

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", role: "assistant", text: WELCOME_MESSAGE },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const [clearModalVisible, setClearModalVisible] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const operationIsCurrent = useCallback((epoch: number, expectedUserId: string | null) => (
    mountedRef.current
    && sessionEpochRef.current === epoch
    && activeUserIdRef.current === expectedUserId
  ), []);

  useEffect(() => {
    // O setup explícito é necessário porque o StrictMode executa
    // setup/cleanup/setup em desenvolvimento.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionEpochRef.current += 1;
    };
  }, []);

  useEffect(() => {
    // Uma sessão nova nunca herda travas visuais de uma requisição iniciada
    // pela conta anterior. A resposta antiga ainda é descartada pelo epoch.
    sendingRef.current = false;
    clearingRef.current = false;
    setLoading(false);
    setClearing(false);
    setClearModalVisible(false);
    setClearError(null);
  }, [sessionUserId]);

  const quotaText = useMemo(() => {
    if (!quota) return "Acesso seguro";
    const limit = Number(quota.limit);
    const remaining = Number(quota.remaining);
    const modelLimit = Number(quota.model_limit);
    const modelRemaining = Number(quota.model_remaining);
    const consultationText = Number.isFinite(modelLimit) && modelLimit > 0 && Number.isFinite(modelRemaining)
      ? `${Math.max(0, modelRemaining)}/${modelLimit} consultas`
      : null;
    if (limit === -1) return consultationText ? `${consultationText} hoje` : "Ações ilimitadas no beta";
    if (Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)) {
      const actionText = `${Math.max(0, remaining)}/${limit} ações`;
      return consultationText ? `${actionText} • ${consultationText}` : `${actionText} hoje`;
    }
    return `Plano ${planLabel(quota.plan)}`;
  }, [quota]);

  const suggestions = useMemo(() => [
    { icon: "account-balance-wallet" as const, text: "Qual é meu saldo atual?" },
    { icon: "add-card" as const, text: "Registrar uma despesa" },
    limitsEnabled && !limites.iaAnalitica
      ? { icon: "receipt-long" as const, text: "Quais despesas tenho neste mês?" }
      : { icon: "insights" as const, text: "Como estão meus gastos?" },
    { icon: "savings" as const, text: "Criar um objetivo" },
  ], [limites.iaAnalitica, limitsEnabled]);

  const appendAssistant = useCallback((text: string) => {
    setMessages((current) => [...current, { id: makeId("assistant"), role: "assistant", text }]);
  }, []);

  const savePendingAction = useCallback(async (action: PendingAction | null) => {
    setPendingAction(action);
    if (action) await secureStorageSetItem(pendingStorageKey, JSON.stringify(action));
    else await secureStorageRemoveItem(pendingStorageKey);
  }, [pendingStorageKey]);

  useEffect(() => {
    const currentUserId = session?.user?.id ?? null;
    const previousUserId = previousUserIdRef.current;
    if (previousUserId && previousUserId !== currentUserId) {
      void secureStorageRemoveItem(`finflow_ai_pending_${previousUserId}`);
      void secureStorageRemoveItem(`finflow_ai_conversation_${previousUserId}`);
      void removeLegacyNativeStorage(`@finflow_ai_conversation_${previousUserId}`);
      void removeLegacyNativeStorage(`@finflow_ai_pending_${previousUserId}`);
    }
    previousUserIdRef.current = currentUserId;
  }, [session?.user?.id]);

  useEffect(() => {
    let active = true;
    const operationEpoch = sessionEpochRef.current;
    const operationUserId = session?.user?.id ?? null;
    const accessToken = activeAccessTokenRef.current;
    async function loadHistory() {
      setMessages([{ id: "welcome", role: "assistant", text: WELCOME_MESSAGE }]);
      setConversationId(null);
      setPendingAction(null);
      setQuota(null);
      setInput("");
      setLoadingHistory(true);

      if (!session?.user?.id) {
        if (active) setLoadingHistory(false);
        return;
      }

      try {
        const [securedConversation, storedPending] = await Promise.all([
          secureStorageGetItem(conversationStorageKey),
          secureStorageGetItem(pendingStorageKey),
        ]);
        const storedConversation = securedConversation
          ?? await migrateLegacyNativeStorage(legacyConversationStorageKey, conversationStorageKey);
        // Tokens de confirmação antigos em texto simples não são migrados.
        await removeLegacyNativeStorage(`@finflow_ai_pending_${session.user.id}`);
        const parsedPending = parseCachedPendingAction(storedPending);
        if (parsedPending) {
          if (active) setPendingAction(parsedPending);
        } else if (storedPending) {
          await secureStorageRemoveItem(pendingStorageKey);
        }

        const response = await invokeFinanceAi({
          mode: "history",
          ...(storedConversation ? { conversationId: storedConversation } : {}),
        }, accessToken);
        if (!active || !operationIsCurrent(operationEpoch, operationUserId)) return;
        // `null` é uma resposta autoritativa do servidor: o ID local pode ter
        // sido apagado, expirado ou pertencer a outra sessão antiga.
        const resolvedConversationId = response.conversationId ?? null;
        setConversationId(resolvedConversationId);
        if (response.conversationId && response.conversationId !== storedConversation) {
          await secureStorageSetItem(conversationStorageKey, response.conversationId);
        } else if (!response.conversationId && storedConversation) {
          await secureStorageRemoveItem(conversationStorageKey);
        }
        if (!active || !operationIsCurrent(operationEpoch, operationUserId)) return;
        setQuota(response.quota ?? null);
        if (response.messages?.length) {
          setMessages(response.messages.map((message) => ({
            id: String(message.id),
            role: message.role === "user" ? "user" : "assistant",
            text: message.text,
            createdAt: message.createdAt,
          })));
        } else {
          setMessages([{ id: "welcome", role: "assistant", text: WELCOME_MESSAGE }]);
        }
      } catch {
        // O histórico é uma conveniência. A tela continua utilizável e tentará novamente no envio.
      } finally {
        if (active) setLoadingHistory(false);
      }
    }
    void loadHistory();
    return () => { active = false; };
  }, [conversationStorageKey, legacyConversationStorageKey, operationIsCurrent, pendingStorageKey, session?.user?.id]);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [loading, messages, pendingAction]);

  const applyResponse = useCallback(async (
    response: FinanceAiResponse,
    operationEpoch: number,
    operationUserId: string | null,
  ) => {
    if (!operationIsCurrent(operationEpoch, operationUserId)) return;
    if (response.conversationId) {
      setConversationId(response.conversationId);
      await secureStorageSetItem(conversationStorageKey, response.conversationId);
    }
    if (!operationIsCurrent(operationEpoch, operationUserId)) return;
    if (response.quota) setQuota(response.quota);
    if (response.message) appendAssistant(response.message);
    if (response.pendingAction) await savePendingAction(response.pendingAction);
    if (response.kind === "navigate" && response.route) {
      setTimeout(() => {
        if (operationIsCurrent(operationEpoch, operationUserId)) router.push(response.route as never);
      }, 250);
    }
  }, [appendAssistant, conversationStorageKey, operationIsCurrent, router, savePendingAction]);

  const sendMessage = useCallback(async (suggested?: string) => {
    const text = (suggested ?? input).trim();
    if (!text || loading || sendingRef.current || clearingRef.current || clearModalVisible) return;
    if (pendingAction) {
      showToast("Confirme ou cancele a ação exibida antes de continuar.", "info");
      return;
    }
    const operationEpoch = sessionEpochRef.current;
    const operationUserId = session?.user?.id ?? null;
    const accessToken = typeof session?.access_token === "string" ? session.access_token : undefined;
    if (!operationUserId || !accessToken) {
      showToast("Sua sessão expirou. Entre novamente para usar a IA financeira.", "error");
      return;
    }

    sendingRef.current = true;
    setLoading(true);
    setInput("");
    setMessages((current) => [...current, { id: makeId("user"), role: "user", text }]);
    try {
      const response = await invokeFinanceAi({
        mode: "message",
        message: text,
        conversationId,
        requestId: makeId("request"),
      }, accessToken);
      await applyResponse(response, operationEpoch, operationUserId);
    } catch (error) {
      if (operationIsCurrent(operationEpoch, operationUserId)) {
        appendAssistant(error instanceof Error ? error.message : "Não foi possível consultar a IA agora.");
      }
    } finally {
      if (operationIsCurrent(operationEpoch, operationUserId)) {
        sendingRef.current = false;
        setLoading(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  }, [appendAssistant, applyResponse, clearModalVisible, conversationId, input, loading, operationIsCurrent, pendingAction, session?.access_token, session?.user?.id, showToast]);

  const confirmAction = useCallback(async () => {
    if (!pendingAction || loading || clearingRef.current || clearModalVisible) return;
    if (Date.parse(pendingAction.expiresAt) <= Date.now()) {
      await savePendingAction(null);
      appendAssistant("Essa confirmação expirou. Peça novamente para eu preparar a ação.");
      return;
    }
    const operationEpoch = sessionEpochRef.current;
    const operationUserId = session?.user?.id ?? null;
    const accessToken = typeof session?.access_token === "string" ? session.access_token : undefined;
    if (!operationUserId || !accessToken) {
      showToast("Sua sessão expirou. Entre novamente para confirmar esta ação.", "error");
      return;
    }
    setLoading(true);
    try {
      const response = await invokeFinanceAi({
        mode: "confirm",
        conversationId,
        actionId: pendingAction.id,
        confirmationToken: pendingAction.confirmationToken,
      }, accessToken);
      if (!operationIsCurrent(operationEpoch, operationUserId)) return;
      await savePendingAction(null);
      await applyResponse(response, operationEpoch, operationUserId);
    } catch (error) {
      if (operationIsCurrent(operationEpoch, operationUserId)) {
        // Falhas terminais significam que o servidor já expirou, cancelou ou
        // marcou a proposta como falha. Erros ambíguos de rede mantêm o token
        // para permitir replay idempotente sem duplicar a ação.
        if (isTerminalConfirmationError(error)) await savePendingAction(null);
        appendAssistant(error instanceof Error ? error.message : "Não foi possível confirmar. Nenhuma ação foi realizada.");
      }
    } finally {
      if (operationIsCurrent(operationEpoch, operationUserId)) setLoading(false);
    }
  }, [appendAssistant, applyResponse, clearModalVisible, conversationId, loading, operationIsCurrent, pendingAction, savePendingAction, session?.access_token, session?.user?.id, showToast]);

  const cancelAction = useCallback(async () => {
    if (!pendingAction || loading || clearingRef.current || clearModalVisible) return;
    const operationEpoch = sessionEpochRef.current;
    const operationUserId = session?.user?.id ?? null;
    const accessToken = typeof session?.access_token === "string" ? session.access_token : undefined;
    if (!operationUserId || !accessToken) {
      showToast("Sua sessão expirou. Entre novamente para cancelar esta ação.", "error");
      return;
    }
    setLoading(true);
    try {
      const response = await invokeFinanceAi({ mode: "cancel", actionId: pendingAction.id }, accessToken);
      if (!operationIsCurrent(operationEpoch, operationUserId)) return;
      await savePendingAction(null);
      await applyResponse(response, operationEpoch, operationUserId);
    } catch (error) {
      if (operationIsCurrent(operationEpoch, operationUserId)) {
        if (isTerminalConfirmationError(error)) await savePendingAction(null);
        appendAssistant(error instanceof Error ? error.message : "Não foi possível cancelar agora.");
      }
    } finally {
      if (operationIsCurrent(operationEpoch, operationUserId)) setLoading(false);
    }
  }, [appendAssistant, applyResponse, clearModalVisible, loading, operationIsCurrent, pendingAction, savePendingAction, session?.access_token, session?.user?.id, showToast]);

  const openClearModal = useCallback(() => {
    if (loading || sendingRef.current || clearingRef.current) return;
    setClearError(null);
    setClearModalVisible(true);
  }, [loading]);

  const closeClearModal = useCallback(() => {
    if (clearingRef.current) return;
    setClearError(null);
    setClearModalVisible(false);
  }, []);

  const clearConversation = useCallback(async () => {
    if (loading || sendingRef.current || clearingRef.current) return;
    const operationEpoch = sessionEpochRef.current;
    const operationUserId = session?.user?.id ?? null;
    const accessToken = typeof session?.access_token === "string" ? session.access_token : undefined;
    if (!operationUserId || !accessToken) {
      setClearError("Sua sessão expirou. Entre novamente para limpar a conversa.");
      return;
    }
    clearingRef.current = true;
    setClearing(true);
    setClearError(null);
    let proposalCancellationWarning = false;

    try {
      if (pendingAction) {
        try {
          const cancelResponse = await invokeFinanceAi({ mode: "cancel", actionId: pendingAction.id }, accessToken);
          proposalCancellationWarning = cancelResponse.kind !== "cancelled" || cancelResponse.action?.ok !== true;
        } catch {
          // Limpar o histórico é um direito independente. A proposta não
          // confirmada permanece inerte no servidor e expira automaticamente.
          proposalCancellationWarning = true;
        }
        if (!operationIsCurrent(operationEpoch, operationUserId)) return;
        await savePendingAction(null);
      }

      const clearResponse = await invokeFinanceAi({
        mode: "clear",
        ...(conversationId ? { conversationId } : {}),
      }, accessToken);
      if (!operationIsCurrent(operationEpoch, operationUserId)) return;
      if (clearResponse.cleared !== true) {
        throw new Error("O servidor não confirmou a limpeza da conversa.");
      }

      setConversationId(null);
      setQuota(clearResponse.quota ?? quota);
      await secureStorageRemoveItem(conversationStorageKey);
      await savePendingAction(null);
      setMessages([{ id: "welcome", role: "assistant", text: WELCOME_MESSAGE }]);
      setClearModalVisible(false);
      showToast(
        proposalCancellationWarning
          ? "Histórico apagado. A proposta não confirmada expirará automaticamente."
          : "Conversa limpa com segurança.",
        proposalCancellationWarning ? "info" : "success",
      );
    } catch (error) {
      if (operationIsCurrent(operationEpoch, operationUserId)) {
        const message = error instanceof Error
          ? error.message
          : "Não foi possível limpar a conversa agora.";
        setClearError(message);
      }
    } finally {
      if (operationIsCurrent(operationEpoch, operationUserId)) {
        clearingRef.current = false;
        setClearing(false);
      }
    }
  }, [conversationId, conversationStorageKey, loading, operationIsCurrent, pendingAction, quota, savePendingAction, session?.access_token, session?.user?.id, showToast]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <View style={[styles.header, { backgroundColor: theme.header }]}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon} accessibilityLabel="Voltar">
              <MaterialIcons name="arrow-back" size={23} color="#FFF" />
            </TouchableOpacity>
            <View style={styles.headerIdentity}>
              <View style={styles.headerSparkle}>
                <MaterialIcons name="auto-awesome" size={20} color="#FFF" />
              </View>
              <View>
                <Text style={styles.headerTitle}>IA FinFlow</Text>
                <Text style={styles.headerSubtitle}>Controle financeiro protegido</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={openClearModal}
              style={[styles.headerIcon, (loading || clearing) && styles.disabled]}
              accessibilityLabel="Limpar conversa"
              disabled={loading || clearing}
            >
              <MaterialIcons name="delete-outline" size={22} color="#FFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.statusRow}>
            <View style={styles.statusPill}>
              <View style={styles.onlineDot} />
              <Text style={styles.statusText}>Somente finanças</Text>
            </View>
            <View style={styles.statusPill}>
              <MaterialIcons name="verified-user" size={14} color="#D9FFF1" />
              <Text style={styles.statusText}>{quotaText}</Text>
            </View>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {loadingHistory && <ActivityIndicator color={theme.primary} style={styles.historyLoader} />}

          {!hasAccess && !loadingHistory && (
            <View style={[styles.accessNotice, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={[styles.accessNoticeIcon, { backgroundColor: theme.primarySoft }]}>
                <MaterialIcons name="lock-outline" size={21} color={theme.primary} />
              </View>
              <View style={styles.accessNoticeCopy}>
                <Text style={[styles.accessNoticeTitle, { color: theme.text }]}>Consultas pausadas no seu plano</Text>
                <Text style={[styles.accessNoticeText, { color: theme.textMuted }]}>Seu histórico continua disponível e pode ser apagado a qualquer momento.</Text>
              </View>
              <TouchableOpacity style={[styles.accessNoticeButton, { backgroundColor: theme.primary }]} onPress={() => router.push("/planos")}>
                <Text style={styles.accessNoticeButtonText}>Planos</Text>
              </TouchableOpacity>
            </View>
          )}

          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <View key={message.id} style={[styles.messageRow, isUser && styles.messageRowUser]}>
                {!isUser && (
                  <View style={[styles.avatar, { backgroundColor: theme.primarySoft }]}>
                    <MaterialIcons name="auto-awesome" size={17} color={theme.primary} />
                  </View>
                )}
                <View
                  style={[
                    styles.bubble,
                    isUser
                      ? { backgroundColor: theme.primary, borderBottomRightRadius: 6 }
                      : { backgroundColor: theme.surface, borderColor: theme.border, borderBottomLeftRadius: 6 },
                    !isUser && styles.assistantBubble,
                  ]}
                >
                  <Text style={[styles.messageText, { color: isUser ? "#FFF" : theme.text }]}>{message.text}</Text>
                </View>
              </View>
            );
          })}

          {hasAccess && messages.length <= 1 && !loadingHistory && (
            <View style={styles.suggestionsWrap}>
              <Text style={[styles.suggestionsTitle, { color: theme.textMuted }]}>Experimente perguntar</Text>
              <View style={styles.suggestionsGrid}>
                {suggestions.map((suggestion) => (
                  <TouchableOpacity
                    key={suggestion.text}
                    style={[styles.suggestionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    onPress={() => void sendMessage(suggestion.text)}
                    disabled={loading}
                  >
                    <MaterialIcons name={suggestion.icon} size={19} color={theme.primary} />
                    <Text style={[styles.suggestionText, { color: theme.text }]}>{suggestion.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {pendingAction && (
            <View style={[styles.proposalCard, { backgroundColor: theme.surface, borderColor: theme.primary }]}>
              <View style={styles.proposalHeader}>
                <View style={[styles.proposalIcon, { backgroundColor: theme.primarySoft }]}>
                  <MaterialIcons name="fact-check" size={22} color={theme.primary} />
                </View>
                <View style={styles.proposalHeading}>
                  <Text style={[styles.proposalEyebrow, { color: theme.primary }]}>AGUARDANDO SUA CONFIRMAÇÃO</Text>
                  <Text style={[styles.proposalTitle, { color: theme.text }]}>{actionTitle(pendingAction)}</Text>
                </View>
              </View>
              <Text style={[styles.proposalSummary, { color: theme.text }]}>{actionSummary(pendingAction)}</Text>
              {(pendingAction.preview?.consequences ?? []).map((item) => (
                <View key={item} style={styles.consequenceRow}>
                  <MaterialIcons name="info-outline" size={16} color={theme.textMuted} />
                  <Text style={[styles.consequenceText, { color: theme.textMuted }]}>{item}</Text>
                </View>
              ))}
              <View style={[styles.confirmationNotice, { backgroundColor: isDark ? "#302B1E" : "#FFF7DE" }]}>
                <MaterialIcons name="lock-outline" size={16} color={isDark ? "#F6D58A" : "#B7791F"} />
                <Text style={[styles.confirmationNoticeText, { color: isDark ? "#F6D58A" : "#8A5A08" }]}>A ação só será executada pelo botão Confirmar abaixo.</Text>
              </View>
              <View style={styles.proposalActions}>
                <TouchableOpacity
                  style={[styles.cancelButton, { borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}
                  onPress={() => void cancelAction()}
                  disabled={loading}
                >
                  <Text style={[styles.cancelButtonText, { color: theme.text }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, { backgroundColor: theme.primary }, loading && styles.disabled]}
                  onPress={() => void confirmAction()}
                  disabled={loading}
                >
                  {loading ? <ActivityIndicator size="small" color="#FFF" /> : <MaterialIcons name="check" size={19} color="#FFF" />}
                  <Text style={styles.confirmButtonText}>Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {loading && !pendingAction && (
            <View style={styles.typingRow}>
              <View style={[styles.avatar, { backgroundColor: theme.primarySoft }]}>
                <MaterialIcons name="auto-awesome" size={17} color={theme.primary} />
              </View>
              <View style={[styles.typingBubble, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <ActivityIndicator size="small" color={theme.primary} />
                <Text style={[styles.typingText, { color: theme.textMuted }]}>Analisando com segurança…</Text>
              </View>
            </View>
          )}
        </ScrollView>

        <View style={[styles.composerArea, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
          {pendingAction && (
            <Text style={[styles.pendingComposerText, { color: theme.textMuted }]}>Confirme ou cancele a proposta para continuar.</Text>
          )}
          <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: pendingAction ? theme.border : theme.primary }]}>
            <TextInput
              ref={inputRef}
              style={[styles.input, { color: theme.text }]}
              placeholder={!hasAccess ? "Disponível nos planos Smart e Premium" : pendingAction ? "Aguardando sua decisão" : "Pergunte ou peça uma ação financeira"}
              placeholderTextColor={theme.textMuted}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={2_000}
              editable={hasAccess && !pendingAction && !loading && !clearModalVisible && !clearing}
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={() => { if (!input.includes("\n")) void sendMessage(); }}
              accessibilityLabel="Mensagem para a IA financeira"
            />
            <TouchableOpacity
              style={[styles.sendButton, { backgroundColor: theme.primary }, (!hasAccess || !input.trim() || loading || pendingAction || clearModalVisible || clearing) && styles.disabled]}
              onPress={() => void sendMessage()}
              disabled={!hasAccess || !input.trim() || loading || Boolean(pendingAction) || clearModalVisible || clearing}
              accessibilityLabel="Enviar mensagem"
            >
              <MaterialIcons name="arrow-upward" size={21} color="#FFF" />
            </TouchableOpacity>
          </View>
          <Text style={[styles.disclaimer, { color: theme.textMuted }]}>Revise valores e datas. A IA não substitui orientação profissional.</Text>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={clearModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeClearModal}
      >
        <View style={[styles.clearModalOverlay, { backgroundColor: theme.overlay }]}>
          <View
            style={[styles.clearModalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            accessibilityViewIsModal
          >
            <View style={[styles.clearModalIcon, { backgroundColor: isDark ? "#3B2525" : "#FDE9E7" }]}>
              <MaterialIcons name="delete-outline" size={28} color={FinFlowColors.red} />
            </View>
            <Text style={[styles.clearModalTitle, { color: theme.text }]}>Limpar conversa?</Text>
            <Text style={[styles.clearModalText, { color: theme.textMuted }]}>O histórico deste chat será apagado do servidor. Seus dados financeiros não serão alterados.</Text>

            {pendingAction && (
              <View style={[styles.clearPendingNotice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
                <MaterialIcons name="info-outline" size={18} color={theme.primary} />
                <Text style={[styles.clearPendingNoticeText, { color: theme.text }]}>A proposta financeira pendente será cancelada antes da limpeza.</Text>
              </View>
            )}

            {clearError && (
              <View style={[styles.clearErrorBox, { backgroundColor: isDark ? "#3B2525" : "#FDE9E7" }]}>
                <MaterialIcons name="error-outline" size={18} color={FinFlowColors.red} />
                <Text style={styles.clearErrorText}>{clearError}</Text>
              </View>
            )}

            <View style={styles.clearModalActions}>
              <TouchableOpacity
                style={[styles.clearModalCancel, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }, clearing && styles.disabled]}
                onPress={closeClearModal}
                disabled={clearing}
                accessibilityLabel="Manter conversa"
              >
                <Text style={[styles.clearModalCancelText, { color: theme.text }]}>Manter</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.clearModalConfirm, { backgroundColor: FinFlowColors.red }, clearing && styles.disabled]}
                onPress={() => void clearConversation()}
                disabled={clearing || loading}
                accessibilityLabel="Confirmar limpeza da conversa"
              >
                {clearing
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <MaterialIcons name="delete-outline" size={19} color="#FFF" />}
                <Text style={styles.clearModalConfirmText}>{clearing ? "Limpando..." : "Limpar"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    minHeight: 126,
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 15,
    ...FinFlowShadow,
  },
  headerTopRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  headerIdentity: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  headerSparkle: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.15)" },
  headerTitle: { color: "#FFF", fontSize: 19, fontWeight: "900" },
  headerSubtitle: { color: "#D8FFF0", fontSize: 10.5, fontWeight: "600", marginTop: 1 },
  statusRow: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 8, marginTop: 10 },
  statusPill: { minHeight: 28, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, backgroundColor: "rgba(0,0,0,0.16)" },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#78F2BC" },
  statusText: { color: "#E8FFF7", fontSize: 10.5, fontWeight: "800" },
  messagesContent: { paddingHorizontal: 14, paddingTop: 20, paddingBottom: 20 },
  historyLoader: { marginVertical: 15 },
  accessNotice: { borderWidth: 1, borderRadius: FinFlowRadius.medium, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 15 },
  accessNoticeIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  accessNoticeCopy: { flex: 1 },
  accessNoticeTitle: { fontSize: 13, lineHeight: 18, fontWeight: "900" },
  accessNoticeText: { fontSize: 10.5, lineHeight: 15, fontWeight: "600", marginTop: 2 },
  accessNoticeButton: { minHeight: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 11 },
  accessNoticeButtonText: { color: "#FFF", fontSize: 11, fontWeight: "900" },
  messageRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 13, paddingRight: 36 },
  messageRowUser: { justifyContent: "flex-end", paddingRight: 0, paddingLeft: 52 },
  avatar: { width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  bubble: { maxWidth: "88%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11 },
  assistantBubble: { borderWidth: 1 },
  messageText: { fontSize: 14, lineHeight: 20.5, fontWeight: "500" },
  suggestionsWrap: { marginTop: 7, marginBottom: 12 },
  suggestionsTitle: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 9, marginLeft: 2 },
  suggestionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  suggestionCard: { width: "48.6%", minHeight: 74, borderWidth: 1, borderRadius: FinFlowRadius.medium, padding: 12, justifyContent: "space-between" },
  suggestionText: { fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 8 },
  proposalCard: { borderWidth: 1.5, borderRadius: FinFlowRadius.large, padding: 16, marginTop: 5, marginBottom: 14, ...FinFlowShadow },
  proposalHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  proposalIcon: { width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  proposalHeading: { flex: 1 },
  proposalEyebrow: { fontSize: 9.5, lineHeight: 13, fontWeight: "900", letterSpacing: 0.45 },
  proposalTitle: { fontSize: 17, lineHeight: 22, fontWeight: "900", marginTop: 2 },
  proposalSummary: { fontSize: 14, lineHeight: 21, fontWeight: "600", marginTop: 14, marginBottom: 9 },
  consequenceRow: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: 6 },
  consequenceText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  confirmationNotice: { minHeight: 42, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11, paddingVertical: 8, marginTop: 13 },
  confirmationNoticeText: { flex: 1, fontSize: 10.5, lineHeight: 15, fontWeight: "800" },
  proposalActions: { flexDirection: "row", gap: 9, marginTop: 13 },
  cancelButton: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cancelButtonText: { fontSize: 13, fontWeight: "800" },
  confirmButton: { flex: 1.25, minHeight: 48, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  confirmButtonText: { color: "#FFF", fontSize: 13, fontWeight: "900" },
  typingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2, marginBottom: 12 },
  typingBubble: { minHeight: 42, borderWidth: 1, borderRadius: 17, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13 },
  typingText: { fontSize: 12, fontWeight: "600" },
  composerArea: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 9, paddingBottom: Platform.OS === "ios" ? 3 : 7 },
  pendingComposerText: { fontSize: 10.5, textAlign: "center", fontWeight: "700", marginBottom: 6 },
  composer: { minHeight: 54, maxHeight: 132, borderWidth: 1.2, borderRadius: 19, flexDirection: "row", alignItems: "flex-end", paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, minHeight: 40, maxHeight: 112, fontSize: 14, lineHeight: 20, paddingTop: 9, paddingBottom: 8, paddingRight: 8, textAlignVertical: "top" },
  sendButton: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.42 },
  disclaimer: { fontSize: 9.5, textAlign: "center", lineHeight: 13, marginTop: 5 },
  clearModalOverlay: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 22 },
  clearModalCard: { width: "100%", maxWidth: 420, borderRadius: FinFlowRadius.large, borderWidth: 1, paddingHorizontal: 20, paddingTop: 23, paddingBottom: 18, alignItems: "center", ...FinFlowShadow },
  clearModalIcon: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  clearModalTitle: { fontSize: 21, lineHeight: 27, fontWeight: "900", textAlign: "center" },
  clearModalText: { marginTop: 7, fontSize: 13, lineHeight: 19, fontWeight: "500", textAlign: "center" },
  clearPendingNotice: { width: "100%", borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 11, paddingVertical: 10, marginTop: 15 },
  clearPendingNoticeText: { flex: 1, fontSize: 11.5, lineHeight: 16, fontWeight: "700" },
  clearErrorBox: { width: "100%", borderRadius: 13, flexDirection: "row", alignItems: "flex-start", gap: 9, paddingHorizontal: 11, paddingVertical: 10, marginTop: 12 },
  clearErrorText: { flex: 1, color: FinFlowColors.red, fontSize: 11.5, lineHeight: 16, fontWeight: "800" },
  clearModalActions: { width: "100%", flexDirection: "row", gap: 9, marginTop: 18 },
  clearModalCancel: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  clearModalCancelText: { fontSize: 13, fontWeight: "800" },
  clearModalConfirm: { flex: 1.15, minHeight: 48, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  clearModalConfirmText: { color: "#FFF", fontSize: 13, fontWeight: "900" },
  lockedHeader: { minHeight: 74, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  lockedContent: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingBottom: 65 },
  lockedIcon: { width: 76, height: 76, borderRadius: 26, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  lockedTitle: { fontSize: 23, fontWeight: "900", textAlign: "center" },
  lockedText: { fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8, maxWidth: 310 },
  upgradeButton: { minWidth: 180, minHeight: 50, borderRadius: FinFlowRadius.medium, alignItems: "center", justifyContent: "center", marginTop: 22 },
  upgradeButtonText: { color: "#FFF", fontSize: 14, fontWeight: "900" },
});
