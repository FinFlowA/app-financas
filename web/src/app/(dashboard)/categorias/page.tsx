import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { filtroTransacoesDoUsuario } from "@/lib/supabase/transacoes-visiveis";
import { mesAtualEmSaoPaulo } from "@/lib/date";
import { progressoDasCategorias, type ItemCartaoParaAlvo, type TransacaoParaAlvo } from "@/lib/metas-categorias";
import type { Categoria } from "@/lib/types";
import CategoryManager, { type CategoryProgress } from "./category-manager";
import CategoryMonthNav from "./month-nav";

/** Primeiro e último dia do mês "AAAA-MM". */
function diasDoMes(mes: string): { inicio: string; fim: string } {
  const [ano, numero] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, numero, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

export default async function CategoriasPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const supabase = await createClient();
  const mesAtual = mesAtualEmSaoPaulo();
  // ?mes=AAAA-MM mostra metas batidas e limites passados de meses anteriores,
  // ou como estão os meses futuros (só com o agendado).
  const pedido = (await searchParams).mes;
  const mes = pedido && /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) ? pedido : mesAtual;
  const { inicio, fim } = diasDoMes(mes);
  // Filtro explícito das transações visíveis: o banco usa os índices em vez
  // de ler a tabela inteira (ver lib/transacoes-visiveis.ts).
  const filtroVisiveis = filtroTransacoesDoUsuario(supabase);
  filtroVisiveis.catch(() => undefined);
  const [result, transactionsResult, invoiceItemsResult] = await Promise.all([
    // `*` mantém a leitura compatível com bancos que ainda não receberam a
    // coluna `version`; o RLS continua limitando as linhas ao usuário conectado.
    fetchAllRows((from, to) => supabase.from("categorias").select("*").order("nome").range(from, to)),
    // Para o progresso das metas e limites: só o mês atual (vencimento ou
    // realização no mês). A data efetiva de cada lançamento é conferida depois.
    filtroVisiveis.then((filtro) => fetchAllRows((from, to) => supabase
      .from("transacoes")
      .select("id, tipo, valor, status, data_vencimento, data_realizacao, descricao, categoria_id")
      .or(filtro)
      .or(`and(data_vencimento.gte.${inicio},data_vencimento.lte.${fim}),and(data_realizacao.gte.${inicio},data_realizacao.lte.${fim})`)
      .not("categoria_id", "is", null)
      .order("id")
      .range(from, to))),
    fetchAllRows((from, to) => supabase
      .from("fatura_itens")
      .select("id, valor, mes_fatura, categoria_id, descricao")
      .eq("mes_fatura", mes)
      .not("categoria_id", "is", null)
      .order("id")
      .range(from, to)),
  ]);
  if (result.error) {
    return <section className="ff-card mx-auto max-w-3xl p-6 text-center"><h1 className="text-xl font-extrabold text-foreground">Categorias indisponíveis</h1><p className="mt-2 text-sm text-foreground-muted">Não foi possível carregar suas categorias agora. Atualize a página em instantes.</p></section>;
  }
  const categories = ((result.data ?? []) as Categoria[]).map((category) => ({ ...category, version: category.version ?? 1 }));
  const active = categories.filter((category) => category.ativa === true || category.ativa === 1);
  const income = active.filter((category) => category.tipo === "receita" || category.tipo === "ambos").length;
  const expenses = active.filter((category) => category.tipo === "despesa" || category.tipo === "ambos").length;
  // O progresso é um complemento: se a busca do mês falhar, as categorias
  // continuam disponíveis e o aviso explica a ausência das barras.
  const progressUnavailable = Boolean(transactionsResult.error || invoiceItemsResult.error);
  const progress: CategoryProgress = progressUnavailable
    ? {}
    : Object.fromEntries(progressoDasCategorias(
      categories,
      (transactionsResult.data ?? []) as TransacaoParaAlvo[],
      (invoiceItemsResult.data ?? []) as ItemCartaoParaAlvo[],
      mes,
    ));
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-15T12:00:00Z`));

  return (
    <div className="w-full">
      <header className="ff-page-hero mb-6 px-5 py-6 sm:px-7 sm:py-7">
        <div aria-hidden="true" className="absolute -right-20 top-1/2 h-60 w-60 -translate-y-1/2 rounded-full border border-white/10" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-mint">Organização inteligente</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Categorias</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/72">Organize receitas e despesas sem perder o histórico: categorias usadas são arquivadas com segurança.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-32 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 backdrop-blur-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Receitas</p><p className="mt-1 text-xl font-black text-mint">{income}</p></div>
            <div className="min-w-32 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 backdrop-blur-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Despesas</p><p className="mt-1 text-xl font-black text-[#ff8c84]">{expenses}</p></div>
          </div>
        </div>
      </header>
      <aside role="note" className="mb-6 flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-foreground">
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-black text-white">i</span>
        <div className="space-y-1 pt-1">
          <p><strong>Metas e limites:</strong> defina uma meta mensal nas categorias de receita e um limite mensal nas de despesa. A barra mostra {monthLabel}: a parte cheia é o que já aconteceu e a mais clara, o que ainda está agendado. Compras do cartão contam no mês da fatura.</p>
          <p><strong>Como aparece no início:</strong> categorias com o mesmo nome são agrupadas no gráfico da página inicial.</p>
          {progressUnavailable && <p className="font-semibold text-red">Não foi possível calcular o progresso do mês agora. Atualize a página em instantes.</p>}
        </div>
      </aside>
      <section className="ff-page-hero mb-5 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-foreground-muted">Metas e limites de</p><p className="font-black capitalize text-foreground">{monthLabel}{mes < mesAtual ? " · mês encerrado" : mes > mesAtual ? " · previsão" : " · mês atual"}</p></div>
        <div><CategoryMonthNav month={mes} currentMonth={mesAtual} /></div>
      </section>
      <CategoryManager categories={categories} progress={progress} />
    </div>
  );
}
