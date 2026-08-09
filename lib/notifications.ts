import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { supabase } from "./supabase";

const NOTIFICATION_SCHEDULE_VERSION = "2026-08-08-v5";
const ANDROID_NOTIFICATION_CHANNEL_ID = "finflow-private-v2";
const LOCAL_DEMO = process.env.EXPO_PUBLIC_FINFLOW_LOCAL_DEMO === "true";

export type PreferenciasNotificacoes = {
  transacoesVencidas: boolean;
  transacoesDoDia: boolean;
  fechamentoFatura: boolean;
  vencimentoFatura: boolean;
  limiteCartao: boolean;
  prazoObjetivos: boolean;
};

export const PREFERENCIAS_NOTIFICACOES_PADRAO: PreferenciasNotificacoes = {
  transacoesVencidas: true,
  transacoesDoDia: true,
  fechamentoFatura: true,
  vencimentoFatura: true,
  limiteCartao: true,
  prazoObjetivos: true,
};

const chavePreferencias = (userId: string) => `@notificacoes_preferencias_${userId}`;

export async function obterPreferenciasNotificacoes(userId: string): Promise<PreferenciasNotificacoes> {
  try {
    const valor = await AsyncStorage.getItem(chavePreferencias(userId));
    if (!valor) return { ...PREFERENCIAS_NOTIFICACOES_PADRAO };
    return { ...PREFERENCIAS_NOTIFICACOES_PADRAO, ...JSON.parse(valor) };
  } catch {
    return { ...PREFERENCIAS_NOTIFICACOES_PADRAO };
  }
}

export async function salvarPreferenciasNotificacoes(
  userId: string,
  preferencias: Partial<PreferenciasNotificacoes>
): Promise<PreferenciasNotificacoes> {
  const atuais = await obterPreferenciasNotificacoes(userId);
  const atualizadas = { ...atuais, ...preferencias };
  await AsyncStorage.setItem(chavePreferencias(userId), JSON.stringify(atualizadas));
  return atualizadas;
}

// Importação lazy para não travar o app se o módulo falhar
let Notif: any = null;
let geracaoAgendaNotificacoes = 0;
let geracaoSessaoNotificacoes = 0;
if (!LOCAL_DEMO) {
  try {
    // Carregamento lazy evita derrubar web/local quando o módulo nativo não existe.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Notif = require("expo-notifications");
    Notif.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    // Canal Android obrigatório para exibir notificações no Android 8+
    if (Platform.OS === "android") {
      Notif.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
        name: "FinFlow",
        importance: Notif.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        sound: "default",
        enableVibrate: true,
        lockscreenVisibility: Notif.AndroidNotificationVisibility.PRIVATE,
      });
    }
  } catch {
    // expo-notifications não disponível — modo silencioso
  }
}

async function gravarMarcadorSeSessaoAtiva(
  chave: string,
  valor: string,
  userId: string,
  geracaoEsperada: number,
): Promise<boolean> {
  if (geracaoEsperada !== geracaoAgendaNotificacoes) return false;
  const { data: sessaoAntes } = await supabase.auth.getSession();
  if (sessaoAntes.session?.user.id !== userId || geracaoEsperada !== geracaoAgendaNotificacoes) return false;

  await AsyncStorage.setItem(chave, valor);
  const { data: sessaoDepois } = await supabase.auth.getSession();
  if (sessaoDepois.session?.user.id === userId && geracaoEsperada === geracaoAgendaNotificacoes) return true;

  await AsyncStorage.removeItem(chave);
  return false;
}

async function gravarMarcadorSistemaSeSessaoAtiva(
  chave: string,
  userId: string,
  geracaoEsperada: number,
): Promise<boolean> {
  if (geracaoEsperada !== geracaoSessaoNotificacoes) return false;
  const { data: sessaoAntes } = await supabase.auth.getSession();
  if (sessaoAntes.session?.user.id !== userId || geracaoEsperada !== geracaoSessaoNotificacoes) return false;

  await AsyncStorage.setItem(chave, "1");
  const { data: sessaoDepois } = await supabase.auth.getSession();
  if (sessaoDepois.session?.user.id === userId && geracaoEsperada === geracaoSessaoNotificacoes) return true;

  await AsyncStorage.removeItem(chave);
  return false;
}

export async function pedirPermissaoNotificacoes(): Promise<boolean> {
  if (LOCAL_DEMO || !Notif || Platform.OS === "web") return false;
  try {
    const { status: existing } = await Notif.getPermissionsAsync();
    if (existing === "granted") return true;
    const { status } = await Notif.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

/**
 * Espelha um evento obrigatorio do servidor em uma notificacao local quando o
 * sistema operacional ja concedeu permissao. Nao solicita permissao e nao
 * consulta as preferencias opcionais do usuario: o aviso persistente dentro do
 * app continua sendo a fonte garantida.
 */
export async function exibirEventoObrigatorioLocal(
  userId: string,
  eventoId: number,
  titulo: string,
  mensagem: string,
): Promise<void> {
  if (LOCAL_DEMO || !Notif || Platform.OS === "web") return;

  const chave = `@notif_sistema_${userId}_${eventoId}`;
  const geracaoDoEvento = geracaoSessaoNotificacoes;
  try {
    if (await AsyncStorage.getItem(chave)) return;

    const { status } = await Notif.getPermissionsAsync();
    if (status !== "granted") return;

    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id !== userId || geracaoDoEvento !== geracaoSessaoNotificacoes) return;

    const identificador = await Notif.scheduleNotificationAsync({
      content: {
        title: titulo,
        body: mensagem,
        sound: "default",
        badge: 0,
        data: { origem: "finflow_sistema", eventoId },
      },
      trigger: Platform.OS === "android"
        ? { type: "timeInterval", seconds: 1, repeats: false, channelId: ANDROID_NOTIFICATION_CHANNEL_ID } as any
        : null,
    });
    const { data: sessaoDepoisDoAgendamento } = await supabase.auth.getSession();
    if (
      sessaoDepoisDoAgendamento.session?.user.id !== userId
      || geracaoDoEvento !== geracaoSessaoNotificacoes
    ) {
      await Promise.allSettled([
        Notif.cancelScheduledNotificationAsync(identificador),
        Notif.dismissNotificationAsync(identificador),
      ]);
      return;
    }
    if (!await gravarMarcadorSistemaSeSessaoAtiva(chave, userId, geracaoDoEvento)) {
      await Promise.allSettled([
        Notif.cancelScheduledNotificationAsync(identificador),
        Notif.dismissNotificationAsync(identificador),
      ]);
    }
  } catch {
    // Best-effort: o evento permanece salvo e visivel dentro do aplicativo.
  }
}

export async function notificacoesEstaoAtivas(): Promise<boolean> {
  if (LOCAL_DEMO) return false;
  try {
    const val = await AsyncStorage.getItem("@notificacoes_enabled");
    return val === "true";
  } catch {
    return false;
  }
}

export async function notificacoesEstaoAtivasPara(userId: string): Promise<boolean> {
  if (LOCAL_DEMO) return false;
  try {
    const val = await AsyncStorage.getItem(`@notificacoes_enabled_${userId}`);
    return val === "true";
  } catch {
    return false;
  }
}

/**
 * Remove os alertas locais pertencentes à sessão encerrada.
 *
 * Notificações locais continuam registradas no sistema operacional mesmo
 * depois que o token do Supabase é removido. Por isso o logout precisa limpar
 * tanto os agendamentos futuros quanto os avisos que já chegaram. Preferências
 * do usuário são preservadas para o próximo login; apenas marcadores efêmeros
 * de deduplicação são descartados.
 */
export async function limparNotificacoesAoSair(userId?: string | null): Promise<void> {
  // Invalida imediatamente qualquer carregamento antigo que ainda esteja em
  // andamento. Sem isso, ele poderia reagendar um aviso depois da limpeza.
  geracaoAgendaNotificacoes += 1;
  geracaoSessaoNotificacoes += 1;
  try {
    const chaves = await AsyncStorage.getAllKeys();
    const chavesDaSessao = chaves.filter((chave) => {
      if (!chave.startsWith("@notif_")) return false;
      if (!userId) return true;
      return chave.includes(`_${userId}_`) || chave.endsWith(`_${userId}`);
    });
    if (chavesDaSessao.length > 0) await AsyncStorage.multiRemove(chavesDaSessao);

    if (LOCAL_DEMO || !Notif || Platform.OS === "web") return;
    await Promise.allSettled([
      Notif.cancelAllScheduledNotificationsAsync(),
      Notif.dismissAllNotificationsAsync(),
      Notif.setBadgeCountAsync(0),
    ]);
  } catch {
    // O logout nunca deve falhar por indisponibilidade do módulo nativo.
  }
}

async function cancelarAgendamentosOpcionaisNativos(): Promise<void> {
  if (LOCAL_DEMO || !Notif || Platform.OS === "web") return;
  const agendadas = await Notif.getAllScheduledNotificationsAsync();
  const identificadores: string[] = (agendadas ?? [])
    .filter((item: any) => item?.content?.data?.origem !== "finflow_sistema")
    .map((item: any) => item.identifier)
    .filter((id: unknown): id is string => typeof id === "string");
  await Promise.allSettled(
    identificadores.map((id) => Notif.cancelScheduledNotificationAsync(id)),
  );
}

/**
 * Cancela somente lembretes configuráveis. Eventos obrigatórios do servidor
 * permanecem visíveis, mesmo quando o usuário desativa os lembretes pessoais.
 */
export async function cancelarNotificacoesOpcionais(userId?: string | null): Promise<void> {
  geracaoAgendaNotificacoes += 1;
  try {
    if (userId) {
      const chaves = await AsyncStorage.getAllKeys();
      const marcadoresOpcionais = chaves.filter((chave) => (
        chave.startsWith("@notif_")
        && !chave.startsWith("@notif_sistema_")
        && (chave.includes(`_${userId}_`) || chave.endsWith(`_${userId}`))
      ));
      if (marcadoresOpcionais.length > 0) await AsyncStorage.multiRemove(marcadoresOpcionais);
    }

    if (LOCAL_DEMO || !Notif || Platform.OS === "web") return;
    const [agendadas, apresentadas] = await Promise.all([
      Notif.getAllScheduledNotificationsAsync(),
      Notif.getPresentedNotificationsAsync(),
    ]);
    const identificadoresAgendados: string[] = (agendadas ?? [])
      .filter((item: any) => item?.content?.data?.origem !== "finflow_sistema")
      .map((item: any) => item.identifier)
      .filter((id: unknown): id is string => typeof id === "string");
    const identificadoresApresentados: string[] = (apresentadas ?? [])
      .filter((item: any) => item?.request?.content?.data?.origem !== "finflow_sistema")
      .map((item: any) => item.request?.identifier)
      .filter((id: unknown): id is string => typeof id === "string");
    await Promise.allSettled([
      ...identificadoresAgendados.map((id) => Notif.cancelScheduledNotificationAsync(id)),
      ...identificadoresApresentados.map((id) => Notif.dismissNotificationAsync(id)),
      Notif.setBadgeCountAsync(0),
    ]);
  } catch {
    // A preferência permanece desativada; a próxima abertura tenta limpar de novo.
  }
}

async function executarAgendamentoNotificacoesDoApp(
  transacoes: { status: string; data_vencimento: string; tipo: string }[],
  userId: string,
  caixinhas?: { nome: string; meta_valor: number; saldo_atual: number; data_prazo?: string }[],
  cartoes?: { id?: number; nome: string; dia_vencimento: number; dia_fechamento: number; limite?: number; limite_usado?: number; faturas_pendentes?: string[] }[],
  dadosCompletos = false
) {
  if (LOCAL_DEMO || !Notif || Platform.OS === "web") return;
  const geracaoDestaAgenda = geracaoAgendaNotificacoes;
  let chaveAgendaCompleta: string | null = null;
  let assinaturaAgendaCompleta: string | null = null;
  try {
    const { data: sessaoAtual } = await supabase.auth.getSession();
    if (sessaoAtual.session?.user.id !== userId || geracaoDestaAgenda !== geracaoAgendaNotificacoes) return;

    const agendarSeSessaoAtiva = async (solicitacao: object) => {
      if (geracaoDestaAgenda !== geracaoAgendaNotificacoes) return null;
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== userId || geracaoDestaAgenda !== geracaoAgendaNotificacoes) return null;
      const identificador = await Notif.scheduleNotificationAsync(solicitacao);
      const { data: sessaoDepoisDoAgendamento } = await supabase.auth.getSession();
      if (
        sessaoDepoisDoAgendamento.session?.user.id !== userId
        || geracaoDestaAgenda !== geracaoAgendaNotificacoes
      ) {
        await Promise.allSettled([
          Notif.cancelScheduledNotificationAsync(identificador),
          Notif.dismissNotificationAsync(identificador),
        ]);
        return null;
      }
      return identificador;
    };

    const ativas = await notificacoesEstaoAtivasPara(userId);
    if (!ativas || geracaoDestaAgenda !== geracaoAgendaNotificacoes) return;
    const preferencias = await obterPreferenciasNotificacoes(userId);

    const agora = new Date();
    const hojeStr = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

    const channelId = Platform.OS === "android" ? ANDROID_NOTIFICATION_CHANNEL_ID : undefined;
    const notifBase = (extra?: object) => ({
      badge: 0,
      data: { origem: "finflow_opcional" },
      ...extra,
    });
    const gatilhoIntervalo = (seconds: number) => ({
      type: "timeInterval",
      seconds: Math.max(1, Math.floor(seconds)),
      repeats: false,
      ...(channelId ? { channelId } : {}),
    }) as any;

    try { await Notif.setBadgeCountAsync(0); } catch {}

    // O dashboard envia o conjunto completo de dados e pode reorganizar a agenda.
    // O cancelamento precisa acontecer antes dos alertas imediatos para não apagá-los.
    if (dadosCompletos) {
      const chaveAgendado = `@notif_agendado_${NOTIFICATION_SCHEDULE_VERSION}_${userId}_${hojeStr}`;
      chaveAgendaCompleta = chaveAgendado;
      const assinaturaBruta = JSON.stringify({
        transacoes: transacoes.map((t) => [t.status, t.data_vencimento, t.tipo]).sort(),
        caixinhas: (caixinhas ?? []).map((c) => [c.nome, c.meta_valor, c.saldo_atual, c.data_prazo]).sort(),
        cartoes: (cartoes ?? []).map((c) => [c.id, c.nome, c.dia_vencimento, c.dia_fechamento, c.limite, c.limite_usado, ...(c.faturas_pendentes ?? []).sort()]).sort(),
        preferencias,
      });
      const assinatura = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        assinaturaBruta,
      );
      assinaturaAgendaCompleta = assinatura;
      const agendaAtual = await AsyncStorage.getItem(chaveAgendado);
      if (agendaAtual === assinatura) return;
      // Reconstrói somente os lembretes configuráveis. Avisos obrigatórios de
      // parceria possuem origem finflow_sistema e nunca podem ser apagados aqui.
      await cancelarAgendamentosOpcionaisNativos();
    }

    // Alertas imediatos de limite de cartão próximo do máximo (dedup por cartão/dia)
    if (preferencias.limiteCartao && cartoes && cartoes.length > 0) {
      for (const [indiceCartao, cartao] of cartoes.entries()) {
        if (cartao.limite && cartao.limite_usado && cartao.limite_usado / cartao.limite > 0.8) {
          const escopoCartao = Number.isSafeInteger(cartao.id) ? String(cartao.id) : String(indiceCartao);
          const chaveLimite = `@notif_limite_${NOTIFICATION_SCHEDULE_VERSION}_${userId}_${escopoCartao}_${hojeStr}`;
          const jaNotificouLimite = await AsyncStorage.getItem(chaveLimite);
          if (!jaNotificouLimite) {
            const pct = Math.round((cartao.limite_usado / cartao.limite) * 100);
            const identificador = await agendarSeSessaoAtiva({
              content: {
                ...notifBase(),
                title: `⚠️ Cartão ${cartao.nome} — ${pct}% do limite usado`,
                body: `Disponível: R$ ${(cartao.limite - cartao.limite_usado).toFixed(2)} de R$ ${cartao.limite.toFixed(2)}`,
              },
              trigger: gatilhoIntervalo(3),
            });
            if (identificador && !await gravarMarcadorSeSessaoAtiva(chaveLimite, "1", userId, geracaoDestaAgenda)) {
              await Promise.allSettled([
                Notif.cancelScheduledNotificationAsync(identificador),
                Notif.dismissNotificationAsync(identificador),
              ]);
            }
          }
        }
      }
    }

    // Vencidas — executa sempre mas com dedup diário (evita duplicata por re-foco)
    const vencidas = preferencias.transacoesVencidas ? transacoes.filter((t) => {
      if (t.status !== "pendente") return false;
      const p = (t.data_vencimento || "").split("-");
      if (p.length < 3) return false;
      const d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
      return d < hoje;
    }) : [];
    const chaveVencidos = `@notif_vencidos_${NOTIFICATION_SCHEDULE_VERSION}_${userId}_${hojeStr}`;
    const jaNotificouVencidos = await AsyncStorage.getItem(chaveVencidos);
    if (vencidas.length > 0 && !jaNotificouVencidos) {
      const identificadoresVencidos: string[] = [];
      const despesasVencidas = vencidas.filter((t) => t.tipo === "despesa").length;
      const receitasVencidas = vencidas.filter((t) => t.tipo === "receita").length;
      if (despesasVencidas > 0) {
        const identificador = await agendarSeSessaoAtiva({
          content: { ...notifBase(), title: "🔴 FinFlow — Despesas Vencidas", body: `${despesasVencidas} despesa${despesasVencidas > 1 ? "s" : ""} vencida${despesasVencidas > 1 ? "s" : ""} sem pagar. Regularize agora!` },
          trigger: gatilhoIntervalo(4),
        });
        if (identificador) identificadoresVencidos.push(identificador);
      }
      if (receitasVencidas > 0) {
        const identificador = await agendarSeSessaoAtiva({
          content: { ...notifBase(), title: "🟡 FinFlow — Receitas Vencidas", body: `${receitasVencidas} receita${receitasVencidas > 1 ? "s" : ""} a receber vencida${receitasVencidas > 1 ? "s" : ""}. Verifique seus lançamentos!` },
          trigger: gatilhoIntervalo(5),
        });
        if (identificador) identificadoresVencidos.push(identificador);
      }
      if (
        identificadoresVencidos.length > 0
        && !await gravarMarcadorSeSessaoAtiva(chaveVencidos, "1", userId, geracaoDestaAgenda)
      ) {
        await Promise.allSettled(identificadoresVencidos.flatMap((identificador) => [
          Notif.cancelScheduledNotificationAsync(identificador),
          Notif.dismissNotificationAsync(identificador),
        ]));
      }
    }

    // Telas com dados parciais não devem alterar a agenda completa.
    if (!dadosCompletos) return;

    // Vencendo hoje (8h e 19h)
    const vencendoHoje = preferencias.transacoesDoDia ? transacoes.filter((t) => {
      if (t.status !== "pendente") return false;
      const p = (t.data_vencimento || "").split("-");
      if (p.length < 3) return false;
      const d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
      return d.getTime() === hoje.getTime();
    }) : [];
    if (vencendoHoje.length > 0) {
      const despesas = vencendoHoje.filter((t) => t.tipo === "despesa").length;
      const receitas = vencendoHoje.filter((t) => t.tipo === "receita").length;
      const partes: string[] = [];
      if (despesas > 0) partes.push(`${despesas} despesa${despesas > 1 ? "s" : ""}`);
      if (receitas > 0) partes.push(`${receitas} receita${receitas > 1 ? "s" : ""}`);
      const corpo = `Você tem ${partes.join(" e ")} vencendo hoje. Não esqueça!`;

      const hora8 = new Date(agora);
      hora8.setHours(8, 0, 0, 0);
      if (hora8 > agora) {
        const seg8 = Math.floor((hora8.getTime() - agora.getTime()) / 1000);
        await agendarSeSessaoAtiva({
          content: { ...notifBase(), title: "📅 FinFlow — Vencimento Hoje", body: corpo },
          trigger: gatilhoIntervalo(seg8),
        });
      }

      const hora19 = new Date(agora);
      hora19.setHours(19, 0, 0, 0);
      if (hora19 > agora) {
        const seg19 = Math.floor((hora19.getTime() - agora.getTime()) / 1000);
        await agendarSeSessaoAtiva({
          content: { ...notifBase(), title: "⏰ FinFlow — Lembrete de Hoje", body: corpo },
          trigger: gatilhoIntervalo(seg19),
        });
      }
    }

    // Notificações de prazo das caixinhas
    if (preferencias.prazoObjetivos && caixinhas && caixinhas.length > 0) {
      const MARCOS_DIAS = [30, 7, 3, 1, 0];
      for (const caixa of caixinhas) {
        if (!caixa.data_prazo) continue;
        const isCompleto = Number(caixa.saldo_atual) >= Number(caixa.meta_valor);
        if (isCompleto) continue;
        const p = caixa.data_prazo.split("-");
        const prazo = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
        prazo.setHours(9, 0, 0, 0);
        for (const marcosDias of MARCOS_DIAS) {
          const alvo = new Date(prazo);
          alvo.setDate(alvo.getDate() - marcosDias);
          if (alvo <= agora) continue;
          const segundos = Math.floor((alvo.getTime() - agora.getTime()) / 1000);
          const titulo = marcosDias === 0 ? "⏰ Prazo de objetivo hoje!" : `📌 Objetivo vence em ${marcosDias} dia${marcosDias > 1 ? "s" : ""}`;
          const falta = Number(caixa.meta_valor) - Number(caixa.saldo_atual);
          await agendarSeSessaoAtiva({
            content: {
              ...notifBase(),
              title: titulo,
              body: `"${caixa.nome}" — faltam R$ ${falta.toFixed(2)} para atingir a meta.`,
            },
            trigger: gatilhoIntervalo(segundos),
          });
        }
      }
    }
    // Notificações de vencimento e fechamento de cartões
    if ((preferencias.vencimentoFatura || preferencias.fechamentoFatura) && cartoes && cartoes.length > 0) {
      const dataNotifCartao = (diaDoMes: number, diasAntes: number, hora: number): { data: Date; mes: string } | null => {
        for (let offset = 0; offset <= 1; offset++) {
          const baseMes = new Date(agora.getFullYear(), agora.getMonth() + offset, 1);
          const ultimoDia = new Date(baseMes.getFullYear(), baseMes.getMonth() + 1, 0).getDate();
          const diaAlvo = new Date(baseMes.getFullYear(), baseMes.getMonth(), Math.min(diaDoMes, ultimoDia), hora, 0, 0, 0);
          const dataNotif = new Date(diaAlvo);
          dataNotif.setDate(dataNotif.getDate() - diasAntes);
          if (dataNotif > agora) {
            const mes = `${baseMes.getFullYear()}-${String(baseMes.getMonth() + 1).padStart(2, "0")}`;
            return { data: dataNotif, mes };
          }
        }
        return null;
      };

      for (const cartao of cartoes) {
        if (preferencias.vencimentoFatura) {
          // Vencimento: 3 dias antes, 1 dia antes, no dia
          const eventosVenc = [
            { diasAntes: 3, titulo: `💳 ${cartao.nome} — Fatura vence em 3 dias`, corpo: "Separe o valor para pagar sua fatura." },
            { diasAntes: 1, titulo: `💳 ${cartao.nome} — Fatura vence amanhã`, corpo: "Não esqueça de pagar a fatura do seu cartão." },
            { diasAntes: 0, titulo: `🔔 ${cartao.nome} — Fatura vence hoje!`, corpo: "Efetue o pagamento para evitar juros." },
          ];
          for (const ev of eventosVenc) {
            const evento = dataNotifCartao(cartao.dia_vencimento, ev.diasAntes, 9);
            if (evento && (cartao.faturas_pendentes ?? []).includes(evento.mes)) {
              const segundos = Math.floor((evento.data.getTime() - agora.getTime()) / 1000);
              if (segundos > 0) {
                await agendarSeSessaoAtiva({
                  content: { ...notifBase(), title: ev.titulo, body: ev.corpo },
                  trigger: gatilhoIntervalo(segundos),
                });
              }
            }
          }
        }

        if (preferencias.fechamentoFatura) {
          // Fechamento: 2 dias antes e no próprio dia
          const eventosFechamento = [
            {
              diasAntes: 2,
              titulo: `📋 ${cartao.nome} — Fatura fecha em 2 dias`,
              corpo: "Últimos dias para incluir compras nesta fatura.",
            },
            {
              diasAntes: 0,
              titulo: `🔒 ${cartao.nome} — Fatura fechou hoje`,
              corpo: "As próximas compras serão lançadas na fatura seguinte.",
            },
          ];
          for (const ev of eventosFechamento) {
            const eventoFechamento = dataNotifCartao(cartao.dia_fechamento, ev.diasAntes, 9);
            if (!eventoFechamento) continue;
            const segundos = Math.floor((eventoFechamento.data.getTime() - agora.getTime()) / 1000);
            if (segundos > 0) {
              await agendarSeSessaoAtiva({
                content: { ...notifBase(), title: ev.titulo, body: ev.corpo },
                trigger: gatilhoIntervalo(segundos),
              });
            }
          }
        }
      }
    }
    if (chaveAgendaCompleta && assinaturaAgendaCompleta) {
      const agendaConfirmada = await gravarMarcadorSeSessaoAtiva(
        chaveAgendaCompleta,
        assinaturaAgendaCompleta,
        userId,
        geracaoDestaAgenda,
      );
      if (!agendaConfirmada) await cancelarAgendamentosOpcionaisNativos();
    }
  } catch (e) {
    if (dadosCompletos && chaveAgendaCompleta) {
      await Promise.allSettled([
        AsyncStorage.removeItem(chaveAgendaCompleta),
        cancelarAgendamentosOpcionaisNativos(),
      ]);
    }
    console.log("Erro ao agendar notificações:", e);
  }
}

let filaAgendamentoNotificacoes: Promise<void> = Promise.resolve();

/** Serializa os chamadores das telas para que cancelamento e reconstrução não
 * se intercalem e produzam uma agenda parcial ou duplicada. */
export function agendarNotificacoesDoApp(
  transacoes: { status: string; data_vencimento: string; tipo: string }[],
  userId: string,
  caixinhas?: { nome: string; meta_valor: number; saldo_atual: number; data_prazo?: string }[],
  cartoes?: { id?: number; nome: string; dia_vencimento: number; dia_fechamento: number; limite?: number; limite_usado?: number; faturas_pendentes?: string[] }[],
  dadosCompletos = false,
): Promise<void> {
  const executar = () => executarAgendamentoNotificacoesDoApp(
    transacoes,
    userId,
    caixinhas,
    cartoes,
    dadosCompletos,
  );
  const atual = filaAgendamentoNotificacoes.then(executar, executar);
  filaAgendamentoNotificacoes = atual.catch(() => undefined);
  return atual;
}
