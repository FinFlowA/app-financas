/**
 * lib/ia-limites.ts
 * Controle de limite diário de ações de IA.
 *
 * REGRA FUNDAMENTAL:
 * O limite conta apenas quando uma ação REAL é executada:
 *   - criar conta, lançamento, categoria, caixinha, cartão
 *   - editar qualquer item
 *   - excluir qualquer item
 *   - gerar análise financeira
 *
 * Perguntas intermediárias (coleta de dados) NÃO consomem cota.
 *
 * Exemplo correto de contagem:
 *   usuário: "Criar conta Nubank"
 *   IA:      "Qual a cor?" → 0 ações consumidas
 *   usuário: "Roxo"
 *   IA cria a conta → 1 ação consumida
 *
 * Reset automático à meia-noite local.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TipoPlano } from "./planos";
import { LIMITES_PLANOS } from "./planos";

const PREFIXO = "@ia_acoes_";

function chaveHoje(userId: string): string {
  const hoje = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${PREFIXO}${userId}_${hoje}`;
}

/** Retorna quantas ações de IA foram consumidas hoje */
export async function getAcoesHoje(userId: string): Promise<number> {
  try {
    const val = await AsyncStorage.getItem(chaveHoje(userId));
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

/** Incrementa o contador de ações em +1 e retorna o novo total */
export async function registrarAcaoIA(userId: string): Promise<number> {
  try {
    const atual = await getAcoesHoje(userId);
    const novo = atual + 1;
    await AsyncStorage.setItem(chaveHoje(userId), String(novo));
    return novo;
  } catch {
    return 0;
  }
}

/**
 * Verifica se o usuário ainda tem cota de IA disponível.
 * Retorna { pode: boolean, restante: number, limite: number }
 */
export async function verificarCotaIA(
  userId: string,
  plano: TipoPlano
): Promise<{ pode: boolean; restante: number; limite: number; usadas: number }> {
  const limite = LIMITES_PLANOS[plano].iaAcoesDia;

  if (limite === 0) {
    return { pode: false, restante: 0, limite: 0, usadas: 0 };
  }
  if (limite === -1) {
    // ilimitado
    const usadas = await getAcoesHoje(userId);
    return { pode: true, restante: -1, limite: -1, usadas };
  }

  const usadas = await getAcoesHoje(userId);
  const restante = Math.max(0, limite - usadas);
  return { pode: restante > 0, restante, limite, usadas };
}

/**
 * Tenta consumir 1 ação de IA.
 * Retorna true se bem-sucedido, false se cota esgotada.
 */
export async function consumirAcaoIA(
  userId: string,
  plano: TipoPlano
): Promise<boolean> {
  const { pode } = await verificarCotaIA(userId, plano);
  if (!pode) return false;
  await registrarAcaoIA(userId);
  return true;
}

/** Verifica se o intent é uma ação real que consome cota (não coleta/pergunta) */
export function intentConsumeAcao(
  intent: string,
  status: string
): boolean {
  // Apenas "confirmed" executa a ação — collecting_data e ready_for_confirmation não consomem
  if (status !== "confirmed") return false;

  const intentsComAcao = new Set([
    "create_transaction",
    "create_account",
    "edit_account",
    "create_category",
    "edit_category",
    "delete_category",
    "create_caixinha",
    "move_caixinha",
    "delete_caixinha",
    "archive_caixinha",
    "confirm_pending",
    "delete_transaction",
    "archive_account",
    "create_cartao",
    "add_compra_cartao",
    "create_compra_parcelada",
    // Analíticos (apenas Premium)
    "analyze_finances",
    "financial_projection",
    "savings_goal",
  ]);

  return intentsComAcao.has(intent);
}

/**
 * Retorna mensagem para o usuário quando cota foi esgotada.
 * Não mostra timer — apenas informa o limite e quando renova.
 */
export function msgCotaEsgotada(plano: TipoPlano): string {
  const limite = LIMITES_PLANOS[plano].iaAcoesDia;
  if (plano === "smart") {
    return `Você usou todas as ${limite} ações de IA disponíveis hoje no plano Smart.\n\nO limite renova automaticamente à meia-noite. Para mais ações, faça upgrade para o Premium (50/dia).`;
  }
  if (plano === "premium") {
    return `Você usou todas as ${limite} ações de IA disponíveis hoje.\n\nO limite renova automaticamente à meia-noite.`;
  }
  return "A IA não está disponível no plano Free. Faça upgrade para usar esta funcionalidade.";
}
