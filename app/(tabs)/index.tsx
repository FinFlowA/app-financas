import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  Button,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../_layout";
import { agendarNotificacoesDoApp } from "../../lib/notifications";
import { usuarioPodeAcessarIA } from "../../constants/features";
import { fmtReais, formatarEntradaMoeda, valorDaEntradaMoeda } from "../../lib/utils";
import {
  adicionarRecorrencia,
  dataEfetivaTransacao,
  descricaoTransferencia,
  getContaDestinoTransferencia,
  isTransferencia,
  type FrequenciaRecorrencia,
  sufixoRecorrencia,
} from "../../lib/transacoes";

interface Categoria {
  id: number;
  nome: string;
  cor: string;
  icone: string;
  tipo: string;
  ativa: number;
}
interface Conta {
  id: number;
  nome: string;
  saldo_inicial: number;
  compartilhado: boolean;
  cor?: string;
  arquivado?: boolean;
  bloqueado_plano?: boolean;
}
interface Caixinha {
  id: number;
  nome: string;
  saldo_atual: number;
  meta_valor: number;
  cor: string;
  icone: string;
}
interface Transacao {
  id: number;
  tipo: string;
  valor: number;
  data_vencimento: string;
  data_realizacao?: string | null;
  descricao: string;
  categoria_id: number | null;
  conta_id: number;
  status: string;
}

interface CompraCartao {
  id: number;
  cartao_id: number;
  valor: number;
  data_compra: string;
  mes_fatura: string;
  pago: boolean;
  categoria_id: number | null;
}

const PALETA_CORES = [
  "#2A9D8F",
  "#E9C46A",
  "#F4A261",
  "#E76F51",
  "#264653",
  "#8AB17D",
  "#457B9D",
  "#8A05BE",
  "#E63946",
  "#1D3557",
  "#EC7000",
  "#CC092F",
  "#005CA9",
  "#6D597A",
  "#B56576",
  "#3A86FF",
];

const LISTA_ICONES = [
  "label", "restaurant", "directions-car", "home", "favorite",
  "shopping-cart", "school", "fitness-center", "local-hospital",
  "flight", "beach-access", "pets", "work", "sports-esports",
  "music-note", "local-movies", "attach-money", "savings",
  "card-giftcard", "build", "coffee", "local-gas-station", "child-care",
  "spa", "book", "camera-alt", "palette", "two-wheeler", "commute",
  "electrical-services", "water-drop", "wifi", "phone-android", "laptop",
  "checkroom", "local-grocery-store", "bakery-dining", "medical-services",
  "payments", "trending-up", "volunteer-activism", "business-center",
];

const getSaudacao = () => {
  const hora = new Date().getHours();
  if (hora >= 5 && hora < 12) return "Bom dia";
  if (hora >= 12 && hora < 18) return "Boa tarde";
  return "Boa noite";
};

const getEstiloBanco = (nome: string, isDark: boolean, corCustom?: string) => {
  if (corCustom) return { bg: corCustom, text: "#FFF" };
  const n = nome.toLowerCase();
  if (n.includes("nu") || n.includes("nubank"))
    return { bg: "#8A05BE", text: "#FFF" };
  if (n.includes("itaú") || n.includes("itau"))
    return { bg: "#EC7000", text: "#FFF" };
  if (n.includes("inter")) return { bg: "#FF7A00", text: "#FFF" };
  if (n.includes("bradesco")) return { bg: "#CC092F", text: "#FFF" };
  if (n.includes("brasil") || n.includes("bb"))
    return { bg: "#F9D300", text: "#0038A8" };
  if (n.includes("santander")) return { bg: "#EC0000", text: "#FFF" };
  if (n.includes("caixa")) return { bg: "#005CA9", text: "#FFF" };
  if (n.includes("c6")) return { bg: "#242424", text: "#FFF" };
  if (n.includes("carteira") || n.includes("dinheiro"))
    return { bg: "#2A9D8F", text: "#FFF" };

  return {
    bg: isDark ? "#333333" : "#F8F9FA",
    text: isDark ? "#FFFFFF" : "#333333",
  };
};

const mesesEmPortugues = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

// Gráfico de barras horizontais por categoria
const BarChartCategorias = ({ dados, total, isDark }: { dados: { cor: string; valor: number; nome: string; icone?: string }[]; total: number; isDark: boolean }) => {
  if (total === 0 || dados.length === 0) return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 20 }}>
      <MaterialIcons name="bar-chart" size={32} color={isDark ? "#333" : "#DDD"} />
      <Text style={{ color: isDark ? "#555" : "#CCC", fontSize: 12, marginTop: 6 }}>Nenhuma transação neste mês</Text>
    </View>
  );
  return (
    <View style={{ width: "100%" }}>
      {dados.map((item, i) => {
        const pct = total > 0 ? (item.valor / total) * 100 : 0;
        return (
          <View key={i} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", flex: 1, marginRight: 8 }}>
                <View style={{ width: 25, height: 25, borderRadius: 8, backgroundColor: `${item.cor}26`, marginRight: 7, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name={(item.icone || "label") as any} size={15} color={item.cor} />
                </View>
                <Text style={{ flex: 1, fontSize: 12, color: isDark ? "#AAA" : "#555" }} numberOfLines={1}>{item.nome}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 12, fontWeight: "bold", color: isDark ? "#FFF" : "#222" }}>
                  {pct.toFixed(0)}%
                </Text>
                <Text style={{ fontSize: 10, color: isDark ? "#AAA" : "#666" }}>
                  {fmtReais(item.valor)}
                </Text>
              </View>
            </View>
            <View style={{ height: 7, backgroundColor: isDark ? "#2C2C2C" : "#E5E7EB", borderRadius: 4, overflow: "hidden" }}>
              <View style={{ height: 7, width: `${pct}%`, backgroundColor: item.cor, borderRadius: 4 }} />
            </View>
          </View>
        );
      })}
    </View>
  );
};

export default function Dashboard() {
  const { isDark, session, notificacoesAtivas, verificarLimite, temPopupPrioritario } = useAppTheme();
  const alertaVencidoMostrado = useRef(false);
  const router = useRouter();

  const Cores = {
    fundo: isDark ? "#121212" : "#F5F2EC",
    textoPrincipal: isDark ? "#ffffff" : "#27313A",
    textoSecundario: isDark ? "#AAAAAA" : "#68727D",
    cardFundo: isDark ? "#1E1E1E" : "#FFFDF9",
    borda: isDark ? "#333333" : "#E5DED3",
    inputFundo: isDark ? "#2C2C2C" : "#FAF8F4",
    pillFundo: isDark ? "#333333" : "#EEEAE3",
    pillAtivo: isDark ? "#555555" : "#E3DDD4",
  };

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [caixinhas, setCaixinhas] = useState<Caixinha[]>([]);
  const [temParceiro, setTemParceiro] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [modalIaEmBreve, setModalIaEmBreve] = useState(false);

  const [mesAtual, setMesAtual] = useState(new Date());
  const [mostrarPickerMesAno, setMostrarPickerMesAno] = useState(false);
  const [anoTemp, setAnoTemp] = useState(new Date().getFullYear());
  const [mesTemp, setMesTemp] = useState(new Date().getMonth());

  const alterarMes = (direcao: number) => {
    const novoMes = new Date(mesAtual);
    novoMes.setMonth(novoMes.getMonth() + direcao);
    setMesAtual(novoMes);
  };

  const nomeDoMes = `${mesesEmPortugues[mesAtual.getMonth()]} ${mesAtual.getFullYear()}`;

  // --- Modais ---
  const [modalCatVisivel, setModalCatVisivel] = useState(false);
  const [nomeCategoria, setNomeCategoria] = useState("");
  const [corSelecionada, setCorSelecionada] = useState(PALETA_CORES[0]);
  const [tipoNovaCategoria, setTipoNovaCategoria] = useState<"receita" | "despesa">("despesa");
  const [iconeSelecionado, setIconeSelecionado] = useState("label");

  const [modalGerenciarCatVisivel, setModalGerenciarCatVisivel] = useState(false);
  const [catEditando, setCatEditando] = useState<Categoria | null>(null);
  const [nomeEditCat, setNomeEditCat] = useState("");
  const [corEditCat, setCorEditCat] = useState(PALETA_CORES[0]);
  const [iconeEditCat, setIconeEditCat] = useState("label");

  const [modalContaVisivel, setModalContaVisivel] = useState(false);
  const [nomeConta, setNomeConta] = useState("");
  const [saldoInicialConta, setSaldoInicialConta] = useState("");
  const [contaCompartilhada, setContaCompartilhada] = useState(false);
  const [corNovaConta, setCorNovaConta] = useState(PALETA_CORES[6]);

  const [modalEditarContaVisivel, setModalEditarContaVisivel] = useState(false);
  const [contaEditando, setContaEditando] = useState<Conta | null>(null);
  const [nomeEditConta, setNomeEditConta] = useState("");
  const [saldoEditConta, setSaldoEditConta] = useState("");
  const [compartilhadoEditConta, setCompartilhadoEditConta] = useState(false);
  const [corEditConta, setCorEditConta] = useState(PALETA_CORES[0]);
  const [editandoSaldoConta, setEditandoSaldoConta] = useState(false);
  const [loadingConta, setLoadingConta] = useState(false);
  const [loadingCat, setLoadingCat] = useState(false);
  const [contaConfirmarArquivo, setContaConfirmarArquivo] = useState<{
    conta: Conta;
    saldoAtual: number;
    temLancamentos: boolean;
  } | null>(null);

  const [modalTransVisivel, setModalTransVisivel] = useState(false);
  const [loadingTrans, setLoadingTrans] = useState(false);
  const [descTransacao, setDescTransacao] = useState("");
  const [valorTransacao, setValorTransacao] = useState("");
  const [tipoTransacao, setTipoTransacao] = useState<"receita" | "despesa" | "transferencia">("despesa");
  const [catSelecionadaId, setCatSelecionadaId] = useState<number | null>(null);
  const [contaSelecionadaId, setContaSelecionadaId] = useState<number | null>(null);
  const [contaDestinoId, setContaDestinoId] = useState<number | null>(null);
  const [caixinhaDestinoId, setCaixinhaDestinoId] = useState<number | null>(null);
  const [frequencia, setFrequencia] = useState<"unica" | "parcelada" | "fixa">("unica");
  const [frequenciaFixa, setFrequenciaFixa] = useState<FrequenciaRecorrencia>("mensal");
  const [numParcelas, setNumParcelas] = useState("");
  const [modoValorParcelado, setModoValorParcelado] = useState<"total" | "parcela">("parcela");
  const [dataSelecionada, setDataSelecionada] = useState(new Date());
  const [mostrarCalendario, setMostrarCalendario] = useState(false);
  const [foiPago, setFoiPago] = useState(true);

  const [modalResumoVisivel, setModalResumoVisivel] = useState(false);
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  const [modoDistribuicao, setModoDistribuicao] = useState<"previstos" | "concluidos">("concluidos");
  const [comprasCartao, setComprasCartao] = useState<CompraCartao[]>([]);
  const [temFaturaVencida, setTemFaturaVencida] = useState(false);
  const [modalVencidosVisivel, setModalVencidosVisivel] = useState(false);
  const [confirmarEdicaoSaldo, setConfirmarEdicaoSaldo] = useState(false);
  const [qtdVencidas, setQtdVencidas] = useState(0);

  // --- Cálculos ---
  const contasAtivas = contas.filter(c => !c.arquivado);
  const contasAtivasIds = new Set(contasAtivas.map(c => c.id));
  const saldoInicialTotal = contasAtivas.reduce((acc, curr) => acc + curr.saldo_inicial, 0);
  const receitasRealizadas = transacoes
    .filter((t) => t.tipo === "receita" && t.status === "paga" && contasAtivasIds.has(t.conta_id))
    .reduce((acc, curr) => acc + curr.valor, 0);
  const despesasRealizadas = transacoes
    .filter((t) => t.tipo === "despesa" && t.status === "paga" && contasAtivasIds.has(t.conta_id))
    .reduce((acc, curr) => acc + curr.valor, 0);
  const transferenciasRecebidasAtivas = transacoes
    .filter((t) => {
      const contaDestinoId = getContaDestinoTransferencia(t.descricao);
      return t.status === "paga" && contaDestinoId !== null && contasAtivasIds.has(contaDestinoId);
    })
    .reduce((acc, curr) => acc + curr.valor, 0);
  const saldoAtualGlobal = saldoInicialTotal + receitasRealizadas + transferenciasRecebidasAtivas - despesasRealizadas;

  const transacoesDoMes = transacoes.filter((t) => {
    const dataT = new Date(dataEfetivaTransacao(t));
    const dataAjustada = new Date(dataT.getTime() + dataT.getTimezoneOffset() * 60000);
    return (
      dataAjustada.getMonth() === mesAtual.getMonth() &&
      dataAjustada.getFullYear() === mesAtual.getFullYear()
    );
  });

  const transacoesDoMesSemTransferencias = transacoesDoMes.filter(
    (t) => !isTransferencia(t.descricao) && !(t.descricao ?? "").includes("[PagFatura:")
  );
  const comprasCartaoDoMes = comprasCartao.filter((item) => item.data_compra?.startsWith(
    `${mesAtual.getFullYear()}-${String(mesAtual.getMonth() + 1).padStart(2, "0")}`
  ));
  const receitasDoMes = transacoesDoMesSemTransferencias.filter((t) => t.tipo === "receita").reduce((acc, curr) => acc + curr.valor, 0);
  const despesasDoMes = transacoesDoMesSemTransferencias.filter((t) => t.tipo === "despesa").reduce((acc, curr) => acc + curr.valor, 0);
  const receitasRealizadasDoMes = transacoesDoMesSemTransferencias.filter((t) => t.tipo === "receita" && t.status === "paga").reduce((acc, curr) => acc + curr.valor, 0);
  const despesasRealizadasDoMes = transacoesDoMesSemTransferencias.filter((t) => t.tipo === "despesa" && t.status === "paga").reduce((acc, curr) => acc + curr.valor, 0);
  const balancoMensal = receitasRealizadasDoMes - despesasRealizadasDoMes;
  const balancoAgendadoMensal = receitasDoMes - despesasDoMes;

  // Dados para os gráficos de pizza
  const caixinhaGuardadoTotal = transacoesDoMes
    .filter(t => t.tipo === "despesa" && (t.descricao || "").startsWith("Guardar em: "))
    .reduce((acc, t) => acc + t.valor, 0);

  const dadosDespesasPorCat = [
    ...categorias
      .filter((c) => c.tipo === "despesa" && c.ativa !== 0)
      .map((cat) => {
        const totalTransacoes = transacoesDoMes
          .filter((t) => t.tipo === "despesa" && t.categoria_id === cat.id)
          .reduce((acc, t) => acc + t.valor, 0);
        const totalCartao = comprasCartaoDoMes
          .filter((item) => item.categoria_id === cat.id)
          .reduce((acc, item) => acc + Number(item.valor), 0);
        return { cor: cat.cor, valor: totalTransacoes + totalCartao, nome: cat.nome, icone: cat.icone };
      })
      .filter((d) => d.valor > 0),
    ...(caixinhaGuardadoTotal > 0 ? [{ cor: "#264653", valor: caixinhaGuardadoTotal, nome: "Objetivos", icone: "savings" }] : []),
  ].sort((a, b) => b.valor - a.valor);

  const dadosReceitasPorCat = categorias
    .filter((c) => c.tipo === "receita" && c.ativa !== 0)
    .map((cat) => {
      const total = transacoesDoMes
        .filter((t) => t.tipo === "receita" && t.categoria_id === cat.id)
        .reduce((acc, t) => acc + t.valor, 0);
      return { cor: cat.cor, valor: total, nome: cat.nome, icone: cat.icone };
    })
    .filter((d) => d.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  // Data for "realized only" mode
  const receitasDoMesRealizadas = transacoesDoMesSemTransferencias.filter(t => t.tipo === "receita" && t.status === "paga").reduce((acc, t) => acc + t.valor, 0);
  const despesasDoMesRealizadas = transacoesDoMesSemTransferencias.filter(t => t.tipo === "despesa" && t.status === "paga").reduce((acc, t) => acc + t.valor, 0)
    + comprasCartaoDoMes.reduce((acc, item) => acc + Number(item.valor), 0);

  const caixinhaGuardadoRealizado = transacoesDoMes
    .filter(t => t.tipo === "despesa" && t.status === "paga" && (t.descricao || "").startsWith("Guardar em: "))
    .reduce((acc, t) => acc + t.valor, 0);

  const dadosDespesasPorCatRealizadas = [
    ...categorias
      .filter((c) => c.tipo === "despesa" && c.ativa !== 0)
      .map((cat) => {
        const totalTransacoes = transacoesDoMes
          .filter(t => t.tipo === "despesa" && t.status === "paga" && t.categoria_id === cat.id)
          .reduce((acc, t) => acc + t.valor, 0);
        const totalCartao = comprasCartaoDoMes
          .filter((item) => item.categoria_id === cat.id)
          .reduce((acc, item) => acc + Number(item.valor), 0);
        return { cor: cat.cor, valor: totalTransacoes + totalCartao, nome: cat.nome, icone: cat.icone };
      })
      .filter((d) => d.valor > 0),
    ...(caixinhaGuardadoRealizado > 0 ? [{ cor: "#264653", valor: caixinhaGuardadoRealizado, nome: "Objetivos", icone: "savings" }] : []),
  ].sort((a, b) => b.valor - a.valor);

  const dadosReceitasPorCatRealizadas = categorias
    .filter((c) => c.tipo === "receita" && c.ativa !== 0)
    .map((cat) => {
      const total = transacoesDoMes
        .filter(t => t.tipo === "receita" && t.status === "paga" && t.categoria_id === cat.id)
        .reduce((acc, t) => acc + t.valor, 0);
      return { cor: cat.cor, valor: total, nome: cat.nome, icone: cat.icone };
    })
    .filter((d) => d.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  // --- Dados ---
  const carregarDados = useCallback(async () => {
    if (!session?.user?.id) return;

    try {
      const [resCategorias, resContas, resTransacoes, resParceria, resCaixinhas, resCartoes, resFaturas] = await Promise.all([
        supabase.from("categorias").select("*").eq("user_id", session.user.id),
        supabase.from("contas").select("*"),        // RLS retorna próprias + compartilhadas do parceiro
        supabase.from("transacoes").select("*"),    // RLS retorna próprias + de contas compartilhadas
        supabase.from("parcerias").select("id, solicitante_id, convidado_id").eq("status", "aceito").or(
          `solicitante_id.eq.${session.user.id},convidado_id.eq.${session.user.id}`
        ),
        supabase.from("caixinhas").select("id, nome, saldo_atual, meta_valor, data_prazo, cor, icone"),
        supabase.from("cartoes").select("id, nome, dia_vencimento, dia_fechamento").eq("user_id", session.user.id).eq("ativo", true),
        supabase.from("fatura_itens").select("id, cartao_id, valor, data_compra, mes_fatura, categoria_id, pago").eq("user_id", session.user.id),
      ]);

      if (resCategorias.error || resContas.error || resTransacoes.error) throw new Error("Sem conexão");

      if (resCategorias.data) {
        setCategorias(resCategorias.data.map((c: Categoria) => ({ ...c, cor: PALETA_CORES.includes(c.cor) ? c.cor : PALETA_CORES[0] })).sort((a, b) =>
          a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
        ));
      }
      if (resContas.data) setContas(resContas.data.map((c: Conta) => ({ ...c, cor: c.cor && PALETA_CORES.includes(c.cor) ? c.cor : PALETA_CORES[6] })));
      if (resTransacoes.data) setTransacoes(resTransacoes.data);
      if (resCaixinhas.data) setCaixinhas(resCaixinhas.data.map((c: Caixinha) => ({ ...c, cor: PALETA_CORES.includes(c.cor) ? c.cor : PALETA_CORES[0] })));
      if (resFaturas.data) setComprasCartao(resFaturas.data as CompraCartao[]);

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const cartoesPorId = new Map((resCartoes.data ?? []).map((c: any) => [c.id, c]));
      const possuiFaturaVencida = (resFaturas.data ?? []).some((item: any) => {
        if (item.pago) return false;
        const cartao = cartoesPorId.get(item.cartao_id) as any;
        if (!cartao) return false;
        const [ano, mes] = item.mes_fatura.split("-").map(Number);
        const ultimoDia = new Date(ano, mes, 0).getDate();
        const vencimento = new Date(ano, mes - 1, Math.min(Number(cartao.dia_vencimento), ultimoDia));
        return vencimento < hoje;
      });
      setTemFaturaVencida(possuiFaturaVencida);

      const temParc = resParceria.data ? resParceria.data.length > 0 : false;
      setTemParceiro(temParc);

      setIsOffline(false);
      await AsyncStorage.setItem("@cache_categorias", JSON.stringify(resCategorias.data ?? []));
      await AsyncStorage.setItem("@cache_contas", JSON.stringify(resContas.data ?? []));
      await AsyncStorage.setItem("@cache_transacoes", JSON.stringify(resTransacoes.data ?? []));
      await AsyncStorage.setItem("@cache_caixinhas", JSON.stringify(resCaixinhas.data ?? []));
      await AsyncStorage.setItem("@cache_parceiro", JSON.stringify(temParc));

      // Alerta de vencidos (apenas uma vez por sessão)
      if (!alertaVencidoMostrado.current && resTransacoes.data) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const vencidas = resTransacoes.data.filter((t: any) => {
          if (t.status !== "pendente") return false;
          const partes = (t.data_vencimento || "").split("-");
          const dataT = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
          return dataT < hoje;
        });
        if (vencidas.length > 0) {
          alertaVencidoMostrado.current = true;
          setQtdVencidas(vencidas.length);
          setModalVencidosVisivel(true);
        }
      }

      // Agenda notificações locais com base nos dados do dia
      if (notificacoesAtivas && resTransacoes.data) {
        agendarNotificacoesDoApp(
          resTransacoes.data,
          session.user.id,
          resCaixinhas.data?.map((c: any) => ({
            nome: c.nome,
            meta_valor: Number(c.meta_valor),
            saldo_atual: Number(c.saldo_atual),
            data_prazo: c.data_prazo,
          })) ?? [],
          resCartoes.data?.map((c: any) => ({
            nome: c.nome,
            dia_vencimento: c.dia_vencimento,
            dia_fechamento: c.dia_fechamento,
            faturas_pendentes: [...new Set((resFaturas.data ?? [])
              .filter((item: any) => item.cartao_id === c.id && !item.pago)
              .map((item: any) => item.mes_fatura))] as string[],
          })) ?? [],
          true
        );
      }
    } catch {
      const catCache = await AsyncStorage.getItem("@cache_categorias");
      const conCache = await AsyncStorage.getItem("@cache_contas");
      const transCache = await AsyncStorage.getItem("@cache_transacoes");
      const caixCache = await AsyncStorage.getItem("@cache_caixinhas");
      const parcCache = await AsyncStorage.getItem("@cache_parceiro");

      if (catCache) {
        setCategorias(JSON.parse(catCache).sort((a: Categoria, b: Categoria) =>
          a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
        ));
      }
      if (conCache) setContas(JSON.parse(conCache));
      if (transCache) {
        const anoAtual = new Date().getFullYear();
        const todas: Transacao[] = JSON.parse(transCache);
        setTransacoes(todas.filter(t => new Date(t.data_vencimento).getFullYear() === anoAtual));
      }
      if (caixCache) setCaixinhas(JSON.parse(caixCache));
      if (parcCache) setTemParceiro(JSON.parse(parcCache));
      setIsOffline(true);
    }
  }, [notificacoesAtivas, session?.user?.id]);

  useFocusEffect(useCallback(() => { carregarDados(); }, [carregarDados]));

  const calcularSaldoConta = (conta: Conta) => {
    const transDaConta = transacoes.filter((t) => t.conta_id === conta.id && t.status === "paga");
    const rec = transDaConta.filter((t) => t.tipo === "receita").reduce((acc, curr) => acc + curr.valor, 0);
    const desp = transDaConta.filter((t) => t.tipo === "despesa").reduce((acc, curr) => acc + curr.valor, 0);
    const transferenciasRecebidas = transacoes
      .filter((t) => t.status === "paga" && getContaDestinoTransferencia(t.descricao) === conta.id)
      .reduce((acc, curr) => acc + curr.valor, 0);
    return Number(conta.saldo_inicial) + rec + transferenciasRecebidas - desp;
  };

  // --- Ações de Categoria ---
  const salvarCategoria = async () => {
    if (nomeCategoria.trim() === "") return Alert.alert("Aviso", "Escreve um nome.");
    // Verificar limite do plano para categorias
    const catDoTipo = categorias.filter(c => c.tipo === tipoNovaCategoria && c.ativa !== 0).length;
    const tipoLimite = tipoNovaCategoria === "receita" ? "categoriasReceita" : "categoriasDespesa";
    if (!verificarLimite(tipoLimite, catDoTipo)) return;
    setLoadingCat(true);
    const { error } = await supabase.from("categorias").insert([{
      nome: nomeCategoria, cor: corSelecionada, icone: iconeSelecionado,
      tipo: tipoNovaCategoria, ativa: 1, user_id: session.user.id,
    }]);
    setLoadingCat(false);
    if (error) return Alert.alert("Erro", "Falha ao salvar categoria.");
    setNomeCategoria("");
    setTipoNovaCategoria("despesa");
    setIconeSelecionado("label");
    setModalCatVisivel(false);
    carregarDados();
  };

  const abrirEditarCategoria = (cat: Categoria) => {
    setCatEditando(cat);
    setNomeEditCat(cat.nome);
    setCorEditCat(PALETA_CORES.includes(cat.cor) ? cat.cor : PALETA_CORES[0]);
    setIconeEditCat(cat.icone);
  };

  const salvarEdicaoCategoria = async () => {
    if (!catEditando || nomeEditCat.trim() === "") return;
    const { error } = await supabase.from("categorias").update({
      nome: nomeEditCat, cor: corEditCat, icone: iconeEditCat,
    }).eq("id", catEditando.id);
    if (error) return Alert.alert("Erro", "Falha ao atualizar categoria.");
    setCatEditando(null);
    carregarDados();
  };

  const arquivarCategoria = async (cat: Categoria) => {
    const novaAtiva = cat.ativa !== 0 ? 0 : 1;
    const acao = novaAtiva === 0 ? "arquivar" : "reativar";
    Alert.alert("Confirmar", `Deseja ${acao} a categoria "${cat.nome}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: acao.charAt(0).toUpperCase() + acao.slice(1),
        onPress: async () => {
          await supabase.from("categorias").update({ ativa: novaAtiva }).eq("id", cat.id);
          carregarDados();
        },
      },
    ]);
  };

  const deletarCategoria = async (cat: Categoria) => {
    const { count } = await supabase
      .from("transacoes")
      .select("id", { count: "exact", head: true })
      .eq("categoria_id", cat.id);

    if (count && count > 0) {
      Alert.alert(
        "Categoria com Lançamentos",
        `A categoria "${cat.nome}" possui lançamentos vinculados e não pode ser apagada.\n\nDeseja arquivá-la em vez disso?`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Arquivar",
            onPress: async () => {
              await supabase.from("categorias").update({ ativa: 0 }).eq("id", cat.id);
              if (catEditando?.id === cat.id) setCatEditando(null);
              carregarDados();
            },
          },
        ]
      );
    } else {
      Alert.alert("Apagar Categoria", `Tem certeza que deseja apagar "${cat.nome}"?`, [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Apagar",
          style: "destructive",
          onPress: async () => {
            await supabase.from("categorias").delete().eq("id", cat.id);
            if (catEditando?.id === cat.id) setCatEditando(null);
            carregarDados();
          },
        },
      ]);
    }
  };

  // --- Ações de Conta ---
  const salvarConta = async () => {
    if (nomeConta.trim() === "") return Alert.alert("Aviso", "Dá um nome à conta.");
    // Verificar limite de contas do plano
    if (!verificarLimite("contas", contasAtivas.length)) return;
    setLoadingConta(true);
    const saldoNum = parseFloat(saldoInicialConta.replace(",", ".")) || 0;
    const base = { nome: nomeConta, saldo_inicial: saldoNum, user_id: session.user.id, compartilhado: contaCompartilhada };
    let res = await supabase.from("contas").insert([{ ...base, cor: corNovaConta }]);
    if (res.error) {
      res = await supabase.from("contas").insert([base]);
    }
    setLoadingConta(false);
    if (res.error) return Alert.alert("Erro", `Falha ao salvar conta: ${res.error.message}`);
    setNomeConta("");
    setSaldoInicialConta("");
    setContaCompartilhada(false);
    setCorNovaConta(PALETA_CORES[6]);
    setModalContaVisivel(false);
    carregarDados();
  };

  const abrirEditarConta = (conta: Conta) => {
    setContaEditando(conta);
    setNomeEditConta(conta.nome);
    setSaldoEditConta(String(conta.saldo_inicial));
    setCompartilhadoEditConta(conta.compartilhado);
    setCorEditConta(conta.cor && PALETA_CORES.includes(conta.cor) ? conta.cor : PALETA_CORES[6]);
    setEditandoSaldoConta(false);
    setModalEditarContaVisivel(true);
  };

  const salvarEdicaoConta = async () => {
    if (!contaEditando || nomeEditConta.trim() === "") return Alert.alert("Aviso", "Nome inválido.");
    const base: any = { nome: nomeEditConta, compartilhado: compartilhadoEditConta };
    if (editandoSaldoConta) {
      const saldoNum = parseFloat(saldoEditConta.replace(",", "."));
      if (isNaN(saldoNum)) return Alert.alert("Aviso", "Saldo inválido.");
      base.saldo_inicial = saldoNum;
    }
    let res = await supabase.from("contas").update({ ...base, cor: corEditConta }).eq("id", contaEditando.id);
    if (res.error) {
      // coluna "cor" pode não existir — tentar sem ela
      res = await supabase.from("contas").update(base).eq("id", contaEditando.id);
    }
    if (res.error) return Alert.alert("Erro", `Falha ao atualizar conta: ${res.error.message}`);
    setContaConfirmarArquivo(null);
    setModalEditarContaVisivel(false);
    setContaEditando(null);
    setEditandoSaldoConta(false);
    carregarDados();
  };

  const desarquivarConta = async (conta: Conta) => {
    const { error } = await supabase.from("contas").update({ arquivado: false }).eq("id", conta.id);
    if (error) return Alert.alert("Erro", `Falha ao desarquivar: ${error.message}`);
    setModalEditarContaVisivel(false);
    carregarDados();
  };

  const executarArquivar = async (conta: Conta) => {
    const { error } = await supabase.from("contas").update({ arquivado: true }).eq("id", conta.id);
    if (error) {
      return Alert.alert(
        "Coluna ausente",
        "Para arquivar contas, adicione a coluna 'arquivado' (boolean, default false) na tabela 'contas' no Supabase."
      );
    }
    setContaConfirmarArquivo(null);
    setModalEditarContaVisivel(false);
    carregarDados();
  };

  const arquivarConta = (conta: Conta) => {
    const saldoAtual = calcularSaldoConta(conta);
    const temLancamentos = transacoes.some((t) => t.conta_id === conta.id);
    setContaConfirmarArquivo({ conta, saldoAtual, temLancamentos });
  };

  const excluirContaSemLancamentos = async (conta: Conta) => {
    const { error } = await supabase.from("contas").delete().eq("id", conta.id);
    if (error) return Alert.alert("Erro", `Falha ao excluir: ${error.message}`);
    setContaConfirmarArquivo(null);
    setModalEditarContaVisivel(false);
    carregarDados();
  };

  // --- Transação ---
  const aoMudarData = (_event: any, dataEscolhida?: Date) => {
    setMostrarCalendario(false);
    if (dataEscolhida) setDataSelecionada(dataEscolhida);
  };

  const formatarDataBR = (data: Date) => {
    const d = String(data.getDate()).padStart(2, "0");
    const m = String(data.getMonth() + 1).padStart(2, "0");
    return `${d}/${m}/${data.getFullYear()}`;
  };

  const salvarTransacao = async () => {
    if (loadingTrans) return;
    if (descTransacao.trim() === "" || valorTransacao.trim() === "")
      return Alert.alert("Aviso", "Preenche a descrição e o valor.");
    // Verificar limite de lançamentos do mês
    const mesStr = `${dataSelecionada.getFullYear()}-${String(dataSelecionada.getMonth() + 1).padStart(2, "0")}`;
    const lancsMes = transacoes.filter(t => (t.data_vencimento || "").startsWith(mesStr)).length;
    if (!verificarLimite("lancamentosMes", lancsMes)) return;
    const valorNum = valorDaEntradaMoeda(valorTransacao);
    if (isNaN(valorNum) || valorNum <= 0) return Alert.alert("Aviso", "O valor deve ser maior que zero.");

    let totalRepeticoes = 1;
    let valorFinal = valorNum;

    if (frequencia === "parcelada") {
      totalRepeticoes = parseInt(numParcelas);
      if (isNaN(totalRepeticoes) || totalRepeticoes < 2) return Alert.alert("Aviso", "Número de parcelas inválido.");
      valorFinal = modoValorParcelado === "total"
        ? Number((valorNum / totalRepeticoes).toFixed(2))
        : valorNum;
    } else if (frequencia === "fixa") {
      totalRepeticoes = frequenciaFixa === "semanal" ? 260 : frequenciaFixa === "anual" ? 5 : 60;
    }

    const statusBd = foiPago ? "paga" : "pendente";
    const novasTransacoes: any[] = [];

    for (let i = 0; i < totalRepeticoes; i++) {
      const dataIteracao = frequencia === "fixa"
        ? adicionarRecorrencia(dataSelecionada, i, frequenciaFixa)
        : adicionarRecorrencia(dataSelecionada, i, "mensal");
      const dataFormatadaSql = `${dataIteracao.getFullYear()}-${String(dataIteracao.getMonth() + 1).padStart(2, "0")}-${String(dataIteracao.getDate()).padStart(2, "0")}`;
      let descFinal = descTransacao;
      if (frequencia === "parcelada") descFinal = `${descTransacao} (${i + 1}/${totalRepeticoes})`;
      if (frequencia === "fixa") descFinal = `${descTransacao} ${sufixoRecorrencia(frequenciaFixa)}`;
      // Parcelas/recorrências futuras (i > 0) sempre ficam pendentes
      const statusFinal = (frequencia !== "unica" && i > 0) ? "pendente" : statusBd;

      if (tipoTransacao === "transferencia") {
        if (!contaSelecionadaId || (!contaDestinoId && !caixinhaDestinoId)) return Alert.alert("Aviso", "Seleciona a origem e destino.");
        if (caixinhaDestinoId) {
          // Transferência para objetivo: cria despesa com descrição "Guardar em: X"
          const caixa = caixinhas.find(c => c.id === caixinhaDestinoId);
          if (!caixa) return Alert.alert("Aviso", "Objetivo não encontrado.");
          novasTransacoes.push({ tipo: "despesa", valor: valorFinal, data_vencimento: dataFormatadaSql, data_realizacao: statusFinal === "paga" ? dataFormatadaSql : null, status: statusFinal, descricao: `Guardar em: ${caixa.nome}`, categoria_id: null, conta_id: contaSelecionadaId, user_id: session.user.id });
        } else {
          if (contaSelecionadaId === contaDestinoId) return Alert.alert("Aviso", "As contas não podem ser iguais.");
          novasTransacoes.push({ tipo: "despesa", valor: valorFinal, data_vencimento: dataFormatadaSql, data_realizacao: statusFinal === "paga" ? dataFormatadaSql : null, status: statusFinal, descricao: descricaoTransferencia(descFinal, contaDestinoId!), categoria_id: null, conta_id: contaSelecionadaId, user_id: session.user.id });
        }
      } else {
        if (!catSelecionadaId || !contaSelecionadaId) return Alert.alert("Aviso", "Seleciona a conta e categoria.");
        novasTransacoes.push({ tipo: tipoTransacao, valor: valorFinal, data_vencimento: dataFormatadaSql, data_realizacao: statusFinal === "paga" ? dataFormatadaSql : null, status: statusFinal, descricao: descFinal, categoria_id: catSelecionadaId, conta_id: contaSelecionadaId, user_id: session.user.id });
      }
    }

    setLoadingTrans(true);
    let respostaInsercao = await supabase.from("transacoes").insert(novasTransacoes);
    const erroTransitorio =
      respostaInsercao.error &&
      (
        respostaInsercao.status === 401 ||
        respostaInsercao.status === 408 ||
        respostaInsercao.status === 429 ||
        respostaInsercao.status >= 500 ||
        respostaInsercao.error.code === "PGRST301"
      );

    // O servidor rejeita o lote inteiro nesses casos. Renovar a sessão e
    // repetir uma vez evita que uma indisponibilidade breve chegue ao usuário.
    if (erroTransitorio) {
      await supabase.auth.refreshSession();
      respostaInsercao = await supabase.from("transacoes").insert(novasTransacoes);
    }
    const { error } = respostaInsercao;
    if (!error && caixinhaDestinoId && statusBd === "paga") {
      // Atualiza saldo do objetivo para transações já pagas
      const caixa = caixinhas.find(c => c.id === caixinhaDestinoId);
      if (caixa) {
        const totalPago = novasTransacoes.filter(t => t.status === "paga").reduce((acc, t) => acc + t.valor, 0);
        await supabase.from("caixinhas").update({ saldo_atual: Number(caixa.saldo_atual) + totalPago }).eq("id", caixa.id);
      }
    }
    setLoadingTrans(false);
    if (error) {
      console.error("Falha ao salvar transação", {
        code: error.code,
        status: respostaInsercao.status,
        details: error.details,
      });
      return Alert.alert(
        "Não foi possível salvar",
        "Nenhum lançamento foi criado. Confira sua conexão e tente novamente.",
      );
    }

    setDescTransacao(""); setValorTransacao(""); setCatSelecionadaId(null);
    setContaSelecionadaId(null); setContaDestinoId(null); setCaixinhaDestinoId(null); setFrequencia("unica");
    setNumParcelas("2"); setModoValorParcelado("parcela"); setFrequenciaFixa("mensal"); setDataSelecionada(new Date()); setFoiPago(true);
    setModalTransVisivel(false);
    carregarDados();
  };

  const nomeUsuario = session?.user?.user_metadata?.nome_usuario || session?.user?.email?.split("@")[0] || "Usuário";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: Cores.fundo }]}>
      <ScrollView style={styles.container}>
        {/* HEADER com botão IA fixo */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.greeting, { color: Cores.textoPrincipal }]}>
              {getSaudacao()}, {nomeUsuario}!
            </Text>
            <Text style={[styles.subtitle, { color: Cores.textoSecundario }]}>
              Seu painel financeiro FinFlow
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.iaBotaoFixo, !usuarioPodeAcessarIA(session?.user?.email) && { opacity: 0.55 }]}
            onPress={() => {
              if (usuarioPodeAcessarIA(session?.user?.email)) {
                router.push("/chat-ia");
              } else {
                setModalIaEmBreve(true);
              }
            }}
          >
            <MaterialIcons name="auto-awesome" size={18} color="#FFF" />
            <Text style={styles.iaBotaoTexto}>IA</Text>
          </TouchableOpacity>
        </View>

        {isOffline && (
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F59E0B22", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12, borderWidth: 1, borderColor: "#F59E0B55" }}>
            <MaterialIcons name="wifi-off" size={16} color="#F59E0B" style={{ marginRight: 8 }} />
            <Text style={{ color: "#B45309", fontSize: 13, fontWeight: "600", flex: 1 }}>Sem conexão — exibindo dados salvos (apenas ano atual)</Text>
          </View>
        )}

        <View style={styles.actionGrid}>
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: "#F97316" }]} onPress={() => setModalTransVisivel(true)}>
              <Text style={styles.actionButtonText}>+ Transação</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: "#2A9D8F" }]} onPress={() => setModalGerenciarCatVisivel(true)}>
              <Text style={styles.actionButtonText}>Gerenciar Categorias</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.actionButtonFull, { backgroundColor: "#2563EB", position: "relative" }]} onPress={() => router.push("/(tabs)/cartoes" as any)}>
            <MaterialIcons name="credit-card" size={15} color="#FFF" style={{ marginRight: 6 }} />
            <Text style={styles.actionButtonText}>Cartão de Crédito</Text>
            {temFaturaVencida && (
              <View style={styles.faturaVencidaBadge}>
                <Text style={styles.faturaVencidaBadgeText}>!</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* CARTÃO DE FLUXO DE CAIXA */}
        <View style={[styles.balanceCard, { backgroundColor: isDark ? "#1A1A1A" : Cores.cardFundo, borderWidth: isDark ? 0 : 1, borderColor: isDark ? "transparent" : Cores.borda, shadowColor: isDark ? "transparent" : "#6B6258", shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0 : 0.04, shadowRadius: 8, elevation: isDark ? 0 : 1 }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <TouchableOpacity onPress={() => alterarMes(-1)} style={styles.mesBotao}>
              <MaterialIcons name="chevron-left" size={24} color={isDark ? "#FFF" : "#111827"} />
            </TouchableOpacity>

            {/* DATA CLICÁVEL */}
            <TouchableOpacity onPress={() => {
              setAnoTemp(mesAtual.getFullYear());
              setMesTemp(mesAtual.getMonth());
              setMostrarPickerMesAno(true);
            }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ fontSize: 18, fontWeight: "bold", color: isDark ? "#FFF" : "#111827", textTransform: "capitalize" }}>
                  {nomeDoMes}
                </Text>
                <MaterialIcons name="arrow-drop-down" size={20} color={isDark ? "rgba(255,255,255,0.7)" : "#6B7280"} style={{ marginLeft: 4 }} />
              </View>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => alterarMes(1)} style={styles.mesBotao}>
              <MaterialIcons name="chevron-right" size={24} color={isDark ? "#FFF" : "#111827"} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.balanceTitle, { color: isDark ? "#999" : "#6B7280" }]}>Saldo Global (Na Conta)</Text>
          <Text style={[styles.balanceAmount, { color: isDark ? "#FFF" : "#111827" }]}>{fmtReais(saldoAtualGlobal)}</Text>

          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 20, paddingTop: 15, borderTopWidth: 1, borderTopColor: isDark ? "#333" : "#E5E7EB" }}>
            <TouchableOpacity onPress={() => setModalResumoVisivel(true)}>
              <Text style={{ color: isDark ? "#999" : "#6B7280", fontSize: 12 }}>Entradas do Mês</Text>
              <Text style={{ color: "#10B981", fontWeight: "bold", fontSize: 16 }}>
                + {fmtReais(receitasDoMes)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setModalResumoVisivel(true)}>
              <Text style={{ color: isDark ? "#999" : "#6B7280", fontSize: 12, textAlign: "right" }}>Saídas do Mês</Text>
              <Text style={{ color: "#EF4444", fontWeight: "bold", fontSize: 16, textAlign: "right" }}>
                - {fmtReais(despesasDoMes)}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: 15, alignItems: "center", backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F3F4F6", padding: 10, borderRadius: 8 }}>
            <Text style={{ color: isDark ? "#999" : "#6B7280", fontSize: 12 }}>Balanço do Mês</Text>
            <Text style={{ color: balancoMensal >= 0 ? "#10B981" : "#EF4444", fontWeight: "bold", fontSize: 20 }}>
              {fmtReais(balancoMensal)}
            </Text>
            <Text style={{ color: isDark ? "#888" : "#7B8490", fontSize: 11, marginTop: 3 }}>
              Previsto até o fim do mês: {fmtReais(balancoAgendadoMensal)}
            </Text>
          </View>
        </View>

        {/* CONTAS */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: Cores.textoPrincipal }]}>Minhas Contas</Text>
            <TouchableOpacity
              style={[styles.addContaBtn, { backgroundColor: "#457B9D" }]}
              onPress={() => setModalContaVisivel(true)}
            >
              <MaterialIcons name="add" size={16} color="#FFF" />
              <Text style={styles.addContaBtnText}>Nova Conta</Text>
            </TouchableOpacity>
          </View>

          {contas.filter(c => !c.arquivado).length === 0 ? (
            <TouchableOpacity
              onPress={() => setModalContaVisivel(true)}
              style={{ alignItems: "center", paddingVertical: 28, borderRadius: 12, borderWidth: 2, borderColor: Cores.borda, borderStyle: "dashed" }}
            >
              <MaterialIcons name="account-balance-wallet" size={40} color={Cores.borda} />
              <Text style={{ color: Cores.textoSecundario, marginTop: 10, fontWeight: "600" }}>Nenhuma conta criada</Text>
              <Text style={{ color: "#2563EB", fontSize: 13, marginTop: 4 }}>Toque para adicionar sua primeira conta</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.accountsGrid}>
              {contas.filter(c => !c.arquivado).map((conta) => {
                const estilo = getEstiloBanco(conta.nome, isDark, conta.cor);
                const bloqueada = conta.bloqueado_plano;
                return (
                  <TouchableOpacity
                    key={conta.id}
                    style={[styles.accountCard, { backgroundColor: estilo.bg, borderColor: isDark ? Cores.borda : estilo.bg, borderWidth: isDark ? 1 : 0, opacity: bloqueada ? 0.55 : 1 }]}
                    onPress={() => !bloqueada && abrirEditarConta(conta)}
                    activeOpacity={bloqueada ? 1 : 0.8}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      {bloqueada && <MaterialIcons name="lock" size={13} color={estilo.text} style={{ marginRight: 4 }} />}
                      <Text style={[styles.accountName, { color: estilo.text }]}>{conta.nome}</Text>
                      {conta.compartilhado && !bloqueada && (
                        <View style={{ marginLeft: 8, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 }}>
                          <MaterialIcons name="people" size={14} color={estilo.text} />
                        </View>
                      )}
                    </View>
                    <Text style={[styles.accountBalance, { color: estilo.text }]}>
                      {fmtReais(calcularSaldoConta(conta))}
                    </Text>
                    <Text style={{ color: estilo.text, opacity: 0.6, fontSize: 11, marginTop: 4 }}>
                      {bloqueada ? "Bloqueada — faça upgrade" : "Toque para editar"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Contas arquivadas */}
          {contas.filter(c => c.arquivado).length > 0 && (
            <>
              <TouchableOpacity
                onPress={() => setMostrarArquivadas(!mostrarArquivadas)}
                style={{ flexDirection: "row", alignItems: "center", marginTop: 12, paddingVertical: 6 }}
              >
                <MaterialIcons name={mostrarArquivadas ? "expand-less" : "expand-more"} size={18} color={Cores.textoSecundario} />
                <Text style={{ color: Cores.textoSecundario, fontSize: 13, marginLeft: 4 }}>
                  {mostrarArquivadas ? "Ocultar arquivadas" : `Ver ${contas.filter(c => c.arquivado).length} conta(s) arquivada(s)`}
                </Text>
              </TouchableOpacity>
              {mostrarArquivadas && (
                <View style={[styles.accountsGrid, { marginTop: 8 }]}>
                  {contas.filter(c => c.arquivado).map((conta) => {
                    const estilo = getEstiloBanco(conta.nome, isDark, conta.cor);
                    return (
                      <TouchableOpacity
                        key={conta.id}
                        style={[styles.accountCard, { backgroundColor: estilo.bg, opacity: 0.5, borderColor: Cores.borda, borderWidth: 1 }]}
                        onPress={() => abrirEditarConta(conta)}
                        activeOpacity={0.8}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <MaterialIcons name="archive" size={14} color={estilo.text} style={{ marginRight: 6 }} />
                          <Text style={[styles.accountName, { color: estilo.text }]}>{conta.nome}</Text>
                        </View>
                        <Text style={{ color: estilo.text, opacity: 0.7, fontSize: 11, marginTop: 4 }}>Arquivada — toque para editar</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </View>

        {/* GRÁFICOS DE PIZZA */}
        <View style={styles.section}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15 }}>
            <Text style={[styles.sectionTitle, { color: Cores.textoPrincipal }]}>
              Distribuição do Mês
            </Text>
            <View style={{ flexDirection: "row", backgroundColor: Cores.pillFundo, borderRadius: 8, padding: 3 }}>
              <TouchableOpacity
                onPress={() => setModoDistribuicao("concluidos")}
                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: modoDistribuicao === "concluidos" ? "#2A9D8F" : "transparent" }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: modoDistribuicao === "concluidos" ? "#FFF" : Cores.textoSecundario }}>Concluídos</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setModoDistribuicao("previstos")}
                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: modoDistribuicao === "previstos" ? (isDark ? "#444" : "#FFF") : "transparent" }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: modoDistribuicao === "previstos" ? Cores.textoPrincipal : Cores.textoSecundario }}>Previstos</Text>
              </TouchableOpacity>
            </View>
          </View>

          {isOffline ? (
            <View style={{ alignItems: "center", paddingVertical: 32, gap: 10 }}>
              <MaterialIcons name="wifi-off" size={36} color={Cores.textoSecundario} />
              <Text style={{ color: Cores.textoSecundario, fontSize: 15, fontWeight: "600" }}>Sem conexão</Text>
              <Text style={{ color: Cores.textoSecundario, fontSize: 13, textAlign: "center" }}>
                O fluxo de caixa não está disponível offline.{"\n"}Reconecte para ver a distribuição por categoria.
              </Text>
            </View>
          ) : (
          <>
          {/* Despesas por categoria */}
          <View style={[styles.graficoCard, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#E76F51", marginRight: 8 }} />
              <Text style={[styles.graficoTitulo, { color: Cores.textoPrincipal }]}>Despesas por Categoria</Text>
            </View>
            <BarChartCategorias
              dados={modoDistribuicao === "concluidos" ? dadosDespesasPorCatRealizadas : dadosDespesasPorCat}
              total={modoDistribuicao === "concluidos" ? despesasDoMesRealizadas : despesasDoMes + comprasCartaoDoMes.reduce((acc, item) => acc + Number(item.valor), 0)}
              isDark={isDark}
            />
            {(modoDistribuicao === "concluidos" ? despesasDoMesRealizadas : despesasDoMes + comprasCartaoDoMes.reduce((acc, item) => acc + Number(item.valor), 0)) > 0 && (
              <Text style={{ color: "#E76F51", fontWeight: "bold", textAlign: "center", marginTop: 8, fontSize: 13 }}>
                Total: {fmtReais(modoDistribuicao === "concluidos" ? despesasDoMesRealizadas : despesasDoMes + comprasCartaoDoMes.reduce((acc, item) => acc + Number(item.valor), 0))}
              </Text>
            )}
          </View>

          {/* Receitas por categoria */}
          <View style={[styles.graficoCard, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#8AB17D", marginRight: 8 }} />
              <Text style={[styles.graficoTitulo, { color: Cores.textoPrincipal }]}>Receitas por Categoria</Text>
            </View>
            <BarChartCategorias
              dados={modoDistribuicao === "concluidos" ? dadosReceitasPorCatRealizadas : dadosReceitasPorCat}
              total={modoDistribuicao === "concluidos" ? receitasDoMesRealizadas : receitasDoMes}
              isDark={isDark}
            />
            {(modoDistribuicao === "concluidos" ? receitasDoMesRealizadas : receitasDoMes) > 0 && (
              <Text style={{ color: "#8AB17D", fontWeight: "bold", textAlign: "center", marginTop: 8, fontSize: 13 }}>
                Total: {fmtReais(modoDistribuicao === "concluidos" ? receitasDoMesRealizadas : receitasDoMes)}
              </Text>
            )}
          </View>
          </>
          )}
        </View>

      </ScrollView>

      {contaConfirmarArquivo && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setContaConfirmarArquivo(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "90%", borderTopWidth: 4, borderTopColor: "#F4A261" }]}>
              <View style={{ alignItems: "center", marginBottom: 14 }}>
                <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: "#F4A26122", alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="archive" size={31} color="#F4A261" />
                </View>
              </View>
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>
                {contaConfirmarArquivo.temLancamentos ? "Arquivar conta" : "Arquivar ou excluir"}
              </Text>
              <Text style={{ color: Cores.textoSecundario, textAlign: "center", fontSize: 14, lineHeight: 21, marginBottom: 10 }}>
                {contaConfirmarArquivo.temLancamentos
                  ? `A conta “${contaConfirmarArquivo.conta.nome}” deixará de aparecer nas operações, mas todo o histórico será preservado.`
                  : `A conta “${contaConfirmarArquivo.conta.nome}” ainda não possui movimentações.`}
              </Text>
              {Math.abs(contaConfirmarArquivo.saldoAtual) > 0.005 && (
                <View style={{ backgroundColor: Cores.pillFundo, borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 16 }}>
                  <Text style={{ color: Cores.textoSecundario, fontSize: 12 }}>Saldo que ficará arquivado</Text>
                  <Text style={{ color: Cores.textoPrincipal, fontSize: 22, fontWeight: "bold", marginTop: 3 }}>{fmtReais(contaConfirmarArquivo.saldoAtual)}</Text>
                </View>
              )}
              <TouchableOpacity style={{ minHeight: 50, borderRadius: 11, backgroundColor: "#F4A261", alignItems: "center", justifyContent: "center", marginBottom: 9 }} onPress={() => executarArquivar(contaConfirmarArquivo.conta)}>
                <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>Arquivar conta</Text>
              </TouchableOpacity>
              {!contaConfirmarArquivo.temLancamentos && (
                <TouchableOpacity style={{ minHeight: 50, borderRadius: 11, backgroundColor: "#E76F51", alignItems: "center", justifyContent: "center", marginBottom: 9 }} onPress={() => excluirContaSemLancamentos(contaConfirmarArquivo.conta)}>
                  <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>Excluir definitivamente</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={{ minHeight: 48, borderRadius: 11, backgroundColor: Cores.pillFundo, alignItems: "center", justifyContent: "center" }} onPress={() => setContaConfirmarArquivo(null)}>
                <Text style={{ color: Cores.textoSecundario, fontWeight: "bold" }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAL PICKER MÊS/ANO */}
      <Modal animationType="fade" transparent visible={mostrarPickerMesAno} onRequestClose={() => setMostrarPickerMesAno(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "85%" }]}>
            <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Selecionar Mês e Ano</Text>

            {/* Seletor de Ano */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <TouchableOpacity onPress={() => setAnoTemp((a) => a - 1)} style={styles.mesBotaoModal}>
                <MaterialIcons name="chevron-left" size={24} color={Cores.textoPrincipal} />
              </TouchableOpacity>
              <Text style={{ fontSize: 20, fontWeight: "bold", color: Cores.textoPrincipal }}>{anoTemp}</Text>
              <TouchableOpacity onPress={() => setAnoTemp((a) => a + 1)} style={styles.mesBotaoModal}>
                <MaterialIcons name="chevron-right" size={24} color={Cores.textoPrincipal} />
              </TouchableOpacity>
            </View>

            {/* Grade de Meses */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 20 }}>
              {mesesEmPortugues.map((mes, idx) => {
                const ativo = idx === mesTemp;
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.mesItem, { backgroundColor: ativo ? "#2A9D8F" : Cores.pillFundo }]}
                    onPress={() => setMesTemp(idx)}
                  >
                    <Text style={{ color: ativo ? "#FFF" : Cores.textoSecundario, fontSize: 12, fontWeight: "600" }}>
                      {mes.substring(0, 3)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modalButtons}>
              <Button title="Cancelar" color="#999" onPress={() => setMostrarPickerMesAno(false)} />
              <Button title="Confirmar" color="#2A9D8F" onPress={() => {
                const novaData = new Date(anoTemp, mesTemp, 1);
                setMesAtual(novaData);
                setMostrarPickerMesAno(false);
              }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL EDITAR CONTA */}
      <Modal animationType="slide" transparent visible={modalEditarContaVisivel} onRequestClose={() => { setModalEditarContaVisivel(false); setEditandoSaldoConta(false); }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "95%", maxHeight: "90%" }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Editar Conta</Text>

              {/* Info estática da conta */}
              {contaEditando && (
                <View style={{ alignItems: "center", marginBottom: 20, padding: 15, backgroundColor: Cores.pillFundo, borderRadius: 12 }}>
                  <Text style={{ color: Cores.textoSecundario, fontSize: 12, marginBottom: 4 }}>Saldo Atual</Text>
                  <Text style={{ color: "#2A9D8F", fontSize: 26, fontWeight: "bold" }}>
                    {fmtReais(calcularSaldoConta(contaEditando))}
                  </Text>
                </View>
              )}

              {temParceiro && (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15, padding: 10, backgroundColor: Cores.pillFundo, borderRadius: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <MaterialIcons name="people" size={20} color="#E76F51" style={{ marginRight: 8 }} />
                    <Text style={{ color: Cores.textoPrincipal, fontWeight: "500" }}>Conta Conjunta?</Text>
                  </View>
                  <Switch value={compartilhadoEditConta} onValueChange={setCompartilhadoEditConta} trackColor={{ false: "#767577", true: "#E76F51" }} />
                </View>
              )}

              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Nome da Conta:</Text>
              <TextInput
                style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, color: Cores.textoPrincipal }]}
                placeholder="Nome da conta"
                placeholderTextColor={Cores.textoSecundario}
                value={nomeEditConta}
                onChangeText={setNomeEditConta}
              />

              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Cor da Conta:</Text>
              <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ maxWidth: "100%" }} contentContainerStyle={styles.colorPalette}>
                {PALETA_CORES.map((cor) => (
                  <TouchableOpacity
                    key={cor}
                    style={[styles.colorOption, { backgroundColor: cor }, corEditConta === cor && { borderWidth: 3, borderColor: Cores.textoPrincipal }]}
                    onPress={() => setCorEditConta(cor)}
                  />
                ))}
              </ScrollView>

              {/* Editar saldo inicial com confirmação */}
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, backgroundColor: Cores.pillFundo, borderRadius: 8, marginBottom: 15 }}
                onPress={() => {
                  if (!editandoSaldoConta) {
                    setConfirmarEdicaoSaldo(true);
                  } else {
                    setEditandoSaldoConta(false);
                  }
                }}
              >
                <Text style={{ color: Cores.textoPrincipal, fontWeight: "600" }}>
                  {editandoSaldoConta ? "Cancelar edição de saldo" : "Editar Saldo Inicial"}
                </Text>
                <MaterialIcons name={editandoSaldoConta ? "close" : "edit"} size={18} color="#457B9D" />
              </TouchableOpacity>

              {editandoSaldoConta && (
                <TextInput
                  style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: "#457B9D", color: Cores.textoPrincipal, borderWidth: 2 }]}
                  placeholder="Novo Saldo Inicial"
                  placeholderTextColor={Cores.textoSecundario}
                  value={saldoEditConta}
                  onChangeText={setSaldoEditConta}
                  keyboardType="numeric"
                />
              )}

              {/* Arquivar / Desarquivar */}
              {contaEditando?.arquivado ? (
                <TouchableOpacity
                  style={[styles.botaoApagar, { marginBottom: 15, backgroundColor: "#2A9D8F" }]}
                  onPress={() => contaEditando && desarquivarConta(contaEditando)}
                >
                  <MaterialIcons name="unarchive" size={18} color="#FFF" />
                  <Text style={styles.botaoApagarTexto}>Desarquivar Conta</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.botaoApagar, { marginBottom: 15, backgroundColor: "#F4A261" }]}
                  onPress={() => contaEditando && arquivarConta(contaEditando)}
                >
                  <MaterialIcons name="archive" size={18} color="#FFF" />
                  <Text style={styles.botaoApagarTexto}>Arquivar Conta</Text>
                </TouchableOpacity>
              )}

              <View style={styles.modalButtons}>
                <Button title="Cancelar" color="#999" onPress={() => { setModalEditarContaVisivel(false); setEditandoSaldoConta(false); }} />
                <Button title="Salvar" color="#457B9D" onPress={salvarEdicaoConta} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL NOVA CONTA */}
      <Modal animationType="slide" transparent visible={modalContaVisivel} onRequestClose={() => setModalContaVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo }]}>
            <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Nova Conta</Text>

            {temParceiro && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15, padding: 10, backgroundColor: Cores.pillFundo, borderRadius: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <MaterialIcons name="people" size={20} color="#E76F51" style={{ marginRight: 8 }} />
                  <Text style={{ color: Cores.textoPrincipal, fontWeight: "500" }}>Conta Conjunta?</Text>
                </View>
                <Switch value={contaCompartilhada} onValueChange={setContaCompartilhada} trackColor={{ false: "#767577", true: "#E76F51" }} />
              </View>
            )}

            <TextInput
              style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, color: Cores.textoPrincipal }]}
              placeholder="Nome (ex: Itaú Casa, Carteira)*"
              placeholderTextColor={Cores.textoSecundario}
              value={nomeConta}
              onChangeText={setNomeConta}
            />
            <TextInput
              style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, color: Cores.textoPrincipal }]}
              placeholder="Saldo Inicial (ex: 100.00)"
              placeholderTextColor={Cores.textoSecundario}
              value={saldoInicialConta}
              onChangeText={setSaldoInicialConta}
              keyboardType="numeric"
            />

            <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Cor da Conta*:</Text>
            <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ maxWidth: "100%" }} contentContainerStyle={styles.colorPalette}>
              {PALETA_CORES.map((cor) => (
                <TouchableOpacity
                  key={cor}
                  style={[styles.colorOption, { backgroundColor: cor }, corNovaConta === cor && { borderWidth: 3, borderColor: Cores.textoPrincipal }]}
                  onPress={() => setCorNovaConta(cor)}
                />
              ))}
            </ScrollView>

            {/* Preview da conta */}
            <View style={{ backgroundColor: corNovaConta, padding: 12, borderRadius: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
              <Text style={{ color: "#FFF", fontWeight: "600" }}>{nomeConta || "Nome da Conta"}</Text>
              <Text style={{ color: "#FFF", fontWeight: "bold" }}>{fmtReais(parseFloat(saldoInicialConta.replace(",", ".") || "0"))}</Text>
            </View>

            <View style={styles.modalButtons}>
              <Button title="Cancelar" color="#999" onPress={() => setModalContaVisivel(false)} />
              <Button title={loadingConta ? "Salvando..." : "Salvar"} color="#457B9D" onPress={salvarConta} disabled={loadingConta} />
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL GERENCIAR CATEGORIAS */}
      <Modal animationType="slide" transparent visible={modalGerenciarCatVisivel} onRequestClose={() => { setModalGerenciarCatVisivel(false); setCatEditando(null); }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "95%", maxHeight: "85%" }]}>
            <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Gerenciar Categorias</Text>

            {!catEditando && (
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#2A9D8F", padding: 10, borderRadius: 8, marginBottom: 15, gap: 6 }}
                onPress={() => { setModalGerenciarCatVisivel(false); setModalCatVisivel(true); }}
              >
                <MaterialIcons name="add" size={18} color="#FFF" />
                <Text style={{ color: "#FFF", fontWeight: "bold" }}>Nova Categoria</Text>
              </TouchableOpacity>
            )}

            {catEditando ? (
              // Tela de edição de categoria específica
              <ScrollView>
                <Text style={[styles.colorLabel, { color: Cores.textoSecundario, marginBottom: 5 }]}>Editando: {catEditando.nome}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, color: Cores.textoPrincipal }]}
                  placeholder="Nome da categoria"
                  placeholderTextColor={Cores.textoSecundario}
                  value={nomeEditCat}
                  onChangeText={setNomeEditCat}
                />
                <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Cor:</Text>
                <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ maxWidth: "100%" }} contentContainerStyle={styles.colorPalette}>
                  {PALETA_CORES.map((cor) => (
                    <TouchableOpacity
                      key={cor}
                      style={[styles.colorOption, { backgroundColor: cor }, corEditCat === cor && { borderWidth: 3, borderColor: Cores.textoPrincipal }]}
                      onPress={() => setCorEditCat(cor)}
                    />
                  ))}
                </ScrollView>
                <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Ícone:</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                  {LISTA_ICONES.map((icone) => (
                    <TouchableOpacity
                      key={icone}
                      style={[styles.iconeOpcao, { backgroundColor: iconeEditCat === icone ? catEditando.cor : Cores.pillFundo }]}
                      onPress={() => setIconeEditCat(icone)}
                    >
                      <MaterialIcons name={icone as any} size={20} color={iconeEditCat === icone ? "#FFF" : Cores.textoSecundario} />
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={[styles.botaoApagar, { marginBottom: 15 }]} onPress={() => deletarCategoria(catEditando)}>
                  <MaterialIcons name="delete-outline" size={16} color="#FFF" />
                  <Text style={styles.botaoApagarTexto}>Apagar Categoria</Text>
                </TouchableOpacity>
                <View style={styles.modalButtons}>
                  <Button title="Voltar" color="#999" onPress={() => setCatEditando(null)} />
                  <Button title="Salvar" color="#2A9D8F" onPress={salvarEdicaoCategoria} />
                </View>
              </ScrollView>
            ) : (
              // Lista de categorias
              <ScrollView>
                {["despesa", "receita"].map((tipo) => (
                  <View key={tipo}>
                    <Text style={[styles.colorLabel, { color: Cores.textoSecundario, textTransform: "uppercase", letterSpacing: 1 }]}>
                      {tipo === "despesa" ? "Despesas" : "Receitas"}
                    </Text>
                    {categorias.filter((c) => c.tipo === tipo).map((cat) => (
                      <View key={cat.id} style={[styles.catGerenciarRow, { backgroundColor: Cores.pillFundo }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: cat.cor, alignItems: "center", justifyContent: "center", marginRight: 10 }}>
                            <MaterialIcons name={cat.icone as any} size={16} color="#FFF" />
                          </View>
                          <Text style={{ color: cat.ativa !== 0 ? Cores.textoPrincipal : Cores.textoSecundario, fontWeight: "600", flex: 1 }} numberOfLines={1}>
                            {cat.nome}
                          </Text>
                          {cat.ativa === 0 && (
                            <View style={{ backgroundColor: "#555", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginRight: 8 }}>
                              <Text style={{ color: "#CCC", fontSize: 10 }}>Arquivada</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TouchableOpacity onPress={() => abrirEditarCategoria(cat)} style={styles.iconeBotao}>
                            <MaterialIcons name="edit" size={18} color="#457B9D" />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => arquivarCategoria(cat)} style={styles.iconeBotao}>
                            <MaterialIcons name={cat.ativa !== 0 ? "archive" : "unarchive"} size={18} color="#F4A261" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                    {categorias.filter((c) => c.tipo === tipo).length === 0 && (
                      <Text style={{ color: Cores.textoSecundario, fontStyle: "italic", marginBottom: 10, fontSize: 13 }}>Nenhuma categoria.</Text>
                    )}
                  </View>
                ))}
                <View style={{ marginTop: 10 }}>
                  <Button title="Fechar" color="#999" onPress={() => setModalGerenciarCatVisivel(false)} />
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* MODAL NOVA CATEGORIA */}
      <Modal animationType="slide" transparent visible={modalCatVisivel} onRequestClose={() => setModalCatVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo }]}>
            <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Criar Categoria</Text>
            <View style={[styles.typeSelector, { borderColor: Cores.borda }]}>
              <TouchableOpacity style={[styles.typeButton, tipoNovaCategoria === "despesa" && styles.expenseSelected]} onPress={() => setTipoNovaCategoria("despesa")}>
                <Text style={[styles.typeButtonText, tipoNovaCategoria === "despesa" ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>Despesas</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.typeButton, tipoNovaCategoria === "receita" && styles.incomeSelected]} onPress={() => setTipoNovaCategoria("receita")}>
                <Text style={[styles.typeButtonText, tipoNovaCategoria === "receita" ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>Receitas</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, color: Cores.textoPrincipal }]}
              placeholder="Nome (ex: Lazer, Vendas)"
              placeholderTextColor={Cores.textoSecundario}
              value={nomeCategoria}
              onChangeText={setNomeCategoria}
            />
            <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Cor:</Text>
            <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ maxWidth: "100%" }} contentContainerStyle={styles.colorPalette}>
              {PALETA_CORES.map((cor) => (
                <TouchableOpacity key={cor} style={[styles.colorOption, { backgroundColor: cor }, corSelecionada === cor && { borderWidth: 3, borderColor: Cores.textoPrincipal }]} onPress={() => setCorSelecionada(cor)} />
              ))}
            </ScrollView>
            <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Ícone:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              {LISTA_ICONES.map((icone) => (
                <TouchableOpacity
                  key={icone}
                  style={[styles.iconeOpcao, { backgroundColor: iconeSelecionado === icone ? corSelecionada : Cores.pillFundo, marginRight: 8 }]}
                  onPress={() => setIconeSelecionado(icone)}
                >
                  <MaterialIcons name={icone as any} size={20} color={iconeSelecionado === icone ? "#FFF" : Cores.textoSecundario} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalButtons}>
              <Button title="Cancelar" color="#999" onPress={() => setModalCatVisivel(false)} />
              <Button title={loadingCat ? "Salvando..." : "Salvar"} color="#2A9D8F" onPress={salvarCategoria} disabled={loadingCat} />
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL RESUMO DO MÊS */}
      <Modal animationType="slide" transparent visible={modalResumoVisivel} onRequestClose={() => setModalResumoVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "95%", maxHeight: "80%" }]}>
            <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>
              {nomeDoMes} — Resumo
            </Text>
            <ScrollView>
              {["receita", "despesa"].map((tipo) => {
                const dadosCat = tipo === "receita" ? dadosReceitasPorCat : dadosDespesasPorCat;
                const totalTipo = tipo === "receita" ? receitasDoMes : despesasDoMes;
                const corTipo = tipo === "receita" ? "#8AB17D" : "#E76F51";
                return (
                  <View key={tipo} style={{ marginBottom: 20 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
                      <Text style={{ color: corTipo, fontWeight: "bold", fontSize: 15, textTransform: "uppercase" }}>
                        {tipo === "receita" ? "Receitas" : "Despesas"}
                      </Text>
                      <Text style={{ color: corTipo, fontWeight: "bold", fontSize: 15 }}>
                        {fmtReais(totalTipo)}
                      </Text>
                    </View>
                    {dadosCat.length === 0 ? (
                      <Text style={{ color: Cores.textoSecundario, fontStyle: "italic", fontSize: 13 }}>Sem registros.</Text>
                    ) : (
                      dadosCat.map((item, i) => (
                        <View key={i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: 10, backgroundColor: Cores.pillFundo, borderRadius: 8 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: item.cor, marginRight: 10 }} />
                            <Text style={{ color: Cores.textoPrincipal, fontWeight: "500", flex: 1 }} numberOfLines={1}>{item.nome}</Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={{ color: corTipo, fontWeight: "bold", fontSize: 13 }}>{fmtReais(item.valor)}</Text>
                            <Text style={{ color: Cores.textoSecundario, fontSize: 11 }}>
                              {totalTipo > 0 ? `${((item.valor / totalTipo) * 100).toFixed(1)}%` : "0%"}
                            </Text>
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <Button title="Fechar" color="#999" onPress={() => setModalResumoVisivel(false)} />
          </View>
        </View>
      </Modal>

      {/* MODAL LANÇAMENTOS VENCIDOS */}
      <Modal
        animationType="fade"
        transparent
        visible={modalVencidosVisivel && !temPopupPrioritario}
        onRequestClose={() => setModalVencidosVisivel(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? "#1E1E1E" : "#FFF", borderTopWidth: 4, borderTopColor: "#E76F51" }]}>
            <View style={{ alignItems: "center", marginBottom: 15 }}>
              <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "#E76F5122", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <MaterialIcons name="warning" size={32} color="#E76F51" />
              </View>
              <Text style={{ color: isDark ? "#FFF" : "#1A1A1A", fontSize: 18, fontWeight: "bold" }}>
                Lançamentos Vencidos
              </Text>
            </View>
            <Text style={{ color: isDark ? "#AAA" : "#555", textAlign: "center", fontSize: 15, marginBottom: 20, lineHeight: 22 }}>
              Você tem{" "}
              <Text style={{ color: "#E76F51", fontWeight: "bold" }}>{qtdVencidas}</Text>{" "}
              lançamento{qtdVencidas > 1 ? "s" : ""} vencido{qtdVencidas > 1 ? "s" : ""} sem resolver.{"\n\n"}
              Acesse o <Text style={{ fontWeight: "bold", color: isDark ? "#FFF" : "#1A1A1A" }}>Histórico</Text> para regularizá-los.
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: "#E76F51", paddingVertical: 14, borderRadius: 10, alignItems: "center" }}
              onPress={() => setModalVencidosVisivel(false)}
            >
              <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>Entendido</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={confirmarEdicaoSaldo}
        onRequestClose={() => setConfirmarEdicaoSaldo(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, borderTopWidth: 4, borderTopColor: "#457B9D" }]}>
            <View style={{ alignItems: "center", marginBottom: 14 }}>
              <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: "#457B9D22", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <MaterialIcons name="account-balance-wallet" size={30} color="#457B9D" />
              </View>
              <Text style={{ color: Cores.textoPrincipal, fontSize: 18, fontWeight: "bold" }}>
                Editar saldo inicial
              </Text>
            </View>
            <Text style={{ color: Cores.textoSecundario, textAlign: "center", fontSize: 14, lineHeight: 21, marginBottom: 22 }}>
              Alterar o saldo inicial afeta o cálculo do saldo atual e dos relatórios desta conta. Deseja continuar?
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: "#457B9D", paddingVertical: 14, borderRadius: 10, alignItems: "center", marginBottom: 9 }}
              onPress={() => {
                setConfirmarEdicaoSaldo(false);
                setEditandoSaldoConta(true);
              }}
            >
              <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>Sim, editar saldo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: Cores.pillFundo, paddingVertical: 14, borderRadius: 10, alignItems: "center" }}
              onPress={() => setConfirmarEdicaoSaldo(false)}
            >
              <Text style={{ color: Cores.textoSecundario, fontWeight: "bold", fontSize: 15 }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL NOVA TRANSAÇÃO */}
      <Modal animationType="slide" transparent visible={modalTransVisivel} onRequestClose={() => setModalTransVisivel(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "95%", maxHeight: "90%" }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Nova Transação</Text>
              <View style={[styles.typeSelector, { borderColor: Cores.borda }]}>
                <TouchableOpacity style={[styles.typeButton, tipoTransacao === "despesa" && styles.expenseSelected]} onPress={() => { setTipoTransacao("despesa"); setCatSelecionadaId(null); }}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.typeButtonText, tipoTransacao === "despesa" ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>Despesa</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.typeButton, tipoTransacao === "receita" && styles.incomeSelected]} onPress={() => { setTipoTransacao("receita"); setCatSelecionadaId(null); }}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.typeButtonText, tipoTransacao === "receita" ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>Receita</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.typeButton, tipoTransacao === "transferencia" && styles.transferSelected]} onPress={() => setTipoTransacao("transferencia")}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.typeButtonText, tipoTransacao === "transferencia" ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>Transferência</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Repetição:</Text>
              <View style={[styles.typeSelector, { borderColor: Cores.borda }]}>
                {(["unica", "parcelada", "fixa"] as const).map((freq) => (
                  <TouchableOpacity key={freq} style={[styles.freqButton, { backgroundColor: Cores.pillFundo }, frequencia === freq && { backgroundColor: Cores.pillAtivo, borderBottomWidth: 3, borderColor: Cores.textoPrincipal }]} onPress={() => {
                    setFrequencia(freq);
                    if (freq !== "unica") setFoiPago(false);
                  }}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.freqButtonText, frequencia === freq ? { color: Cores.textoPrincipal } : { color: Cores.textoSecundario }]}>
                      {freq === "unica" ? "Única" : freq === "parcelada" ? "Parcelada" : "Fixa"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {frequencia === "fixa" && (
                <>
                  <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Periodicidade:</Text>
                  <View style={[styles.typeSelector, { borderColor: Cores.borda }]}>
                    {(["semanal", "mensal", "anual"] as const).map((periodo) => (
                      <TouchableOpacity
                        key={periodo}
                        style={[styles.freqButton, { backgroundColor: Cores.pillFundo }, frequenciaFixa === periodo && { backgroundColor: Cores.pillAtivo, borderBottomWidth: 3, borderColor: Cores.textoPrincipal }]}
                        onPress={() => setFrequenciaFixa(periodo)}
                      >
                        <Text style={[styles.freqButtonText, { color: frequenciaFixa === periodo ? Cores.textoPrincipal : Cores.textoSecundario }]}>
                          {periodo === "semanal" ? "Semanal" : periodo === "mensal" ? "Mensal" : "Anual"}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              {frequencia === "unica" && (
                <>
                  <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Status:</Text>
                  <View style={[styles.typeSelector, { borderColor: Cores.borda }]}>
                    <TouchableOpacity style={[styles.freqButton, { backgroundColor: Cores.pillFundo }, foiPago && { backgroundColor: Cores.pillAtivo, borderBottomWidth: 3, borderColor: Cores.textoPrincipal }]} onPress={() => setFoiPago(true)}>
                      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.freqButtonText, foiPago ? { color: Cores.textoPrincipal } : { color: Cores.textoSecundario }]}>{tipoTransacao === "receita" ? "Já Recebido" : "Já Pago"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.freqButton, { backgroundColor: Cores.pillFundo }, !foiPago && { backgroundColor: Cores.pillAtivo, borderBottomWidth: 3, borderColor: Cores.textoPrincipal }]} onPress={() => setFoiPago(false)}>
                      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.freqButtonText, !foiPago ? { color: Cores.textoPrincipal } : { color: Cores.textoSecundario }]}>{tipoTransacao === "receita" ? "A Receber" : "A Pagar"}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              <TextInput style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, color: Cores.textoPrincipal }]} placeholder="Descrição" placeholderTextColor={Cores.textoSecundario} value={descTransacao} onChangeText={setDescTransacao} />

              <TouchableOpacity style={[styles.input, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda, flexDirection: "row", alignItems: "center" }]} onPress={() => setMostrarCalendario(true)}>
                <MaterialIcons name="calendar-today" size={20} color={Cores.textoSecundario} style={{ marginRight: 8 }} />
                <Text style={[styles.datePickerText, { color: Cores.textoPrincipal }]}>{formatarDataBR(dataSelecionada)}</Text>
              </TouchableOpacity>
              {mostrarCalendario && <DateTimePicker value={dataSelecionada} mode="date" display="default" onChange={aoMudarData} />}
              <View style={styles.rowInputs}>
                <View style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, flexDirection: "row", alignItems: "center", flex: 1 }]}>
                  <Text style={{ color: Cores.textoSecundario, fontSize: 16, marginRight: 4 }}>R$</Text>
                  <TextInput style={{ flex: 1, color: Cores.textoPrincipal, fontSize: 16 }} placeholder="0,00" placeholderTextColor={Cores.textoSecundario} value={valorTransacao} onChangeText={(texto) => setValorTransacao(formatarEntradaMoeda(texto))} keyboardType="number-pad" selectTextOnFocus />
                </View>
              </View>
              {frequencia === "parcelada" && (
                <>
                  <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>O valor informado representa:</Text>
                  <View style={[styles.typeSelector, { borderColor: Cores.borda }]}>
                    {(["parcela", "total"] as const).map((modo) => (
                      <TouchableOpacity key={modo} style={[styles.freqButton, { backgroundColor: Cores.pillFundo }, modoValorParcelado === modo && { backgroundColor: Cores.pillAtivo, borderBottomWidth: 3, borderColor: Cores.textoPrincipal }]} onPress={() => setModoValorParcelado(modo)}>
                        <Text style={[styles.freqButtonText, { color: modoValorParcelado === modo ? Cores.textoPrincipal : Cores.textoSecundario }]}>{modo === "parcela" ? "Valor da parcela" : "Valor total"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Número de parcelas:</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, color: Cores.textoPrincipal }]}
                    placeholder="Ex: 3"
                    placeholderTextColor={Cores.textoSecundario}
                    value={numParcelas}
                    onChangeText={setNumParcelas}
                    keyboardType="numeric"
                  />
                </>
              )}
              {frequencia === "parcelada" && valorTransacao && numParcelas && valorDaEntradaMoeda(valorTransacao) > 0 && !isNaN(parseInt(numParcelas)) && (
                <Text style={{ color: Cores.textoSecundario, fontSize: 12, marginTop: -10, marginBottom: 10, textAlign: "right" }}>
                  {modoValorParcelado === "parcela"
                    ? `Total: ${fmtReais(valorDaEntradaMoeda(valorTransacao) * parseInt(numParcelas))}`
                    : `${parseInt(numParcelas)}x de ${fmtReais(valorDaEntradaMoeda(valorTransacao) / parseInt(numParcelas))}`}
                </Text>
              )}

              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>{tipoTransacao === "transferencia" ? "Conta de Origem (Sai):" : "Qual Conta?"}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
                {contas.filter(c => !c.arquivado).map((conta) => (
                  <TouchableOpacity key={conta.id} style={[styles.catPill, { backgroundColor: Cores.pillFundo }, contaSelecionadaId === conta.id && { borderColor: "#457B9D", borderWidth: 2 }]} onPress={() => setContaSelecionadaId(conta.id)}>
                    <MaterialIcons name="account-balance-wallet" size={16} color={contaSelecionadaId === conta.id ? "#457B9D" : Cores.textoSecundario} style={{ marginRight: 6 }} />
                    <Text style={{ color: Cores.textoPrincipal }}>{conta.nome}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {tipoTransacao === "transferencia" ? (
                <>
                  <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Conta de Destino (Entra):</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
                    {contas.filter(c => !c.arquivado).map((conta) => (
                      <TouchableOpacity key={`dest-${conta.id}`} style={[styles.catPill, { backgroundColor: Cores.pillFundo }, !caixinhaDestinoId && contaDestinoId === conta.id && { borderColor: "#2A9D8F", borderWidth: 2 }]} onPress={() => { setContaDestinoId(conta.id); setCaixinhaDestinoId(null); }}>
                        <MaterialIcons name="account-balance-wallet" size={16} color={!caixinhaDestinoId && contaDestinoId === conta.id ? "#2A9D8F" : Cores.textoSecundario} style={{ marginRight: 6 }} />
                        <Text style={{ color: Cores.textoPrincipal }}>{conta.nome}</Text>
                      </TouchableOpacity>
                    ))}
                    {caixinhas.map((caixa) => (
                      <TouchableOpacity key={`caixa-dest-${caixa.id}`} style={[styles.catPill, { backgroundColor: Cores.pillFundo }, caixinhaDestinoId === caixa.id && { borderColor: caixa.cor, borderWidth: 2 }]} onPress={() => { setCaixinhaDestinoId(caixa.id); setContaDestinoId(null); }}>
                        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: caixa.cor, alignItems: "center", justifyContent: "center", marginRight: 6 }}>
                          <MaterialIcons name={caixa.icone as any} size={11} color="#FFF" />
                        </View>
                        <Text style={{ color: Cores.textoPrincipal }}>{caixa.nome}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              ) : (
                <>
                  <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Categoria:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
                    {categorias.filter((c) => c.ativa !== 0 && c.tipo === tipoTransacao).map((cat) => (
                      <TouchableOpacity key={cat.id} style={[styles.catPill, { backgroundColor: Cores.pillFundo }, catSelecionadaId === cat.id && { borderColor: cat.cor, borderWidth: 2 }]} onPress={() => setCatSelecionadaId(cat.id)}>
                        <View style={[styles.colorDot, { backgroundColor: cat.cor }]} />
                        <Text style={{ color: Cores.textoPrincipal }}>{cat.nome}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

              <View style={styles.modalButtons}>
                <Button title="Cancelar" color="#999" onPress={() => setModalTransVisivel(false)} disabled={loadingTrans} />
                <Button title={loadingTrans ? "Aguarde..." : (!foiPago || frequencia !== "unica" ? "Agendar" : "Registrar")} color="#2A9D8F" onPress={salvarTransacao} disabled={loadingTrans} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal animationType="fade" transparent visible={modalIaEmBreve} onRequestClose={() => setModalIaEmBreve(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, maxWidth: 390, alignItems: "center", borderTopWidth: 4, borderTopColor: "#7C6FF0" }]}>
            <View style={{ width: 68, height: 68, borderRadius: 24, backgroundColor: "#7C6FF022", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <MaterialIcons name="auto-awesome" size={36} color="#7C6FF0" />
            </View>
            <Text style={[styles.modalTitle, { color: Cores.textoPrincipal, marginBottom: 8 }]}>IA FinFlow</Text>
            <View style={{ backgroundColor: "#7C6FF022", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 14 }}>
              <Text style={{ color: "#7C6FF0", fontWeight: "900", letterSpacing: 1 }}>EM BREVE</Text>
            </View>
            <Text style={{ color: Cores.textoSecundario, textAlign: "center", lineHeight: 21, marginBottom: 20 }}>
              Estamos preparando um assistente financeiro inteligente, seguro e realmente útil para sua rotina.
            </Text>
            <TouchableOpacity style={{ width: "100%", minHeight: 50, borderRadius: 12, backgroundColor: "#7C6FF0", alignItems: "center", justifyContent: "center" }} onPress={() => setModalIaEmBreve(false)}>
              <Text style={{ color: "#FFF", fontWeight: "800" }}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, padding: 20, marginTop: 10 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  greeting: { fontSize: 24, fontWeight: "bold" },
  subtitle: { fontSize: 14, marginTop: 2 },
  iaBotaoFixo: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1D3557",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 5,
    marginLeft: 10,
  },
  iaBotaoTexto: { color: "#FFF", fontWeight: "bold", fontSize: 13 },
  actionGrid: { marginBottom: 20, gap: 10 },
  actionRow: { flexDirection: "row", gap: 10 },
  actionButton: { flex: 1, flexDirection: "row", paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  actionButtonFull: { flexDirection: "row", paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  faturaVencidaBadge: {
    position: "absolute", right: 8, top: 6, width: 20, height: 20,
    borderRadius: 10, backgroundColor: "#DC2626", borderWidth: 2, borderColor: "#FFF",
    alignItems: "center", justifyContent: "center",
  },
  faturaVencidaBadgeText: { color: "#FFF", fontSize: 12, fontWeight: "900", lineHeight: 14 },
  actionButtonText: { color: "#FFF", fontWeight: "bold", fontSize: 14 },
  mesBotao: { padding: 8, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 20 },
  mesBotaoModal: { padding: 8, backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 20 },
  mesItem: { width: "23%", alignItems: "center", paddingVertical: 10, borderRadius: 8, marginBottom: 8 },
  balanceCard: { backgroundColor: "#1A1A1A", padding: 20, borderRadius: 16, marginBottom: 20, elevation: 4 },
  balanceTitle: { color: "#999", fontSize: 14, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 },
  balanceAmount: { color: "#FFF", fontSize: 36, fontWeight: "bold", marginTop: 5 },
  section: { marginBottom: 25 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15 },
  sectionTitle: { fontSize: 18, fontWeight: "bold" },
  hintText: { fontSize: 12, fontStyle: "italic" },
  emptyText: { fontStyle: "italic", textAlign: "center", marginTop: 10 },
  accountsGrid: { gap: 10 },
  accountCard: { padding: 20, borderRadius: 12, minWidth: "100%", elevation: 2 },
  accountName: { fontSize: 16, fontWeight: "600" },
  accountBalance: { fontSize: 20, fontWeight: "bold", marginTop: 4 },
  addContaBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, gap: 4 },
  addContaBtnText: { color: "#FFF", fontWeight: "bold", fontSize: 13 },
  graficoCard: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 15 },
  graficoTitulo: { fontSize: 14, fontWeight: "bold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.7)", justifyContent: "center", alignItems: "center" },
modalContent: { width: "95%", padding: 20, borderRadius: 16, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: "bold", marginBottom: 15, textAlign: "center" },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 15 },
  datePickerText: { fontSize: 16, fontWeight: "500" },
  rowInputs: { flexDirection: "row", justifyContent: "space-between" },
  colorLabel: { fontSize: 14, fontWeight: "500", marginBottom: 10 },
  colorPalette: { flexDirection: "row", gap: 8, paddingRight: 12, marginBottom: 20 },
  colorOption: { width: 35, height: 35, borderRadius: 17.5 },
  iconeOpcao: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  modalButtons: { flexDirection: "row", justifyContent: "space-around", marginTop: 20 },
  typeSelector: { flexDirection: "row", marginBottom: 15, borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  typeButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  typeButtonText: { fontWeight: "bold", fontSize: 14, textAlign: "center" },
  expenseSelected: { backgroundColor: "#E76F51" },
  incomeSelected: { backgroundColor: "#2A9D8F" },
  transferSelected: { backgroundColor: "#457B9D" },
  freqButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  freqButtonText: { fontSize: 12, fontWeight: "600", textAlign: "center" },
  catScroll: { flexDirection: "row", marginBottom: 15 },
  catPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20, marginRight: 10 },
  colorDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  catGerenciarRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 10, marginBottom: 8 },
  iconeBotao: { padding: 6 },
  botaoApagar: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#E76F51", padding: 12, borderRadius: 8, gap: 6 },
  botaoApagarTexto: { color: "#FFF", fontWeight: "bold" },
});
