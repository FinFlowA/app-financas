import { MaterialIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Crypto from "expo-crypto";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Animated,
  Alert,
  DeviceEventEmitter,
  Modal,
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
import { useAppTheme } from "../_layout";
import { fmtReais, formatarEntradaMoeda, valorDaEntradaMoeda } from "../../lib/utils";
import { compararHistoricoPorData, dataVencimentoFaturaHistorico } from "../../lib/history-order";
import {
  fallbackTransactionPaymentSummary,
  normalizeTransactionPaymentHistory,
  normalizeTransactionPaymentSummaries,
  shouldShowTransactionPaymentBreakdown,
  type TransactionPaymentHistory,
  type TransactionPaymentSummary,
} from "../../lib/transaction-payments";
import {
  dispositivoSemConexao,
  mensagemFalhaEdicaoOffline,
  OFFLINE_EDIT_SAVED_MESSAGE,
  OFFLINE_SYNC_COMPLETED_EVENT,
  salvarEdicaoFinanceira,
} from "../../lib/offline-sync";
import { FinFlowTabHeader, finFlowTheme } from "../../constants/finflow-design";
import {
  createInvoiceOperationRequestId,
  listInvoicePaymentTransactions,
  parseInvoicePaymentMarker,
  reverseInvoicePayment,
} from "../../lib/invoice-operations";
import {
  descricaoBaseRecorrencia,
  descricaoVisivel,
  dataEfetivaTransacao,
  getContaDestinoTransferencia,
  getIdSerie,
  getMovimentoObjetivo,
  getParcelaRecorrencia,
  isMovimentoObjetivo,
  isRecorrenciaFixa,
  isTransferencia,
  substituirDescricaoBase,
} from "../../lib/transacoes";

interface Categoria {
  id: number;
  nome: string;
  cor: string;
  icone: string;
  tipo: "receita" | "despesa" | "ambos";
  ativa: number;
}
interface Conta {
  id: number;
  nome: string;
  saldo_inicial: number;
  arquivado?: boolean;
}
interface FaturaGrupo {
  cartao_id: number;
  cartao_nome: string;
  cartao_cor: string;
  mes_fatura: string;
  total: number;
  pago: boolean;
  itens_ids: number[];
  itens: { id: number; descricao: string; valor: number; categoria_id: number | null }[];
  dia_vencimento: number;
  filtrada?: boolean;
}
interface Transacao {
  id: number;
  user_id?: string;
  tipo: string;
  valor: number;
  data_vencimento: string;
  data_realizacao?: string | null;
  descricao: string;
  categoria_id: number | null;
  conta_id: number;
  status: string;
  version?: number;
  transacao_pai_id?: number | null;
}

type ItemHistorico =
  | {
      tipo: "transacao";
      chave: string;
      ordemId: number;
      data: string;
      transacao: Transacao;
    }
  | {
      tipo: "fatura";
      chave: string;
      ordemId: number;
      data: string;
      fatura: FaturaGrupo;
    };

type TipoFiltroHistorico = "receita" | "despesa" | "transferencia" | "fatura";

const getEstiloBanco = (nome: string, isDark: boolean) => {
  const n = nome.toLowerCase();
  if (n.includes("nu") || n.includes("nubank")) return { bg: "#8A05BE", text: "#FFF" };
  if (n.includes("itaú") || n.includes("itau")) return { bg: "#EC7000", text: "#FFF" };
  if (n.includes("inter")) return { bg: "#FF7A00", text: "#FFF" };
  if (n.includes("bradesco")) return { bg: "#CC092F", text: "#FFF" };
  if (n.includes("brasil") || n.includes("bb")) return { bg: "#F9D300", text: "#0038A8" };
  if (n.includes("santander")) return { bg: "#EC0000", text: "#FFF" };
  if (n.includes("caixa")) return { bg: "#005CA9", text: "#FFF" };
  if (n.includes("c6")) return { bg: "#242424", text: "#FFF" };
  if (n.includes("carteira") || n.includes("dinheiro")) return { bg: "#2A9D8F", text: "#FFF" };
  return { bg: isDark ? "#333" : "#E3F2FD", text: isDark ? "#FFF" : "#1976D2" };
};

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const getNomeMes = (mes: string) => MESES[parseInt(mes, 10) - 1];

const formatarMesAno = (yyyymm: string) => {
  if (!yyyymm) return "";
  const [ano, mes] = yyyymm.split("-");
  return `${getNomeMes(mes)} ${ano}`;
};

const HEADER_EXPANDED_HEIGHT = FinFlowTabHeader.expandedHeight;
const HEADER_COMPACT_HEIGHT = FinFlowTabHeader.compactHeight;
const HEADER_COLLAPSE_DISTANCE = HEADER_EXPANDED_HEIGHT - HEADER_COMPACT_HEIGHT;

const chaveDataLocal = (data: Date) =>
  `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;

const formatarDataCurta = (data: Date) =>
  `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;

const normalizarBusca = (valor: string) => (valor || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

export default function TransacoesScreen() {
  const { isDark, session, showToast } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ filtroPeriodo?: "hoje" | "proximos-7-dias" | "atrasados" | string }>();
  const novoTema = finFlowTheme(isDark);

  const Cores = {
    fundo: novoTema.background,
    textoPrincipal: novoTema.text,
    textoSecundario: novoTema.textMuted,
    cardFundo: novoTema.surface,
    blocoData: novoTema.surfaceMuted,
    borda: novoTema.border,
    pillFundo: novoTema.surfaceMuted,
    headerTabela: novoTema.surfaceMuted,
    rowPar: novoTema.background,
    rowImpar: novoTema.surface,
  };

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [faturaGrupos, setFaturaGrupos] = useState<FaturaGrupo[]>([]);
  const [faturaAbrirCartao, setFaturaAbrirCartao] = useState<FaturaGrupo | null>(null);
  const [faturaEstornar, setFaturaEstornar] = useState<FaturaGrupo | null>(null);
  const [transacaoDetalhe, setTransacaoDetalhe] = useState<Transacao | null>(null);
  const [resumosPagamentos, setResumosPagamentos] = useState<Map<number, TransactionPaymentSummary>>(new Map());
  const [historicoPagamentosDetalhe, setHistoricoPagamentosDetalhe] = useState<TransactionPaymentHistory | null>(null);
  const [carregandoPagamentosDetalhe, setCarregandoPagamentosDetalhe] = useState(false);
  const [erroPagamentosDetalhe, setErroPagamentosDetalhe] = useState<string | null>(null);
  const [transacaoEstornarPagamento, setTransacaoEstornarPagamento] = useState<Transacao | null>(null);
  const [avisoPagamentoVinculado, setAvisoPagamentoVinculado] = useState<{
    titulo: string;
    mensagem: string;
  } | null>(null);
  const requisicaoHistoricoPagamentosRef = useRef(0);

  const [filtroContas, setFiltroContas] = useState<number[]>([]);
  const [filtroCategorias, setFiltroCategorias] = useState<number[]>([]);
  // Lista vazia significa "todos". Os demais tipos podem ser combinados.
  const [filtrosTipo, setFiltrosTipo] = useState<TipoFiltroHistorico[]>([]);
  const [filtroVencidas, setFiltroVencidas] = useState(false);
  const [filtroHoje, setFiltroHoje] = useState(false);
  const [filtroProximosSeteDias, setFiltroProximosSeteDias] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "concluidos" | "pendentes">("todos");
  const [busca, setBusca] = useState("");
  const [paginaAtual, setPaginaAtual] = useState(1);
  const ITENS_POR_PAGINA = 30;

  const [modalFiltroConta, setModalFiltroConta] = useState(false);
  const [modalFiltroCat, setModalFiltroCat] = useState(false);
  const [modalFiltroTipo, setModalFiltroTipo] = useState(false);
  const [modalFiltroAno, setModalFiltroAno] = useState(false);

  // Edit transaction modal
  const [modalEditarTransVisivel, setModalEditarTransVisivel] = useState(false);
  const [transacaoEditando, setTransacaoEditando] = useState<Transacao | null>(null);
  const [editDescricao, setEditDescricao] = useState("");
  const [editValor, setEditValor] = useState("");
  const [editData, setEditData] = useState(new Date());
  const [editStatus, setEditStatus] = useState<"paga" | "pendente">("paga");
  const [editCategoriaId, setEditCategoriaId] = useState<number | null>(null);
  const [editContaId, setEditContaId] = useState<number | null>(null);
  const [mostrarCalendarioEdit, setMostrarCalendarioEdit] = useState(false);
  const [modalOpcoesSerie, setModalOpcoesSerie] = useState<{
    titulo: string; descricao: string;
    labelSimples: string;
    labelSerie?: string;
    labelFuturas?: string;
    onSimples: () => void;
    onSerie?: () => void;
    onFuturas?: () => void;
    corSerie?: string;
  } | null>(null);
  const [modalDeleteSimples, setModalDeleteSimples] = useState<Transacao | null>(null);
  const [transacaoConfirmar, setTransacaoConfirmar] = useState<Transacao | null>(null);
  const [loadingEstornoFatura, setLoadingEstornoFatura] = useState(false);
  const estornoRequestIdsRef = useRef(new Map<number, string>());
  const estornoFaturaAlvoRef = useRef<{ key: string; transactionId: number } | null>(null);
  const [dataRealizacao, setDataRealizacao] = useState(new Date());
  const [mostrarDataRealizacao, setMostrarDataRealizacao] = useState(false);
  const [ajusteTipo, setAjusteTipo] = useState<"nenhum" | "juros" | "desconto">("nenhum");
  const [ajusteValor, setAjusteValor] = useState("");
  const [valorRealizado, setValorRealizado] = useState("");
  const [salvandoRealizacao, setSalvandoRealizacao] = useState(false);
  const salvandoRealizacaoRef = useRef(false);
  const conclusaoRequestIdsRef = useRef(new Map<string, string>());
  const reaberturaRequestIdsRef = useRef(new Map<string, string>());

  const hoje = new Date();
  const anoAtualNum = hoje.getFullYear();
  const mesAtualChave = `${anoAtualNum}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const [anoSelecionado, setAnoSelecionado] = useState<number>(anoAtualNum);
  const [mesSelecionado, setMesSelecionado] = useState<string>(
    `${anoAtualNum}-${String(hoje.getMonth() + 1).padStart(2, "0")}`
  );
  const paginaScrollRef = useRef<any>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const cabecalhoCompactoRef = useRef(false);
  const [cabecalhoCompacto, setCabecalhoCompacto] = useState(false);

  const alterarAno = (direcao: number) => {
    setFiltroHoje(false);
    setFiltroProximosSeteDias(false);
    setFiltroVencidas(false);
    const novoAno = anoSelecionado + direcao;
    setAnoSelecionado(novoAno);
    const mesNum = mesSelecionado.split("-")[1];
    setMesSelecionado(`${novoAno}-${mesNum}`);
    setPaginaAtual(1);
  };

  const alterarMes = (direcao: number) => {
    setFiltroHoje(false);
    setFiltroProximosSeteDias(false);
    setFiltroVencidas(false);
    const [ano, mes] = mesSelecionado.split("-").map(Number);
    const proximo = new Date(ano, mes - 1 + direcao, 1);
    const novoAno = proximo.getFullYear();
    const novoMes = `${novoAno}-${String(proximo.getMonth() + 1).padStart(2, "0")}`;
    setAnoSelecionado(novoAno);
    setMesSelecionado(novoMes);
    setPaginaAtual(1);
  };

  const carregarDados = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const [resCategorias, resContas, resTransacoes, resCartoes, resFaturas] = await Promise.all([
        supabase.from("categorias").select("id, nome, cor, icone, tipo, ativa").eq("user_id", session.user.id),
        supabase.from("contas").select("id, nome, saldo_inicial, arquivado"),
        supabase.from("transacoes").select("id, user_id, tipo, valor, data_vencimento, data_realizacao, descricao, categoria_id, conta_id, status, version, transacao_pai_id"),
        supabase.from("cartoes").select("id, nome, cor, dia_vencimento").eq("user_id", session.user.id).eq("ativo", true),
        supabase.from("fatura_itens").select("id, cartao_id, descricao, valor, mes_fatura, pago, categoria_id").eq("user_id", session.user.id),
      ]);
      if (resCategorias.data) {
        setCategorias([...resCategorias.data].sort((a, b) =>
          a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
        ));
      }
      if (resContas.data) setContas(resContas.data);
      if (resTransacoes.data) {
        const todas = resTransacoes.data as Transacao[];
        const raizes = todas.filter((transacao) => transacao.transacao_pai_id == null);
        setTransacoes(todas);
        let resumos = normalizeTransactionPaymentSummaries([], raizes);
        if (raizes.length > 0) {
          const { data: dadosResumo, error: erroResumo } = await supabase.rpc(
            "list_transaction_payment_summaries",
            { p_transaction_ids: raizes.map((transacao) => transacao.id) },
          );
          if (!erroResumo) {
            resumos = normalizeTransactionPaymentSummaries(dadosResumo, raizes);
          } else if (erroResumo.code !== "PGRST202") {
            console.warn("Falha ao carregar resumos de pagamentos do Histórico:", erroResumo.message);
          }
        }
        setResumosPagamentos(resumos);
      }

      // Agrupar fatura_itens por (cartao_id, mes_fatura)
      if (resCartoes.data && resFaturas.data) {
        const cartaoMap = new Map<number, { nome: string; cor: string; dia_vencimento: number }>();
        resCartoes.data.forEach((c: any) => {
          cartaoMap.set(c.id, { nome: c.nome, cor: c.cor, dia_vencimento: c.dia_vencimento });
        });

        const grupos = new Map<string, FaturaGrupo>();
        resFaturas.data.forEach((item: any) => {
          // Ignora itens de cartões arquivados (não estão no cartaoMap)
          const cartao = cartaoMap.get(item.cartao_id);
          if (!cartao) return;
          const key = `${item.cartao_id}_${item.mes_fatura}`;
          let grupo = grupos.get(key);
          if (!grupo) {
            grupo = {
              cartao_id: item.cartao_id,
              cartao_nome: cartao.nome,
              cartao_cor: cartao.cor,
              mes_fatura: item.mes_fatura,
              total: 0,
              pago: true,
              itens_ids: [],
              itens: [],
              dia_vencimento: cartao.dia_vencimento,
            };
            grupos.set(key, grupo);
          }
          grupo.total += Number(item.valor);
          if (!item.pago) grupo.pago = false;
          grupo.itens_ids.push(item.id);
          grupo.itens.push({
            id: item.id,
            descricao: item.descricao || "",
            valor: Number(item.valor),
            categoria_id: item.categoria_id ?? null,
          });
        });
        setFaturaGrupos(Array.from(grupos.values()));
      }
    } catch (error) {
      console.error(error);
    }
  }, [session?.user?.id]);

  useFocusEffect(useCallback(() => {
    setTransacaoConfirmar(null);
    carregarDados();
  }, [carregarDados]));

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

  React.useEffect(() => {
    const filtroRecebido = params.filtroPeriodo;
    if (filtroRecebido !== "hoje" && filtroRecebido !== "proximos-7-dias" && filtroRecebido !== "atrasados") return;

    const agora = new Date();
    setAnoSelecionado(agora.getFullYear());
    setMesSelecionado(`${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`);
    setFiltroContas([]);
    setFiltroCategorias([]);
    setFiltrosTipo([]);
    setFiltroVencidas(filtroRecebido === "atrasados");
    setFiltroHoje(filtroRecebido === "hoje");
    setFiltroStatus("todos");
    setBusca("");
    setPaginaAtual(1);
    setFiltroProximosSeteDias(filtroRecebido === "proximos-7-dias");
    router.setParams({ filtroPeriodo: "" });
    requestAnimationFrame(() => paginaScrollRef.current?.scrollTo({ y: 0, animated: true }));
    // O parâmetro do sino é consumido uma vez; os filtros podem ser alterados livremente depois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.filtroPeriodo]);

  const transacoesPrincipais = useMemo(
    () => transacoes.filter((transacao) => transacao.transacao_pai_id == null),
    [transacoes],
  );

  const resumoPagamentoDaTransacao = useCallback((transacao: Transacao) =>
    resumosPagamentos.get(transacao.id) ?? fallbackTransactionPaymentSummary(transacao),
  [resumosPagamentos]);

  const temPagamentosRegistrados = useCallback((transactionId: number) =>
    (resumosPagamentos.get(transactionId)?.paymentCount ?? 0) > 0,
  [resumosPagamentos]);

  const fecharDetalheTransacao = useCallback(() => {
    requisicaoHistoricoPagamentosRef.current += 1;
    setTransacaoDetalhe(null);
    setHistoricoPagamentosDetalhe(null);
    setErroPagamentosDetalhe(null);
    setCarregandoPagamentosDetalhe(false);
  }, []);

  const abrirDetalheTransacao = useCallback(async (transacao: Transacao) => {
    const fallback = fallbackTransactionPaymentSummary(transacao);
    const requestNumber = requisicaoHistoricoPagamentosRef.current + 1;
    requisicaoHistoricoPagamentosRef.current = requestNumber;
    setTransacaoDetalhe(transacao);
    setHistoricoPagamentosDetalhe({
      summary: resumosPagamentos.get(transacao.id) ?? fallback,
      payments: [],
    });
    setErroPagamentosDetalhe(null);
    setCarregandoPagamentosDetalhe(true);

    const { data, error } = await supabase.rpc(
      "get_transaction_payment_history",
      { p_transaction_id: transacao.id },
    );
    if (requisicaoHistoricoPagamentosRef.current !== requestNumber) return;
    setCarregandoPagamentosDetalhe(false);
    if (error) {
      if (error.code !== "PGRST202") {
        setErroPagamentosDetalhe("Não foi possível carregar a lista de pagamentos agora.");
      }
      return;
    }
    const historico = normalizeTransactionPaymentHistory(data, transacao);
    setHistoricoPagamentosDetalhe(historico);
    setResumosPagamentos((atuais) => {
      const proximos = new Map(atuais);
      proximos.set(historico.summary.rootTransactionId, historico.summary);
      return proximos;
    });
  }, [resumosPagamentos]);

  const buscarObjetivoDoMovimento = async (descricao?: string | null) => {
    const movimento = getMovimentoObjetivo(descricao);
    if (!movimento) return { movimento: null, caixinha: null };

    let consulta = supabase.from("caixinhas").select("id, saldo_atual");
    consulta = movimento.objetivoId !== null
      ? consulta.eq("id", movimento.objetivoId)
      : consulta.ilike("nome", movimento.nomeLegado ?? "");
    const { data } = await consulta.maybeSingle();
    return { movimento, caixinha: data };
  };

  const executarEstornoPagamentoPorId = async (transactionId: number) => {
    const requestId = estornoRequestIdsRef.current.get(transactionId)
      ?? createInvoiceOperationRequestId();
    estornoRequestIdsRef.current.set(transactionId, requestId);
    await reverseInvoicePayment(transactionId, requestId);
    estornoRequestIdsRef.current.delete(transactionId);
  };

  const estornarTransacaoDeFatura = async (transacao: Transacao) => {
    if (loadingEstornoFatura) return;
    setLoadingEstornoFatura(true);
    try {
      await executarEstornoPagamentoPorId(transacao.id);
      setModalDeleteSimples(null);
      showToast("Pagamento da fatura estornado", "success");
      await carregarDados();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível estornar o pagamento.", "error");
      await carregarDados();
    } finally {
      setLoadingEstornoFatura(false);
    }
  };

  const estornarPagamentosDaFatura = async (grupo: FaturaGrupo) => {
    if (!session?.user?.id || loadingEstornoFatura) return;
    setLoadingEstornoFatura(true);
    try {
      const key = `${grupo.cartao_id}:${grupo.mes_fatura}`;
      let transactionId = estornoFaturaAlvoRef.current?.key === key
        ? estornoFaturaAlvoRef.current.transactionId
        : null;
      if (transactionId === null) {
        const pagamentos = await listInvoicePaymentTransactions(
          session.user.id,
          grupo.cartao_id,
          grupo.mes_fatura,
        );
        transactionId = pagamentos[0]?.id ?? null;
        if (transactionId !== null) {
          estornoFaturaAlvoRef.current = { key, transactionId };
        }
      }
      if (transactionId === null) {
        throw new Error("Nenhum pagamento rastreável foi encontrado para esta fatura.");
      }
      await executarEstornoPagamentoPorId(transactionId);
      estornoFaturaAlvoRef.current = null;
      setFaturaEstornar(null);
      showToast("Pagamento mais recente da fatura estornado", "success");
      await carregarDados();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível estornar o pagamento.", "error");
      await carregarDados();
    } finally {
      setLoadingEstornoFatura(false);
    }
  };

  const executarDeleteUma = async (transacao: Transacao) => {
    if (parseInvoicePaymentMarker(transacao.descricao)) {
      await estornarTransacaoDeFatura(transacao);
      return;
    }
    if (temPagamentosRegistrados(transacao.id)) {
      setAvisoPagamentoVinculado({
        titulo: "Pagamentos vinculados",
        mensagem: "Estorne os pagamentos deste agendamento, sempre do mais recente para o mais antigo, antes de excluí-lo. O histórico já realizado não será apagado.",
      });
      return;
    }
    const { error } = await supabase.from("transacoes").delete().eq("id", transacao.id);
    if (error) { Alert.alert("Erro", "Não foi possível apagar a transação."); return; }

    if (transacao.status === "paga") {
      const { movimento, caixinha } = await buscarObjetivoDoMovimento(transacao.descricao);
      if (movimento && caixinha) {
        const novoSaldo = movimento.operacao === "guardar"
          ? Math.max(0, Number(caixinha.saldo_atual) - Number(transacao.valor))
          : Number(caixinha.saldo_atual) + Number(transacao.valor);
        await supabase.from("caixinhas").update({ saldo_atual: novoSaldo }).eq("id", caixinha.id);
      }
    }
    carregarDados();
  };

  const deletarFuturas = async (transacao: Transacao) => {
    const desc = transacao.descricao ?? "";
    const isFixa = isRecorrenciaFixa(desc);
    const parcelaReferencia = getParcelaRecorrencia(desc);
    if (isFixa) {
      const serieReferencia = getIdSerie(desc);
      const ids = transacoesPrincipais
        .filter((item) => item.user_id === session.user.id
          && item.status !== "paga"
          && item.data_vencimento >= transacao.data_vencimento
          && !temPagamentosRegistrados(item.id)
          && (serieReferencia !== null
            ? getIdSerie(item.descricao) === serieReferencia
            : item.descricao === desc))
        .map((item) => item.id);
      const { error } = ids.length > 0
        ? await supabase.from("transacoes").delete().in("id", ids)
        : { error: null };
      if (error) Alert.alert("Erro", "Não foi possível apagar.");
    } else if (parcelaReferencia) {
      const serieReferencia = getIdSerie(desc);
      const destinoReferencia = getContaDestinoTransferencia(desc);
      const objetivoReferencia = getMovimentoObjetivo(desc);
      const ids = transacoes
        .filter((t) => {
          const parcela = getParcelaRecorrencia(t.descricao);
          const objetivo = getMovimentoObjetivo(t.descricao);
          const pertenceASerie = serieReferencia !== null
            ? getIdSerie(t.descricao) === serieReferencia
            : parcela?.base === parcelaReferencia.base
              && parcela?.total === parcelaReferencia.total
              && getContaDestinoTransferencia(t.descricao) === destinoReferencia
              && objetivo?.objetivoId === objetivoReferencia?.objetivoId
              && objetivo?.operacao === objetivoReferencia?.operacao;
          return parcela
            && pertenceASerie
            && t.transacao_pai_id == null
            && parcela.atual >= parcelaReferencia.atual
            && t.conta_id === transacao.conta_id
            && t.tipo === transacao.tipo
            && t.status !== "paga"
            && !temPagamentosRegistrados(t.id);
        })
        .map((t) => t.id);
      if (ids.length > 0) {
        const { error } = await supabase.from("transacoes").delete().in("id", ids);
        if (error) Alert.alert("Erro", "Não foi possível apagar.");
      }
    }
    carregarDados();
  };

  const deletarTodasParcelasEmAberto = async (transacao: Transacao) => {
    const parcelaReferencia = getParcelaRecorrencia(transacao.descricao);
    if (!parcelaReferencia) return;
    const serieReferencia = getIdSerie(transacao.descricao);
    const destinoReferencia = getContaDestinoTransferencia(transacao.descricao);
    const objetivoReferencia = getMovimentoObjetivo(transacao.descricao);
    const idsParaDeletar = transacoes
      .filter((t) => {
        const parcela = getParcelaRecorrencia(t.descricao);
        const objetivo = getMovimentoObjetivo(t.descricao);
        const pertenceASerie = serieReferencia !== null
          ? getIdSerie(t.descricao) === serieReferencia
          : parcela?.base === parcelaReferencia.base
            && parcela?.total === parcelaReferencia.total
            && getContaDestinoTransferencia(t.descricao) === destinoReferencia
            && objetivo?.objetivoId === objetivoReferencia?.objetivoId
            && objetivo?.operacao === objetivoReferencia?.operacao;
        return parcela
          && pertenceASerie
          && t.transacao_pai_id == null
          && t.conta_id === transacao.conta_id
          && t.tipo === transacao.tipo
          && t.status !== "paga"
          && !temPagamentosRegistrados(t.id);
      })
      .map((t) => t.id);

    if (idsParaDeletar.length === 0) return;
    const { error } = await supabase.from("transacoes").delete().in("id", idsParaDeletar);
    if (error) Alert.alert("Erro", "Não foi possível apagar as parcelas em aberto.");
    carregarDados();
  };

  const deletarSerie = async (transacao: Transacao) => {
    const base = descricaoBaseRecorrencia(transacao.descricao);
    const serieReferencia = getIdSerie(transacao.descricao);
    const destinoReferencia = getContaDestinoTransferencia(transacao.descricao);
    const objetivoReferencia = getMovimentoObjetivo(transacao.descricao);
    const idsParaDeletar = transacoes
      .filter((t) => {
        if (t.transacao_pai_id != null || !isRecorrenciaFixa(t.descricao) || t.status === "paga") return false;
        if (temPagamentosRegistrados(t.id)) return false;
        if (t.conta_id !== transacao.conta_id || t.tipo !== transacao.tipo) return false;
        if (serieReferencia !== null) return getIdSerie(t.descricao) === serieReferencia;

        const objetivo = getMovimentoObjetivo(t.descricao);
        return descricaoBaseRecorrencia(t.descricao) === base
          && getContaDestinoTransferencia(t.descricao) === destinoReferencia
          && objetivo?.objetivoId === objetivoReferencia?.objetivoId
          && objetivo?.operacao === objetivoReferencia?.operacao;
      })
      .map((t) => t.id);
    const { error } = idsParaDeletar.length
      ? await supabase.from("transacoes").delete().in("id", idsParaDeletar)
      : { error: null };
    if (error) Alert.alert("Erro", "Não foi possível apagar a série.");
    carregarDados();
  };

  const deletarTransacao = (id: number) => {
    const transacao = transacoes.find((t) => t.id === id);
    if (!transacao) return;

    const descricao = transacao.descricao ?? "";
    if (parseInvoicePaymentMarker(descricao)) {
      setModalDeleteSimples(transacao);
      return;
    }
    if (temPagamentosRegistrados(transacao.id)) {
      setAvisoPagamentoVinculado({
        titulo: "Pagamentos vinculados",
        mensagem: "Este agendamento já possui pagamentos. Estorne o mais recente no detalhe antes de tentar excluir. Os pagamentos anteriores nunca são apagados pelo fluxo genérico.",
      });
      return;
    }
    const isFixa = isRecorrenciaFixa(descricao);
    const parcelada = getParcelaRecorrencia(descricao);

    if (transacao.status !== "paga" && (isFixa || parcelada)) {
      setModalOpcoesSerie({
        titulo: "Apagar Agendamento",
        descricao: "Esta transação faz parte de uma série. O que deseja apagar?",
        labelSimples: "Apenas esta",
        // Parceladas: "Esta e as próximas" | Recorrentes: "Toda a série"
        ...(parcelada ? {
          labelFuturas: "Esta e as próximas",
          onFuturas: () => { setModalOpcoesSerie(null); deletarFuturas(transacao); },
          labelSerie: "Todas as parcelas em aberto",
          corSerie: "#E76F51",
          onSerie: () => { setModalOpcoesSerie(null); deletarTodasParcelasEmAberto(transacao); },
        } : {
          labelSerie: "Toda a série",
          corSerie: "#E76F51",
          onSerie: () => {
            setModalOpcoesSerie(null);
            deletarSerie(transacao);
          },
        }),
        onSimples: () => { setModalOpcoesSerie(null); executarDeleteUma(transacao); },
      });
    } else {
      setModalDeleteSimples(transacao);
    }
  };

  const isRecorrente = (t: Transacao) =>
    isRecorrenciaFixa(t.descricao) || getParcelaRecorrencia(t.descricao) !== null;

  const descricaoBase = (desc: string) =>
    descricaoBaseRecorrencia(desc);

  const ehMovimentoInternoSemCategoria = (t: Transacao) => {
    const descricao = t.descricao ?? "";
    return isTransferencia(descricao)
      || isMovimentoObjetivo(descricao)
      || descricao.includes("[PagFatura:");
  };

  const validarCategoriaEdicao = () => {
    if (!transacaoEditando || ehMovimentoInternoSemCategoria(transacaoEditando)) return true;
    if (transacaoEditando.tipo !== "receita" && transacaoEditando.tipo !== "despesa") return true;

    const categoria = categorias.find((item) => item.id === editCategoriaId);
    const categoriaCompativel = categoria
      && categoria.ativa !== 0
      && (categoria.tipo === transacaoEditando.tipo || categoria.tipo === "ambos");

    if (categoriaCompativel) return true;

    Alert.alert(
      "Categoria obrigatória",
      `Selecione uma categoria ativa de ${transacaoEditando.tipo === "receita" ? "receita" : "despesa"} antes de salvar.`,
    );
    return false;
  };

  const abrirEditarTransacao = (t: Transacao) => {
    if (parseInvoicePaymentMarker(t.descricao)) {
      showToast("Pagamentos de fatura só podem ser estornados.", "info");
      return;
    }
    setTransacaoEditando(t);
    setEditDescricao(isRecorrente(t) ? descricaoBase(t.descricao) : descricaoVisivel(t.descricao));
    setEditValor(formatarEntradaMoeda(String(Math.round(Number(t.valor) * 100))));
    const partes = (t.data_vencimento || new Date().toISOString().split("T")[0]).split("-");
    setEditData(new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2])));
    setEditStatus(t.status === "paga" ? "paga" : "pendente");
    setEditCategoriaId(t.categoria_id);
    setEditContaId(t.conta_id);
    setModalEditarTransVisivel(true);
  };

  const executarEdicao = async (apenasEsta: boolean) => {
    if (!transacaoEditando) return;
    if (!apenasEsta && temPagamentosRegistrados(transacaoEditando.id)) {
      setAvisoPagamentoVinculado({
        titulo: "Edição individual",
        mensagem: "Como este agendamento já possui pagamentos, somente o saldo restante pode ser editado individualmente. Os pagamentos anteriores permanecem imutáveis.",
      });
      return;
    }
    if (!validarCategoriaEdicao()) return;
    const valorNum = valorDaEntradaMoeda(editValor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) return Alert.alert("Aviso", "Valor inválido.");
    const dataFormatada = `${editData.getFullYear()}-${String(editData.getMonth() + 1).padStart(2, "0")}-${String(editData.getDate()).padStart(2, "0")}`;
    const campos = { valor: valorNum, status: editStatus, categoria_id: editCategoriaId, conta_id: editContaId };

    const transacaoDoUsuarioAtual = transacaoEditando.user_id === session.user.id;
    if (!IS_LOCAL_DEMO && apenasEsta && transacaoDoUsuarioAtual && editStatus === transacaoEditando.status) {
      const descricaoOriginal = isRecorrente(transacaoEditando)
        ? descricaoBase(transacaoEditando.descricao)
        : descricaoVisivel(transacaoEditando.descricao);
      const changes: Record<string, unknown> = {};
      if (editDescricao.trim() !== descricaoOriginal.trim()) changes.description = editDescricao.trim();
      if (valorNum !== Number(transacaoEditando.valor)) changes.value = valorNum;
      if (dataFormatada !== transacaoEditando.data_vencimento) changes.scheduled_date = dataFormatada;
      if (editContaId !== transacaoEditando.conta_id) changes.account_id = editContaId;
      if (editCategoriaId !== transacaoEditando.categoria_id && editCategoriaId !== null) {
        changes.category_id = editCategoriaId;
      }
      if (Object.keys(changes).length === 0) {
        setModalEditarTransVisivel(false);
        setTransacaoEditando(null);
        return;
      }
      try {
        const resultado = await salvarEdicaoFinanceira(
          "update_transaction",
          transacaoEditando.id,
          Number(transacaoEditando.version),
          changes,
        );
        if (resultado.state === "rejected") {
          return Alert.alert("Não foi possível salvar", mensagemFalhaEdicaoOffline(resultado.errorCode));
        }
        if (resultado.state === "uncertain") {
          return Alert.alert("Sessão alterada", "Não foi possível confirmar a edição. Entre novamente e confira os dados antes de reenviar.");
        }
        setModalEditarTransVisivel(false);
        setTransacaoEditando(null);
        if (resultado.state === "queued") showToast(OFFLINE_EDIT_SAVED_MESSAGE, "info");
        else void carregarDados();
        return;
      } catch {
        return Alert.alert("Não foi possível salvar", "A edição não pôde ser protegida neste dispositivo. Tente novamente.");
      }
    }

    if (!IS_LOCAL_DEMO && await dispositivoSemConexao()) {
      return Alert.alert(
        "Conexão necessária",
        !apenasEsta
          ? "Editar uma série inteira ainda exige conexão para verificar todas as ocorrências."
          : !transacaoDoUsuarioAtual
            ? "Este lançamento compartilhado pertence a outro usuário e só pode ser editado com conexão."
            : "Concluir ou reabrir um lançamento altera saldos e ainda exige conexão.",
      );
    }

    if (apenasEsta) {
      const baseEditada = isRecorrente(transacaoEditando) ? descricaoBase(editDescricao) : editDescricao.trim();
      const descricaoAtualizada = substituirDescricaoBase(transacaoEditando.descricao, baseEditada);
      const { error } = await supabase.from("transacoes").update({ ...campos, descricao: descricaoAtualizada, data_vencimento: dataFormatada }).eq("id", transacaoEditando.id);
      if (error) return Alert.alert("Erro", "Não foi possível salvar as alterações.");
    } else {
      const base = descricaoBase(transacaoEditando.descricao);
      const serieId = getIdSerie(transacaoEditando.descricao);
      const novoBase = descricaoBase(editDescricao);
      const novoDia = editData.getDate();
      const { data: serie } = await supabase.from("transacoes")
        .select("id, descricao, data_vencimento, status, transacao_pai_id")
        .eq("user_id", session.user.id)
        .eq("conta_id", transacaoEditando.conta_id)
        .eq("tipo", transacaoEditando.tipo);
      const itens = (serie ?? []).filter((t) =>
        t.status !== "paga"
        && t.transacao_pai_id == null
        && !temPagamentosRegistrados(t.id)
        && (serieId !== null ? getIdSerie(t.descricao) === serieId : descricaoBase(t.descricao) === base)
      );
      const resultados = await Promise.all(
        itens.map((item) => {
          const partes = (item.data_vencimento || dataFormatada).split("-");
          const ano = parseInt(partes[0]);
          const mes = parseInt(partes[1]) - 1;
          const diasNoMes = new Date(ano, mes + 1, 0).getDate();
          const diaFinal = Math.min(novoDia, diasNoMes);
          const novaData = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(diaFinal).padStart(2, "0")}`;
          const novaDescricao = substituirDescricaoBase(item.descricao, novoBase);
          return supabase.from("transacoes").update({
            ...campos, status: editStatus, descricao: novaDescricao, data_vencimento: novaData,
          }).eq("id", item.id);
        })
      );
      if (resultados.some((r) => r.error)) return Alert.alert("Erro", "Não foi possível atualizar a série.");
    }

    setModalEditarTransVisivel(false);
    setTransacaoEditando(null);
    carregarDados();
  };

  const salvarEdicaoTransacao = async () => {
    if (!transacaoEditando) return;
    if (!validarCategoriaEdicao()) return;
    const valorNum = valorDaEntradaMoeda(editValor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) return Alert.alert("Aviso", "Valor inválido.");

    if (isRecorrente(transacaoEditando)
      && transacaoEditando.status !== "paga"
      && !temPagamentosRegistrados(transacaoEditando.id)) {
      setModalOpcoesSerie({
        titulo: "Editar Recorrência",
        descricao: "Deseja alterar apenas este lançamento ou toda a série?",
        labelSimples: "Só este",
        labelSerie: "Toda a série",
        onSimples: () => { setModalOpcoesSerie(null); executarEdicao(true); },
        onSerie: () => { setModalOpcoesSerie(null); executarEdicao(false); },
      });
    } else {
      executarEdicao(true);
    }
  };

  const aplicarStatus = async (transacao: Transacao, novoStatus: "paga" | "pendente", data?: Date) => {
    if (salvandoRealizacaoRef.current) return;
    salvandoRealizacaoRef.current = true;
    setSalvandoRealizacao(true);
    let saldoRestanteConfirmado = 0;

    try {
      const transacaoComum = (transacao.tipo === "receita" || transacao.tipo === "despesa")
        && !ehMovimentoInternoSemCategoria(transacao);

      if (novoStatus === "paga" && transacaoComum && transacao.categoria_id === null) {
        Alert.alert(
          "Categoria obrigatória",
          "Este lançamento antigo está sem categoria. Escolha uma categoria antes de concluir para manter seus relatórios corretos.",
          [
            { text: "Cancelar", style: "cancel" },
            { text: "Editar lançamento", onPress: () => abrirEditarTransacao(transacao) },
          ],
        );
        return;
      }

      if (novoStatus === "pendente") {
        if (transacaoComum) {
          const assinaturaReabertura = [
            transacao.id,
            transacao.status,
            Number(transacao.valor).toFixed(2),
            transacao.data_realizacao ?? "",
            transacao.descricao,
          ].join(":");
          let requestId = reaberturaRequestIdsRef.current.get(assinaturaReabertura);
          if (!requestId) {
            requestId = Crypto.randomUUID();
            reaberturaRequestIdsRef.current.set(assinaturaReabertura, requestId);
          }

          const { data: resultadoReabertura, error: erroReabertura } = await supabase.rpc(
            "reopen_transaction_completion",
            {
              p_transaction_id: transacao.id,
              p_idempotency_key: requestId,
            },
          );
          if (erroReabertura?.code === "PGRST202") {
            Alert.alert(
              "Atualização necessária",
              "A reabertura segura ainda não está disponível no servidor. Nada foi alterado.",
            );
            return;
          }
          if (erroReabertura) throw erroReabertura;
          if (!resultadoReabertura || resultadoReabertura.ok !== true) {
            throw new Error("A reabertura atômica não devolveu um recibo válido.");
          }
          reaberturaRequestIdsRef.current.delete(assinaturaReabertura);
        } else {
          const { data: reaberta, error: erroReabrir } = await supabase
            .from("transacoes")
            .update({ status: "pendente", data_realizacao: null })
            .eq("id", transacao.id)
            .select("id")
            .maybeSingle();
          if (erroReabrir) throw erroReabrir;
          if (!reaberta) throw new Error("O lançamento não pôde ser reaberto.");
        }
      } else {
        if (!data) throw new Error("A data de realização é obrigatória.");

        const dataFormatada = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
        const agendada = new Date(`${transacao.data_vencimento}T00:00:00`);
        const realizada = new Date(data);
        realizada.setHours(0, 0, 0, 0);
        const ajusteAplicavel = realizada > agendada;

        let valorDevido = Number(transacao.valor);
        const ajuste = valorDaEntradaMoeda(ajusteValor);
        if (ajusteAplicavel && ajusteTipo === "juros" && ajuste > valorDevido) {
          Alert.alert("Juros inválidos", "O ajuste de juros não pode ser maior que o valor original do lançamento.");
          return;
        }
        if (ajusteAplicavel && ajusteTipo === "desconto" && ajuste >= valorDevido) {
          Alert.alert("Desconto inválido", "O desconto precisa ser menor que o valor original do lançamento.");
          return;
        }
        if (ajusteAplicavel && ajusteTipo !== "nenhum" && ajuste > 0) {
          valorDevido = ajusteTipo === "juros"
            ? valorDevido + ajuste
            : Math.max(0.01, valorDevido - ajuste);
        }
        valorDevido = Math.round(valorDevido * 100) / 100;

        const permiteParcial = (transacao.tipo === "receita" || transacao.tipo === "despesa")
          && !ehMovimentoInternoSemCategoria(transacao);
        const valorInformado = permiteParcial ? valorDaEntradaMoeda(valorRealizado) : valorDevido;
        if (!Number.isFinite(valorInformado) || valorInformado <= 0) {
          Alert.alert("Valor inválido", "Informe quanto foi efetivamente pago ou recebido.");
          return;
        }
        if (valorInformado > valorDevido) {
          Alert.alert(
            "Valor acima do previsto",
            "O valor realizado não pode superar o valor devido. Se houve juros, informe o ajuste antes de confirmar.",
          );
          return;
        }

        const valorEfetivo = Math.round(valorInformado * 100) / 100;
        let conclusaoAtomicaExecutada = false;

        if (permiteParcial) {
          const ajusteServidor = !ajusteAplicavel || ajusteTipo === "nenhum" || ajuste <= 0
            ? "none"
            : ajusteTipo === "juros" ? "interest" : "discount";
          const valorAjusteServidor = ajusteServidor === "none" ? 0 : ajuste;
          const assinaturaConclusao = [
            transacao.id,
            Number(transacao.valor).toFixed(2),
            ajusteServidor,
            valorAjusteServidor.toFixed(2),
            valorEfetivo.toFixed(2),
            dataFormatada,
          ].join(":");
          let requestId = conclusaoRequestIdsRef.current.get(assinaturaConclusao);
          if (!requestId) {
            requestId = Crypto.randomUUID();
            conclusaoRequestIdsRef.current.set(assinaturaConclusao, requestId);
          }

          const { data: resultadoAtomico, error: erroAtomico } = await supabase.rpc(
            "complete_transaction_with_partial",
            {
              p_transaction_id: transacao.id,
              p_expected_value: Number(transacao.valor),
              p_adjustment_type: ajusteServidor,
              p_adjustment_value: valorAjusteServidor,
              p_realized_value: valorEfetivo,
              p_realization_date: dataFormatada,
              p_idempotency_key: requestId,
            },
          );
          if (erroAtomico?.code === "PGRST202") {
            Alert.alert(
              "Atualização necessária",
              "A confirmação segura ainda não está disponível no servidor. Nada foi alterado.",
            );
            return;
          }
          if (erroAtomico) throw erroAtomico;
          if (!resultadoAtomico || resultadoAtomico.ok !== true) {
            throw new Error("A confirmação atômica não devolveu um recibo válido.");
          }
          const restanteServidor = Number(resultadoAtomico.remaining_value);
          if (!Number.isFinite(restanteServidor) || restanteServidor < 0) {
            throw new Error("A confirmação atômica devolveu um saldo restante inválido.");
          }
          saldoRestanteConfirmado = Math.round(restanteServidor * 100) / 100;
          conclusaoAtomicaExecutada = true;
          conclusaoRequestIdsRef.current.delete(assinaturaConclusao);
        } else {
          const { data: concluida, error: erroConcluir } = await supabase.from("transacoes").update({
            status: "paga",
            data_realizacao: dataFormatada,
            valor: valorEfetivo,
          }).eq("id", transacao.id).select("id").maybeSingle();
          if (erroConcluir) throw erroConcluir;
          if (!concluida) throw new Error("O lançamento não pôde ser concluído.");
        }

        const { movimento, caixinha } = conclusaoAtomicaExecutada
          ? { movimento: null, caixinha: null }
          : await buscarObjetivoDoMovimento(transacao.descricao);
        if (!conclusaoAtomicaExecutada && movimento && caixinha) {
          const saldoAtual = Number(caixinha.saldo_atual);
          const novoSaldo = movimento.operacao === "guardar"
            ? saldoAtual + valorEfetivo
            : Math.max(0, saldoAtual - valorEfetivo);
          const { error: erroObjetivo } = await supabase.from("caixinhas").update({ saldo_atual: novoSaldo }).eq("id", caixinha.id);
          if (erroObjetivo) {
            await supabase.from("transacoes").update({
              status: transacao.status,
              data_realizacao: transacao.data_realizacao ?? null,
              valor: transacao.valor,
              descricao: transacao.descricao,
            }).eq("id", transacao.id);
            throw erroObjetivo;
          }
        }
      }

      await carregarDados();
      setTransacaoConfirmar(null);
      setAjusteTipo("nenhum");
      setAjusteValor("");
      setValorRealizado("");
      const tipo = transacao.tipo;
      if (novoStatus === "paga") {
        const label = saldoRestanteConfirmado > 0
          ? `Valor realizado. Restam ${fmtReais(saldoRestanteConfirmado)} pendentes.`
          : isTransferencia(transacao.descricao) || isMovimentoObjetivo(transacao.descricao)
            ? "Transferência concluída ✓"
            : tipo === "receita" ? "Receita recebida ✓" : "Despesa paga ✓";
        showToast(label, transacao.tipo === "receita" ? "success" : "info");
      } else {
        showToast("Marcado como pendente", "info");
      }
    } catch (error) {
      console.error("Falha ao alterar status da transação:", error);
      Alert.alert("Erro", "Não foi possível atualizar o lançamento sem risco de inconsistência. Tente novamente.");
    } finally {
      salvandoRealizacaoRef.current = false;
      setSalvandoRealizacao(false);
    }
  };

  const alternarStatus = async (id: number, statusAtual: string, _tipo: string) => {
    const transacao = transacoes.find((t) => t.id === id);
    if (!transacao) return;
    if (parseInvoicePaymentMarker(transacao.descricao)) {
      showToast("Pagamentos de fatura só podem ser estornados.", "info");
      return;
    }
    const conta = contas.find((c) => c.id === transacao.conta_id);
    if (statusAtual !== "paga" && conta?.arquivado) {
      Alert.alert("Conta arquivada", "Reative a conta antes de concluir este lançamento.");
      return;
    }
    if (statusAtual === "paga") {
      aplicarStatus(transacao, "pendente");
      return;
    }
    const transacaoComum = (transacao.tipo === "receita" || transacao.tipo === "despesa")
      && !ehMovimentoInternoSemCategoria(transacao);
    if (transacaoComum && transacao.categoria_id === null) {
      Alert.alert(
        "Categoria obrigatória",
        "Este lançamento antigo está sem categoria. Escolha uma categoria antes de concluir para manter seus relatórios corretos.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Editar lançamento", onPress: () => abrirEditarTransacao(transacao) },
        ],
      );
      return;
    }
    setDataRealizacao(new Date());
    setAjusteTipo("nenhum");
    setAjusteValor("");
    setValorRealizado(formatarEntradaMoeda(String(Math.round(Number(transacao.valor) * 100))));
    setTransacaoConfirmar(transacao);
  };

  const toggleFiltroConta = (id: number) => {
    setPaginaAtual(1);
    setFiltroContas((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);
  };
  const toggleFiltroCategoria = (id: number) => {
    setPaginaAtual(1);
    setFiltroCategorias((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);
  };

  const selecionarFiltroTipo = (tipo: "todas" | TipoFiltroHistorico) => {
    setPaginaAtual(1);
    if (tipo === "todas") {
      setFiltrosTipo([]);
      return;
    }

    const novosTipos = filtrosTipo.includes(tipo)
      ? filtrosTipo.filter((item) => item !== tipo)
      : [...filtrosTipo, tipo];
    setFiltrosTipo(novosTipos);

    const tiposComCategoria = novosTipos.filter((item) => item === "receita" || item === "despesa" || item === "fatura");
    if (novosTipos.length > 0 && tiposComCategoria.length === 0) {
      setFiltroCategorias([]);
      return;
    }
    const somenteReceita = tiposComCategoria.length > 0 && tiposComCategoria.every((item) => item === "receita");
    const somenteDespesaOuFatura = tiposComCategoria.length > 0 && tiposComCategoria.every((item) => item === "despesa" || item === "fatura");
    if (somenteReceita || somenteDespesaOuFatura) {
      const tipoCategoria = somenteReceita ? "receita" : "despesa";
      const idsCompativeis = new Set(categorias.filter((categoria) => categoria.tipo === tipoCategoria || categoria.tipo === "ambos").map((categoria) => categoria.id));
      setFiltroCategorias((atuais) => atuais.filter((id) => idsCompativeis.has(id)));
    }
  };

  const chaveHoje = chaveDataLocal(new Date());
  const hojeRef = useMemo(() => {
    const [ano, mes, dia] = chaveHoje.split("-").map(Number);
    return new Date(ano, mes - 1, dia);
  }, [chaveHoje]);
  const limiteProximosSeteDias = useMemo(() => {
    const limite = new Date(hojeRef);
    limite.setDate(limite.getDate() + 7);
    return limite;
  }, [hojeRef]);
  const chaveLimiteProximosSeteDias = chaveDataLocal(limiteProximosSeteDias);

  const termoBusca = useMemo(() => normalizarBusca(busca.trim()), [busca]);
  const contasPorId = useMemo(() => new Map(contas.map((conta) => [conta.id, conta])), [contas]);
  const filtroContasSet = useMemo(() => new Set(filtroContas), [filtroContas]);
  const filtroCategoriasSet = useMemo(() => new Set(filtroCategorias), [filtroCategorias]);

  const passaFiltrosBasicosHistorico = useCallback((t: Transacao) => {
    const contaDaTransacao = contasPorId.get(t.conta_id);
    if (t.status === "paga" && contaDaTransacao?.arquivado) return false;

    const transferencia = isTransferencia(t.descricao) || isMovimentoObjetivo(t.descricao);
    const passaBusca = !termoBusca || normalizarBusca(t.descricao).includes(termoBusca);
    const passaConta = filtroContasSet.size === 0 || filtroContasSet.has(t.conta_id);
    const passaCategoria = filtroCategoriasSet.size === 0
      || (!transferencia && t.categoria_id !== null && filtroCategoriasSet.has(t.categoria_id));

    const tipoHistorico: TipoFiltroHistorico = transferencia
      ? "transferencia"
      : t.tipo === "receita" ? "receita" : "despesa";
    const passaTipo = filtrosTipo.length === 0 || filtrosTipo.includes(tipoHistorico);

    return passaConta && passaCategoria && passaTipo && passaBusca;
  }, [contasPorId, filtroCategoriasSet, filtroContasSet, filtrosTipo, termoBusca]);

  const quantidadeAtrasadasNoEscopo = useMemo(() => transacoesPrincipais.filter((t) => {
    const dataSegura = dataEfetivaTransacao(t).slice(0, 10);
    return t.status === "pendente"
      && Boolean(dataSegura)
      && dataSegura < chaveHoje
      && passaFiltrosBasicosHistorico(t);
  }).length, [chaveHoje, passaFiltrosBasicosHistorico, transacoesPrincipais]);

  const transacoesDoMes = useMemo(() => transacoesPrincipais
    .filter((t) => {
      const dataSegura = dataEfetivaTransacao(t).slice(0, 10);
      const passaFiltrosBasicos = passaFiltrosBasicosHistorico(t);
      if (filtroVencidas) {
        return t.status === "pendente" && Boolean(dataSegura) && dataSegura < chaveHoje && passaFiltrosBasicos;
      }
      if (filtroHoje) {
        return t.status === "pendente" && dataSegura === chaveHoje && passaFiltrosBasicos;
      }
      if (filtroProximosSeteDias) {
        return t.status === "pendente"
          && Boolean(dataSegura)
          && dataSegura >= chaveHoje
          && dataSegura <= chaveLimiteProximosSeteDias
          && passaFiltrosBasicos;
      }

      const passaMes = (dataSegura || chaveHoje).startsWith(mesSelecionado);
      let passaStatus = true;
      if (filtroStatus === "concluidos") passaStatus = t.status === "paga";
      else if (filtroStatus === "pendentes") passaStatus = t.status === "pendente";
      return passaFiltrosBasicos && passaMes && passaStatus;
    })
    .sort((a, b) => compararHistoricoPorData(
      { id: a.id, data: dataEfetivaTransacao(a) },
      { id: b.id, data: dataEfetivaTransacao(b) },
      hojeRef,
    )), [
      chaveHoje,
      chaveLimiteProximosSeteDias,
      filtroHoje,
      filtroProximosSeteDias,
      filtroStatus,
      filtroVencidas,
      hojeRef,
      mesSelecionado,
      passaFiltrosBasicosHistorico,
      transacoesPrincipais,
    ]);

  // Os filhos técnicos nunca viram cards, mas representam pagamentos realmente
  // ocorridos. O rodapé soma cada evento pago na data realizada e a raiz
  // pendente apenas uma vez, pelo saldo que ainda falta realizar.
  const eventosFinanceirosDoMes = useMemo(() => transacoes
    .filter((t) => {
      const dataSegura = dataEfetivaTransacao(t).slice(0, 10);
      const passaFiltrosBasicos = passaFiltrosBasicosHistorico(t);
      if (filtroVencidas) {
        return t.status === "pendente" && Boolean(dataSegura) && dataSegura < chaveHoje && passaFiltrosBasicos;
      }
      if (filtroHoje) {
        return t.status === "pendente" && dataSegura === chaveHoje && passaFiltrosBasicos;
      }
      if (filtroProximosSeteDias) {
        return t.status === "pendente"
          && Boolean(dataSegura)
          && dataSegura >= chaveHoje
          && dataSegura <= chaveLimiteProximosSeteDias
          && passaFiltrosBasicos;
      }
      const passaMes = (dataSegura || chaveHoje).startsWith(mesSelecionado);
      let passaStatus = true;
      if (filtroStatus === "concluidos") passaStatus = t.status === "paga";
      else if (filtroStatus === "pendentes") passaStatus = t.status === "pendente";
      return passaFiltrosBasicos && passaMes && passaStatus;
    }), [
      chaveHoje,
      chaveLimiteProximosSeteDias,
      filtroHoje,
      filtroProximosSeteDias,
      filtroStatus,
      filtroVencidas,
      mesSelecionado,
      passaFiltrosBasicosHistorico,
      transacoes,
    ]);

  const faturaGruposDoMes = useMemo(() => faturaGrupos.flatMap((g) => {
    if (filtrosTipo.length > 0 && !filtrosTipo.includes("fatura")) return [];
    if (filtroHoje || filtroProximosSeteDias) return [];
    // Compras no cartão ainda não possuem uma conta bancária associada.
    if (filtroContas.length > 0) return [];
    if (g.mes_fatura !== mesSelecionado) return [];
    if (filtroStatus === "concluidos" && !g.pago) return [];
    if (filtroStatus === "pendentes" && g.pago) return [];
    if (filtroVencidas) {
      const vencimento = new Date(`${dataVencimentoFaturaHistorico(g.mes_fatura, g.dia_vencimento)}T00:00:00`);
      if (g.pago || vencimento >= hojeRef) return [];
    }
    let itensEncontrados = g.itens;
    if (filtroCategorias.length > 0) {
      itensEncontrados = itensEncontrados.filter((item) =>
        item.categoria_id !== null && filtroCategorias.includes(item.categoria_id),
      );
    }
    if (termoBusca) {
      itensEncontrados = itensEncontrados.filter((item) => normalizarBusca(item.descricao).includes(termoBusca));
    }
    if (!termoBusca && filtroCategorias.length === 0) return [g];
    if (itensEncontrados.length === 0) return [];
    return [{
      ...g,
      total: itensEncontrados.reduce((total, item) => total + item.valor, 0),
      filtrada: true,
    }];
  }), [
    faturaGrupos,
    filtroCategorias,
    filtroContas.length,
    filtroHoje,
    filtroProximosSeteDias,
    filtroStatus,
    filtroVencidas,
    filtrosTipo,
    hojeRef,
    mesSelecionado,
    termoBusca,
  ]);

  const itensHistorico = useMemo<ItemHistorico[]>(() => [
    ...transacoesDoMes.map((transacao) => {
      const resumo = resumoPagamentoDaTransacao(transacao);
      return {
        tipo: "transacao" as const,
        chave: `transacao:${transacao.id}`,
        ordemId: transacao.id,
        data: resumo.isFullyPaid
          ? resumo.lastRealizationDate ?? dataEfetivaTransacao(transacao)
          : resumo.scheduledDate ?? dataEfetivaTransacao(transacao),
        transacao,
      };
    }),
    ...faturaGruposDoMes.map((fatura) => ({
      tipo: "fatura" as const,
      chave: `fatura:${fatura.cartao_id}:${fatura.mes_fatura}`,
      ordemId: fatura.itens_ids.reduce((maiorId, id) => Math.max(maiorId, id), fatura.cartao_id),
      data: dataVencimentoFaturaHistorico(fatura.mes_fatura, fatura.dia_vencimento),
      fatura,
    })),
  ].sort((a, b) => compararHistoricoPorData(
    { id: a.ordemId, data: a.data },
    { id: b.ordemId, data: b.data },
    hojeRef,
  )), [faturaGruposDoMes, hojeRef, resumoPagamentoDaTransacao, transacoesDoMes]);

  const itensHistoricoPaginados = useMemo(
    () => itensHistorico.slice(0, paginaAtual * ITENS_POR_PAGINA),
    [itensHistorico, paginaAtual],
  );
  const temMais = itensHistoricoPaginados.length < itensHistorico.length;

  const { totalReceitas, totalDespesas } = useMemo(() => {
    let receitas = 0;
    let despesas = 0;
    for (const transacao of eventosFinanceirosDoMes) {
      if (isTransferencia(transacao.descricao) || isMovimentoObjetivo(transacao.descricao)) continue;
      if (transacao.tipo === "receita") receitas += transacao.valor;
      else if (transacao.tipo === "despesa") despesas += transacao.valor;
    }
    return { totalReceitas: receitas, totalDespesas: despesas };
  }, [eventosFinanceirosDoMes]);

  const temFiltroAtivo = mesSelecionado !== mesAtualChave
    || filtroContas.length > 0
    || filtroCategorias.length > 0
    || filtrosTipo.length > 0
    || filtroVencidas
    || filtroHoje
    || filtroProximosSeteDias
    || filtroStatus !== "todos";
  const categoriasReceitaVisiveis = useMemo(
    () => categorias.filter((categoria) => categoria.ativa !== 0 && categoria.tipo === "receita"),
    [categorias],
  );
  const categoriasDespesaVisiveis = useMemo(
    () => categorias.filter((categoria) => categoria.ativa !== 0 && categoria.tipo === "despesa"),
    [categorias],
  );
  const categoriasAmbasVisiveis = useMemo(
    () => categorias.filter((categoria) => categoria.ativa !== 0 && categoria.tipo === "ambos"),
    [categorias],
  );
  const limparFiltros = () => {
    setAnoSelecionado(anoAtualNum);
    setMesSelecionado(mesAtualChave);
    setFiltroContas([]);
    setFiltroCategorias([]);
    setFiltrosTipo([]);
    setFiltroVencidas(false);
    setFiltroHoje(false);
    setFiltroProximosSeteDias(false);
    setFiltroStatus("todos");
    setBusca("");
    setPaginaAtual(1);
  };
  const rotulosTipo: Record<TipoFiltroHistorico, string> = {
    receita: "Receitas",
    despesa: "Despesas",
    transferencia: "Transferências",
    fatura: "Faturas",
  };
  const resumoFiltroTipo = filtrosTipo.length === 0
    ? "Todos"
    : filtrosTipo.length === 1
      ? rotulosTipo[filtrosTipo[0]]
      : `${filtrosTipo.length} tipos`;
  const resumoFiltroContas = filtroContas.length === 0
    ? "Todas"
    : filtroContas.length === 1
      ? contas.find((conta) => conta.id === filtroContas[0])?.nome ?? "1 conta"
      : `${filtroContas.length} contas`;
  const filtroSomenteSemCategoria = filtrosTipo.length > 0
    && filtrosTipo.every((tipo) => tipo === "transferencia");
  const resumoFiltroCategorias = filtroSomenteSemCategoria
    ? "Não se aplica"
    : filtroCategorias.length === 0
      ? "Todas"
      : filtroCategorias.length === 1
        ? categorias.find((categoria) => categoria.id === filtroCategorias[0])?.nome ?? "1 categoria"
        : `${filtroCategorias.length} categorias`;
  const tituloPeriodo = filtroHoje
    ? "Vencendo hoje"
    : filtroProximosSeteDias
      ? "Próximos 7 dias"
    : filtroVencidas
      ? "Lançamentos atrasados"
      : formatarMesAno(mesSelecionado);

  const alturaCabecalho = scrollY.interpolate({
    inputRange: [0, HEADER_COLLAPSE_DISTANCE],
    outputRange: [HEADER_EXPANDED_HEIGHT, HEADER_COMPACT_HEIGHT],
    extrapolate: "clamp",
  });
  const raioCabecalho = scrollY.interpolate({
    inputRange: [0, HEADER_COLLAPSE_DISTANCE],
    outputRange: [FinFlowTabHeader.expandedRadius, FinFlowTabHeader.compactRadius],
    extrapolate: "clamp",
  });
  const opacidadeCabecalhoExpandido = scrollY.interpolate({
    inputRange: [0, 18, HEADER_COLLAPSE_DISTANCE],
    outputRange: [1, 0.65, 0],
    extrapolate: "clamp",
  });
  const deslocamentoCabecalhoExpandido = scrollY.interpolate({
    inputRange: [0, HEADER_COLLAPSE_DISTANCE],
    outputRange: [0, -18],
    extrapolate: "clamp",
  });
  const opacidadeCabecalhoCompacto = scrollY.interpolate({
    inputRange: [20, HEADER_COLLAPSE_DISTANCE],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const deslocamentoCabecalhoCompacto = scrollY.interpolate({
    inputRange: [20, HEADER_COLLAPSE_DISTANCE],
    outputRange: [8, 0],
    extrapolate: "clamp",
  });
  const onScrollHistorico = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: false,
      listener: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
        const offset = Math.max(0, event.nativeEvent.contentOffset.y);
        let compacto = cabecalhoCompactoRef.current;
        if (!compacto && offset >= 28) compacto = true;
        if (compacto && offset <= 12) compacto = false;
        if (compacto !== cabecalhoCompactoRef.current) {
          cabecalhoCompactoRef.current = compacto;
          setCabecalhoCompacto(compacto);
        }
      },
    }
  ), [scrollY]);

  const permiteValorParcial = Boolean(
    transacaoConfirmar
    && (transacaoConfirmar.tipo === "receita" || transacaoConfirmar.tipo === "despesa")
    && !ehMovimentoInternoSemCategoria(transacaoConfirmar),
  );
  const ajusteConclusao = valorDaEntradaMoeda(ajusteValor);
  const realizacaoAposAgendamento = Boolean(
    transacaoConfirmar
    && chaveDataLocal(dataRealizacao) > transacaoConfirmar.data_vencimento,
  );
  const valorDevidoConclusao = transacaoConfirmar
    ? Math.max(
      0.01,
      Number(transacaoConfirmar.valor)
        + (realizacaoAposAgendamento
          ? ajusteTipo === "juros" ? ajusteConclusao : ajusteTipo === "desconto" ? -ajusteConclusao : 0
          : 0),
    )
    : 0;
  const saldoRestanteConclusao = Math.max(
    0,
    Math.round((valorDevidoConclusao - valorDaEntradaMoeda(valorRealizado)) * 100) / 100,
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: Cores.fundo }]}>
      <View style={styles.screenContent}>
      {/* CABEÇALHO COLAPSÁVEL: permanece fixo e reduz ao rolar o extrato. */}
      <Animated.View
        style={[
          styles.header,
          {
            backgroundColor: novoTema.header,
            height: alturaCabecalho,
            borderBottomLeftRadius: raioCabecalho,
            borderBottomRightRadius: raioCabecalho,
          },
        ]}
      >
        <Animated.View
          pointerEvents={cabecalhoCompacto ? "none" : "auto"}
          style={[
            styles.headerExpandedContent,
            {
              opacity: opacidadeCabecalhoExpandido,
              transform: [{ translateY: deslocamentoCabecalhoExpandido }],
            },
          ]}
        >
          <View style={styles.headerTopRow}>
            <Text style={[styles.title, { color: "#FFF" }]}>Histórico</Text>
            <View style={styles.headerSearch}>
              <TextInput
                value={busca}
                onChangeText={(t) => { setBusca(t); setPaginaAtual(1); }}
                placeholder="Buscar..."
                placeholderTextColor="rgba(255,255,255,0.68)"
                style={styles.headerSearchInput}
              />
              {busca.length > 0 && (
                <TouchableOpacity onPress={() => setBusca("")} style={styles.headerSearchClear}>
                  <MaterialIcons name="close" size={16} color="#FFF" />
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={styles.headerTotals}>
            <View>
              <Text style={styles.headerTotalLabel}>Entradas</Text>
              <Text style={styles.headerIncome}>{fmtReais(totalReceitas)}</Text>
            </View>
            <View>
              <Text style={styles.headerTotalLabel}>Saídas</Text>
              <Text style={styles.headerExpense}>{fmtReais(totalDespesas)}</Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          pointerEvents={cabecalhoCompacto ? "auto" : "none"}
          style={[
            styles.headerCompactContent,
            {
              opacity: opacidadeCabecalhoCompacto,
              transform: [{ translateY: deslocamentoCabecalhoCompacto }],
            },
          ]}
        >
          <View style={styles.compactHeaderTopRow}>
            <Text style={styles.compactHeaderTitle}>Histórico</Text>
            <View style={styles.compactHeaderSearch}>
              <MaterialIcons name="search" size={16} color="rgba(255,255,255,0.76)" />
              <TextInput
                value={busca}
                onChangeText={(t) => { setBusca(t); setPaginaAtual(1); }}
                placeholder="Buscar"
                placeholderTextColor="rgba(255,255,255,0.68)"
                style={styles.compactHeaderSearchInput}
              />
              {busca.length > 0 && (
                <TouchableOpacity onPress={() => setBusca("")} style={styles.compactHeaderClear} accessibilityLabel="Limpar busca">
                  <MaterialIcons name="close" size={14} color="#FFF" />
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={styles.compactHeaderSummary}>
            <View style={styles.compactTotals}>
              <Text style={styles.compactIncome} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                + {fmtReais(totalReceitas)}
              </Text>
              <Text style={styles.compactExpense} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                - {fmtReais(totalDespesas)}
              </Text>
            </View>
          </View>
        </Animated.View>
      </Animated.View>

      <Animated.ScrollView
        ref={paginaScrollRef}
        style={styles.mainScroll}
        contentContainerStyle={styles.mainScrollContent}
        onScroll={onScrollHistorico}
        scrollEventThrottle={32}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

      <View style={styles.statusFilters}>
        {([
          { key: "todos", label: "Todos" },
          { key: "concluidos", label: "Concluídos" },
          { key: "pendentes", label: "Pendentes" },
          { key: "atrasados", label: "Atrasados" },
        ] as const).map((item) => {
          const ativo = !filtroHoje && !filtroProximosSeteDias && (item.key === "atrasados" ? filtroVencidas : (!filtroVencidas && filtroStatus === item.key));
          return (
            <TouchableOpacity
              key={item.key}
              onPress={() => {
                setFiltroHoje(false);
                setFiltroProximosSeteDias(false);
                setFiltroVencidas(item.key === "atrasados");
                setFiltroStatus(item.key === "atrasados" ? "todos" : item.key);
                setPaginaAtual(1);
              }}
              style={[styles.statusFilter, { backgroundColor: ativo ? "#23977F" : Cores.cardFundo, borderColor: ativo ? "#23977F" : Cores.borda }]}
            >
              <View style={styles.statusFilterContent}>
                {item.key === "atrasados" && quantidadeAtrasadasNoEscopo > 0 && (
                  <MaterialIcons name="warning-amber" size={14} color={ativo ? "#FFF" : "#E76F51"} />
                )}
                <Text style={[styles.statusFilterText, { color: ativo ? "#FFF" : Cores.textoSecundario }]}>{item.label}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {filtroHoje && (
        <View style={[styles.periodFilterBanner, { backgroundColor: novoTema.primarySoft, borderColor: novoTema.primary }]}>
          <View style={styles.periodFilterIcon}>
            <MaterialIcons name="today" size={20} color={novoTema.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.periodFilterTitle, { color: Cores.textoPrincipal }]}>Agendamentos vencendo hoje</Text>
            <Text style={[styles.periodFilterText, { color: Cores.textoSecundario }]}>{formatarDataCurta(hojeRef)}</Text>
          </View>
          <TouchableOpacity onPress={() => { setFiltroHoje(false); setPaginaAtual(1); }} style={styles.periodFilterClose} accessibilityLabel="Remover filtro de hoje">
            <MaterialIcons name="close" size={19} color={novoTema.primary} />
          </TouchableOpacity>
        </View>
      )}

      {filtroProximosSeteDias && (
        <View style={[styles.periodFilterBanner, { backgroundColor: novoTema.primarySoft, borderColor: novoTema.primary }]}>
          <View style={styles.periodFilterIcon}>
            <MaterialIcons name="date-range" size={20} color={novoTema.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.periodFilterTitle, { color: Cores.textoPrincipal }]}>Pendentes dos próximos 7 dias</Text>
            <Text style={[styles.periodFilterText, { color: Cores.textoSecundario }]}>De {formatarDataCurta(hojeRef)} até {formatarDataCurta(limiteProximosSeteDias)}</Text>
          </View>
          <TouchableOpacity onPress={() => { setFiltroProximosSeteDias(false); setPaginaAtual(1); }} style={styles.periodFilterClose} accessibilityLabel="Remover filtro dos próximos 7 dias">
            <MaterialIcons name="close" size={19} color={novoTema.primary} />
          </TouchableOpacity>
        </View>
      )}

      {/* FILTROS */}
      <View style={[styles.filtersPanel, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
        <View style={styles.filtersPanelHeader}>
          <View style={styles.filtersPanelHeading}>
            <View style={[styles.filtersPanelIcon, { backgroundColor: novoTema.primarySoft }]}>
              <MaterialIcons name="tune" size={17} color={novoTema.primary} />
            </View>
            <View>
              <Text style={[styles.filtersPanelTitle, { color: Cores.textoPrincipal }]}>Refinar histórico</Text>
              <Text style={[styles.filtersPanelSubtitle, { color: Cores.textoSecundario }]}>Período, tipo, conta e categoria</Text>
            </View>
          </View>
          {temFiltroAtivo && (
            <TouchableOpacity onPress={limparFiltros} style={[styles.clearFiltersButton, { backgroundColor: Cores.pillFundo }]}>
              <MaterialIcons name="restart-alt" size={15} color="#E76F51" />
              <Text style={styles.clearFiltersText}>Limpar</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.periodSelector, { backgroundColor: Cores.pillFundo, borderColor: mesSelecionado !== mesAtualChave ? "#805AD5" : Cores.borda }]}>
          <TouchableOpacity onPress={() => alterarMes(-1)} style={styles.periodSelectorArrow} accessibilityLabel="Mês anterior">
            <MaterialIcons name="chevron-left" size={25} color="#805AD5" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setModalFiltroAno(true)} style={styles.periodSelectorCenter} accessibilityLabel={`Período selecionado: ${formatarMesAno(mesSelecionado)}. Toque para alterar o ano.`}>
            <MaterialIcons name="calendar-today" size={16} color="#805AD5" />
            <Text style={[styles.periodSelectorText, { color: Cores.textoPrincipal }]}>{formatarMesAno(mesSelecionado)}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => alterarMes(1)} style={styles.periodSelectorArrow} accessibilityLabel="Próximo mês">
            <MaterialIcons name="chevron-right" size={25} color="#805AD5" />
          </TouchableOpacity>
        </View>

        <View style={styles.filterButtonsRow}>
          <TouchableOpacity
            style={[styles.mainFilterButton, { backgroundColor: filtrosTipo.length > 0 ? "#F4A26114" : Cores.pillFundo, borderColor: filtrosTipo.length > 0 ? "#F4A261" : Cores.borda }]}
            onPress={() => setModalFiltroTipo(true)}
            accessibilityLabel={`Filtrar por tipo. Seleção atual: ${resumoFiltroTipo}`}
          >
            <View style={styles.mainFilterLabelRow}>
              <MaterialIcons name="swap-vert" size={15} color={filtrosTipo.length > 0 ? "#F4A261" : Cores.textoSecundario} />
              <Text style={[styles.mainFilterLabel, { color: Cores.textoSecundario }]}>TIPO</Text>
            </View>
            <Text style={[styles.mainFilterValue, { color: filtrosTipo.length > 0 ? "#D98324" : Cores.textoPrincipal }]} numberOfLines={1}>{resumoFiltroTipo}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mainFilterButton, { backgroundColor: filtroContas.length > 0 ? "#457B9D14" : Cores.pillFundo, borderColor: filtroContas.length > 0 ? "#457B9D" : Cores.borda }]}
            onPress={() => setModalFiltroConta(true)}
            accessibilityLabel={`Filtrar por conta. Seleção atual: ${resumoFiltroContas}`}
          >
            <View style={styles.mainFilterLabelRow}>
              <MaterialIcons name="account-balance-wallet" size={15} color={filtroContas.length > 0 ? "#457B9D" : Cores.textoSecundario} />
              <Text style={[styles.mainFilterLabel, { color: Cores.textoSecundario }]}>CONTA</Text>
            </View>
            <Text style={[styles.mainFilterValue, { color: filtroContas.length > 0 ? "#457B9D" : Cores.textoPrincipal }]} numberOfLines={1}>{resumoFiltroContas}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            disabled={filtroSomenteSemCategoria}
            style={[styles.mainFilterButton, { backgroundColor: filtroCategorias.length > 0 ? "#2A9D8F14" : Cores.pillFundo, borderColor: filtroCategorias.length > 0 ? "#2A9D8F" : Cores.borda, opacity: filtroSomenteSemCategoria ? 0.48 : 1 }]}
            onPress={() => setModalFiltroCat(true)}
            accessibilityLabel={`Filtrar por categoria. Seleção atual: ${resumoFiltroCategorias}`}
          >
            <View style={styles.mainFilterLabelRow}>
              <MaterialIcons name={filtroSomenteSemCategoria ? "label-off" : "label"} size={15} color={filtroCategorias.length > 0 ? "#2A9D8F" : Cores.textoSecundario} />
              <Text style={[styles.mainFilterLabel, { color: Cores.textoSecundario }]}>CATEGORIA</Text>
            </View>
            <Text style={[styles.mainFilterValue, { color: filtroCategorias.length > 0 ? "#2A9D8F" : Cores.textoPrincipal }]} numberOfLines={1}>{resumoFiltroCategorias}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* LISTA DE TRANSAÇÕES */}
      <View style={styles.listContainer}>
        <View style={[styles.tabelaCard, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
          {/* Cabeçalho do mês */}
          <View style={[styles.monthHeader, { backgroundColor: isDark ? "#252525" : "#F8F9FA", borderColor: Cores.borda }]}>
            <Text style={[styles.monthHeaderText, { color: Cores.textoPrincipal }]}>
              {tituloPeriodo}
            </Text>
            {itensHistorico.length > 0 && (
              <Text style={[styles.contadorText, { color: Cores.textoSecundario }]}>
                {itensHistorico.length} registro{itensHistorico.length !== 1 ? "s" : ""}
              </Text>
            )}
          </View>

          {itensHistorico.length === 0 ? (
            <View style={styles.emptyContainer}>
              {temFiltroAtivo || busca.trim().length > 0 ? (
                <>
                  <MaterialIcons name="search-off" size={40} color={Cores.textoSecundario} style={{ marginBottom: 10 }} />
                  <Text style={[styles.emptyMonthText, { color: Cores.textoSecundario }]}>
                    Nenhum resultado com os filtros aplicados.
                  </Text>
                  <TouchableOpacity
                    onPress={limparFiltros}
                    style={{ marginTop: 12, backgroundColor: "#457B9D22", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 }}
                  >
                    <Text style={{ color: "#457B9D", fontWeight: "600" }}>Limpar filtros</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <MaterialIcons name="receipt-long" size={40} color={Cores.textoSecundario} style={{ marginBottom: 10 }} />
                  <Text style={[styles.emptyMonthText, { color: Cores.textoSecundario }]}>
                    Nenhuma transação em {tituloPeriodo}.
                  </Text>
                  <Text style={{ color: Cores.textoSecundario, fontSize: 12, marginTop: 4 }}>
                    Use o botão + no início para adicionar.
                  </Text>
                </>
              )}
            </View>
          ) : (
            itensHistoricoPaginados.map((item, index) => {
              const dataEfetiva = item.data || "0000-00-00";
              const partes = dataEfetiva.split("-");
              const dataAnterior = index > 0 ? itensHistoricoPaginados[index - 1].data : null;
              const mostrarCabecalhoDia = index === 0 || dataAnterior !== dataEfetiva;
              const ontem = new Date(hojeRef);
              ontem.setDate(ontem.getDate() - 1);
              const chaveOntem = chaveDataLocal(ontem);
              const rotuloDia = dataEfetiva === chaveHoje
                ? "Hoje"
                : dataEfetiva === chaveOntem
                  ? "Ontem"
                  : `${partes[2]} ${getNomeMes(partes[1])?.substring(0, 3)}`;
              const bgRow = index % 2 === 0 ? Cores.rowImpar : Cores.rowPar;

              if (item.tipo === "fatura") {
                const g = item.fatura;
                return (
                  <React.Fragment key={item.chave}>
                    {mostrarCabecalhoDia && (
                      <Text style={[styles.dayHeading, { color: Cores.textoSecundario, backgroundColor: Cores.fundo }]}>{rotuloDia}</Text>
                    )}
                    <TouchableOpacity
                      style={[styles.transacaoCard, {
                        backgroundColor: bgRow,
                        borderBottomColor: Cores.borda,
                        borderLeftWidth: 3,
                        borderLeftColor: g.cartao_cor,
                      }]}
                      onPress={() => {
                        if (g.filtrada) return;
                        if (g.pago) {
                          const key = `${g.cartao_id}:${g.mes_fatura}`;
                          if (estornoFaturaAlvoRef.current?.key !== key) {
                            estornoFaturaAlvoRef.current = null;
                            estornoRequestIdsRef.current.clear();
                          }
                          setFaturaEstornar(g);
                        } else {
                          router.push({ pathname: "/cartoes", params: { pagarCartaoId: String(g.cartao_id), mesFatura: g.mes_fatura } } as any);
                        }
                      }}
                      disabled={Boolean(g.filtrada)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.dataBadge, { backgroundColor: Cores.blocoData }]}>
                        <Text style={[styles.dataDia, { color: Cores.textoPrincipal }]}>FAT</Text>
                        <Text style={[styles.dataMes, { color: Cores.textoSecundario }]}>{g.mes_fatura.split("-")[1]}/{g.mes_fatura.split("-")[0].slice(2)}</Text>
                      </View>
                      <View style={styles.transacaoInfo}>
                        <View style={{ backgroundColor: g.cartao_cor + "22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: "flex-start", marginBottom: 4 }}>
                          <Text style={[styles.contaTag, { color: g.cartao_cor }]}>{g.cartao_nome}</Text>
                        </View>
                        <Text style={[styles.transacaoDesc, { color: Cores.textoPrincipal }]}>
                          Fatura {formatarMesAno(g.mes_fatura)}
                        </Text>
                      </View>
                      <View style={styles.transacaoAcoes}>
                        <Text style={[styles.transacaoValor, { color: g.pago ? Cores.textoSecundario : "#EF4444" }]}>
                          - {fmtReais(g.total)}
                        </Text>
                        <View style={[styles.statusBadge, { backgroundColor: g.pago ? "#D1FAE5" : "#FEE2E2" }]}>
                          <Text style={[styles.statusBadgeText, { color: g.pago ? "#065F46" : "#991B1B" }]}>
                            {g.filtrada ? "Resultado filtrado" : g.pago ? "Paga" : "Em aberto"}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </React.Fragment>
                );
              }

              const t = item.transacao;
              const resumoPagamento = resumoPagamentoDaTransacao(t);
              const conta = contas.find((c) => c.id === t.conta_id);
              const categoria = categorias.find((c) => c.id === t.categoria_id);
              const estiloConta = conta ? getEstiloBanco(conta.nome, isDark) : { bg: isDark ? "#333" : "#E3F2FD", text: isDark ? "#FFF" : "#1976D2" };
              const isPendente = !resumoPagamento.isFullyPaid;
              const dataT = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
              const isVencida = isPendente && dataT < hojeRef;
              const transferencia = isTransferencia(t.descricao) || isMovimentoObjetivo(t.descricao);
              const corValor = transferencia ? "#F4A261" : t.tipo === "receita" ? "#2A9D8F" : "#E76F51";
              const prefixoValor = t.tipo === "receita" ? "+" : "-";
              const pagamentoParcial = resumoPagamento.paymentCount > 0 && resumoPagamento.remainingValue > 0;
              const corStatus = isVencida ? "#DC2626" : pagamentoParcial ? "#805AD5" : "#F59E0B";
              const textoStatus = pagamentoParcial
                ? isVencida ? "Parcial vencida" : "Pagamento parcial"
                : isVencida ? "Vencida" : t.tipo === "receita" ? "A receber" : "A pagar";
              const mostrarResumoPagamento = shouldShowTransactionPaymentBreakdown(resumoPagamento);

              return (
                <React.Fragment key={item.chave}>
                {mostrarCabecalhoDia && (
                  <Text style={[styles.dayHeading, { color: Cores.textoSecundario, backgroundColor: Cores.fundo }]}>{rotuloDia}</Text>
                )}
                <TouchableOpacity
                  style={[styles.transacaoCard, {
                    backgroundColor: bgRow,
                    borderBottomColor: Cores.borda,
                    borderLeftWidth: isPendente ? 4 : 0,
                    borderLeftColor: corStatus,
                    opacity: isPendente ? 1 : 0.72,
                  }]}
                  onPress={() => { void abrirDetalheTransacao(t); }}
                  activeOpacity={0.75}
                >
                  {/* Coluna esquerda: categoria */}
                  <View style={[styles.transactionIcon, { backgroundColor: `${categoria?.cor ?? (transferencia ? "#F4A261" : corValor)}22` }]}>
                    <MaterialIcons name={(categoria?.icone as any) ?? (transferencia ? "swap-horiz" : t.tipo === "receita" ? "payments" : "receipt-long")} size={20} color={categoria?.cor ?? (transferencia ? "#F4A261" : corValor)} />
                  </View>

                  {/* Coluna central: descrição + badges */}
                  <View style={styles.transacaoInfo}>
                    <Text style={[styles.nomeText, { color: isPendente ? Cores.textoPrincipal : Cores.textoSecundario, textDecorationLine: isPendente ? "none" : "line-through", textDecorationColor: Cores.textoSecundario }]} numberOfLines={2}>
                      {descricaoVisivel(t.descricao)}
                    </Text>
                    {!isPendente && t.data_realizacao && t.data_realizacao !== t.data_vencimento && (
                      <Text style={{ color: Cores.textoSecundario, fontSize: 11, marginTop: 2 }}>
                        Agendado para {t.data_vencimento.split("-").reverse().join("/")}
                      </Text>
                    )}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {/* Badge conta */}
                      {conta && (
                        <View style={[styles.badge, { backgroundColor: estiloConta.bg }]}>
                          <Text style={[styles.badgeText, { color: estiloConta.text }]} numberOfLines={1}>{conta.nome}</Text>
                        </View>
                      )}
                      {isPendente && <View style={[styles.pendentePill, { backgroundColor: `${corStatus}22` }]}>
                        <Text style={[styles.pendenteText, { color: corStatus }]}>{textoStatus}</Text>
                      </View>}
                    </View>
                  </View>

                  {/* Coluna direita: valor + ações */}
                  <View style={styles.transacaoAcoes}>
                    <Text style={[styles.valorText, { color: isPendente ? corValor : Cores.textoSecundario, textDecorationLine: isPendente ? "none" : "line-through", textDecorationColor: Cores.textoSecundario }]} numberOfLines={1} adjustsFontSizeToFit>
                      {prefixoValor} {fmtReais(resumoPagamento.totalValue)}
                    </Text>
                    {mostrarResumoPagamento && (
                      <View style={styles.paymentCardBreakdown}>
                        <Text style={[styles.paymentCardLine, { color: Cores.textoSecundario }]} numberOfLines={1}>
                          Realizado: {fmtReais(resumoPagamento.paidTotal)}
                        </Text>
                        <Text style={[styles.paymentCardLine, { color: resumoPagamento.remainingValue > 0 ? corStatus : Cores.textoSecundario }]} numberOfLines={1}>
                          Restante: {fmtReais(resumoPagamento.remainingValue)}
                        </Text>
                      </View>
                    )}
                    <MaterialIcons name="chevron-right" size={20} color={Cores.textoSecundario} style={{ marginTop: 5 }} />
                  </View>
                </TouchableOpacity>
                </React.Fragment>
              );
            })
          )}

          {/* Ver mais */}
          {temMais && (
            <TouchableOpacity
              onPress={() => setPaginaAtual((p) => p + 1)}
              style={{ padding: 14, alignItems: "center", borderTopWidth: 1, borderTopColor: Cores.borda }}
            >
              <Text style={{ color: "#2563EB", fontWeight: "600" }}>
                Ver mais ({itensHistorico.length - itensHistoricoPaginados.length} restantes)
              </Text>
            </TouchableOpacity>
          )}

          {/* Rodapé */}
          {eventosFinanceirosDoMes.length > 0 && (
            <View style={[styles.tabelaFooter, { backgroundColor: Cores.headerTabela, borderColor: Cores.borda }]}>
              <Text style={[styles.footerLabel, { color: Cores.textoSecundario }]}>Total do mês</Text>
              <View style={styles.footerTotais}>
                <View style={styles.footerItem}>
                  <MaterialIcons name="arrow-upward" size={12} color="#2A9D8F" />
                  <Text style={styles.footerValorReceita}>{fmtReais(totalReceitas)}</Text>
                </View>
                <View style={styles.footerItem}>
                  <MaterialIcons name="arrow-downward" size={12} color="#E76F51" />
                  <Text style={styles.footerValorDespesa}>{fmtReais(totalDespesas)}</Text>
                </View>
              </View>
            </View>
          )}
        </View>
        <View style={{ height: 40 }} />
      </View>
      </Animated.ScrollView>

      {faturaAbrirCartao && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setFaturaAbrirCartao(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, borderTopWidth: 4, borderTopColor: faturaAbrirCartao.cartao_cor }]}>
              <View style={{ alignItems: "center", marginBottom: 14 }}>
                <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: `${faturaAbrirCartao.cartao_cor}22`, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="credit-card" size={30} color={faturaAbrirCartao.cartao_cor} />
                </View>
              </View>
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Pagar fatura</Text>
              <Text style={{ color: Cores.textoSecundario, textAlign: "center", fontSize: 14, lineHeight: 21, marginBottom: 14 }}>
                {faturaAbrirCartao.cartao_nome} • {formatarMesAno(faturaAbrirCartao.mes_fatura)}
              </Text>
              <View style={{ backgroundColor: Cores.blocoData, borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 16 }}>
                <Text style={{ color: Cores.textoSecundario, fontSize: 12 }}>Valor da fatura</Text>
                <Text style={{ color: "#E76F51", fontSize: 24, fontWeight: "bold", marginTop: 3 }}>{fmtReais(faturaAbrirCartao.total)}</Text>
              </View>
              <Text style={{ color: Cores.textoSecundario, textAlign: "center", fontSize: 13, lineHeight: 19, marginBottom: 18 }}>
                Na tela do cartão você poderá pagar o valor integral, registrar um pagamento parcial ou levar o saldo restante para a próxima fatura.
              </Text>
              <TouchableOpacity
                style={{ minHeight: 52, borderRadius: 11, backgroundColor: "#2A9D8F", alignItems: "center", justifyContent: "center", marginBottom: 9 }}
                onPress={() => {
                  const fatura = faturaAbrirCartao;
                  setFaturaAbrirCartao(null);
                  router.push({ pathname: "/cartoes", params: { pagarCartaoId: String(fatura.cartao_id), mesFatura: fatura.mes_fatura } } as any);
                }}
              >
                <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>Continuar para o cartão</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ minHeight: 48, borderRadius: 11, backgroundColor: Cores.blocoData, alignItems: "center", justifyContent: "center" }} onPress={() => setFaturaAbrirCartao(null)}>
                <Text style={{ color: Cores.textoSecundario, fontWeight: "bold" }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {transacaoDetalhe && (() => {
        const t = transacaoDetalhe;
        const conta = contas.find((c) => c.id === t.conta_id);
        const categoria = categorias.find((c) => c.id === t.categoria_id);
        const destinoId = getContaDestinoTransferencia(t.descricao);
        const destino = contas.find((c) => c.id === destinoId);
        const transferencia = isTransferencia(t.descricao) || isMovimentoObjetivo(t.descricao);
        const pagamentoFatura = parseInvoicePaymentMarker(t.descricao);
        const resumoPagamento = historicoPagamentosDetalhe?.summary ?? resumoPagamentoDaTransacao(t);
        const concluida = resumoPagamento.isFullyPaid;
        const possuiPagamentos = resumoPagamento.paymentCount > 0 && !transferencia && !pagamentoFatura;
        const transacaoPendenteAtual = resumoPagamento.currentPendingTransactionId === null
          ? t
          : transacoes.find((transacao) => transacao.id === resumoPagamento.currentPendingTransactionId) ?? t;
        return (
          <Modal animationType="fade" transparent visible onRequestClose={fecharDetalheTransacao}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, styles.paymentDetailModal, { backgroundColor: Cores.cardFundo, borderTopWidth: 4, borderTopColor: transferencia ? "#F4A261" : t.tipo === "receita" ? "#2A9D8F" : "#E76F51" }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalTitle, { color: Cores.textoPrincipal, textAlign: "left", marginBottom: 4 }]}>Detalhes do lançamento</Text>
                    <Text style={{ color: Cores.textoSecundario, fontSize: 13 }}>{descricaoVisivel(t.descricao)}</Text>
                  </View>
                  <TouchableOpacity onPress={fecharDetalheTransacao} style={{ padding: 6 }}>
                    <MaterialIcons name="close" size={24} color={Cores.textoSecundario} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.paymentDetailBody} contentContainerStyle={styles.paymentDetailBodyContent} showsVerticalScrollIndicator={false}>
                <View style={{ backgroundColor: Cores.blocoData, borderRadius: 12, padding: 14, gap: 10 }}>
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Total do agendamento</Text><Text style={{ color: t.tipo === "receita" ? "#2A9D8F" : "#E76F51", fontWeight: "800" }}>{fmtReais(resumoPagamento.totalValue)}</Text></View>
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Total realizado</Text><Text style={{ color: "#2A9D8F", fontWeight: "800" }}>{fmtReais(resumoPagamento.paidTotal)}</Text></View>
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Restante</Text><Text style={{ color: resumoPagamento.remainingValue > 0 ? "#F59E0B" : Cores.textoSecundario, fontWeight: "800" }}>{fmtReais(resumoPagamento.remainingValue)}</Text></View>
                  {(!possuiPagamentos || concluida) && (
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Status</Text><Text style={{ color: concluida ? "#2A9D8F" : "#F59E0B", fontWeight: "700" }}>{concluida ? "Concluído" : "Pendente"}</Text></View>
                  )}
                  {possuiPagamentos && !concluida && (
                    <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Status</Text><Text style={{ color: "#805AD5", fontWeight: "700" }}>Parcialmente realizado</Text></View>
                  )}
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Data agendada</Text><Text style={{ color: Cores.textoPrincipal }}>{(resumoPagamento.scheduledDate ?? t.data_vencimento).split("-").reverse().join("/")}</Text></View>
                  {t.data_realizacao && <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Data realizada</Text><Text style={{ color: Cores.textoPrincipal }}>{t.data_realizacao.split("-").reverse().join("/")}</Text></View>}
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Conta</Text><Text style={{ color: Cores.textoPrincipal }}>{conta?.nome ?? "Não informada"}</Text></View>
                  {destino && <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Destino</Text><Text style={{ color: Cores.textoPrincipal }}>{destino.nome}</Text></View>}
                  {categoria && <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Categoria</Text><Text style={{ color: categoria.cor, fontWeight: "700" }}>{categoria.nome}</Text></View>}
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Tipo</Text><Text style={{ color: Cores.textoPrincipal }}>{transferencia ? "Transferência" : t.tipo === "receita" ? "Receita" : "Despesa"}</Text></View>
                </View>
                <View style={[styles.paymentHistorySection, { borderColor: Cores.borda }]}>
                  <View style={styles.paymentHistoryHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.paymentHistoryTitle, { color: Cores.textoPrincipal }]}>Pagamentos</Text>
                      <Text style={[styles.paymentHistorySubtitle, { color: Cores.textoSecundario }]}>Cada baixa permanece ligada a este agendamento.</Text>
                    </View>
                    <View style={[styles.paymentHistoryCount, { backgroundColor: Cores.pillFundo }]}>
                      <Text style={{ color: Cores.textoPrincipal, fontWeight: "800" }}>{resumoPagamento.paymentCount}</Text>
                    </View>
                  </View>
                  {carregandoPagamentosDetalhe ? (
                    <Text style={[styles.paymentHistoryEmpty, { color: Cores.textoSecundario }]}>Carregando pagamentos...</Text>
                  ) : erroPagamentosDetalhe ? (
                    <View style={{ gap: 8 }}>
                      <Text style={[styles.paymentHistoryEmpty, { color: "#E76F51" }]}>{erroPagamentosDetalhe}</Text>
                      <TouchableOpacity style={[styles.paymentHistoryRetry, { backgroundColor: Cores.pillFundo }]} onPress={() => { void abrirDetalheTransacao(t); }}>
                        <Text style={{ color: Cores.textoPrincipal, fontWeight: "700" }}>Tentar novamente</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (historicoPagamentosDetalhe?.payments.length ?? 0) === 0 ? (
                    <Text style={[styles.paymentHistoryEmpty, { color: Cores.textoSecundario }]}>Nenhum pagamento registrado ainda.</Text>
                  ) : (
                    <View style={styles.paymentHistoryList}>
                      {historicoPagamentosDetalhe?.payments.map((pagamento) => (
                        <View key={pagamento.paymentId} style={[styles.paymentHistoryRow, { borderTopColor: Cores.borda, opacity: pagamento.active ? 1 : 0.58 }]}>
                          <View style={[styles.paymentHistoryIcon, { backgroundColor: pagamento.active ? "#2A9D8F22" : "#E76F5122" }]}>
                            <MaterialIcons name={pagamento.active ? "check" : "undo"} size={17} color={pagamento.active ? "#2A9D8F" : "#E76F51"} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: Cores.textoPrincipal, fontWeight: "700" }}>
                              Pagamento{pagamento.paymentSequence > 0 ? ` ${pagamento.paymentSequence}` : ""}
                            </Text>
                            <Text style={{ color: Cores.textoSecundario, fontSize: 11, marginTop: 2 }}>
                              {pagamento.active ? "Realizado" : "Estornado"} em {pagamento.realizationDate.split("-").reverse().join("/")}
                            </Text>
                            {pagamento.adjustmentValue > 0 && (
                              <Text style={{ color: Cores.textoSecundario, fontSize: 10, marginTop: 2 }}>
                                {pagamento.adjustmentType === "interest" ? "Juros" : "Desconto"}: {fmtReais(pagamento.adjustmentValue)}
                              </Text>
                            )}
                          </View>
                          <Text style={{ color: pagamento.active ? "#2A9D8F" : Cores.textoSecundario, fontWeight: "800" }}>{fmtReais(pagamento.value)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                </ScrollView>
                <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 14, gap: 10 }}>
                  {pagamentoFatura ? (
                    <TouchableOpacity
                      style={[styles.detalheAcao, { backgroundColor: "#F59E0B22" }]}
                      onPress={() => {
                        fecharDetalheTransacao();
                        setModalDeleteSimples(t);
                      }}
                    >
                      <MaterialIcons name="undo" size={20} color="#F59E0B" />
                      <Text style={{ color: "#F59E0B", fontWeight: "700" }}>Estornar pagamento</Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <TouchableOpacity style={[styles.detalheAcao, { backgroundColor: "#457B9D22" }]} onPress={() => { fecharDetalheTransacao(); abrirEditarTransacao(t); }}>
                        <MaterialIcons name="edit" size={20} color="#457B9D" /><Text style={{ color: "#457B9D", fontWeight: "700" }}>Editar</Text>
                      </TouchableOpacity>
                      {!concluida && (
                        <TouchableOpacity style={[styles.detalheAcao, { backgroundColor: "#2A9D8F22" }]} onPress={() => { fecharDetalheTransacao(); void alternarStatus(transacaoPendenteAtual.id, transacaoPendenteAtual.status, transacaoPendenteAtual.tipo); }}>
                          <MaterialIcons name="check-circle" size={20} color="#2A9D8F" /><Text style={{ color: "#2A9D8F", fontWeight: "700" }}>Concluir restante</Text>
                        </TouchableOpacity>
                      )}
                      {possuiPagamentos && (
                        <TouchableOpacity
                          style={[styles.detalheAcao, { backgroundColor: "#F59E0B22" }]}
                          onPress={() => {
                            fecharDetalheTransacao();
                            setTransacaoEstornarPagamento(t);
                          }}
                        >
                          <MaterialIcons name="undo" size={20} color="#F59E0B" /><Text style={{ color: "#F59E0B", fontWeight: "700" }}>Estornar último</Text>
                        </TouchableOpacity>
                      )}
                      {concluida && !possuiPagamentos && (
                        <TouchableOpacity style={[styles.detalheAcao, { backgroundColor: "#2A9D8F22" }]} onPress={() => { fecharDetalheTransacao(); void aplicarStatus(t, "pendente"); }}>
                          <MaterialIcons name="undo" size={20} color="#2A9D8F" /><Text style={{ color: "#2A9D8F", fontWeight: "700" }}>Reabrir</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={[styles.detalheAcao, { backgroundColor: "#E76F5122" }]} onPress={() => { fecharDetalheTransacao(); deletarTransacao(t.id); }}>
                        <MaterialIcons name="delete-outline" size={20} color="#E76F51" /><Text style={{ color: "#E76F51", fontWeight: "700" }}>Excluir</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            </View>
          </Modal>
        );
      })()}

      {transacaoEstornarPagamento && (() => {
        const alvo = transacaoEstornarPagamento;
        const resumo = resumoPagamentoDaTransacao(alvo);
        return (
          <Modal animationType="fade" transparent visible onRequestClose={() => setTransacaoEstornarPagamento(null)}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, borderTopWidth: 4, borderTopColor: "#F59E0B" }]}>
                <View style={{ alignItems: "center", marginBottom: 12 }}>
                  <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: "#F59E0B22", alignItems: "center", justifyContent: "center" }}>
                    <MaterialIcons name="undo" size={30} color="#F59E0B" />
                  </View>
                </View>
                <Text style={[styles.modalTitle, { color: Cores.textoPrincipal, marginBottom: 8 }]}>Estornar último pagamento</Text>
                <Text style={{ color: Cores.textoSecundario, textAlign: "center", lineHeight: 20, marginBottom: 16 }}>
                  Somente o pagamento mais recente será desfeito. Os anteriores continuarão realizados e o valor voltará para o restante deste mesmo agendamento.
                </Text>
                <View style={[styles.paymentReopenSummary, { backgroundColor: Cores.blocoData }]}>
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Realizado agora</Text><Text style={{ color: "#2A9D8F", fontWeight: "800" }}>{fmtReais(resumo.paidTotal)}</Text></View>
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Restante agora</Text><Text style={{ color: "#F59E0B", fontWeight: "800" }}>{fmtReais(resumo.remainingValue)}</Text></View>
                </View>
                <TouchableOpacity
                  style={{ backgroundColor: "#F59E0B", minHeight: 50, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 9, opacity: salvandoRealizacao ? 0.55 : 1 }}
                  disabled={salvandoRealizacao}
                  onPress={() => {
                    setTransacaoEstornarPagamento(null);
                    void aplicarStatus(alvo, "pendente");
                  }}
                >
                  <Text style={{ color: "#FFF", fontWeight: "800" }}>{salvandoRealizacao ? "Estornando..." : "Confirmar estorno"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ backgroundColor: Cores.pillFundo, minHeight: 48, borderRadius: 11, alignItems: "center", justifyContent: "center" }}
                  onPress={() => setTransacaoEstornarPagamento(null)}
                  disabled={salvandoRealizacao}
                >
                  <Text style={{ color: Cores.textoSecundario, fontWeight: "700" }}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        );
      })()}

      {avisoPagamentoVinculado && (
        <Modal
          animationType="fade"
          transparent
          visible
          onRequestClose={() => setAvisoPagamentoVinculado(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, {
              backgroundColor: Cores.cardFundo,
              borderTopWidth: 4,
              borderTopColor: "#F59E0B",
            }]}
            >
              <View style={{ alignItems: "center", marginBottom: 12 }}>
                <View style={{
                  width: 58,
                  height: 58,
                  borderRadius: 29,
                  backgroundColor: "#F59E0B22",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                >
                  <MaterialIcons name="payments" size={30} color="#F59E0B" />
                </View>
              </View>
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal, marginBottom: 8 }]}>
                {avisoPagamentoVinculado.titulo}
              </Text>
              <Text style={{
                color: Cores.textoSecundario,
                textAlign: "center",
                lineHeight: 20,
                marginBottom: 18,
              }}
              >
                {avisoPagamentoVinculado.mensagem}
              </Text>
              <TouchableOpacity
                style={{
                  backgroundColor: "#2A9D8F",
                  minHeight: 50,
                  borderRadius: 11,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onPress={() => setAvisoPagamentoVinculado(null)}
              >
                <Text style={{ color: "#FFF", fontWeight: "800" }}>Entendi</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {faturaEstornar && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setFaturaEstornar(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, borderTopWidth: 4, borderTopColor: "#F59E0B" }]}>
              <View style={{ alignItems: "center", marginBottom: 12 }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#F59E0B22", alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="undo" size={30} color="#F59E0B" />
                </View>
              </View>
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal, marginBottom: 8 }]}>Estornar pagamento</Text>
              <Text style={{ color: Cores.textoSecundario, textAlign: "center", lineHeight: 20, marginBottom: 20 }}>
                Somente o pagamento mais recente de {faturaEstornar.cartao_nome} — {formatarMesAno(faturaEstornar.mes_fatura)} será estornado. Pagamentos anteriores continuarão no Histórico.
              </Text>
              <TouchableOpacity
                style={{ backgroundColor: "#F59E0B", minHeight: 50, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 9, opacity: loadingEstornoFatura ? 0.55 : 1 }}
                onPress={() => estornarPagamentosDaFatura(faturaEstornar)}
                disabled={loadingEstornoFatura}
              >
                <Text style={{ color: "#FFF", fontWeight: "800" }}>{loadingEstornoFatura ? "Estornando..." : "Confirmar estorno"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ backgroundColor: Cores.pillFundo, minHeight: 48, borderRadius: 11, alignItems: "center", justifyContent: "center" }} onPress={() => setFaturaEstornar(null)} disabled={loadingEstornoFatura}>
                <Text style={{ color: Cores.textoSecundario, fontWeight: "700" }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {transacaoConfirmar && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setTransacaoConfirmar(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo }]}>
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Confirmar realização</Text>
              <Text style={{ color: Cores.textoSecundario, textAlign: "center", lineHeight: 20, marginBottom: 16 }}>
                Agendado para {transacaoConfirmar.data_vencimento.split("-").reverse().join("/")}. Confirme a data em que a movimentação realmente aconteceu.
              </Text>
              <TouchableOpacity
                style={[styles.editInput, { backgroundColor: Cores.blocoData, borderColor: Cores.borda, flexDirection: "row", alignItems: "center" }]}
                onPress={() => setMostrarDataRealizacao(true)}
              >
                <MaterialIcons name="event-available" size={20} color="#2A9D8F" style={{ marginRight: 10 }} />
                <Text style={{ color: Cores.textoPrincipal, fontWeight: "600" }}>
                  {String(dataRealizacao.getDate()).padStart(2, "0")}/{String(dataRealizacao.getMonth() + 1).padStart(2, "0")}/{dataRealizacao.getFullYear()}
                </Text>
              </TouchableOpacity>
              {mostrarDataRealizacao && (
                <DateTimePicker
                  value={dataRealizacao}
                  mode="date"
                  display="default"
                  onChange={(_e, d) => {
                    setMostrarDataRealizacao(false);
                    if (!d) return;
                    setDataRealizacao(d);
                    if (chaveDataLocal(d) <= transacaoConfirmar.data_vencimento) {
                      setAjusteTipo("nenhum");
                      setAjusteValor("");
                      setValorRealizado(formatarEntradaMoeda(String(Math.round(Number(transacaoConfirmar.valor) * 100))));
                    }
                  }}
                />
              )}
              {realizacaoAposAgendamento && (
                <View style={{ marginTop: 14, padding: 14, borderRadius: 12, backgroundColor: isDark ? "#2A2418" : "#FFF7E6", borderWidth: 1, borderColor: isDark ? "#5A4722" : "#F4D79A" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <MaterialIcons name="schedule" size={19} color="#D89014" />
                    <Text style={{ color: Cores.textoPrincipal, fontWeight: "800", flex: 1 }}>Realização após a data agendada</Text>
                  </View>
                  <Text style={{ color: Cores.textoSecundario, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
                    Se desejar, ajuste o valor final com juros ou desconto.
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {(["nenhum", "juros", "desconto"] as const).map((tipo) => (
                      <TouchableOpacity key={tipo} onPress={() => {
                        setAjusteTipo(tipo);
                        setAjusteValor("");
                        if (transacaoConfirmar) setValorRealizado(formatarEntradaMoeda(String(Math.round(Number(transacaoConfirmar.valor) * 100))));
                      }} style={{ flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center", backgroundColor: ajusteTipo === tipo ? (tipo === "desconto" ? "#2A9D8F" : tipo === "juros" ? "#E76F51" : "#68727D") : Cores.cardFundo }}>
                        <Text style={{ color: ajusteTipo === tipo ? "#FFF" : Cores.textoSecundario, fontSize: 12, fontWeight: "700" }}>{tipo === "nenhum" ? "Sem ajuste" : tipo === "juros" ? "Juros" : "Desconto"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {ajusteTipo !== "nenhum" && (
                    <View style={[styles.editInput, { marginTop: 10, marginBottom: 0, backgroundColor: Cores.cardFundo, borderColor: Cores.borda, flexDirection: "row", alignItems: "center" }]}>
                      <Text style={{ color: Cores.textoSecundario, marginRight: 6 }}>R$</Text>
                      <TextInput value={ajusteValor} onChangeText={(texto) => {
                        const formatado = formatarEntradaMoeda(texto);
                        setAjusteValor(formatado);
                        const ajusteNumerico = valorDaEntradaMoeda(formatado);
                        const novoValor = ajusteTipo === "juros"
                          ? Number(transacaoConfirmar.valor) + ajusteNumerico
                          : Math.max(0.01, Number(transacaoConfirmar.valor) - ajusteNumerico);
                        setValorRealizado(formatarEntradaMoeda(String(Math.round(novoValor * 100))));
                      }} keyboardType="numeric" placeholder="0,00" placeholderTextColor={Cores.textoSecundario} style={{ color: Cores.textoPrincipal, flex: 1 }} />
                    </View>
                  )}
                </View>
              )}
              {permiteValorParcial && (
                <View style={{ marginTop: 14 }}>
                  <Text style={{ color: Cores.textoPrincipal, fontWeight: "800", marginBottom: 6 }}>
                    Quanto foi {transacaoConfirmar.tipo === "receita" ? "recebido" : "pago"}?
                  </Text>
                  <View style={[styles.editInput, { marginBottom: 6, backgroundColor: Cores.blocoData, borderColor: Cores.borda, flexDirection: "row", alignItems: "center" }]}>
                    <Text style={{ color: Cores.textoSecundario, marginRight: 6 }}>R$</Text>
                    <TextInput
                      value={valorRealizado}
                      onChangeText={(texto) => setValorRealizado(formatarEntradaMoeda(texto))}
                      keyboardType="numeric"
                      placeholder="0,00"
                      placeholderTextColor={Cores.textoSecundario}
                      style={{ color: Cores.textoPrincipal, flex: 1, fontWeight: "700" }}
                    />
                  </View>
                  <Text style={{ color: saldoRestanteConclusao > 0 ? "#F59E0B" : Cores.textoSecundario, fontSize: 12, lineHeight: 17 }}>
                      {saldoRestanteConclusao > 0
                        ? `O saldo de ${fmtReais(saldoRestanteConclusao)} continuará pendente neste mesmo agendamento. O pagamento realizado ficará registrado no detalhe.`
                        : `Valor previsto: ${fmtReais(valorDevidoConclusao)}.`}
                  </Text>
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <TouchableOpacity disabled={salvandoRealizacao} style={{ flex: 1, padding: 13, borderRadius: 10, alignItems: "center", backgroundColor: Cores.blocoData, opacity: salvandoRealizacao ? 0.55 : 1 }} onPress={() => setTransacaoConfirmar(null)}>
                  <Text style={{ color: Cores.textoSecundario, fontWeight: "bold" }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={salvandoRealizacao} style={{ flex: 1, padding: 13, borderRadius: 10, alignItems: "center", backgroundColor: "#2A9D8F", opacity: salvandoRealizacao ? 0.55 : 1 }} onPress={() => aplicarStatus(transacaoConfirmar, "paga", dataRealizacao)}>
                  <Text style={{ color: "#FFF", fontWeight: "bold" }}>{salvandoRealizacao ? "Salvando..." : "Confirmar"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAIS DE FILTRO */}
      {/* MODAL EDITAR TRANSAÇÃO */}
      {modalEditarTransVisivel && (
      <Modal animationType="slide" transparent visible onRequestClose={() => setModalEditarTransVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? "#1E1E1E" : "#FFF", width: "95%", maxHeight: "90%" }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.modalTitle, { color: isDark ? "#FFF" : "#1A1A1A" }]}>Editar Transação</Text>

              {/* Status */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: 12, backgroundColor: isDark ? "#2C2C2C" : "#F0F0F0", borderRadius: 10 }}>
                <Text style={{ color: isDark ? "#FFF" : "#1A1A1A", fontWeight: "600" }}>
                  {editStatus === "paga" ? "✓ Pago/Recebido" : "⏳ Pendente"}
                </Text>
                <Switch
                  value={editStatus === "paga"}
                  disabled
                  trackColor={{ false: "#767577", true: "#2A9D8F" }}
                />
              </View>
              <Text style={{ color: isDark ? "#888" : "#777", fontSize: 11, lineHeight: 16, marginTop: -9, marginBottom: 14 }}>
                Para concluir ou reabrir, use a ação do lançamento no histórico. Assim a data e o valor realizado são confirmados com segurança.
              </Text>

              {/* Descrição */}
              <TextInput
                style={[styles.editInput, { backgroundColor: isDark ? "#2C2C2C" : "#F5F5F5", color: isDark ? "#FFF" : "#1A1A1A", borderColor: isDark ? "#444" : "#DDD" }]}
                placeholder="Descrição"
                placeholderTextColor={isDark ? "#888" : "#AAA"}
                value={editDescricao}
                onChangeText={setEditDescricao}
              />

              {transacaoEditando && getParcelaRecorrencia(transacaoEditando.descricao) && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, backgroundColor: Cores.blocoData }}>
                  <MaterialIcons name="lock-outline" size={16} color={Cores.textoSecundario} />
                  <Text style={{ color: Cores.textoSecundario, fontSize: 12, fontWeight: "700" }}>
                    Parcela {getParcelaRecorrencia(transacaoEditando.descricao)?.atual} de {getParcelaRecorrencia(transacaoEditando.descricao)?.total} — informação fixa
                  </Text>
                </View>
              )}

              {/* Valor */}
              <View style={[styles.editInput, { backgroundColor: isDark ? "#2C2C2C" : "#F5F5F5", borderColor: isDark ? "#444" : "#DDD", flexDirection: "row", alignItems: "center" }]}>
                <Text style={{ color: isDark ? "#888" : "#AAA", fontSize: 15, marginRight: 4 }}>R$</Text>
                <TextInput
                  style={{ flex: 1, color: isDark ? "#FFF" : "#1A1A1A", fontSize: 15 }}
                  placeholder="0,00"
                  placeholderTextColor={isDark ? "#888" : "#AAA"}
                  value={editValor}
                  onChangeText={(texto) => setEditValor(formatarEntradaMoeda(texto))}
                  keyboardType="numeric"
                />
              </View>

              {/* Data */}
              <TouchableOpacity
                style={[styles.editInput, { backgroundColor: isDark ? "#2C2C2C" : "#F5F5F5", borderColor: isDark ? "#444" : "#DDD", flexDirection: "row", alignItems: "center" }]}
                onPress={() => setMostrarCalendarioEdit(true)}
              >
                <MaterialIcons name="calendar-today" size={18} color={isDark ? "#AAA" : "#666"} style={{ marginRight: 8 }} />
                <Text style={{ color: isDark ? "#FFF" : "#1A1A1A" }}>
                  {String(editData.getDate()).padStart(2, "0")}/{String(editData.getMonth() + 1).padStart(2, "0")}/{editData.getFullYear()}
                </Text>
              </TouchableOpacity>
              {mostrarCalendarioEdit && (
                <DateTimePicker
                  value={editData}
                  mode="date"
                  display="default"
                  onChange={(_e, d) => { setMostrarCalendarioEdit(false); if (d) setEditData(d); }}
                />
              )}

              {/* Conta */}
              <Text style={{ color: isDark ? "#AAA" : "#666", fontSize: 12, marginBottom: 6, marginTop: 4 }}>Conta:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                {contas.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.filterPill, { backgroundColor: editContaId === c.id ? "#457B9D" : (isDark ? "#2C2C2C" : "#F0F0F0"), borderWidth: 1, borderColor: editContaId === c.id ? "#457B9D" : (isDark ? "#444" : "#DDD"), marginRight: 8 }]}
                    onPress={() => setEditContaId(c.id)}
                  >
                    <Text style={[styles.filterPillText, { color: editContaId === c.id ? "#FFF" : (isDark ? "#FFF" : "#1A1A1A") }]}>{c.nome}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Categoria */}
              {transacaoEditando && !ehMovimentoInternoSemCategoria(transacaoEditando) && (
                <>
                  <Text style={{ color: isDark ? "#AAA" : "#666", fontSize: 12, marginBottom: 6 }}>Categoria:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                    {categorias.filter((c) => c.ativa !== 0 && (c.tipo === transacaoEditando.tipo || c.tipo === "ambos")).map((cat) => (
                      <TouchableOpacity
                        key={cat.id}
                        style={[styles.filterPill, { backgroundColor: editCategoriaId === cat.id ? cat.cor : (isDark ? "#2C2C2C" : "#F0F0F0"), borderWidth: 1, borderColor: editCategoriaId === cat.id ? cat.cor : (isDark ? "#444" : "#DDD"), marginRight: 8 }]}
                        onPress={() => setEditCategoriaId(cat.id)}
                      >
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: editCategoriaId === cat.id ? "#FFF" : cat.cor, marginRight: 4 }} />
                        <Text style={[styles.filterPillText, { color: editCategoriaId === cat.id ? "#FFF" : (isDark ? "#FFF" : "#1A1A1A") }]}>{cat.nome}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
                <TouchableOpacity style={{ flex: 1, padding: 14, borderRadius: 10, alignItems: "center", backgroundColor: isDark ? "#2C2C2C" : "#F0F0F0" }} onPress={() => setModalEditarTransVisivel(false)}>
                  <Text style={{ color: isDark ? "#AAA" : "#666", fontWeight: "bold" }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, padding: 14, borderRadius: 10, alignItems: "center", backgroundColor: "#2A9D8F" }} onPress={salvarEdicaoTransacao}>
                  <Text style={{ color: "#FFF", fontWeight: "bold" }}>Salvar</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}

      {/* MODAL OPÇÕES SÉRIE */}
      {modalOpcoesSerie && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalOpcoesSerie(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: isDark ? "#1E1E1E" : "#FFF" }]}>
              <Text style={[styles.modalTitle, { color: isDark ? "#FFF" : "#1A1A1A" }]}>{modalOpcoesSerie.titulo}</Text>
              <Text style={{ color: isDark ? "#AAA" : "#555", textAlign: "center", marginBottom: 24, fontSize: 14, lineHeight: 20 }}>
                {modalOpcoesSerie.descricao}
              </Text>
              <TouchableOpacity
                style={{ paddingVertical: 13, borderRadius: 10, alignItems: "center", backgroundColor: "#457B9D", marginBottom: 10 }}
                onPress={modalOpcoesSerie.onSimples}
              >
                <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>{modalOpcoesSerie.labelSimples}</Text>
              </TouchableOpacity>
              {modalOpcoesSerie.labelFuturas && (
                <TouchableOpacity
                  style={{ paddingVertical: 13, borderRadius: 10, alignItems: "center", backgroundColor: "#F4A261", marginBottom: 10 }}
                  onPress={modalOpcoesSerie.onFuturas}
                >
                  <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>{modalOpcoesSerie.labelFuturas}</Text>
                </TouchableOpacity>
              )}
              {modalOpcoesSerie.labelSerie && (
                <TouchableOpacity
                  style={{ paddingVertical: 13, borderRadius: 10, alignItems: "center", backgroundColor: modalOpcoesSerie.corSerie ?? "#2A9D8F", marginBottom: 10 }}
                  onPress={modalOpcoesSerie.onSerie}
                >
                  <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>{modalOpcoesSerie.labelSerie}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={{ paddingVertical: 13, borderRadius: 10, alignItems: "center", backgroundColor: isDark ? "#2C2C2C" : "#F0F0F0" }}
                onPress={() => setModalOpcoesSerie(null)}
              >
                <Text style={{ color: isDark ? "#AAA" : "#666", fontWeight: "bold" }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAL CONFIRMAR DELETE SIMPLES */}
      {modalDeleteSimples && (
        <Modal animationType="fade" transparent visible onRequestClose={() => { if (!loadingEstornoFatura) setModalDeleteSimples(null); }}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: isDark ? "#1E1E1E" : "#FFF", borderTopWidth: 3, borderTopColor: parseInvoicePaymentMarker(modalDeleteSimples.descricao) ? "#F59E0B" : "#E76F51" }]}>
              <View style={{ alignItems: "center", marginBottom: 12 }}>
                <MaterialIcons name={parseInvoicePaymentMarker(modalDeleteSimples.descricao) ? "undo" : "delete-outline"} size={36} color={parseInvoicePaymentMarker(modalDeleteSimples.descricao) ? "#F59E0B" : "#E76F51"} />
              </View>
              <Text style={[styles.modalTitle, { color: isDark ? "#FFF" : "#1A1A1A" }]}>{parseInvoicePaymentMarker(modalDeleteSimples.descricao) ? "Estornar pagamento" : "Excluir"}</Text>
              <Text style={{ color: isDark ? "#AAA" : "#555", textAlign: "center", marginBottom: 24, fontSize: 14 }}>
                {parseInvoicePaymentMarker(modalDeleteSimples.descricao)
                  ? "Este pagamento será estornado conforme seus itens vinculados e o lançamento será removido do histórico."
                  : "Tem certeza que deseja apagar esta transação?"}
              </Text>
              <TouchableOpacity
                style={{ paddingVertical: 13, borderRadius: 10, alignItems: "center", backgroundColor: parseInvoicePaymentMarker(modalDeleteSimples.descricao) ? "#F59E0B" : "#E76F51", marginBottom: 10, opacity: loadingEstornoFatura ? 0.55 : 1 }}
                onPress={() => {
                  const transacao = modalDeleteSimples;
                  if (parseInvoicePaymentMarker(transacao.descricao)) {
                    void estornarTransacaoDeFatura(transacao);
                  } else {
                    setModalDeleteSimples(null);
                    void executarDeleteUma(transacao);
                  }
                }}
                disabled={loadingEstornoFatura}
              >
                <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>{loadingEstornoFatura ? "Processando..." : parseInvoicePaymentMarker(modalDeleteSimples.descricao) ? "Estornar" : "Apagar"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ paddingVertical: 13, borderRadius: 10, alignItems: "center", backgroundColor: isDark ? "#2C2C2C" : "#F0F0F0" }}
                onPress={() => setModalDeleteSimples(null)}
                disabled={loadingEstornoFatura}
              >
                <Text style={{ color: isDark ? "#AAA" : "#666", fontWeight: "bold" }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {modalFiltroAno && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalFiltroAno(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda, borderWidth: 1 }]}>
            <View style={styles.filterModalHeader}>
              <View style={[styles.filterModalHeaderIcon, { backgroundColor: "#805AD51F" }]}><MaterialIcons name="calendar-today" size={21} color="#805AD5" /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.filterModalTitle, { color: Cores.textoPrincipal }]}>Ano do histórico</Text>
                <Text style={[styles.filterModalSubtitle, { color: Cores.textoSecundario }]}>Escolha o ano sem perder a navegação mensal.</Text>
              </View>
              <TouchableOpacity style={styles.filterModalClose} onPress={() => setModalFiltroAno(false)} accessibilityLabel="Fechar filtro por ano">
                <MaterialIcons name="close" size={21} color={Cores.textoSecundario} />
              </TouchableOpacity>
            </View>

            <View style={[styles.yearFilterStepper, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}>
              <TouchableOpacity onPress={() => alterarAno(-1)} style={styles.yearFilterArrow} accessibilityLabel="Ano anterior">
                <MaterialIcons name="chevron-left" size={27} color="#805AD5" />
              </TouchableOpacity>
              <View style={styles.yearFilterCurrent}>
                <Text style={[styles.yearFilterLabel, { color: Cores.textoSecundario }]}>ANO SELECIONADO</Text>
                <Text style={[styles.yearFilterValue, { color: Cores.textoPrincipal }]}>{anoSelecionado}</Text>
              </View>
              <TouchableOpacity onPress={() => alterarAno(1)} style={styles.yearFilterArrow} accessibilityLabel="Próximo ano">
                <MaterialIcons name="chevron-right" size={27} color="#805AD5" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[styles.modalBotaoAplicar, { backgroundColor: "#805AD5" }]} onPress={() => setModalFiltroAno(false)}>
              <Text style={styles.modalBotaoTexto}>Aplicar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {modalFiltroTipo && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalFiltroTipo(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda, borderWidth: 1 }]}>
            <View style={styles.filterModalHeader}>
              <View style={[styles.filterModalHeaderIcon, { backgroundColor: "#F4A2611F" }]}><MaterialIcons name="swap-vert" size={22} color="#F4A261" /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.filterModalTitle, { color: Cores.textoPrincipal }]}>Tipo de lançamento</Text>
                <Text style={[styles.filterModalSubtitle, { color: Cores.textoSecundario }]}>Selecione um ou mais tipos para combinar no histórico.</Text>
              </View>
              <TouchableOpacity style={styles.filterModalClose} onPress={() => setModalFiltroTipo(false)} accessibilityLabel="Fechar filtro por tipo">
                <MaterialIcons name="close" size={21} color={Cores.textoSecundario} />
              </TouchableOpacity>
            </View>
            <View style={styles.filterModalGrid}>
              {[
                { key: "todas" as const, label: "Todos", icon: "view-list" as const, bgAtivo: "#457B9D" },
                { key: "receita" as const, label: "Receitas", icon: "arrow-upward" as const, bgAtivo: "#2A9D8F" },
                { key: "despesa" as const, label: "Despesas", icon: "arrow-downward" as const, bgAtivo: "#E76F51" },
                { key: "transferencia" as const, label: "Transferências", icon: "swap-horiz" as const, bgAtivo: "#F4A261" },
                { key: "fatura" as const, label: "Faturas", icon: "credit-card" as const, bgAtivo: "#805AD5" },
              ].map((op) => {
                const isAtivo = op.key === "todas" ? filtrosTipo.length === 0 : filtrosTipo.includes(op.key);
                return (
                  <TouchableOpacity key={op.key} style={[styles.filterModalOption, { backgroundColor: isAtivo ? op.bgAtivo : Cores.pillFundo, borderColor: isAtivo ? op.bgAtivo : Cores.borda }]} onPress={() => selecionarFiltroTipo(op.key)}>
                    <MaterialIcons name={op.icon} size={18} color={isAtivo ? "#FFF" : op.bgAtivo} />
                    <Text style={[styles.filterModalOptionText, { color: isAtivo ? "#FFF" : Cores.textoPrincipal }]} numberOfLines={1}>{op.label}</Text>
                    <MaterialIcons name={isAtivo ? "check-box" : "check-box-outline-blank"} size={18} color={isAtivo ? "#FFF" : Cores.textoSecundario} />
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={[styles.modalBotaoAplicar, { backgroundColor: "#2A9D8F" }]} onPress={() => setModalFiltroTipo(false)}>
              <Text style={styles.modalBotaoTexto}>Aplicar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {modalFiltroConta && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalFiltroConta(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda, borderWidth: 1, maxHeight: "82%" }]}>
            <View style={styles.filterModalHeader}>
              <View style={[styles.filterModalHeaderIcon, { backgroundColor: "#457B9D1F" }]}><MaterialIcons name="account-balance-wallet" size={21} color="#457B9D" /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.filterModalTitle, { color: Cores.textoPrincipal }]}>Contas</Text>
                <Text style={[styles.filterModalSubtitle, { color: Cores.textoSecundario }]}>Selecione uma ou mais contas.</Text>
              </View>
              <TouchableOpacity style={styles.filterModalClose} onPress={() => setModalFiltroConta(false)} accessibilityLabel="Fechar filtro por conta">
                <MaterialIcons name="close" size={21} color={Cores.textoSecundario} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.filterModalScroll} contentContainerStyle={styles.filterModalList} showsVerticalScrollIndicator={false}>
              <TouchableOpacity style={[styles.filterModalOptionWide, { backgroundColor: filtroContas.length === 0 ? "#457B9D" : Cores.pillFundo, borderColor: filtroContas.length === 0 ? "#457B9D" : Cores.borda }]} onPress={() => { setFiltroContas([]); setPaginaAtual(1); }}>
                <View style={[styles.filterAccountIcon, { backgroundColor: filtroContas.length === 0 ? "rgba(255,255,255,0.2)" : "#457B9D1F" }]}><MaterialIcons name="select-all" size={18} color={filtroContas.length === 0 ? "#FFF" : "#457B9D"} /></View>
                <Text style={[styles.filterModalOptionText, { color: filtroContas.length === 0 ? "#FFF" : Cores.textoPrincipal }]}>Todas as contas</Text>
                <MaterialIcons name={filtroContas.length === 0 ? "check-circle" : "radio-button-unchecked"} size={19} color={filtroContas.length === 0 ? "#FFF" : Cores.textoSecundario} />
              </TouchableOpacity>
              {contas.map((c) => {
                const selecionada = filtroContas.includes(c.id);
                const estiloConta = getEstiloBanco(c.nome, isDark);
                return (
                <TouchableOpacity key={`fc-${c.id}`} style={[styles.filterModalOptionWide, { backgroundColor: selecionada ? "#457B9D" : Cores.pillFundo, borderColor: selecionada ? "#457B9D" : Cores.borda }]} onPress={() => toggleFiltroConta(c.id)}>
                  <View style={[styles.filterAccountIcon, { backgroundColor: selecionada ? "rgba(255,255,255,0.2)" : estiloConta.bg }]}><MaterialIcons name="account-balance-wallet" size={17} color={selecionada ? "#FFF" : estiloConta.text} /></View>
                  <Text style={[styles.filterModalOptionText, { color: selecionada ? "#FFF" : Cores.textoPrincipal }]} numberOfLines={1}>{c.nome}</Text>
                  <MaterialIcons name={selecionada ? "check-circle" : "radio-button-unchecked"} size={19} color={selecionada ? "#FFF" : Cores.textoSecundario} />
                </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={[styles.modalBotaoAplicar, { backgroundColor: "#457B9D" }]} onPress={() => setModalFiltroConta(false)}>
              <Text style={styles.modalBotaoTexto}>Aplicar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {modalFiltroCat && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalFiltroCat(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda, borderWidth: 1, maxHeight: "85%" }]}>
            <View style={styles.filterModalHeader}>
              <View style={[styles.filterModalHeaderIcon, { backgroundColor: "#2A9D8F1F" }]}><MaterialIcons name="label" size={21} color="#2A9D8F" /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.filterModalTitle, { color: Cores.textoPrincipal }]}>Categorias</Text>
                <Text style={[styles.filterModalSubtitle, { color: Cores.textoSecundario }]}>Combine categorias para refinar os resultados.</Text>
              </View>
              <TouchableOpacity style={styles.filterModalClose} onPress={() => setModalFiltroCat(false)} accessibilityLabel="Fechar filtro por categoria">
                <MaterialIcons name="close" size={21} color={Cores.textoSecundario} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.filterModalScroll} showsVerticalScrollIndicator={false}>
              {/* Todas */}
              <View style={{ marginBottom: 14 }}>
                <TouchableOpacity
                  style={[styles.filterModalOptionWide, { backgroundColor: filtroCategorias.length === 0 ? "#2A9D8F" : Cores.pillFundo, borderColor: filtroCategorias.length === 0 ? "#2A9D8F" : Cores.borda }]}
                  onPress={() => { setFiltroCategorias([]); setPaginaAtual(1); }}
                >
                  <View style={[styles.filterAccountIcon, { backgroundColor: filtroCategorias.length === 0 ? "rgba(255,255,255,0.2)" : "#2A9D8F1F" }]}><MaterialIcons name="select-all" size={18} color={filtroCategorias.length === 0 ? "#FFF" : "#2A9D8F"} /></View>
                  <Text style={[styles.filterModalOptionText, { color: filtroCategorias.length === 0 ? "#FFF" : Cores.textoPrincipal }]}>Todas as categorias</Text>
                  <MaterialIcons name={filtroCategorias.length === 0 ? "check-circle" : "radio-button-unchecked"} size={19} color={filtroCategorias.length === 0 ? "#FFF" : Cores.textoSecundario} />
                </TouchableOpacity>
              </View>

              {/* Receitas */}
              {(filtrosTipo.length === 0 || filtrosTipo.includes("receita")) && categoriasReceitaVisiveis.length > 0 && (
                <>
                  <View style={styles.catSecaoHeader}>
                    <MaterialIcons name="arrow-upward" size={13} color="#2A9D8F" />
                    <Text style={[styles.catSecaoTitulo, { color: "#2A9D8F" }]}>Receitas</Text>
                  </View>
                  <View style={[styles.wrapContainer, { marginBottom: 12 }]}>
                    {categoriasReceitaVisiveis.map((c) => (
                      <TouchableOpacity
                        key={`fcat-${c.id}`}
                        style={[styles.categoryFilterOption, { backgroundColor: filtroCategorias.includes(c.id) ? c.cor : Cores.pillFundo, borderColor: filtroCategorias.includes(c.id) ? c.cor : Cores.borda }]}
                        onPress={() => toggleFiltroCategoria(c.id)}
                      >
                        <View style={[styles.colorDot, { backgroundColor: filtroCategorias.includes(c.id) ? "#FFF" : c.cor }]} />
                        <Text style={[styles.filterModalOptionText, styles.categoryFilterOptionText, { color: filtroCategorias.includes(c.id) ? "#FFF" : Cores.textoPrincipal }]}>{c.nome}</Text>
                        {filtroCategorias.includes(c.id) && <MaterialIcons name="check" size={16} color="#FFF" />}
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* Despesas */}
              {(filtrosTipo.length === 0 || filtrosTipo.includes("despesa") || filtrosTipo.includes("fatura")) && categoriasDespesaVisiveis.length > 0 && (
                <>
                  <View style={styles.catSecaoHeader}>
                    <MaterialIcons name="arrow-downward" size={13} color="#E76F51" />
                    <Text style={[styles.catSecaoTitulo, { color: "#E76F51" }]}>Despesas</Text>
                  </View>
                  <View style={[styles.wrapContainer, { marginBottom: 12 }]}>
                    {categoriasDespesaVisiveis.map((c) => (
                      <TouchableOpacity
                        key={`fcat-${c.id}`}
                        style={[styles.categoryFilterOption, { backgroundColor: filtroCategorias.includes(c.id) ? c.cor : Cores.pillFundo, borderColor: filtroCategorias.includes(c.id) ? c.cor : Cores.borda }]}
                        onPress={() => toggleFiltroCategoria(c.id)}
                      >
                        <View style={[styles.colorDot, { backgroundColor: filtroCategorias.includes(c.id) ? "#FFF" : c.cor }]} />
                        <Text style={[styles.filterModalOptionText, styles.categoryFilterOptionText, { color: filtroCategorias.includes(c.id) ? "#FFF" : Cores.textoPrincipal }]}>{c.nome}</Text>
                        {filtroCategorias.includes(c.id) && <MaterialIcons name="check" size={16} color="#FFF" />}
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {(filtrosTipo.length === 0 || filtrosTipo.some((tipo) => tipo === "receita" || tipo === "despesa" || tipo === "fatura")) && categoriasAmbasVisiveis.length > 0 && (
                <>
                  <View style={styles.catSecaoHeader}>
                    <MaterialIcons name="swap-vert" size={13} color="#457B9D" />
                    <Text style={[styles.catSecaoTitulo, { color: "#457B9D" }]}>Receitas e despesas</Text>
                  </View>
                  <View style={[styles.wrapContainer, { marginBottom: 12 }]}>
                    {categoriasAmbasVisiveis.map((categoria) => (
                      <TouchableOpacity
                        key={`fcat-${categoria.id}`}
                        style={[styles.categoryFilterOption, { backgroundColor: filtroCategorias.includes(categoria.id) ? categoria.cor : Cores.pillFundo, borderColor: filtroCategorias.includes(categoria.id) ? categoria.cor : Cores.borda }]}
                        onPress={() => toggleFiltroCategoria(categoria.id)}
                      >
                        <View style={[styles.colorDot, { backgroundColor: filtroCategorias.includes(categoria.id) ? "#FFF" : categoria.cor }]} />
                        <Text style={[styles.filterModalOptionText, styles.categoryFilterOptionText, { color: filtroCategorias.includes(categoria.id) ? "#FFF" : Cores.textoPrincipal }]}>{categoria.nome}</Text>
                        {filtroCategorias.includes(categoria.id) && <MaterialIcons name="check" size={16} color="#FFF" />}
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>

            <TouchableOpacity style={[styles.modalBotaoAplicar, { backgroundColor: "#2A9D8F", marginTop: 12 }]} onPress={() => setModalFiltroCat(false)}>
              <Text style={styles.modalBotaoTexto}>Aplicar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screenContent: { flex: 1, position: "relative" },
  mainScroll: { flex: 1 },
  mainScrollContent: { paddingTop: HEADER_EXPANDED_HEIGHT + 10, paddingBottom: 110 },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    elevation: 12,
    overflow: "hidden",
    shadowColor: "#001E1A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
  },
  headerExpandedContent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 7,
  },
  headerCompactContent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_COMPACT_HEIGHT,
    paddingHorizontal: 12,
    paddingTop: 5,
    paddingBottom: 4,
  },
  title: { fontSize: 20, fontWeight: "bold" },
  headerTopRow: { height: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerSearch: { width: "52%", height: 28, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(0,0,0,0.15)", borderRadius: 14, paddingRight: 4 },
  headerSearchInput: { flex: 1, paddingHorizontal: 10, paddingVertical: 4, color: "#FFF", fontSize: 12 },
  headerSearchClear: { padding: 3, marginLeft: 2 },
  headerMonthRow: { height: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 2 },
  headerMonthButton: { width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.14)" },
  headerMonthText: { color: "#FFF", fontSize: 13, fontWeight: "700", textTransform: "capitalize", minWidth: 130, textAlign: "center" },
  headerTotals: { minHeight: 33, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 13, paddingHorizontal: 5 },
  headerTotalLabel: { color: "rgba(255,255,255,0.68)", fontSize: 9, marginBottom: 0 },
  headerIncome: { color: "#B7F5D8", fontSize: 14, fontWeight: "800" },
  headerExpense: { color: "#FFC0B5", fontSize: 14, fontWeight: "800", textAlign: "right" },
  compactHeaderTopRow: { minHeight: 27, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  compactHeaderTitle: { color: "#FFF", fontSize: 16, fontWeight: "800" },
  compactHeaderSearch: {
    width: "52%",
    height: 27,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
    paddingRight: 2,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.16)",
  },
  compactHeaderSearchInput: { flex: 1, minWidth: 0, paddingHorizontal: 5, paddingVertical: 3, color: "#FFF", fontSize: 11 },
  compactHeaderClear: { padding: 3 },
  compactHeaderSummary: { flex: 1, minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 1 },
  compactMonthSelector: { flex: 1.2, minWidth: 0, flexDirection: "row", alignItems: "center" },
  compactMonthButton: { width: 23, height: 23, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.13)" },
  compactMonthText: { flex: 1, minWidth: 0, paddingHorizontal: 2, color: "#FFF", fontSize: 11, fontWeight: "700", textAlign: "center", textTransform: "capitalize" },
  compactTotals: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  compactIncome: { flex: 1, color: "#B7F5D8", fontSize: 10, fontWeight: "800", textAlign: "left" },
  compactExpense: { flex: 1, color: "#FFC0B5", fontSize: 10, fontWeight: "800", textAlign: "right" },
  statusFilters: { flexDirection: "row", gap: 7, paddingHorizontal: 14, marginTop: 14, marginBottom: 12 },
  statusFilter: { flex: 1, paddingVertical: 8, borderRadius: 18, borderWidth: 1, alignItems: "center" },
  statusFilterContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  statusFilterText: { fontSize: 11, fontWeight: "700" },
  periodFilterBanner: { marginHorizontal: 14, marginBottom: 10, minHeight: 58, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  periodFilterIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.36)" },
  periodFilterTitle: { fontSize: 13, fontWeight: "800" },
  periodFilterText: { fontSize: 11, marginTop: 2 },
  periodFilterClose: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },

  filtersPanel: { marginHorizontal: 14, marginBottom: 12, padding: 12, borderWidth: 1, borderRadius: 18 },
  filtersPanelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 11 },
  filtersPanelHeading: { flexDirection: "row", alignItems: "center", gap: 9, flex: 1 },
  filtersPanelIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  filtersPanelTitle: { fontSize: 13, fontWeight: "800" },
  filtersPanelSubtitle: { fontSize: 10, marginTop: 1 },
  clearFiltersButton: { minHeight: 32, paddingHorizontal: 9, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  clearFiltersText: { color: "#E76F51", fontSize: 11, fontWeight: "800" },
  filterButtonsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  periodSelector: { minHeight: 50, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", marginBottom: 8 },
  periodSelectorArrow: { width: 48, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  periodSelectorCenter: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 6 },
  periodSelectorText: { fontSize: 14, fontWeight: "900", textTransform: "capitalize" },
  mainFilterButton: { flexGrow: 1, flexBasis: "46%", minWidth: 0, minHeight: 62, justifyContent: "center", paddingVertical: 9, paddingHorizontal: 11, borderRadius: 13, borderWidth: 1 },
  mainFilterLabelRow: { flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 5 },
  mainFilterLabel: { fontSize: 8, fontWeight: "800", letterSpacing: 0.45 },
  mainFilterValue: { fontSize: 11, fontWeight: "800" },

  anoNavBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginHorizontal: 15, marginBottom: 8, borderRadius: 12, paddingVertical: 4 },
  anoNavBtn: { padding: 8 },
  anoNavText: { fontSize: 18, fontWeight: "bold", minWidth: 60, textAlign: "center" },

  mesesScrollContainer: { marginBottom: 12 },
  mesPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginRight: 8, borderWidth: 1 },
  mesPillText: { fontSize: 13, fontWeight: "600" },

  // Barra de resumo
  resumoBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingVertical: 10, paddingHorizontal: 15, borderBottomWidth: 1, marginBottom: 10 },
  resumoItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  resumoReceita: { fontSize: 13, fontWeight: "bold", color: "#2A9D8F" },
  resumoDespesa: { fontSize: 13, fontWeight: "bold", color: "#E76F51" },
  resumoBalanco: { fontSize: 13, fontWeight: "bold" },
  resumoDivider: { width: 1, height: 20 },

  listContainer: { paddingHorizontal: 12 },
  tabelaCard: { marginBottom: 20, borderRadius: 18, borderWidth: 1, overflow: "hidden" },

  monthHeader: { paddingVertical: 12, paddingHorizontal: 15, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  monthHeaderText: { fontSize: 16, fontWeight: "bold", textTransform: "capitalize" },
  contadorText: { fontSize: 12 },

  // Novo layout de card de transação
  transacaoCard: { flexDirection: "row", alignItems: "center", padding: 14, minHeight: 72, borderBottomWidth: 1 },
  dayHeading: { paddingTop: 13, paddingBottom: 7, paddingHorizontal: 12, fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
  transactionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", marginRight: 12 },
  dataBadge: { alignItems: "center", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, marginRight: 12, minWidth: 42 },
  dataDia: { fontSize: 16, fontWeight: "bold", lineHeight: 19 },
  dataMes: { fontSize: 9, fontWeight: "600", lineHeight: 12 },
  transacaoInfo: { flex: 1 },
  nomeText: { fontSize: 13, fontWeight: "600", lineHeight: 17 },
  badge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  pendentePill: { backgroundColor: "#4A1919", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  pendenteText: { fontSize: 9, fontWeight: "700", color: "#FF6B6B" },
  transferPill: { flexDirection: "row", alignItems: "center", backgroundColor: "#4D2C00", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6 },
  transferText: { fontSize: 9, fontWeight: "700", color: "#F4A261", marginLeft: 2 },
  transacaoAcoes: { alignItems: "flex-end" },
  valorText: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  paymentCardBreakdown: { alignItems: "flex-end", gap: 1, marginTop: 3 },
  paymentCardLine: { fontSize: 9, fontWeight: "700", textAlign: "right" },
  acaoBtn: { padding: 2 },

  emptyContainer: { alignItems: "center", paddingVertical: 40 },
  emptyMonthText: { fontStyle: "italic", fontSize: 13, textAlign: "center" },

  tabelaFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1 },
  footerLabel: { fontSize: 11, fontWeight: "600" },
  footerTotais: { flexDirection: "row", gap: 16 },
  footerItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  footerValorReceita: { fontSize: 13, fontWeight: "700", color: "#2A9D8F" },
  footerValorDespesa: { fontSize: 13, fontWeight: "700", color: "#E76F51" },

  editInput: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 14, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(2, 12, 15, 0.78)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalContent: { width: "100%", maxWidth: 520, padding: 24, borderRadius: 22, elevation: 10 },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 20, textAlign: "center" },
  wrapContainer: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 25, justifyContent: "center" },
  filterPill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, flexDirection: "row", alignItems: "center" },
  filterPillText: { fontSize: 14, fontWeight: "500" },
  filterModalHeader: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 18 },
  filterModalHeaderIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  filterModalTitle: { fontSize: 17, fontWeight: "900" },
  filterModalSubtitle: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  filterModalClose: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  filterModalGrid: { gap: 8, marginBottom: 20 },
  filterModalOption: { width: "100%", minHeight: 48, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  filterModalOptionWide: { width: "100%", minHeight: 50, paddingHorizontal: 11, borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  filterModalOptionText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: "700" },
  filterModalScroll: { flexShrink: 1, marginBottom: 16 },
  filterModalList: { gap: 8, paddingBottom: 2 },
  filterAccountIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  categoryFilterOption: { width: "100%", minWidth: 0, minHeight: 48, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  categoryFilterOptionText: { flexShrink: 1, lineHeight: 18 },
  colorDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  yearFilterStepper: { minHeight: 82, borderRadius: 16, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  yearFilterArrow: { width: 54, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  yearFilterCurrent: { alignItems: "center", justifyContent: "center" },
  yearFilterLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.6, marginBottom: 2 },
  yearFilterValue: { fontSize: 25, fontWeight: "900" },
  yearFilterAvailableLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 0.65, marginBottom: 8 },
  yearFilterOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  yearFilterOption: { minWidth: 72, minHeight: 40, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  yearFilterOptionText: { fontSize: 13, fontWeight: "800" },
  modalBotaoAplicar: { minHeight: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  modalBotaoTexto: { fontSize: 15, fontWeight: "700", color: "#FFF" },
  catSecaoHeader: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: "#33333322" },
  catSecaoTitulo: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: "700" },
  contaTag: { fontSize: 11, fontWeight: "700" },
  transacaoDesc: { fontSize: 13, fontWeight: "600" },
  transacaoValor: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  detalheLinha: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  paymentDetailModal: { maxHeight: "92%", paddingBottom: 18 },
  paymentDetailBody: { flexShrink: 1 },
  paymentDetailBodyContent: { paddingBottom: 2 },
  paymentHistorySection: { marginTop: 12, borderWidth: 1, borderRadius: 14, padding: 12 },
  paymentHistoryHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  paymentHistoryTitle: { fontSize: 14, fontWeight: "900" },
  paymentHistorySubtitle: { fontSize: 10, lineHeight: 14, marginTop: 2 },
  paymentHistoryCount: { minWidth: 30, height: 30, paddingHorizontal: 8, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  paymentHistoryList: { width: "100%" },
  paymentHistoryRow: { minHeight: 57, borderTopWidth: 1, flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 8 },
  paymentHistoryIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  paymentHistoryEmpty: { paddingVertical: 12, fontSize: 12, lineHeight: 17, textAlign: "center" },
  paymentHistoryRetry: { minHeight: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  paymentReopenSummary: { borderRadius: 12, padding: 13, gap: 10, marginBottom: 16 },
  detalheAcao: { flex: 1, flexBasis: "45%", minWidth: 120, minHeight: 54, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 3 },
});
