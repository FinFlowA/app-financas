import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../_layout";
import { fmtReais } from "../../lib/utils";
import {
  dataEfetivaTransacao,
  getContaDestinoTransferencia,
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

const MESES_ABREV = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MESES_FULL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const getNomeMes = (mes: string) => MESES_FULL[parseInt(mes, 10) - 1];

const SCREEN_WIDTH = Dimensions.get("window").width;
const BAR_SECTION_WIDTH = Math.max(60, (SCREEN_WIDTH - 56) / 6);
const CHART_HEIGHT = 200;
const BAR_W = BAR_SECTION_WIDTH * 0.28;

export default function RelatoriosScreen() {
  const { isDark, session } = useAppTheme();

  const Cores = {
    fundo: isDark ? "#121212" : "#F5F2EC",
    textoPrincipal: isDark ? "#ffffff" : "#27313A",
    textoSecundario: isDark ? "#AAAAAA" : "#68727D",
    cardFundo: isDark ? "#1E1E1E" : "#FFFDF9",
    borda: isDark ? "#333333" : "#E5DED3",
    pillFundo: isDark ? "#2C2C2C" : "#EEEAE3",
    linhaGuia: isDark ? "#2C2C2C" : "#E3DDD4",
    linhaBalance: "#457B9D",
  };

  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [contaSelecionada, setContaSelecionada] = useState<number | null>(null);

  const hoje = new Date();
  const anoAtualNum = hoje.getFullYear();
  const mesAtualIdx = hoje.getMonth();

  const [anoSelecionado, setAnoSelecionado] = useState<number>(anoAtualNum);
  const [mesProjSelecionado, setMesProjSelecionado] = useState<number>(mesAtualIdx);

  const projScrollRef = useRef<ScrollView>(null);

  const carregarDados = async () => {
    if (!session?.user?.id) return;
    try {
      const [resT, resC] = await Promise.all([
        supabase.from("transacoes").select("valor, tipo, status, data_vencimento, data_realizacao, conta_id, descricao"),
        supabase.from("contas").select("id, nome, cor, saldo_inicial, arquivado"),
      ]);
      if (resT.data) setTransacoes(resT.data);
      if (resC.data) setContas(resC.data.filter((c) => !c.arquivado));
    } catch (e) { console.error(e); }
  };

  useFocusEffect(useCallback(() => { carregarDados(); }, [session]));

  const alterarAno = (dir: number) => {
    const novoAno = anoSelecionado + dir;
    setAnoSelecionado(novoAno);
    setMesProjSelecionado(novoAno === anoAtualNum ? mesAtualIdx : 0);
  };

  // Filtered data based on account selection (null = todas)
  const transacoesFiltradas = transacoes.flatMap((t) => {
    const destinoId = getContaDestinoTransferencia(t.descricao);

    if (destinoId !== null) {
      if (contaSelecionada === null) return [];
      if (t.conta_id === contaSelecionada) return [t];
      if (destinoId === contaSelecionada) {
        return [{ ...t, tipo: "receita", conta_id: destinoId }];
      }
      return [];
    }

    // Transferências antigas possuem duas linhas. No consolidado elas são
    // internas e não representam receita ou despesa real.
    if (isTransferencia(t.descricao) && contaSelecionada === null) return [];
    return contaSelecionada === null || t.conta_id === contaSelecionada ? [t] : [];
  });

  const contasFiltradas = contaSelecionada === null
    ? contas
    : contas.filter(c => c.id === contaSelecionada);

  const saldoInicialTotal = contasFiltradas.reduce((acc, c) => acc + Number(c.saldo_inicial), 0);

  const receitasRealizadas = transacoesFiltradas
    .filter(t => t.tipo === "receita" && t.status === "paga")
    .reduce((acc, t) => acc + Number(t.valor), 0);
  const despesasRealizadas = transacoesFiltradas
    .filter(t => t.tipo === "despesa" && t.status === "paga")
    .reduce((acc, t) => acc + Number(t.valor), 0);
  const saldoAtualGlobal = saldoInicialTotal + receitasRealizadas - despesasRealizadas;

  const isAnoAtual = anoSelecionado === anoAtualNum;

  // All 12 months bar data (paid transactions)
  const todosOsMeses = Array.from({ length: 12 }, (_, m) => {
    const yyyymm = `${anoSelecionado}-${String(m + 1).padStart(2, "0")}`;
    const trans = transacoesFiltradas.filter(t => dataEfetivaTransacao(t).startsWith(yyyymm));
    return {
      mesIdx: m,
      label: MESES_ABREV[m],
      isAtual: isAnoAtual && m === mesAtualIdx,
      recPagas: trans.filter(t => t.tipo === "receita" && t.status === "paga").reduce((a, t) => a + Number(t.valor), 0),
      despPagas: trans.filter(t => t.tipo === "despesa" && t.status === "paga").reduce((a, t) => a + Number(t.valor), 0),
      recPendentes: trans.filter(t => t.tipo === "receita" && t.status !== "paga").reduce((a, t) => a + Number(t.valor), 0),
      despPendentes: trans.filter(t => t.tipo === "despesa" && t.status !== "paga").reduce((a, t) => a + Number(t.valor), 0),
    };
  });

  const saldoRealAte = (dataFim: string): number => {
    return transacoesFiltradas
      .filter(t => t.status === "paga" && dataEfetivaTransacao(t) <= dataFim)
      .reduce(
        (saldo, t) => saldo + (t.tipo === "receita" ? Number(t.valor) : -Number(t.valor)),
        saldoInicialTotal,
      );
  };

  const saldoProjetadoAte = (dataFim: string): number => {
    return transacoesFiltradas
      .filter(t => t.status !== "paga" && (t.data_vencimento || "") <= dataFim)
      .reduce(
        (saldo, t) => saldo + (t.tipo === "receita" ? Number(t.valor) : -Number(t.valor)),
        saldoAtualGlobal,
      );
  };

  // Passado mostra apenas o realizado; mês atual e futuro incluem pendências.
  interface MesProj {
    mesIdx: number;
    saldo: number;
    isFuture: boolean;
    isPast?: boolean;
  }

  const projecaoSaldo: MesProj[] = [];
  for (let m = 0; m <= 11; m++) {
    const yyyymm = `${anoSelecionado}-${String(m + 1).padStart(2, "0")}`;
    const fimDoMes = `${yyyymm}-${String(new Date(anoSelecionado, m + 1, 0).getDate()).padStart(2, "0")}`;
    const mesNoPassado = anoSelecionado < anoAtualNum || (isAnoAtual && m < mesAtualIdx);
    const mesAtualSemPendencias = isAnoAtual
      && m === mesAtualIdx
      && !transacoesFiltradas.some(t => t.status !== "paga" && (t.data_vencimento || "").startsWith(yyyymm));

    if (mesNoPassado) {
      projecaoSaldo.push({ mesIdx: m, saldo: saldoRealAte(fimDoMes), isFuture: false, isPast: true });
    } else if (mesAtualSemPendencias) {
      projecaoSaldo.push({ mesIdx: m, saldo: saldoAtualGlobal, isFuture: false });
    } else {
      projecaoSaldo.push({ mesIdx: m, saldo: saldoProjetadoAte(fimDoMes), isFuture: true });
    }
  }

  // Chart Y scale (bars + balance line share same axis)
  const barMaxes = todosOsMeses.map(m => Math.max(m.recPagas, m.despPagas));
  const balanceSaldos = projecaoSaldo.map(p => p.saldo);
  const chartMax = Math.max(...barMaxes, ...balanceSaldos, saldoAtualGlobal, 0);
  const chartMin = Math.min(...balanceSaldos, saldoAtualGlobal, 0);
  const chartRange = chartMax - chartMin || 1;

  const getY = (val: number) => CHART_HEIGHT - ((val - chartMin) / chartRange) * CHART_HEIGHT;
  const getBarH = (val: number) => Math.max(0, (val / chartRange) * CHART_HEIGHT);
  const zeroY = getY(0);

  // Build balance line points (absolute X positions)
  const balancePoints = projecaoSaldo.map(p => ({
    x: BAR_SECTION_WIDTH * p.mesIdx + BAR_SECTION_WIDTH / 2,
    y: getY(p.saldo),
    isFuture: p.isFuture,
    mesIdx: p.mesIdx,
  }));

  const formatVal = (v: number) =>
    Math.abs(v) >= 1000 ? `R$${(v / 1000).toFixed(1)}k` : `R$${v.toFixed(0)}`;

  const mesDetalhe = todosOsMeses[mesProjSelecionado];
  const saldoDetalhe = projecaoSaldo.find(p => p.mesIdx === mesProjSelecionado);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: Cores.fundo }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: Cores.textoPrincipal }]}>Fluxo de Caixa</Text>
        <Text style={[styles.subtitle, { color: Cores.textoSecundario }]}>
          {getNomeMes(String(mesProjSelecionado + 1).padStart(2, "0"))} {anoSelecionado}
          {contaSelecionada !== null
            ? `  •  ${contas.find(c => c.id === contaSelecionada)?.nome ?? ""}`
            : contas.length > 1 ? "  •  Todas as contas" : ""}
        </Text>
      </View>

      {/* ACCOUNT FILTER */}
      {contas.length > 0 && (
        <View style={styles.contasFiltroWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 15, gap: 8, paddingVertical: 4 }}
        >
          {/* Todas */}
          <TouchableOpacity
            onPress={() => setContaSelecionada(null)}
            style={[
              styles.contaChip,
              {
                backgroundColor: contaSelecionada === null ? "#2A9D8F" : Cores.pillFundo,
                borderColor: contaSelecionada === null ? "#2A9D8F" : Cores.borda,
              },
            ]}
          >
            <MaterialIcons
              name="account-balance-wallet"
              size={13}
              color={contaSelecionada === null ? "#fff" : Cores.textoSecundario}
            />
            <Text style={[styles.contaChipText, { color: contaSelecionada === null ? "#fff" : Cores.textoSecundario }]}>
              Todas
            </Text>
          </TouchableOpacity>

          {/* Individual accounts */}
          {contas.map(conta => {
            const sel = contaSelecionada === conta.id;
            const cor = conta.cor || "#2A9D8F";
            return (
              <TouchableOpacity
                key={conta.id}
                onPress={() => setContaSelecionada(sel ? null : conta.id)}
                style={[
                  styles.contaChip,
                  { backgroundColor: sel ? cor : Cores.pillFundo, borderColor: sel ? cor : Cores.borda },
                ]}
              >
                <View style={[styles.contaChipDot, { backgroundColor: sel ? "#fff" : cor }]} />
                <Text style={[styles.contaChipText, { color: sel ? "#fff" : Cores.textoSecundario }]}>
                  {conta.nome}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        </View>
      )}

      {/* YEAR NAV */}
      <View style={[styles.anoNav, { backgroundColor: Cores.pillFundo }]}>
        <TouchableOpacity onPress={() => alterarAno(-1)} style={styles.anoNavBtn}>
          <MaterialIcons name="chevron-left" size={28} color={Cores.textoPrincipal} />
        </TouchableOpacity>
        <Text style={[styles.anoNavText, { color: Cores.textoPrincipal }]}>{anoSelecionado}</Text>
        <TouchableOpacity onPress={() => alterarAno(1)} style={styles.anoNavBtn}>
          <MaterialIcons name="chevron-right" size={28} color={Cores.textoPrincipal} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* COMBINED BAR + LINE CHART */}
        <View style={[styles.chartCard, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
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

          <Text style={[styles.chartHint, { color: Cores.textoSecundario }]}>
            Toque em um mês para detalhes
          </Text>

          <ScrollView
            ref={projScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 12 }}
            contentContainerStyle={{ paddingHorizontal: 4 }}
          >
            <View style={{ width: BAR_SECTION_WIDTH * 12, height: CHART_HEIGHT + 30 }}>
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
                const barLeftX = BAR_SECTION_WIDTH * i + (BAR_SECTION_WIDTH / 2 - BAR_W - 1.5);
                const barRightX = BAR_SECTION_WIDTH * i + BAR_SECTION_WIDTH / 2 + 1.5;

                return (
                  <View key={i}>
                    {incH > 0 && (
                      <View style={{
                        position: "absolute",
                        left: barLeftX,
                        top: zeroY - incH,
                        width: BAR_W,
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
                        width: BAR_W,
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
                      left: BAR_SECTION_WIDTH * i,
                      top: 0,
                      width: BAR_SECTION_WIDTH,
                      height: CHART_HEIGHT + 30,
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
                          left: BAR_SECTION_WIDTH / 2 - (isSel ? 6 : 4),
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
                            left: BAR_SECTION_WIDTH / 2 - 28,
                            backgroundColor: dotCor,
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 6,
                            minWidth: 56,
                            alignItems: "center",
                          }}>
                            <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "bold" }}>
                              {formatVal(balPt!.isFuture
                                ? projecaoSaldo.find(p => p.mesIdx === mes.mesIdx)?.saldo ?? 0
                                : saldoAtualGlobal)}
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

          {/* Detail box */}
          {mesDetalhe && (
            <View style={[styles.detalheBox, { borderColor: Cores.borda, backgroundColor: isDark ? "#242424" : "#F0F0F0" }]}>
              <Text style={[styles.detalheTitulo, { color: Cores.textoPrincipal }]}>
                {MESES_ABREV[mesDetalhe.mesIdx]} {anoSelecionado}
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

        <View style={{ height: 40 }} />
      </ScrollView>
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
  header: { padding: 20, paddingTop: 30, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: "bold" },
  subtitle: { fontSize: 14, marginTop: 4 },

  contasFiltroWrap: { height: 46, marginBottom: 4 },
  contaChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  contaChipDot: { width: 8, height: 8, borderRadius: 4 },
  contaChipText: { fontSize: 13, fontWeight: "600" },

  anoNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 15,
    marginBottom: 12,
    borderRadius: 12,
    paddingVertical: 4,
  },
  anoNavBtn: { padding: 8 },
  anoNavText: { fontSize: 18, fontWeight: "bold", minWidth: 60, textAlign: "center" },

  content: { flex: 1, paddingHorizontal: 20 },

  chartCard: { padding: 16, borderRadius: 16, borderWidth: 1, elevation: 2, marginBottom: 20 },
  chartHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  chartTitle: { fontSize: 16, fontWeight: "bold", flex: 1 },
  chartHint: { fontSize: 11, marginTop: 4 },

  legendaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  legendaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendaDot: { width: 10, height: 10, borderRadius: 5 },
  legendaLinha: { width: 16, height: 2.5, borderRadius: 1.5 },
  legendaTxt: { fontSize: 11 },

  detalheBox: { marginTop: 14, borderRadius: 12, borderWidth: 1, padding: 14 },
  detalheTitulo: { fontSize: 13, fontWeight: "bold", marginBottom: 10 },
  detalheRow: { flexDirection: "row", alignItems: "center", marginBottom: 7 },
  detalheDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  detalheLabel: { flex: 1, fontSize: 13 },
  detalheVal: { fontSize: 13, fontWeight: "600" },
  detalheSep: { height: 1, marginVertical: 7 },
});
