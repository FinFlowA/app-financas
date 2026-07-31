import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// Importação lazy para não travar o app se o módulo falhar
let Notif: any = null;
try {
  Notif = require("expo-notifications");
  Notif.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  // Canal Android obrigatório para exibir notificações no Android 8+
  if (Platform.OS === "android") {
    Notif.setNotificationChannelAsync("finflow", {
      name: "FinFlow",
      importance: Notif.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default",
      enableVibrate: true,
    });
  }
} catch {
  // expo-notifications não disponível — modo silencioso
}

export async function pedirPermissaoNotificacoes(): Promise<boolean> {
  if (!Notif || Platform.OS === "web") return false;
  try {
    const { status: existing } = await Notif.getPermissionsAsync();
    if (existing === "granted") return true;
    const { status } = await Notif.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

export async function notificacoesEstaoAtivas(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem("@notificacoes_enabled");
    return val === "true";
  } catch {
    return false;
  }
}

export async function notificacoesEstaoAtivasPara(userId: string): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(`@notificacoes_enabled_${userId}`);
    return val === "true";
  } catch {
    return false;
  }
}

export async function agendarNotificacoesDoApp(
  transacoes: { status: string; data_vencimento: string; tipo: string }[],
  userId: string,
  caixinhas?: { nome: string; meta_valor: number; saldo_atual: number; data_prazo?: string }[],
  cartoes?: { nome: string; dia_vencimento: number; dia_fechamento: number; limite?: number; limite_usado?: number }[]
) {
  if (!Notif || Platform.OS === "web") return;
  try {
    const ativas = await notificacoesEstaoAtivasPara(userId);
    if (!ativas) return;

    const agora = new Date();
    const hojeStr = agora.toISOString().split("T")[0];
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

    const channelId = Platform.OS === "android" ? "finflow" : undefined;
    const notifBase = (extra?: object) => ({ badge: 0, ...(channelId ? { android: { channelId } } : {}), ...extra });

    try { await Notif.setBadgeCountAsync(0); } catch {}

    // O dashboard envia o conjunto completo de dados e pode reorganizar a agenda.
    // O cancelamento precisa acontecer antes dos alertas imediatos para não apagá-los.
    if (transacoes.length > 0) {
      const chaveAgendado = `@notif_agendado_${userId}_${hojeStr}`;
      const jaAgendadoHoje = await AsyncStorage.getItem(chaveAgendado);
      if (jaAgendadoHoje) return;
      await Notif.cancelAllScheduledNotificationsAsync();
      await AsyncStorage.setItem(chaveAgendado, "1");
    }

    // Alertas imediatos de limite de cartão próximo do máximo (dedup por cartão/dia)
    if (cartoes && cartoes.length > 0) {
      for (const cartao of cartoes) {
        if (cartao.limite && cartao.limite_usado && cartao.limite_usado / cartao.limite > 0.8) {
          const chaveLimite = `@notif_limite_${userId}_${cartao.nome}_${hojeStr}`;
          const jaNotificouLimite = await AsyncStorage.getItem(chaveLimite);
          if (!jaNotificouLimite) {
            await AsyncStorage.setItem(chaveLimite, "1");
            const pct = Math.round((cartao.limite_usado / cartao.limite) * 100);
            await Notif.scheduleNotificationAsync({
              content: {
                ...notifBase(),
                title: `⚠️ Cartão ${cartao.nome} — ${pct}% do limite usado`,
                body: `Disponível: R$ ${(cartao.limite - cartao.limite_usado).toFixed(2)} de R$ ${cartao.limite.toFixed(2)}`,
              },
              trigger: { type: "timeInterval", seconds: 3, repeats: false } as any,
            });
          }
        }
      }
    }

    // Vencidas — executa sempre mas com dedup diário (evita duplicata por re-foco)
    const vencidas = transacoes.filter((t) => {
      if (t.status !== "pendente") return false;
      const p = (t.data_vencimento || "").split("-");
      if (p.length < 3) return false;
      const d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
      return d < hoje;
    });
    const chaveVencidos = `@notif_vencidos_${userId}_${hojeStr}`;
    const jaNotificouVencidos = await AsyncStorage.getItem(chaveVencidos);
    if (vencidas.length > 0 && !jaNotificouVencidos) {
      await AsyncStorage.setItem(chaveVencidos, "1");
      const despesasVencidas = vencidas.filter((t) => t.tipo === "despesa").length;
      const receitasVencidas = vencidas.filter((t) => t.tipo === "receita").length;
      if (despesasVencidas > 0) {
        await Notif.scheduleNotificationAsync({
          content: { ...notifBase(), title: "🔴 FinFlow — Despesas Vencidas", body: `${despesasVencidas} despesa${despesasVencidas > 1 ? "s" : ""} vencida${despesasVencidas > 1 ? "s" : ""} sem pagar. Regularize agora!` },
          trigger: { type: "timeInterval", seconds: 4, repeats: false } as any,
        });
      }
      if (receitasVencidas > 0) {
        await Notif.scheduleNotificationAsync({
          content: { ...notifBase(), title: "🟡 FinFlow — Receitas Vencidas", body: `${receitasVencidas} receita${receitasVencidas > 1 ? "s" : ""} a receber vencida${receitasVencidas > 1 ? "s" : ""}. Verifique seus lançamentos!` },
          trigger: { type: "timeInterval", seconds: 5, repeats: false } as any,
        });
      }
    }

    // Telas com dados parciais não devem alterar a agenda completa.
    if (transacoes.length === 0) return;

    // Vencendo hoje (8h e 19h)
    const vencendoHoje = transacoes.filter((t) => {
      if (t.status !== "pendente") return false;
      const p = (t.data_vencimento || "").split("-");
      if (p.length < 3) return false;
      const d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
      return d.getTime() === hoje.getTime();
    });
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
        await Notif.scheduleNotificationAsync({
          content: { ...notifBase(), title: "📅 FinFlow — Vencimento Hoje", body: corpo },
          trigger: { type: "timeInterval", seconds: seg8, repeats: false } as any,
        });
      }

      const hora19 = new Date(agora);
      hora19.setHours(19, 0, 0, 0);
      if (hora19 > agora) {
        const seg19 = Math.floor((hora19.getTime() - agora.getTime()) / 1000);
        await Notif.scheduleNotificationAsync({
          content: { ...notifBase(), title: "⏰ FinFlow — Lembrete de Hoje", body: corpo },
          trigger: { type: "timeInterval", seconds: seg19, repeats: false } as any,
        });
      }
    }

    // Notificações de prazo das caixinhas
    if (caixinhas && caixinhas.length > 0) {
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
          await Notif.scheduleNotificationAsync({
            content: {
              ...notifBase(),
              title: titulo,
              body: `"${caixa.nome}" — faltam R$ ${falta.toFixed(2)} para atingir a meta.`,
            },
            trigger: { type: "timeInterval", seconds: segundos, repeats: false } as any,
          });
        }
      }
    }
    // Notificações de vencimento e fechamento de cartões
    if (cartoes && cartoes.length > 0) {
      const dataNotifCartao = (diaDoMes: number, diasAntes: number, hora: number): Date | null => {
        for (let offset = 0; offset <= 1; offset++) {
          const baseMes = new Date(agora.getFullYear(), agora.getMonth() + offset, 1);
          const ultimoDia = new Date(baseMes.getFullYear(), baseMes.getMonth() + 1, 0).getDate();
          const diaAlvo = new Date(baseMes.getFullYear(), baseMes.getMonth(), Math.min(diaDoMes, ultimoDia), hora, 0, 0, 0);
          const dataNotif = new Date(diaAlvo);
          dataNotif.setDate(dataNotif.getDate() - diasAntes);
          if (dataNotif > agora) return dataNotif;
        }
        return null;
      };

      for (const cartao of cartoes) {
        // Vencimento: 3 dias antes, 1 dia antes, no dia
        const eventosVenc = [
          { diasAntes: 3, titulo: `💳 ${cartao.nome} — Fatura vence em 3 dias`, corpo: "Separe o valor para pagar sua fatura." },
          { diasAntes: 1, titulo: `💳 ${cartao.nome} — Fatura vence amanhã`, corpo: "Não esqueça de pagar a fatura do seu cartão." },
          { diasAntes: 0, titulo: `🔔 ${cartao.nome} — Fatura vence hoje!`, corpo: "Efetue o pagamento para evitar juros." },
        ];
        for (const ev of eventosVenc) {
          const dataNotif = dataNotifCartao(cartao.dia_vencimento, ev.diasAntes, 9);
          if (dataNotif) {
            const segundos = Math.floor((dataNotif.getTime() - agora.getTime()) / 1000);
            if (segundos > 0) {
              await Notif.scheduleNotificationAsync({
                content: { ...notifBase(), title: ev.titulo, body: ev.corpo },
                trigger: { type: "timeInterval", seconds: segundos, repeats: false } as any,
              });
            }
          }
        }

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
          const dataFecha = dataNotifCartao(cartao.dia_fechamento, ev.diasAntes, 9);
          if (!dataFecha) continue;
          const segundos = Math.floor((dataFecha.getTime() - agora.getTime()) / 1000);
          if (segundos > 0) {
            await Notif.scheduleNotificationAsync({
              content: { ...notifBase(), title: ev.titulo, body: ev.corpo },
              trigger: { type: "timeInterval", seconds: segundos, repeats: false } as any,
            });
          }
        }
      }
    }
  } catch (e) {
    console.log("Erro ao agendar notificações:", e);
  }
}
