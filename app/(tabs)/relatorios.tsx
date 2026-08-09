import { MaterialIcons } from "@expo/vector-icons";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../_layout";
import { fmtReais } from "../../lib/utils";
import { finFlowTheme, FinFlowTabHeader } from "../../constants/finflow-design";
import {
  dataEfetivaTransacao,
  getContaDestinoTransferencia,
  isMovimentoObjetivo,
  isTransferencia,
} from "../../lib/transacoes";

interface Transacao {
  valor: number;
  tipo: string;
  status: string;
  data_vencimento: string;
  data_realizacao?: string | null;
  conta_id: number;
  descricao: string;
}

interface Conta {
  id: number;
  nome: string;
  cor?: string;
  saldo_inicial: number;
  arquivado?: boolean;
}

interface MesProj {
  mesIdx: number;
  saldo: number;
  isFuture: boolean;
  isPast?: boolean;
}

interface EventoSaldo {
  data: string;
  valor: number;
}

const ordenarEventosComAcumulado = (eventos: EventoSaldo[]) => {
  const ordenados = [...eventos].sort((a, b) => a.data.localeCompare(b.data));
  let total = 0;
  return {
    datas: ordenados.map((evento) => evento.data),
    acumulados: ordenados.map((evento) => {
      total += evento.valor;
      return total;
    }),
  };
};

const indiceAposData = (datas: string[], dataLimite: string): number => {
  let inicio = 0;
  let fim = datas.length;
  while (inicio < fim) {
    const meio = Math.floor((inicio + fim) / 2);
    const dataDoMeio = datas.at(meio);
    if (dataDoMeio !== undefined && dataDoMeio <= dataLimite) inicio = meio + 1;
    else fim = meio;
  }
  return inicio;
};

const totalAcumuladoAte = (
  serie: ReturnType<typeof ordenarEventosComAcumulado>,
  dataLimite: string,
): number => {
  const indice = indiceAposData(serie.datas, dataLimite);
  return indice === 0 ? 0 : (serie.acumulados.at(indice - 1) ?? 0);
};

const MESES_ABREV = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MESES_FULL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const getNomeMes = (mes: string) => MESES_FULL[parseInt(mes, 10) - 1];

export default function RelatoriosScreen() {
  const { isDark, session } = useAppTheme();
  const novoTema = finFlowTheme(isDark);
  const { width: screenWidth } = useWindowDimensions();
  const tabBarHeight = useBottomTabBarHeight();

  const Cores = {
    fundo: novoTema.background,
    textoPrincipal: novoTema.text,
    textoSecundario: novoTema.textMuted,
    cardFundo: novoTema.surface,
    borda: novoTema.border,
    pillFundo: novoTema.surfaceMuted,
    linhaGuia: novoTema.border,
    linhaBalance: novoTema.primary,
  };

  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [contasSelecionadasIds, setContasSelecionadasIds] = useState<number[] | null>(null);

  const hoje = new Date();
  const anoAtualNum = hoje.getFullYear();
  const mesAtualIdx = hoje.getMonth();

  const [anoSelecionado, setAnoSelecionado] = useState<number>(anoAtualNum);
  const [mesProjSelecionado, setMesProjSelecionado] = useState<number>(mesAtualIdx);
  const [chartCardHeight, setChartCardHeight] = useState(0);
  const [chartChromeHeight, setChartChromeHeight] = useState(0);
  const [detailHeight, setDetailHeight] = useState(0);

  const projScrollRef = useRef<ScrollView>(null);
  const chartScrollXRef = useRef(0);
  const chartDragStartXRef = useRef(0);
  const chartDragResponder = useRef(
    PanResponder.create({
      // No celular, o ScrollView continua usando o gesto nativo. No web,
      // capturamos apenas um arrasto horizontal real, mantendo o toque nos
      // meses livre quando o ponteiro não se move.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_event, gesture) => (
        Platform.OS === "web"
        && Math.abs(gesture.dx) > 6
        && Math.abs(gesture.dx) > Math.abs(gesture.dy)
      ),
      onPanResponderGrant: () => {
        chartDragStartXRef.current = chartScrollXRef.current;
      },
      onPanResponderMove: (_event, gesture) => {
        const nextX = Math.max(0, chartDragStartXRef.current - gesture.dx);
        projScrollRef.current?.scrollTo({ x: nextX, animated: false });
      },
      onPanResponderTerminationRequest: () => true,
    }),
  ).current;

  const carregarDados = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const [resT, resC] = await Promise.all([
        supabase.from("transacoes").select("valor, tipo, status, data_vencimento, data_realizacao, conta_id, descricao"),
        supabase.from("contas").select("id, nome, cor, saldo_inicial, arquivado"),
      ]);
      if (resT.data) setTransacoes(resT.data);
      if (resC.data) setContas(resC.data.filter((c) => !c.arquivado));
    } catch (e) { console.error(e); }
  }, [session?.user?.id]);

  useFocusEffect(useCallback(() => { carregarDados(); }, [carregarDados]));

  const alterarAno = (dir: number) => {
    const novoAno = anoSelecionado + dir;
    setAnoSelecionado(novoAno);
    setMesProjSelecionado(novoAno === anoAtualNum ? mesAtualIdx : 0);
  };

  const idsContasAtivas = useMemo(
    () => new Set(contas.map((conta) => conta.id)),
    [contas],
  );
  const idsSelecionadosValidos = useMemo(
    () => contasSelecionadasIds?.filter((id) => idsContasAtivas.has(id)) ?? null,
    [contasSelecionadasIds, idsContasAtivas],
  );
  const escopoFluxoEhTodas = idsSelecionadosValidos === null
    || idsSelecionadosValidos.length === contas.length
    || (contas.length > 0 && idsSelecionadosValidos.length === 0);
  const contasFiltradas = useMemo(
    () => escopoFluxoEhTodas
      ? contas
      : contas.filter((conta) => idsSelecionadosValidos?.includes(conta.id)),
    [contas, escopoFluxoEhTodas, idsSelecionadosValidos],
  );
  const idsEscopoFluxo = useMemo(
    () => new Set(contasFiltradas.map((conta) => conta.id)),
    [contasFiltradas],
  );

  const alternarContaFluxo = (contaId: number) => {
    setContasSelecionadasIds((idsAtuais) => {
      // Ao sair da visão "Todas", o primeiro toque cria uma seleção
      // individual; os próximos adicionam novas contas ao conjunto.
      if (idsAtuais === null) return [contaId];

      const idsValidos = idsAtuais.filter(id => idsContasAtivas.has(id));
      if (idsValidos.includes(contaId)) {
        if (idsValidos.length === 1) return idsValidos;
        return idsValidos.filter(id => id !== contaId);
      }

      const proximosIds = [...idsValidos, contaId];
      return proximosIds.length === contas.length ? null : proximosIds;
    });
  };

  // Dados filtrados pela seleção múltipla. Transferências internas ao
  // conjunto se anulam; movimentos que cruzam a fronteira viram saída/entrada.
  const transacoesFiltradas = useMemo(() => transacoes.flatMap((t) => {
    const destinoId = getContaDestinoTransferencia(t.descricao);

    if (destinoId !== null) {
      const origemSelecionada = idsEscopoFluxo.has(t.conta_id);
      const destinoSelecionado = idsEscopoFluxo.has(destinoId);
      if (origemSelecionada === destinoSelecionado) return [];
      if (origemSelecionada) return [t];
      return [{ ...t, tipo: "receita", conta_id: destinoId }];
    }

    if (isMovimentoObjetivo(t.descricao)) {
      return idsEscopoFluxo.has(t.conta_id) ? [t] : [];
    }

    // Transferências antigas possuem duas linhas. No consolidado elas são
    // internas e não representam receita ou despesa real.
    if (isTransferencia(t.descricao)) {
      return contasFiltradas.length === 1 && idsEscopoFluxo.has(t.conta_id) ? [t] : [];
    }
    return idsEscopoFluxo.has(t.conta_id) ? [t] : [];
  }), [contasFiltradas.length, idsEscopoFluxo, transacoes]);

  const isAnoAtual = anoSelecionado === anoAtualNum;

  const {
    saldoAtualGlobal,
    todosOsMeses,
    projecaoSaldo,
  } = useMemo(() => {
    const saldoInicialTotal = contasFiltradas.reduce(
      (total, conta) => total + Number(conta.saldo_inicial),
      0,
    );
    let receitasRealizadas = 0;
    let despesasRealizadas = 0;
    const eventosRealizados: EventoSaldo[] = [];
    const eventosPendentes: EventoSaldo[] = [];
    const datasPendentesValidas: string[] = [];
    const meses = Array.from({ length: 12 }, (_, mesIdx) => ({
      mesIdx,
      label: MESES_ABREV.at(mesIdx) ?? "",
      isAtual: isAnoAtual && mesIdx === mesAtualIdx,
      recPagas: 0,
      despPagas: 0,
      recPendentes: 0,
      despPendentes: 0,
    }));

    for (const transacao of transacoesFiltradas) {
      const valor = Number(transacao.valor);
      const realizada = transacao.status === "paga";
      const dataEfetiva = dataEfetivaTransacao(transacao);
      const delta = transacao.tipo === "receita" ? valor : -valor;

      if (realizada) {
        if (transacao.tipo === "receita") receitasRealizadas += valor;
        if (transacao.tipo === "despesa") despesasRealizadas += valor;
        eventosRealizados.push({ data: dataEfetiva, valor: delta });
      } else {
        const vencimento = transacao.data_vencimento || "";
        eventosPendentes.push({ data: vencimento, valor: delta });
        if (vencimento) datasPendentesValidas.push(vencimento);
      }

      // Guardar ou resgatar valores de um objetivo altera o saldo disponível,
      // mas não representa receita nem despesa nas barras do gráfico.
      if (isMovimentoObjetivo(transacao.descricao)) continue;
      if (!dataEfetiva.startsWith(`${anoSelecionado}-`)) continue;

      const mesIdx = Number(dataEfetiva.slice(5, 7)) - 1;
      const mes = meses.at(mesIdx);
      if (!mes) continue;
      if (transacao.tipo === "receita") {
        if (realizada) mes.recPagas += valor;
        else mes.recPendentes += valor;
      } else if (transacao.tipo === "despesa") {
        if (realizada) mes.despPagas += valor;
        else mes.despPendentes += valor;
      }
    }

    const saldoAtual = saldoInicialTotal + receitasRealizadas - despesasRealizadas;
    const realizados = ordenarEventosComAcumulado(eventosRealizados);
    const pendentes = ordenarEventosComAcumulado(eventosPendentes);
    datasPendentesValidas.sort((a, b) => a.localeCompare(b));

    // Doze buscas binárias substituem as varreduras completas repetidas para
    // cada mês. O resultado financeiro permanece cumulativo como antes.
    const projecoes: MesProj[] = meses.map(({ mesIdx }) => {
      const yyyymm = `${anoSelecionado}-${String(mesIdx + 1).padStart(2, "0")}`;
      const fimDoMes = `${yyyymm}-${String(new Date(anoSelecionado, mesIdx + 1, 0).getDate()).padStart(2, "0")}`;
      const mesNoPassado = anoSelecionado < anoAtualNum
        || (isAnoAtual && mesIdx < mesAtualIdx);
      const mesAtualSemPendencias = isAnoAtual
        && mesIdx === mesAtualIdx
        && indiceAposData(datasPendentesValidas, fimDoMes) === 0;

      if (mesNoPassado) {
        return {
          mesIdx,
          saldo: saldoInicialTotal + totalAcumuladoAte(realizados, fimDoMes),
          isFuture: false,
          isPast: true,
        };
      }
      if (mesAtualSemPendencias) {
        return { mesIdx, saldo: saldoAtual, isFuture: false };
      }
      return {
        mesIdx,
        saldo: saldoAtual + totalAcumuladoAte(pendentes, fimDoMes),
        isFuture: true,
      };
    });

    return {
      saldoAtualGlobal: saldoAtual,
      todosOsMeses: meses,
      projecaoSaldo: projecoes,
    };
  }, [anoAtualNum, anoSelecionado, contasFiltradas, isAnoAtual, mesAtualIdx, transacoesFiltradas]);

  // Chart Y scale (bars + balance line share same axis)
  const barMaxes = todosOsMeses.map(m => Math.max(m.recPagas, m.despPagas));
  const balanceSaldos = projecaoSaldo.map(p => p.saldo);
  const chartMax = Math.max(...barMaxes, ...balanceSaldos, saldoAtualGlobal, 0);
  const chartMin = Math.min(...balanceSaldos, saldoAtualGlobal, 0);
  const chartRange = chartMax - chartMin || 1;
  const mesDetalhe = todosOsMeses.at(mesProjSelecionado) ?? todosOsMeses.at(0);
  const saldoDetalhe = projecaoSaldo.find(p => p.mesIdx === mesProjSelecionado);
  const saldoAcumuladoSelecionado = saldoDetalhe?.saldo ?? saldoAtualGlobal;

  // O gráfico ocupa exatamente o espaço real restante do card. A barra de
  // abas já está reservada pelo paddingBottom do conteúdo e não deve ser
  // descontada uma segunda vez aqui.
  const medidasDoCardProntas = chartCardHeight > 0
    && chartChromeHeight > 0
    && (!mesDetalhe || detailHeight > 0);
  const chartHeightDisponivel = chartCardHeight
    - 18 // padding vertical (16) + bordas (2) do card
    - chartChromeHeight
    - 4 // margem superior da área rolável
    - 20 // rótulos dos meses
    - (mesDetalhe ? detailHeight + 10 : 0); // detalhe e sua margem superior
  const chartHeight = medidasDoCardProntas
    ? Math.max(72, Math.min(460, chartHeightDisponivel))
    : 120;
  // Mantém aproximadamente cinco meses visíveis em telas estreitas. Assim os
  // 12 meses formam uma faixa realmente rolável no celular e no preview web.
  const barSectionWidth = Math.max(64, Math.min(86, (screenWidth - 48) / 5.25));
  const barWidth = barSectionWidth * 0.28;
  const chartContentWidth = barSectionWidth * 12;

  const getY = (val: number) => chartHeight - ((val - chartMin) / chartRange) * chartHeight;
  const getBarH = (val: number) => Math.max(0, (val / chartRange) * chartHeight);
  const zeroY = getY(0);

  // Build balance line points (absolute X positions)
  const balancePoints = projecaoSaldo.map(p => ({
    x: barSectionWidth * p.mesIdx + barSectionWidth / 2,
    y: getY(p.saldo),
    saldo: p.saldo,
    isFuture: p.isFuture,
    mesIdx: p.mesIdx,
  }));

  const formatVal = (v: number) =>
    Math.abs(v) >= 1000 ? `R$${(v / 1000).toFixed(1)}k` : `R$${v.toFixed(0)}`;

  const rotuloEscopoFluxo = contas.length === 0
    ? "Vis\u00e3o consolidada"
    : escopoFluxoEhTodas
      ? contas.length > 1 ? "Todas as contas" : contas[0]?.nome ?? "Vis\u00e3o consolidada"
      : contasFiltradas.length === 1
        ? contasFiltradas[0].nome
        : `${contasFiltradas.length} contas selecionadas`;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safe, { backgroundColor: Cores.fundo }]}
    >
      <View style={[styles.header, { backgroundColor: novoTema.header }]}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.title, { color: "#FFF" }]}>Fluxo de caixa</Text>
          <View style={styles.headerYearSelector}>
            <TouchableOpacity onPress={() => alterarAno(-1)} style={styles.headerYearButton} accessibilityLabel="Ano anterior">
              <MaterialIcons name="chevron-left" size={20} color="#FFF" />
            </TouchableOpacity>
            <MaterialIcons name="calendar-today" size={12} color="rgba(255,255,255,0.76)" />
            <Text style={styles.headerPeriodText}>{anoSelecionado}</Text>
            <TouchableOpacity onPress={() => alterarAno(1)} style={styles.headerYearButton} accessibilityLabel="Próximo ano">
              <MaterialIcons name="chevron-right" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.headerBalanceLabel} numberOfLines={1}>
          Saldo acumulado{" \u00b7 "}{rotuloEscopoFluxo}
        </Text>
        <View style={styles.headerBalanceRow}>
          <Text style={styles.headerBalance}>{fmtReais(saldoAcumuladoSelecionado)}</Text>
          <View style={styles.headerTrendPill}>
            <MaterialIcons
              name={saldoDetalhe?.isPast ? "history" : saldoDetalhe?.isFuture ? "trending-up" : "account-balance-wallet"}
              size={13}
              color="#C7F6E5"
            />
            <Text style={styles.headerTrendText}>{getNomeMes(String(mesProjSelecionado + 1).padStart(2, "0"))}</Text>
          </View>
        </View>
        {contas.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.headerAccountsScroll}
            contentContainerStyle={styles.headerAccountsContent}
          >
            <TouchableOpacity
              onPress={() => setContasSelecionadasIds(null)}
              style={[
                styles.contaChip,
                escopoFluxoEhTodas ? styles.contaChipHeaderSelected : styles.contaChipHeaderIdle,
              ]}
            >
              <MaterialIcons
                name="account-balance-wallet"
                size={13}
                color={escopoFluxoEhTodas ? "#FFF" : "rgba(255,255,255,0.72)"}
              />
              <Text style={[styles.contaChipText, { color: escopoFluxoEhTodas ? "#FFF" : "rgba(255,255,255,0.72)" }]}>
                Todas
              </Text>
            </TouchableOpacity>

            {contas.map(conta => {
              const sel = !escopoFluxoEhTodas && idsEscopoFluxo.has(conta.id);
              const cor = conta.cor || "#C7F6E5";
              return (
                <TouchableOpacity
                  key={conta.id}
                  onPress={() => alternarContaFluxo(conta.id)}
                  style={[
                    styles.contaChip,
                    sel ? styles.contaChipHeaderSelected : styles.contaChipHeaderIdle,
                  ]}
                >
                  <View style={[styles.contaChipDot, { backgroundColor: sel ? "#FFF" : cor }]} />
                  <Text style={[styles.contaChipText, { color: sel ? "#FFF" : "rgba(255,255,255,0.72)" }]}>
                    {conta.nome}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View
        style={[styles.content, { paddingBottom: tabBarHeight + 6 }]}
      >
        {/* COMBINED BAR + LINE CHART */}
        <View
          style={[styles.chartCard, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}
          onLayout={({ nativeEvent }) => {
            const altura = Math.round(nativeEvent.layout.height);
            setChartCardHeight(atual => Math.abs(atual - altura) > 1 ? altura : atual);
          }}
        >
          <View
            style={styles.chartChrome}
            onLayout={({ nativeEvent }) => {
              const altura = Math.round(nativeEvent.layout.height);
              setChartChromeHeight(atual => Math.abs(atual - altura) > 1 ? altura : atual);
            }}
          >
          <View style={styles.chartHeader}>
            <MaterialIcons name="bar-chart" size={18} color="#2A9D8F" />
            <Text style={[styles.chartTitle, { color: Cores.textoPrincipal }]}>
              Receitas & Despesas — {anoSelecionado}
            </Text>
          </View>

          {/* Legend */}
          <View style={styles.legendaRow}>
            <View style={styles.legendaItem}>
              <View style={[styles.legendaDot, { backgroundColor: "#2A9D8F" }]} />
              <Text style={[styles.legendaTxt, { color: Cores.textoSecundario }]}>Recebido</Text>
            </View>
            <View style={styles.legendaItem}>
              <View style={[styles.legendaDot, { backgroundColor: "#E76F51" }]} />
              <Text style={[styles.legendaTxt, { color: Cores.textoSecundario }]}>Pago</Text>
            </View>
            <View style={styles.legendaItem}>
              <View style={[styles.legendaLinha, { backgroundColor: Cores.linhaBalance }]} />
              <Text style={[styles.legendaTxt, { color: Cores.textoSecundario }]}>Saldo atual</Text>
            </View>
            <View style={styles.legendaItem}>
              <View style={[styles.legendaLinha, { backgroundColor: "#888" }]} />
              <Text style={[styles.legendaTxt, { color: Cores.textoSecundario }]}>Projetado</Text>
            </View>
          </View>

          <Text
            style={[styles.chartHint, { color: Cores.textoSecundario }]}
          >
            Toque em um mês ou arraste para navegar
          </Text>
          </View>

          <View
            {...chartDragResponder.panHandlers}
            style={[
              styles.chartDragViewport,
              Platform.OS === "web" && ({ cursor: "grab" } as any),
            ]}
          >
            <ScrollView
              ref={projScrollRef}
              horizontal
              directionalLockEnabled
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.chartScroll}
              contentContainerStyle={{ paddingHorizontal: 4 }}
              onScroll={({ nativeEvent }) => {
                chartScrollXRef.current = nativeEvent.contentOffset.x;
              }}
              scrollEventThrottle={16}
            >
              <View style={{ width: chartContentWidth, height: chartHeight + 20 }}>
              {/* Guide lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                const y = getY(chartMin + frac * chartRange);
                return (
                  <View key={frac} style={{ position: "absolute", top: y, left: 0, right: 0, height: 1, backgroundColor: Cores.linhaGuia }} />
                );
              })}

              {/* Zero line (only if chart goes negative) */}
              {chartMin < 0 && (
                <View style={{ position: "absolute", top: zeroY, left: 0, right: 0, height: 1.5, backgroundColor: "#E76F51", opacity: 0.35 }} />
              )}

              {/* Bars for all 12 months */}
              {todosOsMeses.map((mes, i) => {
                const incH = getBarH(mes.recPagas);
                const expH = getBarH(mes.despPagas);
                const barLeftX = barSectionWidth * i + (barSectionWidth / 2 - barWidth - 1.5);
                const barRightX = barSectionWidth * i + barSectionWidth / 2 + 1.5;

                return (
                  <View key={i}>
                    {incH > 0 && (
                      <View style={{
                        position: "absolute",
                        left: barLeftX,
                        top: zeroY - incH,
                        width: barWidth,
                        height: incH,
                        backgroundColor: "#2A9D8F",
                        borderTopLeftRadius: 3,
                        borderTopRightRadius: 3,
                      }} />
                    )}
                    {expH > 0 && (
                      <View style={{
                        position: "absolute",
                        left: barRightX,
                        top: zeroY - expH,
                        width: barWidth,
                        height: expH,
                        backgroundColor: "#E76F51",
                        borderTopLeftRadius: 3,
                        borderTopRightRadius: 3,
                      }} />
                    )}
                  </View>
                );
              })}

              {/* Balance line segments */}
              {balancePoints.slice(0, -1).map((pt, i) => {
                const pt2 = balancePoints[i + 1];
                const dx = pt2.x - pt.x;
                const dy = pt2.y - pt.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                const lineCor = pt.isFuture ? "#888888" : Cores.linhaBalance;
                return (
                  <View key={i} style={{
                    position: "absolute",
                    left: pt.x,
                    top: pt.y,
                    width: len,
                    height: 2.5,
                    backgroundColor: lineCor,
                    opacity: pt.isFuture ? 0.65 : 1,
                    transform: [{ rotate: `${angle}deg` }],
                    transformOrigin: "0 0",
                  }} />
                );
              })}

              {/* Month touch areas + dots + labels */}
              {todosOsMeses.map((mes, i) => {
                const isSel = mesProjSelecionado === mes.mesIdx;
                const balPt = balancePoints.find(p => p.mesIdx === mes.mesIdx);
                const dotY = balPt ? balPt.y : null;
                const dotCor = balPt
                  ? (balPt.isFuture ? "#888888" : Cores.linhaBalance)
                  : Cores.textoSecundario;

                return (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.7}
                    onPress={() => setMesProjSelecionado(mes.mesIdx)}
                    style={{
                      position: "absolute",
                      left: barSectionWidth * i,
                      top: 0,
                      width: barSectionWidth,
                      height: chartHeight + 20,
                      alignItems: "center",
                    }}
                  >
                    {isSel && (
                      <View style={{
                        position: "absolute", top: 0, left: 2, right: 2, bottom: 0,
                        backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                        borderRadius: 8,
                      }} />
                    )}

                    {/* Balance dot */}
                    {dotY !== null && (
                      <>
                        <View style={{
                          position: "absolute",
                          left: barSectionWidth / 2 - (isSel ? 6 : 4),
                          top: dotY - (isSel ? 6 : 4),
                          width: isSel ? 12 : 8,
                          height: isSel ? 12 : 8,
                          borderRadius: isSel ? 6 : 4,
                          backgroundColor: dotCor,
                          borderWidth: isSel ? 2 : 0,
                          borderColor: Cores.fundo,
                          elevation: isSel ? 3 : 0,
                        }} />
                        {isSel && (
                          <View style={{
                            position: "absolute",
                            top: dotY < 28 ? dotY + 14 : dotY - 22,
                            left: barSectionWidth / 2 - 28,
                            backgroundColor: dotCor,
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 6,
                            minWidth: 56,
                            alignItems: "center",
                          }}>
                            <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "bold" }}>
                              {formatVal(balPt!.saldo)}
                            </Text>
                          </View>
                        )}
                      </>
                    )}

                    <Text style={{
                      position: "absolute",
                      bottom: 0,
                      fontSize: 11,
                      fontWeight: isSel ? "bold" : "500",
                      color: isSel ? Cores.textoPrincipal : Cores.textoSecundario,
                    }}>
                      {mes.label}{mes.isAtual ? " ●" : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              </View>
            </ScrollView>
          </View>

          {/* Detail box */}
          {mesDetalhe && (
            <View
              style={[styles.detalheBox, { borderColor: Cores.borda, backgroundColor: isDark ? "#242424" : "#F0F0F0" }]}
              onLayout={({ nativeEvent }) => {
                const altura = Math.round(nativeEvent.layout.height);
                setDetailHeight(atual => Math.abs(atual - altura) > 1 ? altura : atual);
              }}
            >
              <Text style={[styles.detalheTitulo, { color: Cores.textoPrincipal }]}>
                {MESES_ABREV.at(mesDetalhe.mesIdx)} {anoSelecionado}
                {mesDetalhe.isAtual ? "  •  Mês atual" : ""}
              </Text>

              <DetalheRow
                label="Recebido"
                valor={`+ ${fmtReais(mesDetalhe.recPagas)}`}
                cor="#2A9D8F"
                dotCor="#2A9D8F"
                cores={Cores}
              />
              <DetalheRow
                label="Pago"
                valor={`- ${fmtReais(mesDetalhe.despPagas)}`}
                cor="#E76F51"
                dotCor="#E76F51"
                cores={Cores}
              />

              {(mesDetalhe.recPendentes > 0 || mesDetalhe.despPendentes > 0) && (
                <>
                  <View style={[styles.detalheSep, { backgroundColor: Cores.borda }]} />
                  {mesDetalhe.recPendentes > 0 && (
                    <DetalheRow
                      label="A receber"
                      valor={`+ ${fmtReais(mesDetalhe.recPendentes)}`}
                      cor="#457B9D"
                      dotCor="#457B9D"
                      cores={Cores}
                    />
                  )}
                  {mesDetalhe.despPendentes > 0 && (
                    <DetalheRow
                      label="A pagar"
                      valor={`- ${fmtReais(mesDetalhe.despPendentes)}`}
                      cor="#E9C46A"
                      dotCor="#E9C46A"
                      cores={Cores}
                    />
                  )}
                </>
              )}

              {saldoDetalhe && (
                <>
                  <View style={[styles.detalheSep, { backgroundColor: Cores.borda }]} />
                  {mesDetalhe.isAtual && saldoDetalhe.isFuture && (
                    <DetalheRow
                      label="Saldo atual"
                      valor={fmtReais(saldoAtualGlobal)}
                      cor={saldoAtualGlobal >= 0 ? "#2A9D8F" : "#E76F51"}
                      isIcon
                      iconName="account-balance-wallet"
                      cores={Cores}
                      bold
                    />
                  )}
                  <DetalheRow
                    label={saldoDetalhe.isFuture ? (mesDetalhe.isAtual ? "Saldo previsto" : "Saldo projetado") : saldoDetalhe.isPast ? "Saldo no mês" : "Saldo atual"}
                    valor={fmtReais(saldoDetalhe.saldo)}
                    cor={saldoDetalhe.saldo >= 0 ? "#2A9D8F" : "#E76F51"}
                    isIcon
                    iconName={saldoDetalhe.isFuture ? "trending-up" : saldoDetalhe.isPast ? "history" : "account-balance-wallet"}
                    cores={Cores}
                    bold
                  />
                </>
              )}
            </View>
          )}
        </View>

      </View>
    </SafeAreaView>
  );
}

function DetalheRow({ label, valor, cor, dotCor, isIcon, iconName, bold, cores }: {
  label: string;
  valor: string;
  cor: string;
  dotCor?: string;
  isIcon?: boolean;
  iconName?: string;
  bold?: boolean;
  cores: any;
}) {
  return (
    <View style={styles.detalheRow}>
      {isIcon ? (
        <MaterialIcons
          name={(iconName as any) ?? "trending-up"}
          size={12}
          color={cores.textoSecundario}
          style={{ marginRight: 8 }}
        />
      ) : (
        <View style={[styles.detalheDot, { backgroundColor: dotCor }]} />
      )}
      <Text style={[styles.detalheLabel, { color: cores.textoSecundario }]}>{label}</Text>
      <Text style={[styles.detalheVal, { color: cor, fontWeight: bold ? "bold" : "600" }]}>{valor}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    height: FinFlowTabHeader.expandedHeight,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 5,
    borderBottomLeftRadius: FinFlowTabHeader.expandedRadius,
    borderBottomRightRadius: FinFlowTabHeader.expandedRadius,
    overflow: "hidden",
    elevation: 12,
    shadowColor: "#001E1A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
  },
  title: { fontSize: 21, lineHeight: 25, fontWeight: "bold" },
  headerTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerYearSelector: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 3, paddingVertical: 2, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.15)" },
  headerYearButton: { width: 27, height: 27, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  headerPeriodText: { color: "#FFF", fontSize: 12, fontWeight: "700", minWidth: 35, textAlign: "center" },
  headerBalanceLabel: { color: "rgba(255,255,255,0.68)", fontSize: 10, lineHeight: 12, marginTop: 3 },
  headerBalanceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 1 },
  headerBalance: { color: "#FFF", fontSize: 24, lineHeight: 28, fontWeight: "900" },
  headerTrendPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "rgba(0,0,0,0.15)", borderRadius: 13 },
  headerTrendText: { color: "#C7F6E5", fontSize: 10, fontWeight: "700", textTransform: "capitalize" },

  headerAccountsScroll: { marginTop: 2, flexGrow: 0 },
  headerAccountsContent: { gap: 7, paddingRight: 8 },
  contaChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 16,
    borderWidth: 1,
    gap: 5,
  },
  contaChipHeaderSelected: { backgroundColor: "rgba(255,255,255,0.20)", borderColor: "rgba(255,255,255,0.52)" },
  contaChipHeaderIdle: { backgroundColor: "rgba(0,0,0,0.10)", borderColor: "rgba(255,255,255,0.16)" },
  contaChipDot: { width: 8, height: 8, borderRadius: 4 },
  contaChipText: { fontSize: 11, fontWeight: "700" },

  content: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingTop: 14 },

  chartCard: { flex: 1, minHeight: 0, padding: 8, borderRadius: 16, borderWidth: 1, elevation: 3 },
  chartChrome: { flexShrink: 0 },
  chartHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  chartTitle: { fontSize: 14, lineHeight: 18, fontWeight: "bold", flex: 1 },
  chartHint: { fontSize: 10, lineHeight: 12, marginTop: 2 },
  chartDragViewport: { marginTop: 4, flexGrow: 0, overflow: "hidden" },
  chartScroll: { flexGrow: 0 },

  legendaRow: { flexDirection: "row", flexWrap: "wrap", columnGap: 7, rowGap: 2, marginTop: 5 },
  legendaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendaDot: { width: 8, height: 8, borderRadius: 4 },
  legendaLinha: { width: 14, height: 2, borderRadius: 1 },
  legendaTxt: { fontSize: 10, lineHeight: 12 },

  detalheBox: { marginTop: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 8 },
  detalheTitulo: { fontSize: 11, lineHeight: 15, fontWeight: "bold", marginBottom: 6 },
  detalheRow: { flexDirection: "row", alignItems: "center", minHeight: 18, marginBottom: 2 },
  detalheDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  detalheLabel: { flex: 1, fontSize: 11, lineHeight: 14 },
  detalheVal: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
  detalheSep: { height: 1, marginVertical: 3 },
});
