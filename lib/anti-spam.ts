/**
 * lib/anti-spam.ts
 * Proteção inteligente contra spam e abuso no FinFlow.
 *
 * Princípios:
 * - Usuário normal: experiência completamente fluida
 * - Usuário abusivo: bloqueio silencioso, sem mensagens de erro
 * - Sem timers visíveis, sem cooldowns explícitos
 * - Debounce para evitar cliques duplos acidentais
 * - Rate limit silencioso por janela de tempo
 */

// ─── Debounce ─────────────────────────────────────────────────────────────────

const debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

/**
 * Cria uma função com debounce.
 * Garante que cliques rápidos acidentais não disparem múltiplas ações.
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  chave: string,
  delayMs = 400
): (...args: Parameters<T>) => void {
  return (...args: Parameters<T>) => {
    const timer = debounceTimers.get(chave);
    if (timer) clearTimeout(timer);
    const novo = setTimeout(() => {
      debounceTimers.delete(chave);
      fn(...args);
    }, delayMs);
    debounceTimers.set(chave, novo);
  };
}

// ─── Rate Limit em memória ────────────────────────────────────────────────────

interface JanelaRateLimit {
  contagem: number;
  inicio: number;
}

const rateLimitMap: Map<string, JanelaRateLimit> = new Map();

/**
 * Verifica e registra uma tentativa de ação.
 * Retorna false silenciosamente se o usuário estiver abusando.
 *
 * @param chave     Identificador único da ação (ex: "enviar_mensagem_ia")
 * @param maxAcoes  Máximo de ações permitidas na janela
 * @param janelaMs  Duração da janela em ms (padrão: 10 segundos)
 */
export function verificarRateLimit(
  chave: string,
  maxAcoes = 10,
  janelaMs = 10_000
): boolean {
  const agora = Date.now();
  const janela = rateLimitMap.get(chave);

  if (!janela || agora - janela.inicio > janelaMs) {
    // Nova janela
    rateLimitMap.set(chave, { contagem: 1, inicio: agora });
    return true;
  }

  if (janela.contagem >= maxAcoes) {
    // Abuso silencioso — não incrementa, não avisa
    return false;
  }

  janela.contagem += 1;
  return true;
}

// ─── Proteção contra requisições duplicadas ───────────────────────────────────

const requestsEmAndamento: Set<string> = new Set();

/**
 * Garante que uma operação assíncrona não rode em paralelo com ela mesma.
 * Se já estiver em andamento, retorna false silenciosamente.
 */
export async function executarSemDuplicata<T>(
  chave: string,
  fn: () => Promise<T>
): Promise<T | null> {
  if (requestsEmAndamento.has(chave)) return null;
  requestsEmAndamento.add(chave);
  try {
    return await fn();
  } finally {
    requestsEmAndamento.delete(chave);
  }
}

// ─── Fila de execução ─────────────────────────────────────────────────────────

/**
 * Fila simples para serializar operações críticas.
 * Útil quando múltiplas ações da IA precisam acontecer em sequência.
 */
export class FilaExecucao {
  private fila: (() => Promise<any>)[] = [];
  private executando = false;

  enfileirar<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.fila.push(async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
      this.processar();
    });
  }

  private async processar() {
    if (this.executando) return;
    this.executando = true;
    while (this.fila.length > 0) {
      const fn = this.fila.shift()!;
      await fn();
    }
    this.executando = false;
  }
}

export const filaIA = new FilaExecucao();
