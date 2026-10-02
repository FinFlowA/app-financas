import type { SupabaseClient } from "@supabase/supabase-js";
import { filtroTransacoesVisiveis } from "@/lib/transacoes-visiveis";

/**
 * Filtro das transações visíveis para quem está logado (ver
 * lib/transacoes-visiveis.ts): lê o usuário do JWT e as contas que ele
 * enxerga. Use com `.or(filtro)` nas consultas de `transacoes`.
 */
export async function filtroTransacoesDoUsuario(supabase: SupabaseClient): Promise<string> {
  const [{ data: auth }, contas] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("contas").select("id"),
  ]);
  const userId = auth?.claims.sub;
  // Sem sessão, nenhuma linha (ids são sempre positivos): a própria página
  // continua cuidando do redirecionamento para o login, como antes.
  if (typeof userId !== "string") return "id.eq.0";
  if (contas.error) throw new Error("Não foi possível carregar suas contas agora.");
  return filtroTransacoesVisiveis(userId, (contas.data ?? []).map((conta: { id: number }) => conta.id));
}
