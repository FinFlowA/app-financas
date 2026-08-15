import { createClient } from "@/lib/supabase/server";
import { formatarReais } from "@/lib/format";
import { isMovimentoObjetivo, isTransferencia } from "@/lib/transacoes";
import { calcularSaldoProjetadoPorMes } from "@/lib/saldo-projetado";
import type { Categoria, Conta, Transacao } from "@/lib/types";
import FluxoSaldoChart, { type MesFluxo, type PontoSaldo } from "./fluxo-saldo-chart";

const MESES_NOME = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export default async function RelatoriosPage() {
  const supabase = await createClient();
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtualIdx = hoje.getMonth();
  const mesAtualStr = `${anoAtual}-${String(mesAtualIdx + 1).padStart(2, "0")}`;

  const [{ data: transacoesData }, { data: categoriasData }, { data: contasData }] = await Promise.all([
    supabase
      .from("transacoes")
      .select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status"),
    supabase.from("categorias").select("id, user_id, nome, cor, icone, tipo, ativa"),
    supabase.from("contas").select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado"),
  ]);

  const transacoes = (transacoesData ?? []) as Transacao[];
  const categorias = (categoriasData ?? []) as Categoria[];
  const contas = (contasData ?? []) as Conta[];
  const categoriaPorId = new Map(categorias.map((categoria) => [categoria.id, categoria]));

  // Transferências entre contas próprias se anulam no total combinado (débito
  // em uma conta, crédito em outra); só existe uma linha no banco, então
  // excluí-la evita contar o débito sem o crédito correspondente. Guardar/
  // resgatar de objetivo continua contando: é dinheiro que sai de verdade das
  // contas, mesmo sem ser "gasto".
  const semTransferencia = transacoes.filter((t) => !isTransferencia(t.descricao));
  const transacoesReais = semTransferencia.filter(
    (t) => t.status === "paga" && !isMovimentoObjetivo(t.descricao),
  );

  const saldoInicialTotal = contas.reduce((soma, conta) => soma + Number(conta.saldo_inicial), 0);
  const projecaoMensal = calcularSaldoProjetadoPorMes(saldoInicialTotal, semTransferencia, anoAtual, hoje);
  const pontosSaldo: PontoSaldo[] = projecaoMensal.map((mes) => ({
    label: `${MESES_NOME[mes.mesIdx]} ${anoAtual}`,
    saldo: mes.saldo,
    projetado: mes.projetado,
  }));

  const meses: MesFluxo[] = MESES_NOME.map((nome) => ({
    label: `${nome} ${anoAtual}`,
    receitas: 0,
    despesas: 0,
  }));

  const despesasPorCategoriaDoMes = new Map<number | null, number>();
  let totalDespesasDoMes = 0;

  for (const transacao of transacoesReais) {
    const dataEfetiva = transacao.data_realizacao ?? transacao.data_vencimento;
    if (!dataEfetiva?.startsWith(`${anoAtual}-`)) continue;
    const mesIdx = Number(dataEfetiva.slice(5, 7)) - 1;
    const mes = meses[mesIdx];
    if (!mes) continue;
    const valor = Number(transacao.valor);
    if (transacao.tipo === "receita") mes.receitas += valor;
    else mes.despesas += valor;

    if (transacao.tipo === "despesa" && dataEfetiva.startsWith(mesAtualStr)) {
      totalDespesasDoMes += valor;
      despesasPorCategoriaDoMes.set(
        transacao.categoria_id,
        (despesasPorCategoriaDoMes.get(transacao.categoria_id) ?? 0) + valor,
      );
    }
  }

  const distribuicao = [...despesasPorCategoriaDoMes.entries()]
    .map(([categoriaId, valor]) => ({
      categoria: categoriaId !== null ? categoriaPorId.get(categoriaId) : undefined,
      valor,
      percentual: totalDespesasDoMes > 0 ? (valor / totalDespesasDoMes) * 100 : 0,
    }))
    .sort((a, b) => b.valor - a.valor);

  return (
    <div className="max-w-6xl">
      <h1 className="mb-6 text-2xl font-extrabold text-foreground">Fluxo de caixa</h1>

      <p className="mb-3 text-sm font-semibold text-foreground-muted">
        Receitas, despesas e saldo acumulado em {anoAtual}
      </p>
      <FluxoSaldoChart meses={meses} saldos={pontosSaldo} />

      <h2 className="mt-8 mb-3 text-lg font-bold text-foreground">
        Despesas por categoria — {MESES_NOME[mesAtualIdx]}
      </h2>
      <div className="max-w-2xl rounded-ff-lg border border-border bg-surface p-5">
        {distribuicao.length === 0 && (
          <p className="text-sm text-foreground-muted">Nenhuma despesa realizada neste mês ainda.</p>
        )}
        <div className="flex flex-col gap-3">
          {distribuicao.map((item, indice) => {
            const cor = item.categoria?.cor ?? "#6C7D77";
            const nome = item.categoria?.nome ?? "Sem categoria";
            return (
              <div key={item.categoria?.id ?? `sem-categoria-${indice}`}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cor }} />
                    <span className="font-semibold text-foreground">{nome}</span>
                  </div>
                  <span className="text-foreground-muted">
                    {formatarReais(item.valor)} · {item.percentual.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                  <div className="h-full rounded-full" style={{ width: `${item.percentual}%`, backgroundColor: cor }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
