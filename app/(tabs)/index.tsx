import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  DeviceEventEmitter,
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

import { IS_LOCAL_DEMO, supabase } from "../../lib/supabase";
import { isInvoicePaymentAdjustment } from "../../lib/invoice-operations";
import { useAppTheme } from "../_layout";
import { agendarNotificacoesDoApp } from "../../lib/notifications";
import { usuarioPodeAcessarIA } from "../../constants/features";
import { fmtReais, formatarEntradaMoeda, valorDaEntradaMoeda } from "../../lib/utils";
import { FinFlowColors, FinFlowRadius, FinFlowShadow, finFlowTheme } from "../../constants/finflow-design";
import Button from "../../components/FinFlowButton";
import {
  dispositivoSemConexao,
  mensagemFalhaEdicaoOffline,
  OFFLINE_EDIT_SAVED_MESSAGE,
  OFFLINE_SAVED_MESSAGE,
  OFFLINE_SYNC_COMPLETED_EVENT,
  salvarCriacaoFinanceira,
  salvarEdicaoFinanceira,
} from "../../lib/offline-sync";
import {
  adicionarRecorrencia,
  adicionarIdSerie,
  dataEfetivaTransacao,
  descricaoTransferencia,
  descricaoTransferenciaObjetivo,
  getContaDestinoTransferencia,
  isMovimentoObjetivo,
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
  version?: number;
}
interface Conta {
  id: number;
  user_id?: string;
  nome: string;
  saldo_inicial: number;
  compartilhado: boolean;
  cor?: string;
  arquivado?: boolean;
  bloqueado_plano?: boolean;
  version?: number;
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
  transacao_pai_id?: number | null;
}

interface CompraCartao {
  id: number;
  cartao_id: number;
  descricao: string;
  valor: number;
  data_compra: string;
  mes_fatura: string;
  pago: boolean;
  categoria_id: number | null;
}

interface DadoDistribuicaoCategoria {
  cor: string;
  valor: number;
  nome: string;
  icone?: string;
}

type TipoFinanceiro = "receita" | "despesa";

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

type CacheHomeEmMemoria = {
  categorias: Categoria[];
  contas: Conta[];
  transacoes: Transacao[];
  caixinhas: Caixinha[];
  temParceiro: boolean;
};

// O cache financeiro vive somente no processo. AsyncStorage não é cifrado no
// dispositivo e não deve conter saldos, contas ou lançamentos.
const cacheHomePorUsuario = new Map<string, CacheHomeEmMemoria>();
const CHAVES_CACHE_HOME_LEGADO = [
  "@cache_categorias",
  "@cache_contas",
  "@cache_transacoes",
  "@cache_caixinhas",
  "@cache_parceiro",
  "@finflow_demo:cache_categorias",
  "@finflow_demo:cache_contas",
  "@finflow_demo:cache_transacoes",
  "@finflow_demo:cache_caixinhas",
  "@finflow_demo:cache_parceiro",
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

const isPagamentoFatura = (descricao?: string | null) =>
  (descricao ?? "").includes("[PagFatura:");

const mesesEmPortugues = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

// Gráfico de barras horizontais por categoria
const BarChartCategorias = React.memo(function BarChartCategorias({ dados, total, isDark, valoresVisiveis }: { dados: DadoDistribuicaoCategoria[]; total: number; isDark: boolean; valoresVisiveis: boolean }) {
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
                  {valoresVisiveis ? fmtReais(item.valor) : "R$ ••••••"}
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
});

export default function Dashboard() {
  const { isDark, session, showToast, notificacoesAtivas, verificarLimite, temPopupPrioritario, limites, limitsEnabled } = useAppTheme();
  const iaDisponivel = usuarioPodeAcessarIA(
    limitsEnabled && limites.iaOperacional,
    limitsEnabled,
  );
  const alertaVencidoMostrado = useRef(false);
  const router = useRouter();
  const novoTema = finFlowTheme(isDark);

  const Cores = {
    fundo: novoTema.background,
    textoPrincipal: novoTema.text,
    textoSecundario: novoTema.textMuted,
    cardFundo: novoTema.surface,
    borda: novoTema.border,
    inputFundo: novoTema.surfaceMuted,
    pillFundo: novoTema.surfaceMuted,
    pillAtivo: novoTema.primarySoft,
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
  const corTipoTransacao = tipoTransacao === "despesa"
    ? "#E76F51"
    : tipoTransacao === "receita"
      ? "#2A9D8F"
      : "#457B9D";

  const [modalResumoVisivel, setModalResumoVisivel] = useState(false);
  const [modalBalancoAtualVisivel, setModalBalancoAtualVisivel] = useState(false);
  const [modalNotificacoesHome, setModalNotificacoesHome] = useState(false);
  // Começa oculto para uma preferência salva como privada nunca piscar na tela.
  const [valoresVisiveis, setValoresVisiveis] = useState(false);
  const [assinaturaAvisosVisualizada, setAssinaturaAvisosVisualizada] = useState("");
  const [leituraAvisosCarregada, setLeituraAvisosCarregada] = useState(false);
  const [modalContasHomeVisivel, setModalContasHomeVisivel] = useState(false);
  const [contasSelecionadasHomeIds, setContasSelecionadasHomeIds] = useState<number[] | null>(null);
  const [contasHomeRascunhoIds, setContasHomeRascunhoIds] = useState<number[]>([]);
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  const [modoDistribuicao, setModoDistribuicao] = useState<"previstos" | "concluidos">("concluidos");
  const [comprasCartao, setComprasCartao] = useState<CompraCartao[]>([]);
  const [temFaturaVencida, setTemFaturaVencida] = useState(false);
  const [modalVencidosVisivel, setModalVencidosVisivel] = useState(false);
  const [confirmarEdicaoSaldo, setConfirmarEdicaoSaldo] = useState(false);
  const [qtdVencidas, setQtdVencidas] = useState(0);

  // --- Cálculos ---
  const contasAtivas = useMemo(() => contas.filter((conta) => !conta.arquivado), [contas]);
  const contasArquivadas = useMemo(() => contas.filter((conta) => conta.arquivado), [contas]);
  const idsAtivosHome = useMemo(() => new Set(contasAtivas.map((conta) => conta.id)), [contasAtivas]);
  const idsSelecionadosHomeValidos = useMemo(
    () => contasSelecionadasHomeIds?.filter((id) => idsAtivosHome.has(id)) ?? null,
    [contasSelecionadasHomeIds, idsAtivosHome],
  );
  const escopoHomeEhTodas = idsSelecionadosHomeValidos === null
    || idsSelecionadosHomeValidos.length === contasAtivas.length
    || (contasAtivas.length > 0 && idsSelecionadosHomeValidos.length === 0);
  const contasEscopoHome = useMemo(() => {
    if (escopoHomeEhTodas) return contasAtivas;
    const idsSelecionados = new Set(idsSelecionadosHomeValidos);
    return contasAtivas.filter((conta) => idsSelecionados.has(conta.id));
  }, [contasAtivas, escopoHomeEhTodas, idsSelecionadosHomeValidos]);
  const contasEscopoHomeIds = useMemo(
    () => new Set(contasEscopoHome.map((conta) => conta.id)),
    [contasEscopoHome],
  );
  const contasHomeRascunhoIdsValidos = useMemo(
    () => contasHomeRascunhoIds.filter((id) => idsAtivosHome.has(id)),
    [contasHomeRascunhoIds, idsAtivosHome],
  );
  const todasContasHomeRascunhoSelecionadas = contasAtivas.length > 0
    && contasHomeRascunhoIdsValidos.length === contasAtivas.length;
  const podeAplicarContasHome = contasHomeRascunhoIdsValidos.length > 0;
  const chaveContasAtivasHome = useMemo(
    () => contasAtivas.map((conta) => conta.id).sort((a, b) => a - b).join(","),
    [contasAtivas],
  );

  React.useEffect(() => {
    if (!modalContasHomeVisivel) return;
    setContasHomeRascunhoIds((idsAtuais) => {
      if (contasSelecionadasHomeIds === null) return contasAtivas.map(conta => conta.id);
      return idsAtuais.filter(id => idsAtivosHome.has(id));
    });
    // A chave muda somente quando uma conta é criada, arquivada ou reativada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveContasAtivasHome, modalContasHomeVisivel, contasSelecionadasHomeIds]);

  // Uma transferência interna ao conjunto selecionado se anula. Quando apenas
  // uma das pontas está no conjunto, ela representa uma saída ou entrada real
  // para a visão dessas contas.
  const transacoesEscopoHome = useMemo(() => transacoes.flatMap((transacao) => {
    const destinoId = getContaDestinoTransferencia(transacao.descricao);
    if (destinoId !== null) {
      const origemSelecionada = contasEscopoHomeIds.has(transacao.conta_id);
      const destinoSelecionado = contasEscopoHomeIds.has(destinoId);
      if (origemSelecionada === destinoSelecionado) return [];
      if (origemSelecionada) return [transacao];
      return [{ ...transacao, tipo: "receita", conta_id: destinoId }];
    }

    // Guardar ou resgatar de um objetivo afeta somente a conta de origem.
    // É uma movimentação interna, mas precisa continuar compondo o saldo dela.
    if (isMovimentoObjetivo(transacao.descricao)) {
      return contasEscopoHomeIds.has(transacao.conta_id) ? [transacao] : [];
    }

    // Transferências legadas não informam o destino. A linha da conta é
    // segura em uma seleção individual; em um consolidado, seria duplicada.
    if (isTransferencia(transacao.descricao)) {
      return contasEscopoHome.length === 1 && contasEscopoHomeIds.has(transacao.conta_id)
        ? [transacao]
        : [];
    }

    return contasEscopoHomeIds.has(transacao.conta_id) ? [transacao] : [];
  }), [contasEscopoHome.length, contasEscopoHomeIds, transacoes]);

  const {
    saldoAtualGlobal,
    transacoesFinanceirasDoMes,
    comprasCartaoDoMes,
    receitasDoMes,
    despesasDoMes,
    balancoMensal,
    saldoPrevistoFimDoMes,
  } = useMemo(() => {
    const mesSelecionado = mesAtual.getMonth();
    const anoSelecionado = mesAtual.getFullYear();
    const ultimoDiaMesSelecionado = new Date(anoSelecionado, mesSelecionado + 1, 0).getDate();
    const dataFimMesSelecionado = `${anoSelecionado}-${String(mesSelecionado + 1).padStart(2, "0")}-${String(ultimoDiaMesSelecionado).padStart(2, "0")}`;
    const saldoInicialTotal = contasEscopoHome.reduce((total, conta) => total + Number(conta.saldo_inicial), 0);
    const financeirasDoMes: Transacao[] = [];
    let receitasRealizadas = 0;
    let despesasRealizadas = 0;
    let entradasMes = 0;
    let saidasMes = 0;
    let entradasRealizadasMes = 0;
    let saidasRealizadasMes = 0;
    let saldoPrevisto = saldoInicialTotal;

    transacoesEscopoHome.forEach((transacao) => {
      const valor = Number(transacao.valor);
      if (transacao.status === "paga" && Number.isFinite(valor)) {
        if (transacao.tipo === "receita") receitasRealizadas += valor;
        if (transacao.tipo === "despesa") despesasRealizadas += valor;
      }

      if (transacao.status === "paga" || transacao.status === "pendente") {
        const dataConsiderada = dataEfetivaTransacao(transacao).slice(0, 10);
        if (dataConsiderada && dataConsiderada <= dataFimMesSelecionado && Number.isFinite(valor)) {
          saldoPrevisto += transacao.tipo === "receita" ? valor : -valor;
        }
      }

      const dataTransacao = new Date(dataEfetivaTransacao(transacao));
      const dataAjustada = new Date(dataTransacao.getTime() + dataTransacao.getTimezoneOffset() * 60000);
      if (dataAjustada.getMonth() !== mesSelecionado || dataAjustada.getFullYear() !== anoSelecionado) return;
      if ((escopoHomeEhTodas && isPagamentoFatura(transacao.descricao)) || isMovimentoObjetivo(transacao.descricao)) return;

      financeirasDoMes.push(transacao);
      if (!Number.isFinite(valor)) return;
      if (transacao.tipo === "receita") {
        entradasMes += valor;
        if (transacao.status === "paga") entradasRealizadasMes += valor;
      } else if (transacao.tipo === "despesa") {
        saidasMes += valor;
        if (transacao.status === "paga") saidasRealizadasMes += valor;
      }
    });

    // As compras do cartão ainda não possuem conta vinculada no banco e só
    // entram na visão consolidada, evitando atribuição incorreta a uma conta.
    const prefixoMes = `${anoSelecionado}-${String(mesSelecionado + 1).padStart(2, "0")}`;
    const comprasDoMes = escopoHomeEhTodas
      ? comprasCartao.filter((item) => item.mes_fatura === prefixoMes && !isInvoicePaymentAdjustment(item.descricao))
      : [];

    return {
      saldoAtualGlobal: saldoInicialTotal + receitasRealizadas - despesasRealizadas,
      transacoesFinanceirasDoMes: financeirasDoMes,
      comprasCartaoDoMes: comprasDoMes,
      receitasDoMes: entradasMes,
      despesasDoMes: saidasMes,
      balancoMensal: entradasRealizadasMes - saidasRealizadasMes,
      saldoPrevistoFimDoMes: saldoPrevisto,
    };
  }, [comprasCartao, contasEscopoHome, escopoHomeEhTodas, mesAtual, transacoesEscopoHome]);

  const { transacoesVencidasHome, transacoesHojeHome, transacoesProximasHome } = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const limite = new Date(hoje);
    limite.setDate(limite.getDate() + 7);
    const vencidas: Transacao[] = [];
    const hojePendentes: Transacao[] = [];
    const proximas: Transacao[] = [];

    transacoesEscopoHome.forEach((transacao) => {
      if (transacao.status !== "pendente") return;
      const [ano, mes, dia] = transacao.data_vencimento.split("-").map(Number);
      const vencimento = new Date(ano, mes - 1, dia);
      if (vencimento < hoje) vencidas.push(transacao);
      else if (vencimento.getTime() === hoje.getTime()) hojePendentes.push(transacao);
      else if (vencimento <= limite) proximas.push(transacao);
    });

    return {
      transacoesVencidasHome: vencidas,
      transacoesHojeHome: hojePendentes,
      transacoesProximasHome: proximas,
    };
  }, [transacoesEscopoHome]);
  const qtdVencidasHome = transacoesVencidasHome.length;
  const qtdVencendoHoje = transacoesHojeHome.length;
  const qtdProximosVencimentos = transacoesProximasHome.length;
  const temFaturaVencidaHome = escopoHomeEhTodas && temFaturaVencida;
  const assinaturaAvisosAtual = useMemo(() => [
    `atrasados:${transacoesVencidasHome.map((transacao) => transacao.id).sort((a, b) => a - b).join(",")}`,
    `hoje:${transacoesHojeHome.map((transacao) => transacao.id).sort((a, b) => a - b).join(",")}`,
    `proximos:${transacoesProximasHome.map((transacao) => transacao.id).sort((a, b) => a - b).join(",")}`,
    `fatura:${temFaturaVencidaHome ? "1" : "0"}`,
  ].join("|"), [temFaturaVencidaHome, transacoesHojeHome, transacoesProximasHome, transacoesVencidasHome]);
  const temAvisosFinanceiros = qtdVencidasHome > 0 || qtdVencendoHoje > 0 || qtdProximosVencimentos > 0 || temFaturaVencidaHome;
  const mostrarBadgeAvisos = leituraAvisosCarregada
    && temAvisosFinanceiros
    && assinaturaAvisosVisualizada !== assinaturaAvisosAtual;

  React.useEffect(() => {
    let efeitoAtivo = true;
    const userId = session?.user?.id;
    setLeituraAvisosCarregada(false);

    if (!userId) {
      setAssinaturaAvisosVisualizada("");
      setLeituraAvisosCarregada(true);
      return () => { efeitoAtivo = false; };
    }

    void AsyncStorage.getItem(`@finflow_avisos_home_visualizados:${userId}`)
      .then((assinaturaSalva) => {
        if (!efeitoAtivo) return;
        setAssinaturaAvisosVisualizada(assinaturaSalva ?? "");
      })
      .catch(() => {
        if (efeitoAtivo) setAssinaturaAvisosVisualizada("");
      })
      .finally(() => {
        if (efeitoAtivo) setLeituraAvisosCarregada(true);
      });

    return () => { efeitoAtivo = false; };
  }, [session?.user?.id]);

  React.useEffect(() => {
    let ativo = true;
    const userId = session?.user?.id;
    // Falha fechado enquanto a preferencia da nova sessao e carregada, evitando
    // um flash com valores da conta anterior durante a troca de usuario.
    setValoresVisiveis(false);
    if (!userId) {
      return () => { ativo = false; };
    }

    void AsyncStorage.getItem(`@finflow_valores_visiveis:${userId}`)
      .then((valor) => {
        if (ativo) setValoresVisiveis(valor !== "false");
      })
      .catch(() => {
        if (ativo) setValoresVisiveis(false);
      });

    return () => { ativo = false; };
  }, [session?.user?.id]);

  // Cada movimentação entra em exatamente um bucket. Assim, categorias
  // arquivadas preservam o histórico e registros legados nunca somem do gráfico.
  const {
    dadosDespesasPorCat,
    dadosReceitasPorCat,
    dadosDespesasPorCatRealizadas,
    dadosReceitasPorCatRealizadas,
    totalDespesasPorCat,
    totalReceitasPorCat,
    totalDespesasPorCatRealizadas,
    totalReceitasPorCatRealizadas,
  } = useMemo(() => {
  const categoriasPorId = new Map(categorias.map((categoria) => [String(categoria.id), categoria]));
  const categoriaCompativel = (categoria: Categoria, tipo: TipoFinanceiro) => {
    const tipoCategoria = (categoria.tipo ?? "").trim().toLocaleLowerCase("pt-BR");
    return tipoCategoria === tipo || tipoCategoria === "ambos";
  };
  const montarDistribuicao = (tipo: TipoFinanceiro, somenteRealizadas: boolean) => {
    const buckets = new Map<string, DadoDistribuicaoCategoria>();

    const somarBucket = (chave: string, dados: Omit<DadoDistribuicaoCategoria, "valor">, valorBruto: number) => {
      const valor = Number(valorBruto);
      if (!Number.isFinite(valor) || valor === 0) return;
      const existente = buckets.get(chave);
      if (existente) {
        existente.valor += valor;
      } else {
        buckets.set(chave, { ...dados, valor });
      }
    };

    const somarSemCategoria = (valor: number) => somarBucket("especial:sem-categoria", {
      nome: "Sem categoria",
      cor: "#6D7280",
      icone: "help-outline",
    }, valor);

    const somarCategoriaOuSemCategoria = (categoriaId: number | null, valor: number) => {
      const categoria = categoriaId == null ? undefined : categoriasPorId.get(String(categoriaId));
      if (!categoria || !categoriaCompativel(categoria, tipo)) {
        somarSemCategoria(valor);
        return;
      }
      somarBucket(`categoria:${categoria.id}`, {
        nome: categoria.nome,
        cor: categoria.cor,
        icone: categoria.icone,
      }, valor);
    };

    transacoesFinanceirasDoMes.forEach((transacao) => {
      if (transacao.tipo !== tipo || (somenteRealizadas && transacao.status !== "paga")) return;

      if (isTransferencia(transacao.descricao)) {
        somarBucket("especial:transferencias", { nome: "Transferências", cor: "#F4A261", icone: "swap-horiz" }, transacao.valor);
        return;
      }
      if (tipo === "despesa" && isPagamentoFatura(transacao.descricao)) {
        somarBucket("especial:fatura", { nome: "Fatura do cartão", cor: "#805AD5", icone: "credit-card" }, transacao.valor);
        return;
      }

      somarCategoriaOuSemCategoria(transacao.categoria_id, transacao.valor);
    });

    // Cada compra/parcela entra na categoria do respectivo mês da fatura. O
    // pagamento bancário da fatura é excluído para não duplicar a despesa.
    if (tipo === "despesa") {
      comprasCartaoDoMes.forEach((item) => somarCategoriaOuSemCategoria(item.categoria_id, Number(item.valor)));
    }

    return [...buckets.values()]
      .filter((item) => item.valor > 0)
      .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR"));
  };

  const dadosDespesasPorCat = montarDistribuicao("despesa", false);
  const dadosReceitasPorCat = montarDistribuicao("receita", false);
  const dadosDespesasPorCatRealizadas = montarDistribuicao("despesa", true);
  const dadosReceitasPorCatRealizadas = montarDistribuicao("receita", true);
  const totalDistribuicao = (dados: DadoDistribuicaoCategoria[]) => dados.reduce((total, item) => total + item.valor, 0);
  const totalDespesasPorCat = totalDistribuicao(dadosDespesasPorCat);
  const totalReceitasPorCat = totalDistribuicao(dadosReceitasPorCat);
  const totalDespesasPorCatRealizadas = totalDistribuicao(dadosDespesasPorCatRealizadas);
  const totalReceitasPorCatRealizadas = totalDistribuicao(dadosReceitasPorCatRealizadas);

  return {
    dadosDespesasPorCat,
    dadosReceitasPorCat,
    dadosDespesasPorCatRealizadas,
    dadosReceitasPorCatRealizadas,
    totalDespesasPorCat,
    totalReceitasPorCat,
    totalDespesasPorCatRealizadas,
    totalReceitasPorCatRealizadas,
  };
  }, [categorias, comprasCartaoDoMes, transacoesFinanceirasDoMes]);

  // --- Dados ---
  const carregarDados = useCallback(async () => {
    if (!session?.user?.id) return;

    try {
      const [resCategorias, resContas, resTransacoes, resParceria, resCaixinhas, resCartoes, resFaturas] = await Promise.all([
        supabase.from("categorias").select("*").eq("user_id", session.user.id),
        supabase.from("contas").select("*"),        // RLS retorna próprias + compartilhadas do parceiro
        supabase.from("transacoes").select("id, tipo, valor, data_vencimento, data_realizacao, descricao, categoria_id, conta_id, status, transacao_pai_id"), // RLS retorna próprias + compartilhadas
        supabase.from("parcerias").select("id, solicitante_id, convidado_id").eq("status", "aceito").or(
          `solicitante_id.eq.${session.user.id},convidado_id.eq.${session.user.id}`
        ),
        supabase.from("caixinhas").select("id, nome, saldo_atual, meta_valor, data_prazo, cor, icone"),
        supabase.from("cartoes").select("id, nome, dia_vencimento, dia_fechamento").eq("user_id", session.user.id).eq("ativo", true),
        supabase.from("fatura_itens").select("id, cartao_id, descricao, valor, data_compra, mes_fatura, categoria_id, pago").eq("user_id", session.user.id),
      ]);

      if (resCategorias.error || resContas.error || resTransacoes.error) throw new Error("Sem conexão");

      const categoriasCarregadas = (resCategorias.data ?? []).map((c: Categoria) => ({ ...c, cor: PALETA_CORES.includes(c.cor) ? c.cor : PALETA_CORES[0] })).sort((a, b) =>
          a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
        );
      const contasCarregadas = (resContas.data ?? []).map((c: Conta) => ({ ...c, cor: c.cor && PALETA_CORES.includes(c.cor) ? c.cor : PALETA_CORES[6] }));
      const transacoesCarregadas = (resTransacoes.data ?? []) as Transacao[];
      const caixinhasCarregadas = (resCaixinhas.data ?? []).map((c: Caixinha) => ({ ...c, cor: PALETA_CORES.includes(c.cor) ? c.cor : PALETA_CORES[0] }));

      setCategorias(categoriasCarregadas);
      setContas(contasCarregadas);
      setTransacoes(transacoesCarregadas);
      setCaixinhas(caixinhasCarregadas);
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
      cacheHomePorUsuario.set(session.user.id, {
        categorias: categoriasCarregadas,
        contas: contasCarregadas,
        transacoes: transacoesCarregadas,
        caixinhas: caixinhasCarregadas,
        temParceiro: temParc,
      });
      void AsyncStorage.multiRemove(CHAVES_CACHE_HOME_LEGADO).catch(() => {});

      // Mantém a central do sino atualizada; o popup automático aparece apenas uma vez.
      if (resTransacoes.data) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const vencidas = resTransacoes.data.filter((t: any) => {
          if (t.status !== "pendente") return false;
          const partes = (t.data_vencimento || "").split("-");
          const dataT = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
          return dataT < hoje;
        });
        setQtdVencidas(vencidas.length);
        if (!alertaVencidoMostrado.current && vencidas.length > 0) {
          alertaVencidoMostrado.current = true;
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
      const cache = cacheHomePorUsuario.get(session.user.id);
      if (cache) {
        setCategorias(cache.categorias);
        setContas(cache.contas);
        setTransacoes(cache.transacoes);
        setCaixinhas(cache.caixinhas);
        setTemParceiro(cache.temParceiro);
      } else {
        setCategorias([]);
        setContas([]);
        setTransacoes([]);
        setCaixinhas([]);
        setComprasCartao([]);
        setTemParceiro(false);
      }
      void AsyncStorage.multiRemove(CHAVES_CACHE_HOME_LEGADO).catch(() => {});
      setIsOffline(true);
    }
  }, [notificacoesAtivas, session?.user?.id]);

  useFocusEffect(useCallback(() => { carregarDados(); }, [carregarDados]));

  React.useEffect(() => {
    const subscription = DeviceEventEmitter.addListener("finflow:categorias-padrao-prontas", () => {
      void carregarDados();
    });
    const offlineSubscription = DeviceEventEmitter.addListener(OFFLINE_SYNC_COMPLETED_EVENT, () => {
      void carregarDados();
    });
    return () => {
      subscription.remove();
      offlineSubscription.remove();
    };
  }, [carregarDados]);

  const { saldoPorConta, contasComLancamentos } = useMemo(() => {
    const saldos = new Map<number, number>();
    const contasComMovimento = new Set<number>();

    contas.forEach((conta) => saldos.set(conta.id, Number(conta.saldo_inicial)));
    transacoes.forEach((transacao) => {
      const destinoId = getContaDestinoTransferencia(transacao.descricao);
      contasComMovimento.add(transacao.conta_id);
      if (destinoId !== null) contasComMovimento.add(destinoId);
      if (transacao.status !== "paga") return;

      const valor = Number(transacao.valor);
      if (!Number.isFinite(valor)) return;
      const saldoOrigem = saldos.get(transacao.conta_id) ?? 0;
      if (transacao.tipo === "receita") saldos.set(transacao.conta_id, saldoOrigem + valor);
      else if (transacao.tipo === "despesa") saldos.set(transacao.conta_id, saldoOrigem - valor);

      if (destinoId !== null) {
        saldos.set(destinoId, (saldos.get(destinoId) ?? 0) + valor);
      }
    });

    return { saldoPorConta: saldos, contasComLancamentos: contasComMovimento };
  }, [contas, transacoes]);

  const calcularSaldoConta = useCallback(
    (conta: Conta) => saldoPorConta.get(conta.id) ?? Number(conta.saldo_inicial),
    [saldoPorConta],
  );

  const contaPossuiLancamentos = useCallback(
    (contaId: number) => contasComLancamentos.has(contaId),
    [contasComLancamentos],
  );

  // --- Ações de Categoria ---
  const salvarCategoria = async () => {
    if (nomeCategoria.trim() === "") return Alert.alert("Aviso", "Escreve um nome.");
    // Verificar limite do plano para categorias
    const catDoTipo = categorias.filter(c => c.tipo === tipoNovaCategoria && c.ativa !== 0).length;
    const tipoLimite = tipoNovaCategoria === "receita" ? "categoriasReceita" : "categoriasDespesa";
    if (!verificarLimite(tipoLimite, catDoTipo)) return;
    setLoadingCat(true);
    if (!IS_LOCAL_DEMO) {
      try {
        const resultado = await salvarCriacaoFinanceira("create_category", {
          name: nomeCategoria.trim(),
          type: tipoNovaCategoria,
          color: corSelecionada,
          icon: iconeSelecionado,
        });
        setLoadingCat(false);
        if (resultado.state === "rejected") {
          return Alert.alert("Não foi possível salvar", "A categoria foi recusada pelo servidor. Revise os dados e tente novamente.");
        }
        if (resultado.state === "uncertain") {
          return Alert.alert("Sessão alterada", "Não foi possível confirmar a categoria. Entre novamente e confira seus dados antes de reenviar.");
        }
        setNomeCategoria("");
        setTipoNovaCategoria("despesa");
        setIconeSelecionado("label");
        setModalCatVisivel(false);
        if (resultado.state === "queued") showToast(OFFLINE_SAVED_MESSAGE, "info");
        else void carregarDados();
        return;
      } catch {
        setLoadingCat(false);
        return Alert.alert("Não foi possível salvar", "A categoria não pôde ser salva no dispositivo. Tente novamente.");
      }
    }
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
    if (!IS_LOCAL_DEMO) {
      const changes: Record<string, unknown> = {};
      if (nomeEditCat.trim() !== catEditando.nome) changes.name = nomeEditCat.trim();
      if (corEditCat !== catEditando.cor) changes.color = corEditCat;
      if (iconeEditCat !== catEditando.icone) changes.icon = iconeEditCat;
      if (Object.keys(changes).length === 0) {
        setCatEditando(null);
        return;
      }
      try {
        const resultado = await salvarEdicaoFinanceira(
          "update_category",
          catEditando.id,
          Number(catEditando.version),
          changes,
        );
        if (resultado.state === "rejected") {
          return Alert.alert("Não foi possível salvar", mensagemFalhaEdicaoOffline(resultado.errorCode));
        }
        if (resultado.state === "uncertain") {
          return Alert.alert("Sessão alterada", "Não foi possível confirmar a edição. Entre novamente e confira os dados antes de reenviar.");
        }
        setCatEditando(null);
        if (resultado.state === "queued") showToast(OFFLINE_EDIT_SAVED_MESSAGE, "info");
        else void carregarDados();
        return;
      } catch {
        return Alert.alert("Não foi possível salvar", "A edição não pôde ser protegida neste dispositivo. Tente novamente.");
      }
    }
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
    const [referenciasTransacoes, referenciasCartao] = await Promise.all([
      supabase.from("transacoes").select("id", { count: "exact", head: true }).eq("categoria_id", cat.id),
      supabase.from("fatura_itens").select("id", { count: "exact", head: true }).eq("categoria_id", cat.id),
    ]);

    if (referenciasTransacoes.error || referenciasCartao.error) {
      return Alert.alert("Não foi possível verificar", "Confira sua conexão e tente excluir a categoria novamente.");
    }

    const totalReferencias = (referenciasTransacoes.count ?? 0) + (referenciasCartao.count ?? 0);

    if (totalReferencias > 0) {
      Alert.alert(
        "Categoria com lançamentos",
        `A categoria "${cat.nome}" possui lançamentos vinculados. Por segurança, ela será apenas arquivada.\n\nOs lançamentos atuais continuarão nesta categoria e não serão movidos para "Outros".`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Arquivar",
            onPress: async () => {
              const { error } = await supabase.from("categorias").update({ ativa: 0 }).eq("id", cat.id);
              if (error) return Alert.alert("Erro", "Não foi possível arquivar a categoria.");
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
            const { error } = await supabase.from("categorias").delete().eq("id", cat.id);
            if (error) return Alert.alert("Erro", "Não foi possível apagar a categoria.");
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
    const saldoNum = valorDaEntradaMoeda(saldoInicialConta);
    if (!Number.isFinite(saldoNum) || saldoNum < 0) {
      setLoadingConta(false);
      return Alert.alert("Aviso", "Saldo inicial inválido.");
    }
    if (!IS_LOCAL_DEMO && !contaCompartilhada) {
      try {
        const resultado = await salvarCriacaoFinanceira("create_account", {
          name: nomeConta.trim(),
          initial_balance: saldoNum,
          color: corNovaConta,
        });
        setLoadingConta(false);
        if (resultado.state === "rejected") {
          return Alert.alert("Não foi possível salvar", "A conta foi recusada pelo servidor. Revise os dados e tente novamente.");
        }
        if (resultado.state === "uncertain") {
          return Alert.alert("Sessão alterada", "Não foi possível confirmar a conta. Entre novamente e confira seus dados antes de reenviar.");
        }
        setNomeConta("");
        setSaldoInicialConta("");
        setContaCompartilhada(false);
        setCorNovaConta(PALETA_CORES[6]);
        setModalContaVisivel(false);
        if (resultado.state === "queued") showToast(OFFLINE_SAVED_MESSAGE, "info");
        else void carregarDados();
        return;
      } catch {
        setLoadingConta(false);
        return Alert.alert("Não foi possível salvar", "A conta não pôde ser salva no dispositivo. Tente novamente.");
      }
    }
    if (!IS_LOCAL_DEMO && contaCompartilhada && await dispositivoSemConexao()) {
      setLoadingConta(false);
      return Alert.alert(
        "Conexão necessária",
        "Contas compartilhadas ainda não podem ser salvas offline. Reconecte e tente novamente.",
      );
    }
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
    setModalContasHomeVisivel(false);
    setContaEditando(conta);
    setNomeEditConta(conta.nome);
    setSaldoEditConta(formatarEntradaMoeda(String(Math.round(Number(conta.saldo_inicial) * 100))));
    setCompartilhadoEditConta(conta.compartilhado);
    setCorEditConta(conta.cor && PALETA_CORES.includes(conta.cor) ? conta.cor : PALETA_CORES[6]);
    setEditandoSaldoConta(false);
    setModalEditarContaVisivel(true);
  };

  const salvarEdicaoConta = async () => {
    if (!contaEditando || nomeEditConta.trim() === "") return Alert.alert("Aviso", "Nome inválido.");
    const base: any = { nome: nomeEditConta, compartilhado: compartilhadoEditConta };
    let saldoNumEditado: number | null = null;
    if (editandoSaldoConta) {
      const saldoNum = valorDaEntradaMoeda(saldoEditConta);
      if (isNaN(saldoNum)) return Alert.alert("Aviso", "Saldo inválido.");
      base.saldo_inicial = saldoNum;
      saldoNumEditado = saldoNum;
    }

    if (!IS_LOCAL_DEMO) {
      const contaDoUsuarioAtual = contaEditando.user_id === session.user.id;
      const compartilhamentoAlterado = compartilhadoEditConta !== contaEditando.compartilhado;
      if (contaDoUsuarioAtual && !compartilhamentoAlterado) {
        const changes: Record<string, unknown> = {};
        if (nomeEditConta.trim() !== contaEditando.nome) changes.name = nomeEditConta.trim();
        if (corEditConta !== contaEditando.cor) changes.color = corEditConta;
        if (saldoNumEditado !== null && saldoNumEditado !== Number(contaEditando.saldo_inicial)) {
          changes.initial_balance = saldoNumEditado;
        }
        if (Object.keys(changes).length === 0) {
          setModalEditarContaVisivel(false);
          setContaEditando(null);
          setEditandoSaldoConta(false);
          return;
        }
        try {
          const resultado = await salvarEdicaoFinanceira(
            "update_account",
            contaEditando.id,
            Number(contaEditando.version),
            changes,
          );
          if (resultado.state === "rejected") {
            return Alert.alert("Não foi possível salvar", mensagemFalhaEdicaoOffline(resultado.errorCode));
          }
          if (resultado.state === "uncertain") {
            return Alert.alert("Sessão alterada", "Não foi possível confirmar a edição. Entre novamente e confira os dados antes de reenviar.");
          }
          setContaConfirmarArquivo(null);
          setModalEditarContaVisivel(false);
          setContaEditando(null);
          setEditandoSaldoConta(false);
          if (resultado.state === "queued") showToast(OFFLINE_EDIT_SAVED_MESSAGE, "info");
          else void carregarDados();
          return;
        } catch {
          return Alert.alert("Não foi possível salvar", "A edição não pôde ser protegida neste dispositivo. Tente novamente.");
        }
      }

      if (await dispositivoSemConexao()) {
        return Alert.alert(
          "Conexão necessária",
          compartilhamentoAlterado
            ? "Alterar o compartilhamento da conta exige conexão para revalidar as permissões."
            : "Esta conta compartilhada pertence a outro usuário e só pode ser editada com conexão.",
        );
      }
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
    const temLancamentos = contaPossuiLancamentos(conta.id);
    setModalEditarContaVisivel(false);
    setContaConfirmarArquivo({ conta, saldoAtual, temLancamentos });
  };

  const excluirContaSemLancamentos = async (conta: Conta) => {
    if (contaPossuiLancamentos(conta.id)) {
      setContaConfirmarArquivo(null);
      return Alert.alert(
        "Conta com lançamentos",
        "Esta conta recebeu um lançamento enquanto a confirmação estava aberta. Para preservar o histórico, ela não pode mais ser excluída.",
      );
    }
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
    const lancsMes = transacoes.filter((t) =>
      t.transacao_pai_id == null
      && (t.data_vencimento || "").startsWith(mesStr)
    ).length;
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
    const dataBaseSql = `${dataSelecionada.getFullYear()}-${String(dataSelecionada.getMonth() + 1).padStart(2, "0")}-${String(dataSelecionada.getDate()).padStart(2, "0")}`;

    if (!IS_LOCAL_DEMO && tipoTransacao !== "transferencia") {
      if (!catSelecionadaId || !contaSelecionadaId) return Alert.alert("Aviso", "Seleciona a conta e categoria.");
      const frequency = frequencia === "fixa" ? frequenciaFixa : frequencia;
      const totalValue = frequencia === "parcelada" && modoValorParcelado === "parcela"
        ? Number((valorNum * totalRepeticoes).toFixed(2))
        : valorNum;
      const payload: Record<string, unknown> = {
        type: tipoTransacao,
        value: totalValue,
        description: descTransacao.trim(),
        status: statusBd,
        scheduled_date: dataBaseSql,
        account_id: contaSelecionadaId,
        category_id: catSelecionadaId,
        frequency,
      };
      if (foiPago) payload.realization_date = dataBaseSql;
      if (frequencia === "parcelada") {
        payload.installments = totalRepeticoes;
      } else if (frequencia === "fixa") {
        payload.recurrence_count = totalRepeticoes;
      }

      setLoadingTrans(true);
      try {
        const resultado = await salvarCriacaoFinanceira("create_transaction", payload);
        setLoadingTrans(false);
        if (resultado.state === "rejected") {
          return Alert.alert("Não foi possível salvar", "O lançamento foi recusado pelo servidor. Revise os dados e tente novamente.");
        }
        if (resultado.state === "uncertain") {
          return Alert.alert("Sessão alterada", "Não foi possível confirmar o lançamento. Entre novamente e confira seus dados antes de reenviar.");
        }
        setDescTransacao(""); setValorTransacao(""); setCatSelecionadaId(null);
        setContaSelecionadaId(null); setContaDestinoId(null); setCaixinhaDestinoId(null); setFrequencia("unica");
        setNumParcelas("2"); setModoValorParcelado("parcela"); setFrequenciaFixa("mensal"); setDataSelecionada(new Date()); setFoiPago(true);
        setModalTransVisivel(false);
        if (resultado.state === "queued") showToast(OFFLINE_SAVED_MESSAGE, "info");
        else void carregarDados();
        return;
      } catch {
        setLoadingTrans(false);
        return Alert.alert("Não foi possível salvar", "O lançamento não pôde ser salvo no dispositivo. Tente novamente.");
      }
    }

    if (!IS_LOCAL_DEMO && tipoTransacao === "transferencia" && !caixinhaDestinoId) {
      if (!contaSelecionadaId || !contaDestinoId) return Alert.alert("Aviso", "Seleciona a origem e destino.");
      if (contaSelecionadaId === contaDestinoId) return Alert.alert("Aviso", "As contas não podem ser iguais.");
      const frequency = frequencia === "fixa" ? frequenciaFixa : frequencia;
      const totalValue = frequencia === "parcelada" && modoValorParcelado === "parcela"
        ? Number((valorNum * totalRepeticoes).toFixed(2))
        : valorNum;
      const payload: Record<string, unknown> = {
        account_id: contaSelecionadaId,
        destination_account_id: contaDestinoId,
        value: totalValue,
        description: descTransacao.trim(),
        status: statusBd,
        scheduled_date: dataBaseSql,
        frequency,
      };
      if (foiPago) payload.realization_date = dataBaseSql;
      if (frequencia === "parcelada") {
        payload.installments = totalRepeticoes;
      } else if (frequencia === "fixa") {
        payload.recurrence_count = totalRepeticoes;
      }

      setLoadingTrans(true);
      try {
        const resultado = await salvarCriacaoFinanceira("transfer_between_accounts", payload);
        setLoadingTrans(false);
        if (resultado.state === "rejected") {
          return Alert.alert("Não foi possível salvar", "A transferência foi recusada pelo servidor. Revise os dados e tente novamente.");
        }
        if (resultado.state === "uncertain") {
          return Alert.alert("Sessão alterada", "Não foi possível confirmar a transferência. Entre novamente e confira seus dados antes de reenviar.");
        }
        setDescTransacao(""); setValorTransacao(""); setCatSelecionadaId(null);
        setContaSelecionadaId(null); setContaDestinoId(null); setCaixinhaDestinoId(null); setFrequencia("unica");
        setNumParcelas("2"); setModoValorParcelado("parcela"); setFrequenciaFixa("mensal"); setDataSelecionada(new Date()); setFoiPago(true);
        setModalTransVisivel(false);
        if (resultado.state === "queued") showToast(OFFLINE_SAVED_MESSAGE, "info");
        else void carregarDados();
        return;
      } catch {
        setLoadingTrans(false);
        return Alert.alert("Não foi possível salvar", "A transferência não pôde ser salva no dispositivo. Tente novamente.");
      }
    }

    if (!IS_LOCAL_DEMO && tipoTransacao === "transferencia" && caixinhaDestinoId) {
      if (!contaSelecionadaId) return Alert.alert("Aviso", "Seleciona a conta de origem.");
      const caixa = caixinhas.find((item) => item.id === caixinhaDestinoId);
      if (!caixa) return Alert.alert("Aviso", "Objetivo não encontrado.");

      // A RPC de `move_goal` preserva de forma atômica a transação e o saldo do
      // objetivo para movimentos realizados. Séries fixas inteiramente pendentes
      // também têm equivalência exata; os demais formatos continuam online-only.
      const movimentoUnicoRealizado = frequencia === "unica" && foiPago;
      const serieFixaPendente = frequencia === "fixa" && !foiPago;
      if (movimentoUnicoRealizado || serieFixaPendente) {
        const payload: Record<string, unknown> = {
          operation: "guardar",
          goal_id: caixinhaDestinoId,
          account_id: contaSelecionadaId,
          value: valorFinal,
          description: descTransacao.trim(),
          frequency: movimentoUnicoRealizado ? "unica" : frequenciaFixa,
        };
        if (movimentoUnicoRealizado) {
          payload.realization_date = dataBaseSql;
        } else {
          payload.scheduled_date = dataBaseSql;
          payload.recurrence_count = totalRepeticoes;
        }

        setLoadingTrans(true);
        try {
          const resultado = await salvarCriacaoFinanceira("move_goal", payload);
          setLoadingTrans(false);
          if (resultado.state === "rejected") {
            return Alert.alert("Não foi possível salvar", "A movimentação do objetivo foi recusada pelo servidor. Revise os dados e tente novamente.");
          }
          if (resultado.state === "uncertain") {
            return Alert.alert("Sessão alterada", "Não foi possível confirmar a movimentação. Entre novamente e confira seus dados antes de reenviar.");
          }
          setDescTransacao(""); setValorTransacao(""); setCatSelecionadaId(null);
          setContaSelecionadaId(null); setContaDestinoId(null); setCaixinhaDestinoId(null); setFrequencia("unica");
          setNumParcelas("2"); setModoValorParcelado("parcela"); setFrequenciaFixa("mensal"); setDataSelecionada(new Date()); setFoiPago(true);
          setModalTransVisivel(false);
          if (resultado.state === "queued") showToast(OFFLINE_SAVED_MESSAGE, "info");
          else void carregarDados();
          return;
        } catch {
          setLoadingTrans(false);
          return Alert.alert("Não foi possível salvar", "A movimentação não pôde ser salva no dispositivo. Tente novamente.");
        }
      }

      if (await dispositivoSemConexao()) {
        return Alert.alert(
          "Conexão necessária",
          frequencia === "parcelada"
            ? "Movimentações parceladas de objetivos ainda precisam de conexão. Reconecte e tente novamente."
            : frequencia === "unica"
              ? "Movimentações únicas de objetivo agendadas como pendentes ainda precisam de conexão."
              : "Este agendamento mistura uma realização imediata com ocorrências futuras e ainda precisa de conexão.",
        );
      }
    }
    const novasTransacoes: any[] = [];
    const serieId = frequencia === "unica"
      ? null
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const comIdentificadorDaSerie = (descricao: string) =>
      serieId ? adicionarIdSerie(descricao, serieId) : descricao;

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
          const caixa = caixinhas.find(c => c.id === caixinhaDestinoId);
          if (!caixa) return Alert.alert("Aviso", "Objetivo não encontrado.");
          novasTransacoes.push({
            tipo: "despesa",
            valor: valorFinal,
            data_vencimento: dataFormatadaSql,
            data_realizacao: statusFinal === "paga" ? dataFormatadaSql : null,
            status: statusFinal,
            descricao: comIdentificadorDaSerie(
              descricaoTransferenciaObjetivo(descFinal, caixa.nome, caixa.id, "guardar"),
            ),
            categoria_id: null,
            conta_id: contaSelecionadaId,
            user_id: session.user.id,
          });
        } else {
          if (contaSelecionadaId === contaDestinoId) return Alert.alert("Aviso", "As contas não podem ser iguais.");
          novasTransacoes.push({ tipo: "despesa", valor: valorFinal, data_vencimento: dataFormatadaSql, data_realizacao: statusFinal === "paga" ? dataFormatadaSql : null, status: statusFinal, descricao: comIdentificadorDaSerie(descricaoTransferencia(descFinal, contaDestinoId!)), categoria_id: null, conta_id: contaSelecionadaId, user_id: session.user.id });
        }
      } else {
        if (!catSelecionadaId || !contaSelecionadaId) return Alert.alert("Aviso", "Seleciona a conta e categoria.");
        novasTransacoes.push({ tipo: tipoTransacao, valor: valorFinal, data_vencimento: dataFormatadaSql, data_realizacao: statusFinal === "paga" ? dataFormatadaSql : null, status: statusFinal, descricao: comIdentificadorDaSerie(descFinal), categoria_id: catSelecionadaId, conta_id: contaSelecionadaId, user_id: session.user.id });
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
  const resumoContasHome = contasAtivas.length === 0
    ? "Nenhuma conta ativa"
    : escopoHomeEhTodas
      ? "Todas as contas"
      : contasEscopoHome.length === 1
        ? contasEscopoHome[0].nome
        : `${contasEscopoHome.length} contas selecionadas`;

  const abrirSeletorContasHome = () => {
    setContasHomeRascunhoIds(contasEscopoHome.map(conta => conta.id));
    setModalContasHomeVisivel(true);
  };

  const alternarContaHomeRascunho = (contaId: number) => {
    setContasHomeRascunhoIds((idsAtuais) => {
      if (!idsAtuais.includes(contaId)) return [...idsAtuais, contaId];
      return idsAtuais.filter(id => id !== contaId);
    });
  };

  const aplicarContasHome = () => {
    const idsValidos = contasHomeRascunhoIdsValidos;
    if (contasAtivas.length > 0 && idsValidos.length === 0) return;
    setContasSelecionadasHomeIds(idsValidos.length === contasAtivas.length ? null : idsValidos);
    setModalContasHomeVisivel(false);
  };

  const formatarValorPrivado = (valor: number) =>
    valoresVisiveis ? fmtReais(valor) : "R$ ••••••";

  const alternarVisibilidadeValores = () => {
    setValoresVisiveis((visiveisAgora) => {
      const proximoValor = !visiveisAgora;
      const userId = session?.user?.id;
      if (userId) {
        void AsyncStorage.setItem(
          `@finflow_valores_visiveis:${userId}`,
          String(proximoValor),
        ).catch((error) => console.warn("Não foi possível salvar a preferência de privacidade:", error));
      }
      return proximoValor;
    });
  };

  const abrirAvisosFinanceiros = () => {
    setModalNotificacoesHome(true);
    setAssinaturaAvisosVisualizada(assinaturaAvisosAtual);

    const userId = session?.user?.id;
    if (userId) {
      void AsyncStorage.setItem(
        `@finflow_avisos_home_visualizados:${userId}`,
        assinaturaAvisosAtual,
      ).catch((error) => console.warn("Não foi possível registrar a leitura dos avisos:", error));
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: Cores.fundo }]}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.homeHero, { backgroundColor: novoTema.header }]}>
          <View pointerEvents="none" style={styles.homeHeroWaves}>
            <View style={[styles.homeHeroWave, styles.homeHeroWaveOne]} />
            <View style={[styles.homeHeroWave, styles.homeHeroWaveTwo]} />
            <View style={[styles.homeHeroWave, styles.homeHeroWaveThree]} />
          </View>
          <View style={styles.homeHeroContent}>
          <View style={styles.homeHeroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.homeHeroGreeting}>{getSaudacao()}, {nomeUsuario}</Text>
              <TouchableOpacity onPress={() => { setAnoTemp(mesAtual.getFullYear()); setMesTemp(mesAtual.getMonth()); setMostrarPickerMesAno(true); }} style={styles.homeMonthButton}>
                <Text style={styles.homeMonthText}>{nomeDoMes}</Text>
                <MaterialIcons name="keyboard-arrow-down" size={16} color="rgba(255,255,255,0.8)" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.homeBell} onPress={abrirAvisosFinanceiros} accessibilityLabel="Abrir avisos financeiros">
              <MaterialIcons name={notificacoesAtivas ? "notifications-active" : "notifications-none"} size={22} color="#FFF" />
              {mostrarBadgeAvisos && <View style={styles.homeBellBadge} />}
            </TouchableOpacity>
          </View>
          <Text style={styles.homeBalanceLabel}>Saldo geral</Text>
          <View style={styles.homeBalanceRow}>
            <Text style={styles.homeBalanceValue}>{formatarValorPrivado(saldoAtualGlobal)}</Text>
            <TouchableOpacity
              style={styles.homeBalanceVisibility}
              onPress={alternarVisibilidadeValores}
              accessibilityRole="button"
              accessibilityLabel={valoresVisiveis ? "Ocultar valores financeiros" : "Mostrar valores financeiros"}
            >
              <MaterialIcons name={valoresVisiveis ? "visibility" : "visibility-off"} size={20} color="#D6F8E8" />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.homeHeroTrend}
            onPress={abrirSeletorContasHome}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel={`Selecionar contas. ${resumoContasHome}`}
          >
            <MaterialIcons name="account-balance-wallet" size={14} color="#8FF0C2" />
            <Text style={styles.homeHeroTrendText}>{resumoContasHome}</Text>
            <MaterialIcons name="keyboard-arrow-down" size={15} color="#B8F4D7" />
          </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.homeActions, { backgroundColor: novoTema.surface, borderColor: novoTema.border }]}>
          {[
            { label: "Transação", icon: "swap-horiz", color: novoTema.primary, action: () => setModalTransVisivel(true) },
            { label: "Categorias", icon: "category", color: "#4D76E8", action: () => setModalGerenciarCatVisivel(true) },
            { label: "Cartões", icon: "credit-card", color: "#EE6B63", action: () => router.push("/(tabs)/cartoes" as any) },
            { label: "IA", icon: "auto-awesome", color: "#805AD5", action: () => router.push("/chat-ia") },
          ].map((item) => (
            <TouchableOpacity key={item.label} style={styles.homeActionItem} onPress={item.action}>
              <View style={[styles.homeActionIcon, { backgroundColor: `${item.color}1F` }]}>
                <MaterialIcons name={item.icon as any} size={23} color={item.color} />
                {item.label === "Cartões" && temFaturaVencidaHome && <View style={styles.homeActionAlert} />}
              </View>
              <Text style={[styles.homeActionLabel, { color: novoTema.text }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.homeMonthCard, { backgroundColor: novoTema.surface, borderColor: novoTema.border }]}>
          <View style={styles.homeSectionTop}>
            <Text style={[styles.homeSectionTitle, { color: novoTema.text }]}>Visão do mês</Text>
            <View style={[styles.homeCalendarIcon, { backgroundColor: novoTema.surfaceMuted }]}><MaterialIcons name="calendar-today" size={15} color={novoTema.textMuted} /></View>
          </View>
          <View style={styles.homeMonthMetrics}>
            <View style={[styles.homeMetricColumn, { alignItems: "flex-start" }]}><Text style={[styles.homeMetricLabel, { color: novoTema.textMuted }]}>Entradas</Text><Text style={[styles.homeMetricValue, { color: "#24A873" }]} numberOfLines={1} adjustsFontSizeToFit>{formatarValorPrivado(receitasDoMes)}</Text></View>
            <TouchableOpacity
              style={[styles.homeMetricColumn, styles.homeMetricInfoButton, { alignItems: "center" }]}
              onPress={() => setModalBalancoAtualVisivel(true)}
              accessibilityRole="button"
              accessibilityLabel="Entender o Balanço atual"
            >
              <View style={styles.homeMetricLabelRow}>
                <Text style={[styles.homeMetricLabel, { color: novoTema.textMuted }]}>Balanço atual</Text>
                <MaterialIcons name="info-outline" size={12} color={novoTema.textMuted} />
              </View>
              <Text style={[styles.homeMetricValue, { color: balancoMensal < 0 ? "#EE6B63" : novoTema.text }]} numberOfLines={1} adjustsFontSizeToFit>{formatarValorPrivado(balancoMensal)}</Text>
            </TouchableOpacity>
            <View style={[styles.homeMetricColumn, { alignItems: "flex-end" }]}><Text style={[styles.homeMetricLabel, { color: novoTema.textMuted }]}>Saídas</Text><Text style={[styles.homeMetricValue, { color: "#EE6B63" }]} numberOfLines={1} adjustsFontSizeToFit>{formatarValorPrivado(despesasDoMes)}</Text></View>
          </View>
          <View style={[styles.homeMonthTrack, { backgroundColor: novoTema.surfaceMuted }]}>
            <View style={{ flex: Math.max(receitasDoMes, 1), backgroundColor: "#42C78B" }} />
            <View style={{ flex: Math.max(despesasDoMes, 1), backgroundColor: "#EE6B63" }} />
          </View>
          <Text style={{ color: saldoPrevistoFimDoMes < 0 ? (isDark ? "#F28B82" : "#C96A6A") : novoTema.textMuted, fontSize: 11, marginTop: 9 }}>
            Saldo previsto no fim do mês: {formatarValorPrivado(saldoPrevistoFimDoMes)}
          </Text>
        </View>

        {false && <>
        {/* HEADER com botão IA fixo */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.greeting, { color: "#FFF" }]}>
              {getSaudacao()}, {nomeUsuario}!
            </Text>
            <Text style={[styles.subtitle, { color: "rgba(255,255,255,0.78)" }]}>
              Seu painel financeiro FinFlow
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.iaBotaoFixo, !iaDisponivel && { opacity: 0.55 }]}
            onPress={() => {
              if (iaDisponivel) {
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
            <Text style={{ color: "#B45309", fontSize: 13, fontWeight: "600", flex: 1 }}>Sem conexão — exibindo os dados salvos neste dispositivo</Text>
          </View>
        )}

        <View style={styles.actionGrid}>
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: novoTema.surface, borderColor: novoTema.border }]} onPress={() => setModalTransVisivel(true)}>
              <MaterialIcons name="swap-horiz" size={20} color={novoTema.primary} style={{ marginRight: 7 }} />
              <Text style={[styles.actionButtonText, { color: novoTema.text }]}>+ Transação</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: novoTema.surface, borderColor: novoTema.border }]} onPress={() => setModalGerenciarCatVisivel(true)}>
              <MaterialIcons name="category" size={19} color="#4D76E8" style={{ marginRight: 7 }} />
              <Text style={[styles.actionButtonText, { color: novoTema.text }]}>Gerenciar Categorias</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.actionButtonFull, { backgroundColor: novoTema.surface, borderColor: novoTema.border, position: "relative" }]} onPress={() => router.push("/(tabs)/cartoes" as any)}>
            <MaterialIcons name="credit-card" size={19} color="#EE6B63" style={{ marginRight: 7 }} />
            <Text style={[styles.actionButtonText, { color: novoTema.text }]}>Cartão de Crédito</Text>
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
            <Text style={{ color: saldoPrevistoFimDoMes < 0 ? (isDark ? "#F28B82" : "#C96A6A") : (isDark ? "#888" : "#7B8490"), fontSize: 11, marginTop: 3 }}>
              Saldo previsto no fim do mês: {fmtReais(saldoPrevistoFimDoMes)}
            </Text>
          </View>
        </View>

        </>}

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
              total={modoDistribuicao === "concluidos" ? totalDespesasPorCatRealizadas : totalDespesasPorCat}
              isDark={isDark}
              valoresVisiveis={valoresVisiveis}
            />
            {(modoDistribuicao === "concluidos" ? totalDespesasPorCatRealizadas : totalDespesasPorCat) > 0 && (
              <Text style={{ color: "#E76F51", fontWeight: "bold", textAlign: "center", marginTop: 8, fontSize: 13 }}>
                Total: {formatarValorPrivado(modoDistribuicao === "concluidos" ? totalDespesasPorCatRealizadas : totalDespesasPorCat)}
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
              total={modoDistribuicao === "concluidos" ? totalReceitasPorCatRealizadas : totalReceitasPorCat}
              isDark={isDark}
              valoresVisiveis={valoresVisiveis}
            />
            {(modoDistribuicao === "concluidos" ? totalReceitasPorCatRealizadas : totalReceitasPorCat) > 0 && (
              <Text style={{ color: "#8AB17D", fontWeight: "bold", textAlign: "center", marginTop: 8, fontSize: 13 }}>
                Total: {formatarValorPrivado(modoDistribuicao === "concluidos" ? totalReceitasPorCatRealizadas : totalReceitasPorCat)}
              </Text>
            )}
          </View>
          </>
          )}
        </View>

      </ScrollView>

      {modalContasHomeVisivel && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalContasHomeVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.accountScopePanel, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
            <View style={styles.accountScopeHeader}>
              <View style={[styles.accountScopeHeaderIcon, { backgroundColor: novoTema.primarySoft }]}>
                <MaterialIcons name="account-balance-wallet" size={24} color={novoTema.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.accountScopeTitle, { color: Cores.textoPrincipal }]}>Contas e visão inicial</Text>
                <Text style={[styles.accountScopeSubtitle, { color: Cores.textoSecundario }]}>Selecione, crie e gerencie suas contas em um só lugar.</Text>
              </View>
              <TouchableOpacity style={styles.notificationClose} onPress={() => setModalContasHomeVisivel(false)}>
                <MaterialIcons name="close" size={22} color={Cores.textoSecundario} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.accountScopeCreate, { backgroundColor: novoTema.primary }]}
              onPress={() => {
                setModalContasHomeVisivel(false);
                setModalContaVisivel(true);
              }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add" size={19} color="#FFF" />
              <Text style={styles.accountScopeCreateText}>Criar nova conta</Text>
            </TouchableOpacity>

            <Text style={[styles.accountScopeSectionLabel, { color: Cores.textoSecundario }]}>CONTAS EXIBIDAS NA TELA INICIAL</Text>

            <TouchableOpacity
              style={[styles.accountScopeOption, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}
              onPress={() => setContasHomeRascunhoIds(contasAtivas.map(conta => conta.id))}
            >
              <View style={[styles.accountScopeCheck, {
                borderColor: todasContasHomeRascunhoSelecionadas ? novoTema.primary : Cores.borda,
                backgroundColor: todasContasHomeRascunhoSelecionadas ? novoTema.primary : "transparent",
              }]}>
                {todasContasHomeRascunhoSelecionadas && <MaterialIcons name="check" size={16} color="#FFF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.accountScopeOptionTitle, { color: Cores.textoPrincipal }]}>Todas as contas</Text>
                <Text style={[styles.accountScopeOptionText, { color: Cores.textoSecundario }]}>Visão consolidada completa</Text>
              </View>
            </TouchableOpacity>

            <ScrollView style={styles.accountScopeList} showsVerticalScrollIndicator={false}>
              {contasAtivas.map((conta) => {
                const selecionada = contasHomeRascunhoIdsValidos.includes(conta.id);
                return (
                  <View
                    key={conta.id}
                    style={[styles.accountScopeManagedOption, { backgroundColor: Cores.pillFundo, borderColor: selecionada ? novoTema.primary : Cores.borda }]}
                  >
                    <TouchableOpacity
                      style={styles.accountScopeSelectArea}
                      onPress={() => alternarContaHomeRascunho(conta.id)}
                      activeOpacity={0.76}
                    >
                      <View style={[styles.accountScopeCheck, {
                        borderColor: selecionada ? novoTema.primary : Cores.borda,
                        backgroundColor: selecionada ? novoTema.primary : "transparent",
                      }]}>
                        {selecionada && <MaterialIcons name="check" size={16} color="#FFF" />}
                      </View>
                      <View style={[styles.accountScopeDot, { backgroundColor: conta.cor || novoTema.primary }]} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={styles.accountScopeNameRow}>
                          <Text style={[styles.accountScopeOptionTitle, { color: Cores.textoPrincipal }]} numberOfLines={1}>{conta.nome}</Text>
                          {conta.compartilhado && <MaterialIcons name="people" size={13} color={novoTema.primary} />}
                        </View>
                        <Text style={[styles.accountScopeOptionText, { color: Cores.textoSecundario }]}>{formatarValorPrivado(calcularSaldoConta(conta))}</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.accountScopeManageButton, { borderColor: Cores.borda }]}
                      onPress={() => abrirEditarConta(conta)}
                      accessibilityLabel={`Editar conta ${conta.nome}`}
                    >
                      <MaterialIcons name="edit" size={17} color={Cores.textoSecundario} />
                    </TouchableOpacity>
                  </View>
                );
              })}

              {contasArquivadas.length > 0 && (
                <>
                  <TouchableOpacity
                    style={[styles.accountScopeArchivedToggle, { borderColor: Cores.borda }]}
                    onPress={() => setMostrarArquivadas(atual => !atual)}
                  >
                    <View style={[styles.accountScopeArchivedIcon, { backgroundColor: Cores.inputFundo }]}>
                      <MaterialIcons name="archive" size={17} color={Cores.textoSecundario} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.accountScopeOptionTitle, { color: Cores.textoPrincipal }]}>Contas arquivadas</Text>
                      <Text style={[styles.accountScopeOptionText, { color: Cores.textoSecundario }]}>{contasArquivadas.length} conta(s)</Text>
                    </View>
                    <MaterialIcons name={mostrarArquivadas ? "expand-less" : "expand-more"} size={22} color={Cores.textoSecundario} />
                  </TouchableOpacity>

                  {mostrarArquivadas && contasArquivadas.map((conta) => (
                    <TouchableOpacity
                      key={`arquivada-${conta.id}`}
                      style={[styles.accountScopeArchivedRow, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}
                      onPress={() => abrirEditarConta(conta)}
                    >
                      <View style={[styles.accountScopeDot, { backgroundColor: conta.cor || novoTema.primary, opacity: 0.55 }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.accountScopeOptionTitle, { color: Cores.textoPrincipal }]}>{conta.nome}</Text>
                        <Text style={[styles.accountScopeOptionText, { color: Cores.textoSecundario }]}>Arquivada · toque para editar ou reativar</Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={20} color={Cores.textoSecundario} />
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </ScrollView>

            {!todasContasHomeRascunhoSelecionadas && (
              <Text style={[styles.accountScopeHint, { color: Cores.textoSecundario }]}>Compras de cartão ainda não têm uma conta vinculada e aparecem somente em “Todas as contas”.</Text>
            )}

            {contasAtivas.length > 0 && !podeAplicarContasHome && (
              <Text style={styles.accountScopeEmptyWarning}>Selecione ao menos uma conta para aplicar.</Text>
            )}

            <View style={styles.accountScopeActions}>
              <TouchableOpacity style={[styles.accountScopeCancel, { borderColor: Cores.borda }]} onPress={() => setModalContasHomeVisivel(false)}>
                <Text style={[styles.accountScopeCancelText, { color: Cores.textoSecundario }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.accountScopeApply, { backgroundColor: novoTema.primary }, !podeAplicarContasHome && styles.accountScopeApplyDisabled]}
                onPress={aplicarContasHome}
                disabled={!podeAplicarContasHome}
              >
                <Text style={styles.accountScopeApplyText}>Aplicar seleção</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      )}

      {modalBalancoAtualVisivel && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalBalancoAtualVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.balanceExplanationPanel, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
            <View style={[styles.balanceExplanationIcon, { backgroundColor: novoTema.primarySoft }]}>
              <MaterialIcons name="insights" size={28} color={novoTema.primary} />
            </View>
            <Text style={[styles.balanceExplanationTitle, { color: Cores.textoPrincipal }]}>Como funciona o Balanço atual?</Text>
            <Text style={[styles.balanceExplanationText, { color: Cores.textoSecundario }]}>Ele mostra a diferença entre as receitas e as despesas já realizadas no mês e nas contas selecionadas.</Text>

            <View style={[styles.balanceExplanationNote, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}>
              <MaterialIcons name="savings" size={21} color={novoTema.primary} />
              <Text style={[styles.balanceExplanationNoteText, { color: Cores.textoPrincipal }]}>Guardar dinheiro em um objetivo não é uma saída: é uma transferência entre sua conta e sua caixinha.</Text>
            </View>
            <View style={[styles.balanceExplanationNote, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}>
              <MaterialIcons name="receipt-long" size={21} color="#E76F51" />
              <Text style={[styles.balanceExplanationNoteText, { color: Cores.textoPrincipal }]}>Resgatar da caixinha também não é receita. Porém, quando esse valor é usado em uma despesa registrada e paga, a despesa entra no balanço normalmente.</Text>
            </View>

            <TouchableOpacity style={[styles.balanceExplanationButton, { backgroundColor: novoTema.primary }]} onPress={() => setModalBalancoAtualVisivel(false)}>
              <Text style={styles.balanceExplanationButtonText}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {modalNotificacoesHome && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalNotificacoesHome(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.notificationPanel, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
            <View style={styles.notificationHeader}>
              <View style={[styles.notificationHeaderIcon, { backgroundColor: novoTema.primarySoft }]}>
                <MaterialIcons name="notifications-none" size={24} color={novoTema.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.notificationTitle, { color: Cores.textoPrincipal }]}>Avisos financeiros</Text>
                <Text style={[styles.notificationSubtitle, { color: Cores.textoSecundario }]}>
                  {notificacoesAtivas ? "Notificações do dispositivo ativadas" : "Notificações do dispositivo desativadas"}
                </Text>
              </View>
              <TouchableOpacity style={styles.notificationClose} onPress={() => setModalNotificacoesHome(false)}>
                <MaterialIcons name="close" size={22} color={Cores.textoSecundario} />
              </TouchableOpacity>
            </View>

            <View style={styles.notificationList}>
              {qtdVencidasHome > 0 && (
                <TouchableOpacity style={[styles.notificationItem, { backgroundColor: Cores.pillFundo }]} onPress={() => {
                  setModalNotificacoesHome(false);
                  router.push({ pathname: "/(tabs)/transacoes", params: { filtroPeriodo: "atrasados" } } as any);
                }}>
                  <View style={[styles.notificationItemIcon, { backgroundColor: "#E76F5122" }]}><MaterialIcons name="warning-amber" size={20} color="#E76F51" /></View>
                  <View style={{ flex: 1 }}><Text style={[styles.notificationItemTitle, { color: Cores.textoPrincipal }]}>Lançamentos atrasados</Text><Text style={[styles.notificationItemText, { color: Cores.textoSecundario }]}>{qtdVencidasHome} pendência{qtdVencidasHome === 1 ? "" : "s"} precisa{qtdVencidasHome === 1 ? "" : "m"} de atenção.</Text></View>
                  <MaterialIcons name="chevron-right" size={21} color={Cores.textoSecundario} />
                </TouchableOpacity>
              )}
              {qtdVencendoHoje > 0 && (
                <TouchableOpacity style={[styles.notificationItem, { backgroundColor: Cores.pillFundo }]} onPress={() => {
                  setModalNotificacoesHome(false);
                  router.push({ pathname: "/(tabs)/transacoes", params: { filtroPeriodo: "hoje" } } as any);
                }}>
                  <View style={[styles.notificationItemIcon, { backgroundColor: `${novoTema.primary}22` }]}><MaterialIcons name="today" size={20} color={novoTema.primary} /></View>
                  <View style={{ flex: 1 }}><Text style={[styles.notificationItemTitle, { color: Cores.textoPrincipal }]}>Agendamentos vencendo hoje</Text><Text style={[styles.notificationItemText, { color: Cores.textoSecundario }]}>{qtdVencendoHoje} lançamento{qtdVencendoHoje === 1 ? "" : "s"} precisa{qtdVencendoHoje === 1 ? "" : "m"} ser acompanhado{qtdVencendoHoje === 1 ? "" : "s"} hoje.</Text></View>
                  <MaterialIcons name="chevron-right" size={21} color={Cores.textoSecundario} />
                </TouchableOpacity>
              )}
              {qtdProximosVencimentos > 0 && (
                <TouchableOpacity style={[styles.notificationItem, { backgroundColor: Cores.pillFundo }]} onPress={() => {
                  setModalNotificacoesHome(false);
                  router.push({ pathname: "/(tabs)/transacoes", params: { filtroPeriodo: "proximos-7-dias" } } as any);
                }}>
                  <View style={[styles.notificationItemIcon, { backgroundColor: "#E9C46A22" }]}><MaterialIcons name="event" size={20} color="#C99B25" /></View>
                  <View style={{ flex: 1 }}><Text style={[styles.notificationItemTitle, { color: Cores.textoPrincipal }]}>Próximos 7 dias</Text><Text style={[styles.notificationItemText, { color: Cores.textoSecundario }]}>{qtdProximosVencimentos} lançamento{qtdProximosVencimentos === 1 ? "" : "s"} pendente{qtdProximosVencimentos === 1 ? "" : "s"}.</Text></View>
                  <MaterialIcons name="chevron-right" size={21} color={Cores.textoSecundario} />
                </TouchableOpacity>
              )}
              {temFaturaVencidaHome && (
                <TouchableOpacity style={[styles.notificationItem, { backgroundColor: Cores.pillFundo }]} onPress={() => { setModalNotificacoesHome(false); router.push("/(tabs)/cartoes" as any); }}>
                  <View style={[styles.notificationItemIcon, { backgroundColor: "#EE6B6322" }]}><MaterialIcons name="credit-card" size={20} color="#EE6B63" /></View>
                  <View style={{ flex: 1 }}><Text style={[styles.notificationItemTitle, { color: Cores.textoPrincipal }]}>Fatura vencida</Text><Text style={[styles.notificationItemText, { color: Cores.textoSecundario }]}>Existe uma fatura em aberto após o vencimento.</Text></View>
                  <MaterialIcons name="chevron-right" size={21} color={Cores.textoSecundario} />
                </TouchableOpacity>
              )}
              {qtdVencidasHome === 0 && qtdVencendoHoje === 0 && qtdProximosVencimentos === 0 && !temFaturaVencidaHome && (
                <View style={styles.notificationEmpty}>
                  <MaterialIcons name="task-alt" size={38} color="#2A9D8F" />
                  <Text style={[styles.notificationEmptyTitle, { color: Cores.textoPrincipal }]}>Tudo em dia</Text>
                  <Text style={[styles.notificationEmptyText, { color: Cores.textoSecundario }]}>Nenhum aviso financeiro importante no momento.</Text>
                </View>
              )}
            </View>

            <TouchableOpacity style={[styles.notificationSettings, { borderColor: Cores.borda }]} onPress={() => {
              setModalNotificacoesHome(false);
              router.push({ pathname: "/(tabs)/configuracoes", params: { abrirNotificacoes: "1" } } as any);
            }}>
              <MaterialIcons name="tune" size={18} color={novoTema.primary} />
              <Text style={[styles.notificationSettingsText, { color: novoTema.primary }]}>Configurar notificações</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {contaConfirmarArquivo && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setContaConfirmarArquivo(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "90%", borderTopWidth: 4, borderTopColor: contaConfirmarArquivo.temLancamentos ? "#F4A261" : "#E76F51" }]}>
              <View style={{ alignItems: "center", marginBottom: 14 }}>
                <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: contaConfirmarArquivo.temLancamentos ? "#F4A26122" : "#E76F5122", alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name={contaConfirmarArquivo.temLancamentos ? "archive" : "delete-outline"} size={31} color={contaConfirmarArquivo.temLancamentos ? "#F4A261" : "#E76F51"} />
                </View>
              </View>
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>
                {contaConfirmarArquivo.temLancamentos ? "Arquivar conta" : "Excluir conta"}
              </Text>
              <Text style={{ color: Cores.textoSecundario, textAlign: "center", fontSize: 14, lineHeight: 21, marginBottom: 10 }}>
                {contaConfirmarArquivo.temLancamentos
                  ? `A conta “${contaConfirmarArquivo.conta.nome}” deixará de aparecer nas operações, mas todo o histórico será preservado.`
                  : `A conta “${contaConfirmarArquivo.conta.nome}” não possui lançamentos e será excluída definitivamente.`}
              </Text>
              {Math.abs(contaConfirmarArquivo.saldoAtual) > 0.005 && (
                <View style={{ backgroundColor: Cores.pillFundo, borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 16 }}>
                  <Text style={{ color: Cores.textoSecundario, fontSize: 12 }}>
                    {contaConfirmarArquivo.temLancamentos ? "Saldo que ficará arquivado" : "Saldo que será removido"}
                  </Text>
                  <Text style={{ color: Cores.textoPrincipal, fontSize: 22, fontWeight: "bold", marginTop: 3 }}>{formatarValorPrivado(contaConfirmarArquivo.saldoAtual)}</Text>
                </View>
              )}
              {contaConfirmarArquivo.temLancamentos ? (
                <TouchableOpacity style={{ minHeight: 50, borderRadius: 11, backgroundColor: "#F4A261", alignItems: "center", justifyContent: "center", marginBottom: 9 }} onPress={() => executarArquivar(contaConfirmarArquivo.conta)}>
                  <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>Arquivar conta</Text>
                </TouchableOpacity>
              ) : (
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
      {mostrarPickerMesAno && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setMostrarPickerMesAno(false)}>
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
      )}

      {/* MODAL EDITAR CONTA */}
      {modalEditarContaVisivel && (
      <Modal animationType="slide" transparent visible onRequestClose={() => { setModalEditarContaVisivel(false); setEditandoSaldoConta(false); }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "95%", maxHeight: "90%" }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Editar Conta</Text>

              {/* Info estática da conta */}
              {contaEditando && (
                <View style={{ alignItems: "center", marginBottom: 20, padding: 15, backgroundColor: Cores.pillFundo, borderRadius: 12 }}>
                  <Text style={{ color: Cores.textoSecundario, fontSize: 12, marginBottom: 4 }}>Saldo Atual</Text>
                  <Text style={{ color: "#2A9D8F", fontSize: 26, fontWeight: "bold" }}>
                    {formatarValorPrivado(calcularSaldoConta(contaEditando))}
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
                  onChangeText={(texto) => setSaldoEditConta(formatarEntradaMoeda(texto))}
                  keyboardType="numeric"
                />
              )}

              {/* Arquivar, excluir ou desarquivar */}
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
                  style={[styles.botaoApagar, { marginBottom: 15, backgroundColor: contaEditando && contaPossuiLancamentos(contaEditando.id) ? "#F4A261" : "#E76F51" }]}
                  onPress={() => contaEditando && arquivarConta(contaEditando)}
                >
                  <MaterialIcons name={contaEditando && contaPossuiLancamentos(contaEditando.id) ? "archive" : "delete-outline"} size={18} color="#FFF" />
                  <Text style={styles.botaoApagarTexto}>
                    {contaEditando && contaPossuiLancamentos(contaEditando.id) ? "Arquivar Conta" : "Excluir Conta"}
                  </Text>
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
      )}

      {/* MODAL NOVA CONTA */}
      {modalContaVisivel && (
      <Modal animationType="slide" transparent visible onRequestClose={() => setModalContaVisivel(false)}>
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
              placeholder="Saldo inicial (R$ 0,00)"
              placeholderTextColor={Cores.textoSecundario}
              value={saldoInicialConta}
              onChangeText={(texto) => setSaldoInicialConta(formatarEntradaMoeda(texto))}
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
              <Text style={{ color: "#FFF", fontWeight: "bold" }}>{fmtReais(valorDaEntradaMoeda(saldoInicialConta))}</Text>
            </View>

            <View style={styles.modalButtons}>
              <Button title="Cancelar" color="#999" onPress={() => setModalContaVisivel(false)} />
              <Button title={loadingConta ? "Salvando..." : "Salvar"} color="#457B9D" onPress={salvarConta} disabled={loadingConta} />
            </View>
          </View>
        </View>
      </Modal>
      )}

      {/* MODAL GERENCIAR CATEGORIAS */}
      {modalGerenciarCatVisivel && (
      <Modal animationType="slide" transparent visible onRequestClose={() => { setModalGerenciarCatVisivel(false); setCatEditando(null); }}>
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
                          <TouchableOpacity onPress={() => deletarCategoria(cat)} style={styles.iconeBotao} accessibilityLabel={`Excluir ${cat.nome}`}>
                            <MaterialIcons name="delete-outline" size={18} color="#E76F51" />
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
      )}

      {/* MODAL NOVA CATEGORIA */}
      {modalCatVisivel && (
      <Modal animationType="slide" transparent visible onRequestClose={() => setModalCatVisivel(false)}>
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
      )}

      {/* MODAL RESUMO DO MÊS */}
      {modalResumoVisivel && (
      <Modal animationType="slide" transparent visible onRequestClose={() => setModalResumoVisivel(false)}>
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
                        {formatarValorPrivado(totalTipo)}
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
                            <Text style={{ color: corTipo, fontWeight: "bold", fontSize: 13 }}>{formatarValorPrivado(item.valor)}</Text>
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
      )}

      {/* MODAL LANÇAMENTOS VENCIDOS */}
      {modalVencidosVisivel && !temPopupPrioritario && (
      <Modal
        animationType="fade"
        transparent
        visible
        onRequestClose={() => setModalVencidosVisivel(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.accountScopePanel, FinFlowShadow, { backgroundColor: novoTema.surface, borderColor: novoTema.border, alignItems: "center", padding: 24, maxHeight: undefined }]}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#EE6B6322", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <MaterialIcons name="warning-amber" size={28} color={FinFlowColors.red} />
            </View>
            <Text style={{ color: novoTema.text, fontSize: 18, fontWeight: "900", marginBottom: 8, textAlign: "center" }}>
              Lançamentos vencidos
            </Text>
            <Text style={{ color: novoTema.textMuted, textAlign: "center", fontSize: 14, lineHeight: 21, marginBottom: 22 }}>
              Você tem{" "}
              <Text style={{ color: FinFlowColors.red, fontWeight: "800" }}>{qtdVencidas}</Text>{" "}
              lançamento{qtdVencidas > 1 ? "s" : ""} vencido{qtdVencidas > 1 ? "s" : ""} sem resolver.
            </Text>
            <TouchableOpacity
              style={{ width: "100%", minHeight: 50, backgroundColor: novoTema.primary, borderRadius: FinFlowRadius.medium, alignItems: "center", justifyContent: "center", marginBottom: 10 }}
              onPress={() => {
                setModalVencidosVisivel(false);
                router.push({ pathname: "/(tabs)/transacoes", params: { filtroPeriodo: "atrasados" } } as any);
              }}
            >
              <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 15 }}>Ver no Histórico</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ width: "100%", minHeight: 46, alignItems: "center", justifyContent: "center" }}
              onPress={() => setModalVencidosVisivel(false)}
            >
              <Text style={{ color: novoTema.textMuted, fontWeight: "700", fontSize: 14 }}>Ver depois</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {confirmarEdicaoSaldo && (
      <Modal
        animationType="fade"
        transparent
        visible
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
      )}

      {/* MODAL NOVA TRANSAÇÃO */}
      {modalTransVisivel && (
      <Modal animationType="slide" transparent visible onRequestClose={() => setModalTransVisivel(false)}>
        <KeyboardAvoidingView style={styles.transactionOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.transactionSheet, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
            <View style={[styles.transactionHandle, { backgroundColor: Cores.borda }]} />
            <View style={styles.transactionHeader}>
              <View style={[styles.transactionHeaderIcon, { backgroundColor: `${corTipoTransacao}22` }]}>
                <MaterialIcons name="swap-horiz" size={24} color={corTipoTransacao} />
              </View>
              <View style={styles.transactionHeaderCopy}>
                <Text style={[styles.transactionTitle, { color: Cores.textoPrincipal }]}>Nova transação</Text>
                <Text style={[styles.transactionSubtitle, { color: Cores.textoSecundario }]}>Registre ou agende uma movimentação.</Text>
              </View>
              <TouchableOpacity style={[styles.transactionClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalTransVisivel(false)} accessibilityLabel="Fechar">
                <MaterialIcons name="close" size={22} color={Cores.textoSecundario} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.transactionForm} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.transactionSectionLabel, { color: Cores.textoSecundario }]}>Tipo de movimentação</Text>
              <View style={[styles.typeSelector, styles.transactionSelector, { borderColor: Cores.borda, backgroundColor: Cores.pillFundo }]}>
                <TouchableOpacity style={[styles.typeButton, styles.transactionTypeButton, tipoTransacao === "despesa" && styles.expenseSelected]} onPress={() => { setTipoTransacao("despesa"); setCatSelecionadaId(null); }}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.typeButtonText, tipoTransacao === "despesa" ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>Despesa</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.typeButton, styles.transactionTypeButton, tipoTransacao === "receita" && styles.incomeSelected]} onPress={() => { setTipoTransacao("receita"); setCatSelecionadaId(null); }}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.typeButtonText, tipoTransacao === "receita" ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>Receita</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.typeButton, styles.transactionTypeButton, tipoTransacao === "transferencia" && styles.transferSelected]} onPress={() => setTipoTransacao("transferencia")}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.typeButtonText, tipoTransacao === "transferencia" ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>Transferência</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.transactionSectionLabel, { color: Cores.textoSecundario }]}>Repetição</Text>
              <View style={[styles.typeSelector, styles.transactionSelector, { borderColor: Cores.borda, backgroundColor: Cores.pillFundo }]}>
                {(["unica", "parcelada", "fixa"] as const).map((freq) => (
                  <TouchableOpacity key={freq} style={[styles.freqButton, styles.transactionChoice, frequencia === freq && { backgroundColor: corTipoTransacao }]} onPress={() => {
                    setFrequencia(freq);
                    if (freq !== "unica") setFoiPago(false);
                  }}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.freqButtonText, frequencia === freq ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>
                      {freq === "unica" ? "Única" : freq === "parcelada" ? "Parcelada" : "Fixa"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {frequencia === "fixa" && (
                <>
                  <Text style={[styles.transactionSectionLabel, { color: Cores.textoSecundario }]}>Periodicidade</Text>
                  <View style={[styles.typeSelector, styles.transactionSelector, { borderColor: Cores.borda, backgroundColor: Cores.pillFundo }]}>
                    {(["semanal", "mensal", "anual"] as const).map((periodo) => (
                      <TouchableOpacity
                        key={periodo}
                        style={[styles.freqButton, styles.transactionChoice, frequenciaFixa === periodo && { backgroundColor: corTipoTransacao }]}
                        onPress={() => setFrequenciaFixa(periodo)}
                      >
                        <Text style={[styles.freqButtonText, { color: frequenciaFixa === periodo ? "#FFF" : Cores.textoSecundario }]}>
                          {periodo === "semanal" ? "Semanal" : periodo === "mensal" ? "Mensal" : "Anual"}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              {frequencia === "unica" && (
                <>
                  <Text style={[styles.transactionSectionLabel, { color: Cores.textoSecundario }]}>Status</Text>
                  <View style={[styles.typeSelector, styles.transactionSelector, { borderColor: Cores.borda, backgroundColor: Cores.pillFundo }]}>
                    <TouchableOpacity style={[styles.freqButton, styles.transactionChoice, foiPago && { backgroundColor: corTipoTransacao }]} onPress={() => setFoiPago(true)}>
                      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.freqButtonText, foiPago ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>{tipoTransacao === "receita" ? "Já Recebido" : "Já Pago"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.freqButton, styles.transactionChoice, !foiPago && { backgroundColor: corTipoTransacao }]} onPress={() => setFoiPago(false)}>
                      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.freqButtonText, !foiPago ? { color: "#FFF" } : { color: Cores.textoSecundario }]}>{tipoTransacao === "receita" ? "A Receber" : "A Pagar"}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              <Text style={[styles.transactionSectionLabel, { color: Cores.textoSecundario }]}>Detalhes</Text>
              <View style={[styles.transactionInputWrap, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda }]}>
                <MaterialIcons name="notes" size={19} color={Cores.textoSecundario} />
                <TextInput style={[styles.transactionTextInput, { color: Cores.textoPrincipal }]} placeholder="Descrição" placeholderTextColor={Cores.textoSecundario} value={descTransacao} onChangeText={setDescTransacao} />
              </View>

              <TouchableOpacity style={[styles.transactionInputWrap, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda }]} onPress={() => setMostrarCalendario(true)}>
                <MaterialIcons name="calendar-today" size={19} color={corTipoTransacao} />
                <Text style={[styles.datePickerText, { color: Cores.textoPrincipal }]}>{formatarDataBR(dataSelecionada)}</Text>
                <MaterialIcons name="chevron-right" size={20} color={Cores.textoSecundario} style={{ marginLeft: "auto" }} />
              </TouchableOpacity>
              {mostrarCalendario && <DateTimePicker value={dataSelecionada} mode="date" display="default" onChange={aoMudarData} />}
              <View style={styles.rowInputs}>
                <View style={[styles.transactionInputWrap, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, flex: 1 }]}>
                  <View style={[styles.transactionCurrency, { backgroundColor: `${corTipoTransacao}22` }]}><Text style={{ color: corTipoTransacao, fontSize: 12, fontWeight: "900" }}>R$</Text></View>
                  <TextInput
                    style={[styles.transactionTextInput, { color: Cores.textoPrincipal, fontSize: 17, fontWeight: "700" }]}
                    placeholder="0,00"
                    placeholderTextColor={Cores.textoSecundario}
                    value={valorTransacao}
                    onChangeText={(texto) => setValorTransacao(formatarEntradaMoeda(texto))}
                    keyboardType="number-pad"
                    selectTextOnFocus={false}
                    selection={{ start: valorTransacao.length, end: valorTransacao.length }}
                  />
                </View>
              </View>
              {frequencia === "parcelada" && (
                <>
                  <Text style={[styles.transactionSectionLabel, { color: Cores.textoSecundario }]}>O valor informado representa</Text>
                  <View style={[styles.typeSelector, styles.transactionSelector, { borderColor: Cores.borda, backgroundColor: Cores.pillFundo }]}>
                    {(["parcela", "total"] as const).map((modo) => (
                      <TouchableOpacity key={modo} style={[styles.freqButton, styles.transactionChoice, modoValorParcelado === modo && { backgroundColor: corTipoTransacao }]} onPress={() => setModoValorParcelado(modo)}>
                        <Text style={[styles.freqButtonText, { color: modoValorParcelado === modo ? "#FFF" : Cores.textoSecundario }]}>{modo === "parcela" ? "Valor da parcela" : "Valor total"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[styles.transactionSectionLabel, { color: Cores.textoSecundario }]}>Número de parcelas</Text>
                  <TextInput
                    style={[styles.transactionPlainInput, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, color: Cores.textoPrincipal }]}
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

              <Text style={[styles.transactionSectionLabel, { color: Cores.textoSecundario }]}>{tipoTransacao === "transferencia" ? "Conta de origem" : "Conta"}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.transactionChipRow}>
                {contasAtivas.map((conta) => (
                  <TouchableOpacity key={conta.id} style={[styles.catPill, styles.transactionChip, { backgroundColor: Cores.pillFundo, borderColor: contaSelecionadaId === conta.id ? corTipoTransacao : Cores.borda }]} onPress={() => setContaSelecionadaId(conta.id)}>
                    <MaterialIcons name="account-balance-wallet" size={16} color={contaSelecionadaId === conta.id ? corTipoTransacao : Cores.textoSecundario} style={{ marginRight: 6 }} />
                    <Text style={{ color: Cores.textoPrincipal }}>{conta.nome}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {tipoTransacao === "transferencia" ? (
                <>
                  <Text style={[styles.transactionSectionLabel, { color: Cores.textoSecundario }]}>Conta ou objetivo de destino</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.transactionChipRow}>
                    {contasAtivas.map((conta) => (
                      <TouchableOpacity key={`dest-${conta.id}`} style={[styles.catPill, styles.transactionChip, { backgroundColor: Cores.pillFundo, borderColor: !caixinhaDestinoId && contaDestinoId === conta.id ? corTipoTransacao : Cores.borda }]} onPress={() => { setContaDestinoId(conta.id); setCaixinhaDestinoId(null); }}>
                        <MaterialIcons name="account-balance-wallet" size={16} color={!caixinhaDestinoId && contaDestinoId === conta.id ? corTipoTransacao : Cores.textoSecundario} style={{ marginRight: 6 }} />
                        <Text style={{ color: Cores.textoPrincipal }}>{conta.nome}</Text>
                      </TouchableOpacity>
                    ))}
                    {caixinhas.map((caixa) => (
                      <TouchableOpacity key={`caixa-dest-${caixa.id}`} style={[styles.catPill, styles.transactionChip, { backgroundColor: Cores.pillFundo, borderColor: caixinhaDestinoId === caixa.id ? corTipoTransacao : Cores.borda }]} onPress={() => { setCaixinhaDestinoId(caixa.id); setContaDestinoId(null); }}>
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
                  <Text style={[styles.transactionSectionLabel, { color: Cores.textoSecundario }]}>Categoria</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.transactionChipRow}>
                    {categorias.filter((c) => c.ativa !== 0 && c.tipo === tipoTransacao).map((cat) => (
                      <TouchableOpacity key={cat.id} style={[styles.catPill, styles.transactionChip, { backgroundColor: Cores.pillFundo, borderColor: catSelecionadaId === cat.id ? corTipoTransacao : Cores.borda }]} onPress={() => setCatSelecionadaId(cat.id)}>
                        <View style={[styles.colorDot, { backgroundColor: cat.cor }]} />
                        <Text style={{ color: Cores.textoPrincipal }}>{cat.nome}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

              <View style={styles.transactionActions}>
                <Button title="Cancelar" color={Cores.textoSecundario} onPress={() => setModalTransVisivel(false)} disabled={loadingTrans} style={styles.transactionActionButton} />
                <Button title={loadingTrans ? "Aguarde..." : (!foiPago || frequencia !== "unica" ? "Agendar" : "Registrar")} color={corTipoTransacao} onPress={salvarTransacao} disabled={loadingTrans} style={styles.transactionActionButton} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      )}
      {modalIaEmBreve && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalIaEmBreve(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, maxWidth: 390, alignItems: "center", borderTopWidth: 4, borderTopColor: "#7C6FF0" }]}>
            <View style={{ width: 68, height: 68, borderRadius: 24, backgroundColor: "#7C6FF022", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <MaterialIcons name="auto-awesome" size={36} color="#7C6FF0" />
            </View>
            <Text style={[styles.modalTitle, { color: Cores.textoPrincipal, marginBottom: 8 }]}>IA FinFlow</Text>
            <View style={{ backgroundColor: "#7C6FF022", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 14 }}>
              <Text style={{ color: "#7C6FF0", fontWeight: "900", letterSpacing: 1 }}>SMART E PREMIUM</Text>
            </View>
            <Text style={{ color: Cores.textoSecundario, textAlign: "center", lineHeight: 21, marginBottom: 20 }}>
              A IA financeira prepara lançamentos e consultas com confirmação segura. O recurso está disponível conforme o seu plano.
            </Text>
            <TouchableOpacity style={{ width: "100%", minHeight: 50, borderRadius: 12, backgroundColor: "#7C6FF0", alignItems: "center", justifyContent: "center" }} onPress={() => setModalIaEmBreve(false)}>
              <Text style={{ color: "#FFF", fontWeight: "800" }}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, padding: 16 },
  homeHero: { borderRadius: 24, padding: 20, paddingBottom: 24, overflow: "hidden", minHeight: 190 },
  homeHeroWaves: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  homeHeroWave: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },
  homeHeroWaveOne: { width: 420, height: 155, right: -175, top: 45, transform: [{ rotate: "-10deg" }] },
  homeHeroWaveTwo: { width: 390, height: 135, left: -205, top: 92, backgroundColor: "rgba(255,255,255,0.06)", transform: [{ rotate: "12deg" }] },
  homeHeroWaveThree: { width: 330, height: 105, right: -105, bottom: -58, backgroundColor: "rgba(0,55,48,0.10)", transform: [{ rotate: "-7deg" }] },
  homeHeroContent: { zIndex: 2 },
  homeHeroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  homeHeroGreeting: { color: "#FFF", fontSize: 20, fontWeight: "800" },
  homeMonthButton: { flexDirection: "row", alignItems: "center", marginTop: 3, alignSelf: "flex-start" },
  homeMonthText: { color: "rgba(255,255,255,0.78)", fontSize: 12, textTransform: "capitalize" },
  homeBell: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  homeBellBadge: { position: "absolute", right: 3, top: 3, width: 9, height: 9, borderRadius: 5, backgroundColor: "#FF6B5F", borderWidth: 1.5, borderColor: "#FFF" },
  homeBalanceLabel: { color: "rgba(255,255,255,0.72)", fontSize: 12, marginTop: 22 },
  homeBalanceRow: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start" },
  homeBalanceValue: { color: "#FFF", fontSize: 36, fontWeight: "900", letterSpacing: -0.5, marginTop: 2 },
  homeBalanceVisibility: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", marginTop: 2 },
  homeHeroTrend: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 9, backgroundColor: "rgba(0,0,0,0.13)", borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, alignSelf: "flex-start" },
  homeHeroTrendText: { color: "#B8F4D7", fontSize: 10, fontWeight: "600" },
  homeActions: { marginHorizontal: 10, marginTop: -12, borderRadius: 20, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 8, flexDirection: "row", justifyContent: "space-around", elevation: 6 },
  homeActionItem: { flex: 1, alignItems: "center", gap: 7 },
  homeActionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  homeActionLabel: { fontSize: 11, fontWeight: "700" },
  homeActionAlert: { position: "absolute", right: 1, top: 1, width: 9, height: 9, borderRadius: 5, backgroundColor: "#EE4B4B", borderWidth: 1.5, borderColor: "#FFF" },
  homeMonthCard: { marginTop: 14, borderRadius: 20, borderWidth: 1, padding: 16, elevation: 2 },
  homeSectionTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15 },
  homeSectionTitle: { fontSize: 15, fontWeight: "800" },
  homeCalendarIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  homeMonthMetrics: { flexDirection: "row", justifyContent: "space-between" },
  homeMetricColumn: { flex: 1, minWidth: 0 },
  homeMetricInfoButton: { borderRadius: 10, paddingVertical: 2 },
  homeMetricLabelRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  homeMetricLabel: { fontSize: 10, marginBottom: 4 },
  homeMetricValue: { fontSize: 14, fontWeight: "800" },
  homeMonthTrack: { height: 5, borderRadius: 3, overflow: "hidden", flexDirection: "row", marginTop: 14 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 16, backgroundColor: "#15966E", padding: 18, borderRadius: 22, minHeight: 104 },
  greeting: { fontSize: 24, fontWeight: "bold" },
  subtitle: { fontSize: 14, marginTop: 2 },
  iaBotaoFixo: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 5,
    marginLeft: 10,
  },
  iaBotaoTexto: { color: "#FFF", fontWeight: "bold", fontSize: 13 },
  actionGrid: { marginBottom: 18, gap: 10, padding: 4, borderRadius: 18 },
  actionRow: { flexDirection: "row", gap: 10 },
  actionButton: { flex: 1, flexDirection: "row", minHeight: 58, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  actionButtonFull: { flexDirection: "row", minHeight: 56, paddingVertical: 12, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
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
  balanceCard: { backgroundColor: "#1A1A1A", padding: 20, borderRadius: 22, marginBottom: 20, elevation: 4 },
  balanceTitle: { color: "#999", fontSize: 14, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 },
  balanceAmount: { color: "#FFF", fontSize: 36, fontWeight: "bold", marginTop: 5 },
  section: { marginBottom: 25 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15 },
  sectionTitle: { fontSize: 18, fontWeight: "bold" },
  hintText: { fontSize: 12, fontStyle: "italic" },
  emptyText: { fontStyle: "italic", textAlign: "center", marginTop: 10 },
  accountsGrid: { gap: 12, paddingRight: 16 },
  accountsGridSingle: { flexGrow: 1, justifyContent: "center", paddingRight: 0 },
  accountCard: { padding: 18, borderRadius: 18, width: 255, minHeight: 112, elevation: 2, justifyContent: "center" },
  accountName: { fontSize: 16, fontWeight: "600" },
  accountBalance: { fontSize: 20, fontWeight: "bold", marginTop: 4 },
  addContaBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, gap: 4 },
  addContaBtnText: { color: "#FFF", fontWeight: "bold", fontSize: 13 },
  graficoCard: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 15 },
  graficoTitulo: { fontSize: 14, fontWeight: "bold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.7)", justifyContent: "center", alignItems: "center" },
  modalContent: { width: "92%", maxWidth: 520, padding: 22, borderRadius: 22, elevation: 10 },
  balanceExplanationPanel: { width: "92%", maxWidth: 460, borderRadius: 24, borderWidth: 1, padding: 22, elevation: 12 },
  balanceExplanationIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 14 },
  balanceExplanationTitle: { fontSize: 20, lineHeight: 25, fontWeight: "900", textAlign: "center" },
  balanceExplanationText: { fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8, marginBottom: 16 },
  balanceExplanationNote: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 15, padding: 13, marginBottom: 10 },
  balanceExplanationNoteText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: "600" },
  balanceExplanationButton: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 8 },
  balanceExplanationButtonText: { color: "#FFF", fontSize: 15, fontWeight: "900" },
  transactionOverlay: { flex: 1, backgroundColor: "rgba(2,12,15,0.78)", justifyContent: "flex-end", alignItems: "center" },
  transactionSheet: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "94%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 12,
    ...FinFlowShadow,
  },
  transactionHandle: { width: 42, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  transactionHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16 },
  transactionHeaderIcon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  transactionHeaderCopy: { flex: 1, minWidth: 0, paddingHorizontal: 11 },
  transactionTitle: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  transactionSubtitle: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  transactionClose: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  transactionForm: { paddingHorizontal: 20, paddingBottom: 26 },
  transactionSectionLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0.45, textTransform: "uppercase", marginBottom: 8 },
  transactionSelector: { minHeight: 50, borderRadius: FinFlowRadius.medium, padding: 4, marginBottom: 18 },
  transactionTypeButton: { minHeight: 40, borderRadius: 12 },
  transactionChoice: { minHeight: 40, borderRadius: 12 },
  transactionInputWrap: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: FinFlowRadius.medium,
    paddingHorizontal: 13,
    marginBottom: 13,
  },
  transactionTextInput: { flex: 1, minHeight: 52, fontSize: 15 },
  transactionCurrency: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  transactionPlainInput: { minHeight: 52, borderWidth: 1, borderRadius: FinFlowRadius.medium, paddingHorizontal: 14, fontSize: 15, marginBottom: 14 },
  transactionChipRow: { paddingRight: 12 },
  transactionChip: { minHeight: 42, borderWidth: 1.5, paddingHorizontal: 13, marginRight: 9 },
  transactionActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  transactionActionButton: { flex: 1, minWidth: 0, borderRadius: FinFlowRadius.medium },
  modalTitle: { fontSize: 20, fontWeight: "bold", marginBottom: 15, textAlign: "center" },
  notificationPanel: { width: "92%", maxWidth: 520, borderRadius: 24, borderWidth: 1, padding: 20, elevation: 12 },
  notificationHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  notificationHeaderIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  notificationTitle: { fontSize: 18, fontWeight: "900" },
  notificationSubtitle: { fontSize: 11, marginTop: 2 },
  notificationClose: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  notificationList: { gap: 10 },
  notificationItem: { flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 16, padding: 12 },
  notificationItemIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  notificationItemTitle: { fontSize: 13, fontWeight: "800" },
  notificationItemText: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  notificationEmpty: { alignItems: "center", paddingVertical: 22, paddingHorizontal: 20 },
  notificationEmptyTitle: { fontSize: 16, fontWeight: "800", marginTop: 8 },
  notificationEmptyText: { fontSize: 12, textAlign: "center", marginTop: 4 },
  notificationSettings: { minHeight: 46, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 17 },
  notificationSettingsText: { fontSize: 13, fontWeight: "800" },
  accountScopePanel: { width: "92%", maxWidth: 520, maxHeight: "90%", flexShrink: 1, borderRadius: 24, borderWidth: 1, padding: 20, elevation: 12 },
  accountScopeHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  accountScopeHeaderIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  accountScopeTitle: { fontSize: 18, fontWeight: "900" },
  accountScopeSubtitle: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  accountScopeCreate: { minHeight: 48, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 16 },
  accountScopeCreateText: { color: "#FFF", fontSize: 13, fontWeight: "900" },
  accountScopeSectionLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 0.8, marginBottom: 8 },
  accountScopeList: { maxHeight: 330, flexShrink: 1, minHeight: 0, marginTop: 8 },
  accountScopeOption: { minHeight: 54, borderRadius: 15, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  accountScopeManagedOption: { minHeight: 62, borderRadius: 15, borderWidth: 1, paddingLeft: 13, paddingRight: 8, flexDirection: "row", alignItems: "center", marginBottom: 8 },
  accountScopeSelectArea: { flex: 1, minWidth: 0, minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  accountScopeNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  accountScopeManageButton: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center", marginLeft: 7 },
  accountScopeCheck: { width: 23, height: 23, borderRadius: 7, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  accountScopeDot: { width: 10, height: 10, borderRadius: 5 },
  accountScopeOptionTitle: { fontSize: 13, fontWeight: "800" },
  accountScopeOptionText: { fontSize: 10, marginTop: 2 },
  accountScopeArchivedToggle: { minHeight: 58, borderTopWidth: 1, marginTop: 7, paddingVertical: 10, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 10 },
  accountScopeArchivedIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  accountScopeArchivedRow: { minHeight: 56, borderRadius: 14, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 7, opacity: 0.86 },
  accountScopeHint: { fontSize: 10, lineHeight: 15, marginTop: 4 },
  accountScopeEmptyWarning: { color: "#E76F51", fontSize: 10, lineHeight: 15, fontWeight: "700", marginTop: 5 },
  accountScopeActions: { flexDirection: "row", gap: 10, marginTop: 17 },
  accountScopeCancel: { flex: 1, minHeight: 47, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  accountScopeCancelText: { fontSize: 13, fontWeight: "800" },
  accountScopeApply: { flex: 1.35, minHeight: 47, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  accountScopeApplyDisabled: { opacity: 0.38 },
  accountScopeApplyText: { color: "#FFF", fontSize: 13, fontWeight: "900" },
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
