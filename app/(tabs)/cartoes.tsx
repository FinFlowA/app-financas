/**
 * app/(tabs)/cartoes.tsx
 * Sistema completo de cartões de crédito do FinFlow.
 *
 * Funcionalidades:
 * - Criar/editar cartões com nome, cor, limite, vencimento, fechamento
 * - Visualizar fatura atual, limite disponível, histórico de compras
 * - Adicionar compras simples e parceladas
 * - Marcar fatura como paga
 * - Parcelas distribuídas automaticamente nas faturas corretas
 *
 * SQL necessário no Supabase (executar uma única vez):
 * ─────────────────────────────────────────────────────────────────
 * CREATE TABLE cartoes (
 *   id SERIAL PRIMARY KEY,
 *   user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
 *   nome VARCHAR(100) NOT NULL,
 *   cor VARCHAR(20) NOT NULL DEFAULT '#457B9D',
 *   limite DECIMAL(12,2) NOT NULL DEFAULT 0,
 *   dia_vencimento INTEGER NOT NULL DEFAULT 10,
 *   dia_fechamento INTEGER NOT NULL DEFAULT 3,
 *   ativo BOOLEAN NOT NULL DEFAULT true,
 *   criado_em TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * CREATE TABLE fatura_itens (
 *   id SERIAL PRIMARY KEY,
 *   cartao_id INTEGER REFERENCES cartoes(id) ON DELETE CASCADE,
 *   user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
 *   descricao VARCHAR(200) NOT NULL,
 *   valor DECIMAL(12,2) NOT NULL,
 *   data_compra DATE NOT NULL,
 *   mes_fatura VARCHAR(7) NOT NULL,  -- YYYY-MM
 *   parcela_atual INTEGER NOT NULL DEFAULT 1,
 *   total_parcelas INTEGER NOT NULL DEFAULT 1,
 *   grupo_parcela_id INTEGER,        -- referência ao id da 1ª parcela
 *   categoria_id INTEGER,
 *   pago BOOLEAN NOT NULL DEFAULT false,
 *   criado_em TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * ALTER TABLE cartoes ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE fatura_itens ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "user_own" ON cartoes USING (auth.uid() = user_id);
 * CREATE POLICY "user_own" ON fatura_itens USING (auth.uid() = user_id);
 * ─────────────────────────────────────────────────────────────────
 */

import { MaterialIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  DeviceEventEmitter,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Modal from "../../components/FinFlowScreen";
import FinFlowPopup from "../../components/FinFlowPopup";
import { SafeAreaView } from "react-native-safe-area-context";
import { IS_LOCAL_DEMO, supabase } from "../../lib/supabase";
import { useAppTheme } from "../_layout";
import { fmtReais, formatarEntradaMoeda, valorDaEntradaMoeda } from "../../lib/utils";
import { agendarNotificacoesDoApp } from "../../lib/notifications";
import {
  createInvoiceOperationRequestId,
  isInvoicePaymentAdjustment,
  listInvoicePaymentTransactions,
  payInvoice,
  reverseInvoicePayment,
} from "../../lib/invoice-operations";
import {
  FinFlowColors,
  FinFlowRadius,
  FinFlowShadow,
  finFlowTheme,
} from "../../constants/finflow-design";
import {
  mensagemFalhaEdicaoOffline,
  OFFLINE_EDIT_SAVED_MESSAGE,
  OFFLINE_SAVED_MESSAGE,
  OFFLINE_SYNC_COMPLETED_EVENT,
  salvarCriacaoFinanceira,
  salvarEdicaoFinanceira,
} from "../../lib/offline-sync";
import { invoicePresentationStatus } from "../../web/src/lib/invoice-status";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Cartao {
  id: number;
  nome: string;
  cor: string;
  limite: number;
  dia_vencimento: number;
  dia_fechamento: number;
  ativo: boolean;
  bloqueado_plano?: boolean;
  version?: number;
}

interface FaturaItem {
  id: number;
  cartao_id: number;
  descricao: string;
  valor: number;
  data_compra: string;
  mes_fatura: string;
  parcela_atual: number;
  total_parcelas: number;
  grupo_parcela_id: number | null;
  categoria_id: number | null;
  pago: boolean;
}

interface Categoria {
  id: number;
  nome: string;
  cor: string;
  icone: string;
  tipo: string;
  ativa?: boolean | number;
}

interface ContaSimples {
  id: number;
  nome: string;
  cor?: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const CORES_CARTAO = [
  "#457B9D", "#2A9D8F", "#8A05BE", "#E76F51",
  "#F4A261", "#264653", "#8AB17D", "#E63946",
  "#1D3557", "#333333",
  "#E9C46A", "#EC7000", "#CC092F", "#005CA9",
  "#6D597A", "#B56576", "#3A86FF", "#8338EC",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mesAtualStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function proximoMesStr(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(ano, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function mesParaFatura(dataCompra: Date, diaFechamento: number): string {
  const dia = dataCompra.getDate();
  // Se compra após fechamento → vai para próxima fatura
  if (dia > diaFechamento) {
    const proximo = new Date(dataCompra.getFullYear(), dataCompra.getMonth() + 1, 1);
    return `${proximo.getFullYear()}-${String(proximo.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${dataCompra.getFullYear()}-${String(dataCompra.getMonth() + 1).padStart(2, "0")}`;
}

function adicionarMeses(mes: string, n: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(ano, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatarMes(mes: string): string {
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const [ano, m] = mes.split("-").map(Number);
  return `${meses[m - 1]}/${ano}`;
}

function dataVencimentoFatura(mes: string, diaVencimento: number): Date {
  const [ano, mesNumero] = mes.split("-").map(Number);
  const ultimoDiaDoMes = new Date(ano, mesNumero, 0).getDate();
  return new Date(ano, mesNumero - 1, Math.min(diaVencimento, ultimoDiaDoMes), 23, 59, 59, 999);
}

function formatarDiaMesVencimento(mes: string, diaVencimento: number): string {
  const data = dataVencimentoFatura(mes, diaVencimento);
  return `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function CartoesScreen() {
  const { isDark, session, showToast, verificarLimite } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ pagarCartaoId?: string; mesFatura?: string }>();
  const pagamentoRotaConsumido = useRef("");
  const novoTema = finFlowTheme(isDark);

  const Cores = {
    fundo: novoTema.background,
    texto: novoTema.text,
    secundario: novoTema.textMuted,
    card: novoTema.surface,
    borda: novoTema.border,
    input: novoTema.surfaceMuted,
    pillFundo: novoTema.surfaceMuted,
    primary: novoTema.primary,
    primarySoft: novoTema.primarySoft,
  };

  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [itens, setItens] = useState<FaturaItem[]>([]);

  // Cartão selecionado (fatura aberta)
  const [cartaoAberto, setCartaoAberto] = useState<Cartao | null>(null);
  const [modalFaturaVisivel, setModalFaturaVisivel] = useState(false);
  const [mesFaturaAtivo, setMesFaturaAtivo] = useState(mesAtualStr());

  // Modal novo cartão
  const [modalNovoCartao, setModalNovoCartao] = useState(false);
  const [nomeCartao, setNomeCartao] = useState("");
  const [corCartao, setCorCartao] = useState(CORES_CARTAO[0]);
  const [limiteCartao, setLimiteCartao] = useState("");
  const [diaVencimento, setDiaVencimento] = useState("10");
  const [diaFechamento, setDiaFechamento] = useState("3");
  const [loadingNovoCartao, setLoadingNovoCartao] = useState(false);

  // Modal nova compra
  const [modalNovaCompra, setModalNovaCompra] = useState(false);
  const [descCompra, setDescCompra] = useState("");
  const [valorCompra, setValorCompra] = useState("");
  const [parcelasCompra, setParcelasCompra] = useState("1");
  const [modoValorParcelado, setModoValorParcelado] = useState<"total" | "parcela">("total");
  const [tipoCompra, setTipoCompra] = useState<"unica" | "parcelada" | "fixa">("unica");
  const [dataCompra, setDataCompra] = useState(new Date());
  const [mostrarDataPicker, setMostrarDataPicker] = useState(false);
  const [loadingCompra, setLoadingCompra] = useState(false);
  const [categCompraId, setCategCompraId] = useState<number | null>(null);

  // Dados auxiliares
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [contas, setContas] = useState<ContaSimples[]>([]);

  // Modal editar cartão
  const [modalEditarCartao, setModalEditarCartao] = useState(false);
  const [cartaoEditando, setCartaoEditando] = useState<Cartao | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editCor, setEditCor] = useState(CORES_CARTAO[0]);
  const [editLimite, setEditLimite] = useState("");
  const [editVenc, setEditVenc] = useState("");
  const [editFecha, setEditFecha] = useState("");
  const [loadingEditar, setLoadingEditar] = useState(false);

  // Espaço extra pro teclado nos formulários dos modais abaixo: só existe
  // enquanto o teclado está de fato aberto, senão o formulário ganha uma
  // área vazia arrastável mesmo com o teclado fechado.
  const [cartoesKeyboardVisivel, setCartoesKeyboardVisivel] = useState(false);

  // Modal pagamento — selecionar conta
  const [modalPagamento, setModalPagamento] = useState(false);
  const [mesPagamento, setMesPagamento] = useState("");
  const [contaPagamentoId, setContaPagamentoId] = useState<number | null>(null);
  const [valorPagamento, setValorPagamento] = useState("");
  const [modalPagamentoParcial, setModalPagamentoParcial] = useState(false);
  const [modalJuros, setModalJuros] = useState(false);
  const [tipoJuros, setTipoJuros] = useState<"valor" | "percentual">("valor");
  const [valorJuros, setValorJuros] = useState("");
  const [loadingPagamento, setLoadingPagamento] = useState(false);
  const [loadingEstorno, setLoadingEstorno] = useState(false);
  const pagamentoRequestIdRef = useRef<string | null>(null);
  const estornoRequestIdsRef = useRef(new Map<number, string>());
  const estornoFaturaAlvoRef = useRef<{ key: string; transactionId: number } | null>(null);

  useEffect(() => {
    if (!modalNovoCartao && !modalNovaCompra && !modalEditarCartao && !modalPagamento) return;
    const subShow = Keyboard.addListener("keyboardDidShow", () => setCartoesKeyboardVisivel(true));
    const subHide = Keyboard.addListener("keyboardDidHide", () => setCartoesKeyboardVisivel(false));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [modalNovoCartao, modalNovaCompra, modalEditarCartao, modalPagamento]);

  // Modal opções cartão (long-press) — substitui Alert
  const [modalOpcoesCartao, setModalOpcoesCartao] = useState<Cartao | null>(null);

  // Modal excluir item de fatura — substitui Alert
  const [modalExcluirItem, setModalExcluirItem] = useState<FaturaItem | null>(null);
  const [estornoPendente, setEstornoPendente] = useState<{ cartaoId: number; mes: string } | null>(null);

  // Cartões arquivados
  const [cartoesArquivados, setCartoesArquivados] = useState<Cartao[]>([]);
  const [mostrarArquivados, setMostrarArquivados] = useState(false);

  const carregarDados = useCallback(async () => {
    if (!session?.user?.id) return;

    const [resCartoes, resItens, resCats, resContas, resArquivados] = await Promise.all([
      supabase.from("cartoes").select("*").eq("user_id", session.user.id).eq("ativo", true).order("id"),
      supabase.from("fatura_itens").select("*").eq("user_id", session.user.id).order("data_compra", { ascending: false }),
      supabase.from("categorias").select("id, nome, cor, icone, tipo, ativa").eq("user_id", session.user.id).order("nome"),
      supabase.from("contas").select("id, nome, cor").eq("user_id", session.user.id).eq("arquivado", false).order("nome"),
      supabase.from("cartoes").select("*").eq("user_id", session.user.id).eq("ativo", false).order("id"),
    ]);

    if (resCartoes.data) setCartoes(resCartoes.data.map((c: Cartao) => ({ ...c, cor: CORES_CARTAO.includes(c.cor) ? c.cor : CORES_CARTAO[0] })));
    if (resItens.data) setItens(resItens.data);
    if (resCats.data) {
      setCategorias(
        (resCats.data as Categoria[])
          .filter((c) => c.ativa !== false && c.ativa !== 0)
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }))
      );
    }
    if (resContas.data) setContas(resContas.data as ContaSimples[]);
    if (resArquivados.data) setCartoesArquivados(resArquivados.data.map((c: Cartao) => ({ ...c, cor: CORES_CARTAO.includes(c.cor) ? c.cor : CORES_CARTAO[0] })));

    // Alerta de limite próximo do máximo para cada cartão
    if (resCartoes.data && resItens.data && session?.user?.id) {
      const mesAtual = mesAtualStr();
      const cartoesComLimite = resCartoes.data.map((c: any) => {
        const limiteUsado = resItens.data!
          .filter((i: any) =>
            i.cartao_id === c.id
            && i.mes_fatura >= mesAtual
            && !i.pago
            && (!(i.descricao ?? "").endsWith("(Fixa)") || i.mes_fatura === mesAtual)
          )
          .reduce((acc: number, i: any) => acc + Number(i.valor), 0);
        return {
          nome: c.nome,
          dia_vencimento: c.dia_vencimento,
          dia_fechamento: c.dia_fechamento,
          limite: Number(c.limite),
          limite_usado: limiteUsado,
        };
      });
      agendarNotificacoesDoApp([], session.user.id, undefined, cartoesComLimite);
    }
  }, [session?.user?.id]);

  useFocusEffect(useCallback(() => { carregarDados(); }, [carregarDados]));

  useEffect(() => {
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

  useEffect(() => {
    const cartaoId = Number(params.pagarCartaoId);
    const mes = params.mesFatura;
    const chave = `${cartaoId}:${mes}`;
    if (!cartaoId || !mes || pagamentoRotaConsumido.current === chave || cartoes.length === 0 || itens.length === 0) return;
    const cartao = cartoes.find((item) => item.id === cartaoId);
    if (!cartao) return;
    const total = itens
      .filter((item) => item.cartao_id === cartaoId && item.mes_fatura === mes && !item.pago)
      .reduce((acc, item) => acc + Number(item.valor), 0);
    pagamentoRotaConsumido.current = chave;
    setCartaoAberto(cartao);
    setMesFaturaAtivo(mes);
    setMesPagamento(mes);
    pagamentoRequestIdRef.current = createInvoiceOperationRequestId();
    setValorPagamento(formatarEntradaMoeda(String(Math.round(total * 100))));
    setValorJuros("");
    setContaPagamentoId(contas[0]?.id ?? null);
    setModalFaturaVisivel(true);
    if (total > 0) setModalPagamento(true);
    else showToast("Esta fatura já está paga", "info");
  }, [cartoes, contas, itens, params.mesFatura, params.pagarCartaoId, showToast]);

  // ─── Cálculos ──────────────────────────────────────────────────────────────

  const calcularTotalFatura = (cartaoId: number, mes: string): number => {
    return itens
      .filter((i) => i.cartao_id === cartaoId && i.mes_fatura === mes && !i.pago)
      .reduce((acc, i) => acc + Number(i.valor), 0);
  };

  const calcularLimiteUsado = (cartaoId: number): number => {
    const mes = mesAtualStr();
    return itens
      .filter((i) =>
        i.cartao_id === cartaoId
        && i.mes_fatura >= mes
        && !i.pago
        && (!i.descricao.endsWith("(Fixa)") || i.mes_fatura === mes)
      )
      .reduce((acc, i) => acc + Number(i.valor), 0);
  };

  const obterFaturaDoCard = (cartao: Cartao) => {
    const mesAtual = mesAtualStr();
    const itensDaFaturaAtual = itens.filter(
      (item) => item.cartao_id === cartao.id && item.mes_fatura === mesAtual,
    );
    const totalAtual = calcularTotalFatura(cartao.id, mesAtual);
    const statusAtual = invoicePresentationStatus({
      invoiceMonth: mesAtual,
      closingDay: cartao.dia_fechamento,
      itemCount: itensDaFaturaAtual.length,
      openTotal: totalAtual,
      allItemsPaid: itensDaFaturaAtual.length > 0 && itensDaFaturaAtual.every((item) => item.pago),
    });
    const faturaAtualFoiPagaOuZerada =
      itensDaFaturaAtual.length === 0 ||
      totalAtual === 0 ||
      itensDaFaturaAtual.every((item) => item.pago);
    const mesExibido =
      faturaAtualFoiPagaOuZerada
        ? proximoMesStr(mesAtual)
        : mesAtual;

    return {
      mes: mesExibido,
      total: calcularTotalFatura(cartao.id, mesExibido),
      proxima: mesExibido !== mesAtual,
      atualPaga: statusAtual === "paid",
      vencimento: formatarDiaMesVencimento(mesExibido, cartao.dia_vencimento),
    };
  };

  // ─── Criar cartão ──────────────────────────────────────────────────────────

  const salvarNovoCartao = async () => {
    if (!nomeCartao.trim()) return Alert.alert("Aviso", "Informe o nome do cartão.");
    const limiteNum = valorDaEntradaMoeda(limiteCartao);
    if (limiteNum <= 0) return Alert.alert("Aviso", "Informe um limite válido.");
    const venc = parseInt(diaVencimento);
    const fecha = parseInt(diaFechamento);
    if (isNaN(venc) || venc < 1 || venc > 31) return Alert.alert("Aviso", "Dia de vencimento inválido (1–31).");
    if (isNaN(fecha) || fecha < 1 || fecha > 31) return Alert.alert("Aviso", "Dia de fechamento inválido (1–31).");

    // Verificar limite do plano
    if (!verificarLimite("cartoes", cartoes.length)) return;

    setLoadingNovoCartao(true);
    if (!IS_LOCAL_DEMO) {
      try {
        const resultado = await salvarCriacaoFinanceira("create_card", {
          name: nomeCartao.trim(),
          value: limiteNum,
          color: corCartao,
          due_day: venc,
          closing_day: fecha,
        });
        setLoadingNovoCartao(false);
        if (resultado.state === "rejected") {
          return Alert.alert("Não foi possível salvar", "O cartão foi recusado pelo servidor. Revise os dados e tente novamente.");
        }
        if (resultado.state === "uncertain") {
          return Alert.alert("Sessão alterada", "Não foi possível confirmar o cartão. Entre novamente e confira seus dados antes de reenviar.");
        }
        setNomeCartao(""); setLimiteCartao(""); setDiaVencimento("10"); setDiaFechamento("3");
        setCorCartao(CORES_CARTAO[0]);
        setModalNovoCartao(false);
        if (resultado.state === "queued") showToast(OFFLINE_SAVED_MESSAGE, "info");
        else {
          showToast("Cartão criado com sucesso ✓", "success");
          void carregarDados();
        }
        return;
      } catch {
        setLoadingNovoCartao(false);
        return Alert.alert("Não foi possível salvar", "O cartão não pôde ser salvo no dispositivo. Tente novamente.");
      }
    }
    const { error } = await supabase.from("cartoes").insert([{
      user_id: session.user.id,
      nome: nomeCartao.trim(),
      cor: corCartao,
      limite: limiteNum,
      dia_vencimento: venc,
      dia_fechamento: fecha,
      ativo: true,
    }]);
    setLoadingNovoCartao(false);

    if (error) {
      Alert.alert("Erro", "Não foi possível salvar o cartão.\n\nCertifique-se de que a tabela 'cartoes' existe no Supabase.");
      return;
    }

    setNomeCartao(""); setLimiteCartao(""); setDiaVencimento("10"); setDiaFechamento("3");
    setCorCartao(CORES_CARTAO[0]);
    setModalNovoCartao(false);
    showToast("Cartão criado com sucesso ✓", "success");
    carregarDados();
  };

  // ─── Adicionar compra ──────────────────────────────────────────────────────

  const salvarCompra = async () => {
    if (!cartaoAberto) return;
    if (!descCompra.trim()) return Alert.alert("Aviso", "Informe a descrição da compra.");
    const valor = valorDaEntradaMoeda(valorCompra);
    if (isNaN(valor) || valor <= 0) return Alert.alert("Aviso", "Informe um valor válido.");
    const categoriaCompra = categorias.find(
      (categoria) => categoria.id === categCompraId
        && categoria.tipo === "despesa"
        && categoria.ativa !== false
        && categoria.ativa !== 0,
    );
    if (!categoriaCompra) {
      return Alert.alert("Categoria obrigatória", "Selecione uma categoria ativa de despesa antes de salvar a compra.");
    }
    const parcelasInformadas = parseInt(parcelasCompra) || 1;
    if (tipoCompra === "parcelada" && (parcelasInformadas < 2 || parcelasInformadas > 48)) {
      return Alert.alert("Aviso", "Número de parcelas inválido (2–48).");
    }
    const repeticoes = tipoCompra === "fixa" ? 60 : tipoCompra === "parcelada" ? parcelasInformadas : 1;

    const valorParcela = tipoCompra === "parcelada" && modoValorParcelado === "total"
      ? +(valor / parcelasInformadas).toFixed(2)
      : valor;
    const mesPrimeiro = mesParaFatura(dataCompra, cartaoAberto.dia_fechamento);
    const [anoFatura, mesFatura] = mesPrimeiro.split("-").map(Number);
    const ultimoDia = new Date(anoFatura, mesFatura, 0).getDate();
    const dataFechamento = new Date(anoFatura, mesFatura - 1, Math.min(cartaoAberto.dia_fechamento, ultimoDia), 23, 59, 59);
    if (new Date() > dataFechamento) {
      return Alert.alert("Fatura fechada", `A fatura de ${formatarMes(mesPrimeiro)} já fechou. Não é possível adicionar novas compras nela.`);
    }

    if (!IS_LOCAL_DEMO) {
      const dataCompraSql = `${dataCompra.getFullYear()}-${String(dataCompra.getMonth() + 1).padStart(2, "0")}-${String(dataCompra.getDate()).padStart(2, "0")}`;
      const frequency = tipoCompra === "fixa" ? "mensal" : tipoCompra;
      const totalValue = tipoCompra === "parcelada" && modoValorParcelado === "parcela"
        ? Number((valor * parcelasInformadas).toFixed(2))
        : valor;
      const payload: Record<string, unknown> = {
        card_id: cartaoAberto.id,
        category_id: categoriaCompra.id,
        description: descCompra.trim(),
        value: totalValue,
        purchase_date: dataCompraSql,
        frequency,
      };
      if (tipoCompra === "parcelada") payload.installments = parcelasInformadas;
      if (tipoCompra === "fixa") payload.recurrence_count = 60;

      setLoadingCompra(true);
      try {
        const resultado = await salvarCriacaoFinanceira("create_card_purchase", payload);
        setLoadingCompra(false);
        if (resultado.state === "rejected") {
          return Alert.alert("Não foi possível salvar", "A compra foi recusada pelo servidor. Revise os dados e tente novamente.");
        }
        if (resultado.state === "uncertain") {
          return Alert.alert("Sessão alterada", "Não foi possível confirmar a compra. Entre novamente e confira seus dados antes de reenviar.");
        }
        setDescCompra(""); setValorCompra(""); setParcelasCompra("2"); setModoValorParcelado("total"); setTipoCompra("unica"); setDataCompra(new Date()); setCategCompraId(null);
        setModalNovaCompra(false);
        if (resultado.state === "queued") showToast(OFFLINE_SAVED_MESSAGE, "info");
        else {
          showToast(tipoCompra === "fixa" ? "Compra fixa mensal adicionada ✓" : `Compra adicionada${tipoCompra === "parcelada" ? ` em ${parcelasInformadas}x` : ""} ✓`, "success");
          void carregarDados();
        }
        return;
      } catch {
        setLoadingCompra(false);
        return Alert.alert("Não foi possível salvar", "A compra não pôde ser salva no dispositivo. Tente novamente.");
      }
    }

    setLoadingCompra(true);

    const itensInserir: any[] = [];
    let grupoPrimeiroId: number | null = null;

    for (let i = 0; i < repeticoes; i++) {
      const mes = adicionarMeses(mesPrimeiro, i);
      const dataOcorrencia = tipoCompra === "fixa"
        ? new Date(dataCompra.getFullYear(), dataCompra.getMonth() + i, Math.min(
            dataCompra.getDate(),
            new Date(dataCompra.getFullYear(), dataCompra.getMonth() + i + 1, 0).getDate()
          ))
        : dataCompra;
      const dataCompraStr = `${dataOcorrencia.getFullYear()}-${String(dataOcorrencia.getMonth() + 1).padStart(2, "0")}-${String(dataOcorrencia.getDate()).padStart(2, "0")}`;
      const desc = tipoCompra === "parcelada"
        ? `${descCompra} (${i + 1}/${parcelasInformadas})`
        : tipoCompra === "fixa"
          ? `${descCompra} (Fixa)`
          : descCompra;
      itensInserir.push({
        cartao_id: cartaoAberto.id,
        user_id: session.user.id,
        descricao: desc,
        valor: valorParcela,
        data_compra: dataCompraStr,
        mes_fatura: mes,
        parcela_atual: i + 1,
        total_parcelas: tipoCompra === "parcelada" ? parcelasInformadas : 1,
        grupo_parcela_id: null,
        categoria_id: categoriaCompra.id,
        pago: false,
      });
    }

    // Inserir primeiro item para obter o ID do grupo
    const { data: primeiro, error: err1 } = await supabase
      .from("fatura_itens")
      .insert([itensInserir[0]])
      .select()
      .single();

    if (err1 || !primeiro) {
      setLoadingCompra(false);
      Alert.alert("Erro", "Não foi possível salvar a compra.\n\nVerifique a tabela 'fatura_itens' no Supabase.");
      return;
    }

    grupoPrimeiroId = primeiro.id;

    // Atualiza grupo_parcela_id do primeiro
    await supabase.from("fatura_itens").update({ grupo_parcela_id: grupoPrimeiroId }).eq("id", grupoPrimeiroId);

    // Insere demais parcelas
    if (repeticoes > 1) {
      const demais = itensInserir.slice(1).map((item) => ({
        ...item,
        grupo_parcela_id: grupoPrimeiroId,
      }));
      const { error: err2 } = await supabase.from("fatura_itens").insert(demais);
      if (err2) {
        setLoadingCompra(false);
        Alert.alert("Erro parcial", "Primeira compra salva, mas houve erro nas parcelas seguintes.");
        carregarDados();
        return;
      }
    }

    setLoadingCompra(false);
    setDescCompra(""); setValorCompra(""); setParcelasCompra("2"); setModoValorParcelado("total"); setTipoCompra("unica"); setDataCompra(new Date()); setCategCompraId(null);
    setModalNovaCompra(false);
    showToast(tipoCompra === "fixa" ? "Compra fixa mensal adicionada ✓" : `Compra adicionada${tipoCompra === "parcelada" ? ` em ${parcelasInformadas}x` : ""} ✓`, "success");
    carregarDados();
  };

  // ─── Pagar fatura — abre modal de seleção de conta ───────────────────────

  const iniciarPagamentoFatura = (mes: string) => {
    const totalFatura = calcularTotalFatura(cartaoAberto!.id, mes);
    if (totalFatura === 0) return showToast("Fatura já está zerada", "info");
    pagamentoRequestIdRef.current = createInvoiceOperationRequestId();
    setMesPagamento(mes);
    setValorPagamento(formatarEntradaMoeda(String(Math.round(totalFatura * 100))));
    setValorJuros("");
    setContaPagamentoId(contas[0]?.id ?? null);
    setModalPagamento(true);
  };

  const confirmarPagamentoFatura = async () => {
    if (!cartaoAberto || !contaPagamentoId || loadingPagamento) return;
    const totalFatura = calcularTotalFatura(cartaoAberto.id, mesPagamento);
    const valorPago = valorDaEntradaMoeda(valorPagamento);
    if (!Number.isFinite(valorPago) || valorPago <= 0) {
      Alert.alert("Valor inválido", "Informe quanto foi pago.");
      return;
    }
    if (valorPago > totalFatura + 0.005) {
      Alert.alert("Valor acima da fatura", `O pagamento não pode ultrapassar ${fmtReais(totalFatura)}.`);
      return;
    }
    if (valorPago < totalFatura - 0.005) {
      setModalPagamentoParcial(true);
      return;
    }
    const requestId = pagamentoRequestIdRef.current ?? createInvoiceOperationRequestId();
    pagamentoRequestIdRef.current = requestId;
    setLoadingPagamento(true);
    try {
      await payInvoice({
        cardId: cartaoAberto.id,
        invoiceMonth: mesPagamento,
        accountId: contaPagamentoId,
        paymentAmount: valorPago,
        remainderMode: "full",
        requestId,
      });
      pagamentoRequestIdRef.current = null;
      setModalPagamento(false);
      showToast("Fatura paga ✓", "success");
      await carregarDados();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível registrar o pagamento.", "error");
    } finally {
      setLoadingPagamento(false);
    }
  };

  const registrarPagamentoMenor = async (levarSaldo: boolean) => {
    if (!cartaoAberto || !contaPagamentoId || !session?.user?.id || loadingPagamento) return;
    const total = calcularTotalFatura(cartaoAberto.id, mesPagamento);
    const pago = valorDaEntradaMoeda(valorPagamento);
    if (!Number.isFinite(pago) || pago <= 0 || pago >= total) {
      showToast("O pagamento parcial precisa ser maior que zero e menor que a fatura.", "error");
      return;
    }

    const jurosInformado = levarSaldo
      ? Math.max(
          0,
          tipoJuros === "valor"
            ? valorDaEntradaMoeda(valorJuros)
            : Number(valorJuros.replace(",", ".")) || 0,
        )
      : 0;
    const requestId = pagamentoRequestIdRef.current ?? createInvoiceOperationRequestId();
    pagamentoRequestIdRef.current = requestId;
    setLoadingPagamento(true);
    try {
      await payInvoice({
        cardId: cartaoAberto.id,
        invoiceMonth: mesPagamento,
        accountId: contaPagamentoId,
        paymentAmount: pago,
        remainderMode: levarSaldo ? "carry" : "keep_open",
        interestValue: levarSaldo && tipoJuros === "valor" ? jurosInformado : null,
        interestPercent: levarSaldo && tipoJuros === "percentual" ? jurosInformado : null,
        requestId,
      });
      pagamentoRequestIdRef.current = null;
      setModalJuros(false);
      setModalPagamentoParcial(false);
      setModalPagamento(false);
      showToast(levarSaldo ? "Saldo levado para a próxima fatura ✓" : "Pagamento parcial registrado ✓", "success");
      await carregarDados();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível registrar o pagamento.", "error");
    } finally {
      setLoadingPagamento(false);
    }
  };

  const estornarFatura = async (cartaoId: number, mes: string) => {
    const key = `${cartaoId}:${mes}`;
    if (estornoFaturaAlvoRef.current?.key !== key) {
      estornoFaturaAlvoRef.current = null;
      estornoRequestIdsRef.current.clear();
    }
    setEstornoPendente({ cartaoId, mes });
  };

  const confirmarEstornoFatura = async () => {
    if (!estornoPendente || !session?.user?.id || loadingEstorno) return;
    const { cartaoId, mes } = estornoPendente;
    setLoadingEstorno(true);
    try {
      const key = `${cartaoId}:${mes}`;
      let transactionId = estornoFaturaAlvoRef.current?.key === key
        ? estornoFaturaAlvoRef.current.transactionId
        : null;
      if (transactionId === null) {
        const pagamentos = await listInvoicePaymentTransactions(session.user.id, cartaoId, mes);
        transactionId = pagamentos[0]?.id ?? null;
        if (transactionId !== null) {
          estornoFaturaAlvoRef.current = { key, transactionId };
        }
      }
      if (transactionId === null) {
        throw new Error("Nenhum pagamento rastreável foi encontrado para esta fatura.");
      }
      const requestId = estornoRequestIdsRef.current.get(transactionId)
        ?? createInvoiceOperationRequestId();
      estornoRequestIdsRef.current.set(transactionId, requestId);
      await reverseInvoicePayment(transactionId, requestId);
      estornoRequestIdsRef.current.delete(transactionId);
      estornoFaturaAlvoRef.current = null;
      setEstornoPendente(null);
      showToast("Pagamento mais recente estornado", "success");
      await carregarDados();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível estornar o pagamento.", "error");
      await carregarDados();
    } finally {
      setLoadingEstorno(false);
    }
  };

  // ─── Editar cartão ─────────────────────────────────────────────────────────

  const abrirEditarCartao = (c: Cartao) => {
    setCartaoEditando(c);
    setEditNome(c.nome);
    setEditCor(CORES_CARTAO.includes(c.cor) ? c.cor : CORES_CARTAO[0]);
    setEditLimite(formatarEntradaMoeda(String(Math.round(Number(c.limite) * 100))));
    setEditVenc(c.dia_vencimento.toString());
    setEditFecha(c.dia_fechamento.toString());
    setModalEditarCartao(true);
  };

  const salvarEdicaoCartao = async () => {
    if (!cartaoEditando) return;
    if (!editNome.trim()) return showToast("Informe o nome", "error");
    const limiteNum = valorDaEntradaMoeda(editLimite);
    if (limiteNum <= 0) return showToast("Limite inválido", "error");
    const venc = parseInt(editVenc);
    const fecha = parseInt(editFecha);
    if (isNaN(venc) || venc < 1 || venc > 31) return showToast("Vencimento inválido (1–31)", "error");
    if (isNaN(fecha) || fecha < 1 || fecha > 31) return showToast("Fechamento inválido (1–31)", "error");

    setLoadingEditar(true);
    if (!IS_LOCAL_DEMO) {
      const changes: Record<string, unknown> = {};
      if (editNome.trim() !== cartaoEditando.nome) changes.name = editNome.trim();
      if (editCor !== cartaoEditando.cor) changes.color = editCor;
      if (limiteNum !== Number(cartaoEditando.limite)) changes.value = limiteNum;
      if (venc !== Number(cartaoEditando.dia_vencimento)) changes.due_day = venc;
      if (fecha !== Number(cartaoEditando.dia_fechamento)) changes.closing_day = fecha;
      if (Object.keys(changes).length === 0) {
        setLoadingEditar(false);
        setModalEditarCartao(false);
        return;
      }
      try {
        const resultado = await salvarEdicaoFinanceira(
          "update_card",
          cartaoEditando.id,
          Number(cartaoEditando.version),
          changes,
        );
        setLoadingEditar(false);
        if (resultado.state === "rejected") {
          showToast(mensagemFalhaEdicaoOffline(resultado.errorCode), "error");
          return;
        }
        if (resultado.state === "uncertain") {
          showToast("Sessão alterada. Entre novamente e confira o cartão antes de reenviar.", "error");
          return;
        }
        setModalEditarCartao(false);
        if (resultado.state === "queued") showToast(OFFLINE_EDIT_SAVED_MESSAGE, "info");
        else {
          showToast("Cartão atualizado ✓", "success");
          void carregarDados();
        }
        return;
      } catch {
        setLoadingEditar(false);
        showToast("A edição não pôde ser protegida neste dispositivo.", "error");
        return;
      }
    }
    const { error } = await supabase.from("cartoes").update({
      nome: editNome.trim(), cor: editCor, limite: limiteNum,
      dia_vencimento: venc, dia_fechamento: fecha,
    }).eq("id", cartaoEditando.id);
    setLoadingEditar(false);

    if (error) { showToast("Erro ao salvar", "error"); return; }
    setModalEditarCartao(false);
    showToast("Cartão atualizado ✓", "success");
    carregarDados();
  };

  // ─── Opções ao pressionar e segurar cartão ────────────────────────────────

  const opcoesCartao = (c: Cartao) => {
    setModalOpcoesCartao(c);
  };

  const arquivarCartaoConfirm = async (c: Cartao) => {
    setModalOpcoesCartao(null);
    await supabase.from("cartoes").update({ ativo: false }).eq("id", c.id);
    showToast("Cartão arquivado", "success");
    carregarDados();
  };

  const deletarCartaoConfirm = async (c: Cartao) => {
    setModalOpcoesCartao(null);
    await supabase.from("cartoes").delete().eq("id", c.id);
    showToast("Cartão excluído", "success");
    carregarDados();
  };

  const desarquivarCartao = async (c: Cartao) => {
    await supabase.from("cartoes").update({ ativo: true }).eq("id", c.id);
    showToast("Cartão reativado ✓", "success");
    carregarDados();
  };

  // ─── Excluir compra ────────────────────────────────────────────────────────

  const excluirCompra = (item: FaturaItem) => {
    if (item.pago) {
      showToast("Estorne o pagamento da fatura antes de excluir esta compra.", "info");
      return;
    }
    if (isInvoicePaymentAdjustment(item.descricao)) {
      showToast("Este ajuste só pode ser removido estornando o pagamento correspondente.", "info");
      return;
    }
    setModalExcluirItem(item);
  };

  const executarExclusao = async (ids: number[]) => {
    const { error } = await supabase.from("fatura_itens").delete().in("id", ids);
    if (error) Alert.alert("Erro", "Não foi possível excluir.");
    else { showToast("Compra removida ✓", "success"); carregarDados(); }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const itensFatura = cartaoAberto
    ? itens.filter((i) => i.cartao_id === cartaoAberto.id && i.mes_fatura === mesFaturaAtivo)
    : [];

  const totalFaturaAtiva = itensFatura.filter((i) => !i.pago).reduce((a, i) => a + Number(i.valor), 0);
  const statusFaturaAtiva = cartaoAberto
    ? invoicePresentationStatus({
        invoiceMonth: mesFaturaAtivo,
        closingDay: cartaoAberto.dia_fechamento,
        itemCount: itensFatura.length,
        openTotal: totalFaturaAtiva,
        allItemsPaid: itensFatura.length > 0 && itensFatura.every((item) => item.pago),
      })
    : "open";
  const limiteUsado = cartaoAberto ? calcularLimiteUsado(cartaoAberto.id) : 0;
  const limiteDisponivel = cartaoAberto ? Math.max(0, cartaoAberto.limite - limiteUsado) : 0;
  const pctUsado = cartaoAberto && cartaoAberto.limite > 0
    ? Math.min(100, (limiteUsado / cartaoAberto.limite) * 100)
    : 0;
  const totalFaturas = cartoes.reduce((total, cartao) => total + obterFaturaDoCard(cartao).total, 0);
  const totalLimiteDisponivel = cartoes.reduce(
    (total, cartao) => total + Math.max(0, Number(cartao.limite) - calcularLimiteUsado(cartao.id)),
    0,
  );

  return (
    <SafeAreaView style={[estilos.safeArea, { backgroundColor: Cores.fundo }]}>
      <ScrollView contentContainerStyle={estilos.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[estilos.header, { backgroundColor: novoTema.header }]}>
          <View style={estilos.headerDecoracaoUm} />
          <View style={estilos.headerDecoracaoDois} />
          <View style={estilos.headerTopRow}>
            <TouchableOpacity onPress={() => router.back()} style={estilos.voltarBtn} accessibilityLabel="Voltar">
              <MaterialIcons name="arrow-back" size={22} color="#FFF" />
            </TouchableOpacity>
            <View style={estilos.headerTitleGroup}>
              <Text style={estilos.headerEyebrow}>CRÉDITO</Text>
              <Text style={estilos.titulo}>Cartões de crédito</Text>
            </View>
            <TouchableOpacity style={estilos.btnNovo} onPress={() => setModalNovoCartao(true)}>
              <MaterialIcons name="add" size={19} color="#FFF" />
              <Text style={estilos.btnNovoText}>Novo</Text>
            </TouchableOpacity>
          </View>
          <Text style={estilos.headerSubtitle}>Acompanhe limites, compras e vencimentos em um só lugar.</Text>
          <View style={estilos.headerResumo}>
            <View style={estilos.headerResumoItem}>
              <Text style={estilos.headerResumoLabel}>Faturas em aberto</Text>
              <Text style={estilos.headerResumoValor}>{fmtReais(totalFaturas)}</Text>
            </View>
            <View style={estilos.headerResumoDivisor} />
            <View style={estilos.headerResumoItem}>
              <Text style={estilos.headerResumoLabel}>Limite disponível</Text>
              <Text style={estilos.headerResumoValor}>{fmtReais(totalLimiteDisponivel)}</Text>
            </View>
          </View>
        </View>

        <View style={estilos.sectionHeader}>
          <View>
            <Text style={[estilos.sectionTitle, { color: Cores.texto }]}>Seus cartões</Text>
            <Text style={[estilos.sectionSubtitle, { color: Cores.secundario }]}>
              {cartoes.length === 1 ? "1 cartão ativo" : `${cartoes.length} cartões ativos`}
            </Text>
          </View>
          <View style={[estilos.sectionIcon, { backgroundColor: Cores.primarySoft }]}>
            <MaterialIcons name="credit-card" size={20} color={Cores.primary} />
          </View>
        </View>

        {/* Lista de cartões */}
        {cartoes.length === 0 ? (
          <TouchableOpacity
            onPress={() => setModalNovoCartao(true)}
            style={[estilos.emptyCard, { borderColor: Cores.borda, backgroundColor: Cores.card }]}
          >
            <View style={[estilos.emptyIcon, { backgroundColor: Cores.primarySoft }]}>
              <MaterialIcons name="add-card" size={34} color={Cores.primary} />
            </View>
            <Text style={[estilos.emptyTitulo, { color: Cores.texto }]}>Nenhum cartão cadastrado</Text>
            <Text style={[estilos.emptySubtitulo, { color: Cores.secundario }]}>Toque para adicionar seu primeiro cartão</Text>
          </TouchableOpacity>
        ) : (
          <View style={estilos.cartoesLista}>
            {cartoes.map((c) => {
              const faturaCard = obterFaturaDoCard(c);
              const usado = calcularLimiteUsado(c.id);
              const disponivel = Math.max(0, c.limite - usado);
              const bloqueado = c.bloqueado_plano;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[estilos.cartaoCard, { backgroundColor: c.cor, opacity: bloqueado ? 0.55 : 1 }]}
                  onPress={() => {
                    if (bloqueado) return;
                    setCartaoAberto(c);
                    setMesFaturaAtivo(faturaCard.mes);
                    setModalFaturaVisivel(true);
                  }}
                  onLongPress={() => !bloqueado && opcoesCartao(c)}
                  activeOpacity={bloqueado ? 1 : 0.85}
                >
                  <View style={estilos.cartaoDecoracao} />
                  <View style={estilos.cartaoTopo}>
                    <View style={estilos.cartaoIcone}>
                      {bloqueado
                        ? <MaterialIcons name="lock" size={18} color="#FFF" />
                        : <MaterialIcons name="credit-card" size={20} color="#FFF" />
                      }
                    </View>
                    <Text style={estilos.cartaoNome}>{c.nome}</Text>
                    {!bloqueado && <MaterialIcons name="chevron-right" size={22} color="rgba(255,255,255,0.76)" />}
                  </View>
                  {bloqueado ? (
                    <Text style={[estilos.cartaoFaturaLabel, { marginTop: 4 }]}>Bloqueado — faça upgrade</Text>
                  ) : (
                    <>
                      <Text style={estilos.cartaoFaturaLabel}>
                        {faturaCard.atualPaga
                          ? "Fatura atual paga · próxima fatura"
                          : faturaCard.proxima ? "Próxima fatura" : "Fatura atual"}
                      </Text>
                      <Text style={estilos.cartaoFatura}>{fmtReais(faturaCard.total)}</Text>
                      <View style={estilos.cartaoRodape}>
                        <View style={estilos.cartaoRodapeCol}>
                          <Text style={estilos.cartaoRodapeLabel}>Limite disponível</Text>
                          <Text style={estilos.cartaoLimite}>{fmtReais(disponivel)}</Text>
                        </View>
                        <View style={[estilos.cartaoRodapeCol, { alignItems: "flex-end" }]}>
                          <Text style={estilos.cartaoRodapeLabel}>Vencimento</Text>
                          <Text style={estilos.cartaoVenc}>{faturaCard.vencimento}</Text>
                        </View>
                      </View>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Seção: Cartões Arquivados */}
        {cartoesArquivados.length > 0 && (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 8 }}
              onPress={() => setMostrarArquivados(v => !v)}
            >
              <MaterialIcons name={mostrarArquivados ? "expand-less" : "expand-more"} size={20} color={Cores.secundario} />
              <MaterialIcons name="archive" size={16} color={Cores.secundario} />
              <Text style={{ color: Cores.secundario, fontSize: 13, fontWeight: "600" }}>
                Arquivados ({cartoesArquivados.length})
              </Text>
            </TouchableOpacity>
            {mostrarArquivados && cartoesArquivados.map((c) => (
              <View key={c.id} style={[estilos.cartaoArquivado, { backgroundColor: Cores.card, borderColor: Cores.borda }]}>
                <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 10 }}>
                  <View style={[estilos.corPill, { backgroundColor: c.cor }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Cores.texto, fontWeight: "600", fontSize: 14 }}>{c.nome}</Text>
                    <Text style={{ color: Cores.secundario, fontSize: 11, marginTop: 2 }}>
                      Limite: {fmtReais(c.limite)} · Vence dia {c.dia_vencimento}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[estilos.desarquivarBtn, { backgroundColor: `${Cores.primary}18`, borderColor: Cores.primary }]}
                  onPress={() => desarquivarCartao(c)}
                >
                  <MaterialIcons name="unarchive" size={14} color={Cores.primary} />
                  <Text style={{ color: Cores.primary, fontSize: 12, fontWeight: "700" }}>Reativar</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* Modal: Fatura do Cartão (centered) */}
      {cartaoAberto && (
        <Modal animationType="fade" transparent visible={modalFaturaVisivel} onRequestClose={() => setModalFaturaVisivel(false)}>
          <View style={estilos.modalFaturaOverlay}>
            <View style={[estilos.modalFaturaContent, { backgroundColor: Cores.card }]}>
              {/* Header */}
              <View style={estilos.faturaHeader}>
                <View style={estilos.modalTitleGroup}>
                  <View style={[estilos.modalHeaderIcon, { backgroundColor: `${cartaoAberto.cor}20` }]}>
                    <MaterialIcons name="credit-card" size={22} color={cartaoAberto.cor} />
                  </View>
                  <View>
                    <Text style={[estilos.faturaCartaoNome, { color: Cores.texto }]}>{cartaoAberto.nome}</Text>
                    <Text style={[estilos.faturaTotal, { color: totalFaturaAtiva > 0 ? FinFlowColors.red : Cores.primary }]}>
                      {fmtReais(totalFaturaAtiva)}
                    </Text>
                    {(statusFaturaAtiva === "paid" || statusFaturaAtiva === "zero") && (
                      <Text style={[estilos.faturaStatus, { color: statusFaturaAtiva === "paid" ? Cores.primary : Cores.secundario }]}>
                        {statusFaturaAtiva === "paid"
                          ? itensFatura.length === 0 ? "Fatura paga · fechou zerada" : "Fatura paga"
                          : "Fatura zerada"}
                      </Text>
                    )}
                  </View>
                </View>
                <TouchableOpacity style={[estilos.modalClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalFaturaVisivel(false)} accessibilityLabel="Fechar fatura">
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>

              {/* Limite */}
              <View style={[estilos.limiteContainer, { backgroundColor: Cores.pillFundo }]}>
                <View style={estilos.limiteRow}>
                  <Text style={[estilos.limiteLbl, { color: Cores.secundario }]}>Limite usado</Text>
                  <Text style={[estilos.limiteVal, { color: Cores.texto }]}>
                    {fmtReais(limiteUsado)} / {fmtReais(cartaoAberto.limite)}
                  </Text>
                </View>
                <View style={[estilos.progressoBg, { backgroundColor: Cores.borda }]}>
                  <View
                    style={[
                      estilos.progressoBar,
                      {
                        width: `${pctUsado}%` as any,
                        backgroundColor: pctUsado >= 90 ? FinFlowColors.red : pctUsado >= 70 ? FinFlowColors.orange : Cores.primary,
                      },
                    ]}
                  />
                </View>
                <Text style={[estilos.limiteDisp, { color: Cores.primary }]}>
                  Disponível: {fmtReais(limiteDisponivel)}
                </Text>
              </View>

              {/* Navegação de meses */}
              <View style={estilos.mesNav}>
                <TouchableOpacity onPress={() => {
                  const [ano, m] = mesFaturaAtivo.split("-").map(Number);
                  const d = new Date(ano, m - 2, 1);
                  setMesFaturaAtivo(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }}>
                  <MaterialIcons name="chevron-left" size={30} color={Cores.texto} />
                </TouchableOpacity>
                <Text style={[estilos.mesTitulo, { color: Cores.texto }]}>
                  Fatura {formatarMes(mesFaturaAtivo)}
                </Text>
                <TouchableOpacity onPress={() => setMesFaturaAtivo(adicionarMeses(mesFaturaAtivo, 1))}>
                  <MaterialIcons name="chevron-right" size={30} color={Cores.texto} />
                </TouchableOpacity>
              </View>

              {/* Ações */}
              <View style={estilos.acoesRow}>
                <TouchableOpacity
                  style={[estilos.acaoBtn, { backgroundColor: FinFlowColors.blue }]}
                  onPress={() => setModalNovaCompra(true)}
                >
                  <MaterialIcons name="add-shopping-cart" size={16} color="#FFF" />
                  <Text style={estilos.acaoBtnText}>Add Compra</Text>
                </TouchableOpacity>
                {totalFaturaAtiva > 0 ? (
                  <TouchableOpacity
                    style={[estilos.acaoBtn, { backgroundColor: Cores.primary }]}
                    onPress={() => iniciarPagamentoFatura(mesFaturaAtivo)}
                  >
                    <MaterialIcons name="check-circle" size={16} color="#FFF" />
                    <Text style={estilos.acaoBtnText}>Pagar Fatura</Text>
                  </TouchableOpacity>
                ) : itensFatura.some(i => i.pago) ? (
                  <TouchableOpacity
                    style={[estilos.acaoBtn, { backgroundColor: "#F59E0B" }]}
                    onPress={() => estornarFatura(cartaoAberto.id, mesFaturaAtivo)}
                  >
                    <MaterialIcons name="undo" size={16} color="#FFF" />
                    <Text style={estilos.acaoBtnText}>Estornar</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Itens da fatura */}
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }}>
                {itensFatura.length === 0 ? (
                  <View style={estilos.faturaVazia}>
                    <MaterialIcons name={statusFaturaAtiva === "paid" ? "check-circle" : "receipt"} size={32} color={statusFaturaAtiva === "paid" ? Cores.primary : Cores.borda} />
                    <Text style={[estilos.faturaVaziaText, { color: Cores.secundario }]}>
                      {statusFaturaAtiva === "paid" ? "Fechou zerada e consta como paga" : "Nenhuma compra nesta fatura"}
                    </Text>
                  </View>
                ) : (
                  <View style={estilos.itensList}>
                    {itensFatura.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[estilos.itemFatura, { borderBottomColor: Cores.borda }]}
                        onPress={() => excluirCompra(item)}
                        activeOpacity={0.7}
                      >
                        <View style={estilos.itemFaturaLeft}>
                          <View style={[estilos.itemStatus, { backgroundColor: item.pago ? `${Cores.primary}1F` : `${FinFlowColors.red}1F` }]}>
                            <MaterialIcons
                              name={item.pago ? "check-circle" : "radio-button-unchecked"}
                              size={14}
                              color={item.pago ? Cores.primary : FinFlowColors.red}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[estilos.itemDesc, { color: Cores.texto, opacity: item.pago ? 0.5 : 1 }]}>
                              {item.descricao}
                            </Text>
                            <Text style={[estilos.itemData, { color: Cores.secundario }]}>
                              {item.data_compra.split("-").reverse().join("/")}
                              {item.total_parcelas > 1 && ` · ${item.parcela_atual}/${item.total_parcelas}x`}
                            </Text>
                          </View>
                        </View>
                        <Text style={[estilos.itemValor, { color: item.pago ? Cores.secundario : "#E76F51" }]}>
                          {fmtReais(item.valor)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* Modal: Novo Cartão — centralizado */}
      {modalNovoCartao && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalNovoCartao(false)}>
          <KeyboardAvoidingView
            style={estilos.modalCentradoOverlay}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={[estilos.modalCentradoContent, { backgroundColor: Cores.card }]}>
              <ScrollView
                style={estilos.modalFormScroll}
                contentContainerStyle={[estilos.modalFormContent, cartoesKeyboardVisivel && estilos.modalFormContentKeyboard]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                showsVerticalScrollIndicator={false}
              >
              <View style={estilos.modalHeaderRow}>
                <View style={estilos.modalTitleGroup}>
                  <View style={[estilos.modalHeaderIcon, { backgroundColor: Cores.primarySoft }]}>
                    <MaterialIcons name="add-card" size={22} color={Cores.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Novo cartão</Text>
                    <Text style={[estilos.modalSubtitle, { color: Cores.secundario }]}>Informe os dados usados na sua fatura.</Text>
                  </View>
                </View>
                <TouchableOpacity style={[estilos.modalClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalNovoCartao(false)} accessibilityLabel="Fechar">
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>

              <Text style={[estilos.label, { color: Cores.secundario }]}>Nome do Cartão</Text>
              <TextInput
                style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                placeholder="Ex: Nubank, Itaú, Bradesco"
                placeholderTextColor={Cores.secundario}
                value={nomeCartao}
                onChangeText={setNomeCartao}
              />

              <Text style={[estilos.label, { color: Cores.secundario }]}>Limite (R$)</Text>
              <TextInput
                style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                placeholder="R$ 0,00"
                placeholderTextColor={Cores.secundario}
                value={limiteCartao}
                onChangeText={(texto) => setLimiteCartao(formatarEntradaMoeda(texto))}
                keyboardType="decimal-pad"
              />

              <View style={estilos.doisCampos}>
                <View style={{ flex: 1 }}>
                  <Text style={[estilos.label, { color: Cores.secundario }]}>Dia de Vencimento</Text>
                  <TextInput
                    style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                    placeholder="Ex: 10"
                    placeholderTextColor={Cores.secundario}
                    value={diaVencimento}
                    onChangeText={setDiaVencimento}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[estilos.label, { color: Cores.secundario }]}>Dia de Fechamento</Text>
                  <TextInput
                    style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                    placeholder="Ex: 3"
                    placeholderTextColor={Cores.secundario}
                    value={diaFechamento}
                    onChangeText={setDiaFechamento}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                </View>
              </View>

              <Text style={[estilos.label, { color: Cores.secundario }]}>Cor do Cartão</Text>
              <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ marginBottom: 16, maxWidth: "100%" }} contentContainerStyle={{ paddingRight: 12 }}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {CORES_CARTAO.map((cor) => (
                    <TouchableOpacity
                      key={cor}
                      style={[
                        estilos.corCirculo,
                        { backgroundColor: cor },
                        corCartao === cor && estilos.corSelecionada,
                      ]}
                      onPress={() => setCorCartao(cor)}
                    >
                      {corCartao === cor && <MaterialIcons name="check" size={14} color="#FFF" />}
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <View style={estilos.modalBtns}>
                <TouchableOpacity
                  style={[estilos.modalBtn, { backgroundColor: Cores.pillFundo }]}
                  onPress={() => setModalNovoCartao(false)}
                >
                  <Text style={[estilos.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[estilos.modalBtn, { backgroundColor: Cores.primary }]}
                  onPress={salvarNovoCartao}
                  disabled={loadingNovoCartao}
                >
                  <Text style={[estilos.modalBtnText, { color: "#FFF" }]}>
                    {loadingNovoCartao ? "Salvando..." : "Salvar"}
                  </Text>
                </TouchableOpacity>
              </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Modal: Nova Compra */}
      {modalNovaCompra && cartaoAberto && (
        <Modal animationType="slide" transparent visible onRequestClose={() => setModalNovaCompra(false)}>
          <KeyboardAvoidingView style={estilos.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={[estilos.modalContent, { backgroundColor: Cores.card }]}>
              <View style={[estilos.sheetHandle, { backgroundColor: Cores.borda }]} />
              <ScrollView
                style={estilos.modalFormScroll}
                contentContainerStyle={[estilos.modalFormContent, cartoesKeyboardVisivel && estilos.modalFormContentKeyboard]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                showsVerticalScrollIndicator={false}
              >
              <View style={estilos.modalHeaderRow}>
                <View style={estilos.modalTitleGroup}>
                  <View style={[estilos.modalHeaderIcon, { backgroundColor: `${FinFlowColors.blue}1A` }]}>
                    <MaterialIcons name="add-shopping-cart" size={22} color={FinFlowColors.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Nova compra</Text>
                    <Text style={[estilos.modalSubtitle, { color: Cores.secundario }]} numberOfLines={1}>{cartaoAberto.nome}</Text>
                  </View>
                </View>
                <TouchableOpacity style={[estilos.modalClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalNovaCompra(false)} accessibilityLabel="Fechar">
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>

              <Text style={[estilos.label, { color: Cores.secundario }]}>Tipo da compra</Text>
              <View style={[estilos.tipoCompraRow, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}>
                {([
                  ["unica", "Única"],
                  ["parcelada", "Parcelada"],
                  ["fixa", "Fixa mensal"],
                ] as const).map(([tipo, label]) => (
                  <TouchableOpacity
                    key={tipo}
                    style={[estilos.tipoCompraBtn, tipoCompra === tipo && { backgroundColor: FinFlowColors.blue }]}
                    onPress={() => {
                      setTipoCompra(tipo);
                      if (tipo === "parcelada" && Number(parcelasCompra) < 2) setParcelasCompra("2");
                    }}
                  >
                    <Text style={{ color: tipoCompra === tipo ? "#FFF" : Cores.secundario, fontSize: 12, fontWeight: "700" }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {tipoCompra === "fixa" && (
                <Text style={{ color: Cores.secundario, fontSize: 12, lineHeight: 17, marginBottom: 14 }}>
                  O valor será lançado mensalmente nas próximas faturas.
                </Text>
              )}

              {tipoCompra === "parcelada" && (
                <>
                  <Text style={[estilos.label, { color: Cores.secundario }]}>O valor informado representa</Text>
                  <View style={[estilos.tipoCompraRow, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}>
                    {(["total", "parcela"] as const).map((modo) => (
                      <TouchableOpacity key={modo} style={[estilos.tipoCompraBtn, modoValorParcelado === modo && { backgroundColor: FinFlowColors.blue }]} onPress={() => setModoValorParcelado(modo)}>
                        <Text style={{ color: modoValorParcelado === modo ? "#FFF" : Cores.secundario, fontSize: 12, fontWeight: "700" }}>{modo === "total" ? "Valor total" : "Valor da parcela"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <Text style={[estilos.label, { color: Cores.secundario }]}>Descrição</Text>
              <TextInput
                style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                placeholder="Ex: Compra no Mercado"
                placeholderTextColor={Cores.secundario}
                value={descCompra}
                onChangeText={setDescCompra}
              />

              <View style={estilos.doisCampos}>
                <View style={{ flex: 1 }}>
                  <Text style={[estilos.label, { color: Cores.secundario }]}>{tipoCompra === "parcelada" && modoValorParcelado === "parcela" ? "Valor da Parcela (R$)" : "Valor Total (R$)"}</Text>
                  <TextInput
                    style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                    placeholder="Ex: 120,00"
                    placeholderTextColor={Cores.secundario}
                    value={valorCompra}
                    onChangeText={(texto) => setValorCompra(formatarEntradaMoeda(texto))}
                    keyboardType="number-pad"
                    selectTextOnFocus={false}
                  />
                </View>
                {tipoCompra === "parcelada" && <><View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[estilos.label, { color: Cores.secundario }]}>Parcelas</Text>
                    <TextInput
                      style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                      placeholder="Ex: 3"
                      placeholderTextColor={Cores.secundario}
                      value={parcelasCompra}
                      onChangeText={setParcelasCompra}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                  </View>
                </>}
              </View>

              {/* Preview de parcelas */}
              {tipoCompra === "parcelada" && valorDaEntradaMoeda(valorCompra) > 0 && parseInt(parcelasCompra) > 1 && (
                <View style={[estilos.previewParcelas, { backgroundColor: Cores.pillFundo }]}>
                  <Text style={[estilos.previewText, { color: Cores.secundario }]}>
                    {modoValorParcelado === "total"
                      ? <>{parseInt(parcelasCompra)}x de <Text style={{ color: Cores.texto, fontWeight: "bold" }}>{fmtReais(valorDaEntradaMoeda(valorCompra) / parseInt(parcelasCompra))}</Text></>
                      : <>Total: <Text style={{ color: Cores.texto, fontWeight: "bold" }}>{fmtReais(valorDaEntradaMoeda(valorCompra) * parseInt(parcelasCompra))}</Text></>}
                  </Text>
                </View>
              )}

              <Text style={[estilos.label, { color: Cores.secundario }]}>Categoria</Text>
              <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ marginBottom: 16, maxWidth: "100%" }} contentContainerStyle={{ paddingRight: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {categorias.filter(c => c.tipo === "despesa").map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[estilos.catPill, { backgroundColor: categCompraId === cat.id ? cat.cor : Cores.pillFundo, borderWidth: 1, borderColor: categCompraId === cat.id ? cat.cor : Cores.borda }]}
                      onPress={() => setCategCompraId(categCompraId === cat.id ? null : cat.id)}
                    >
                      <Text style={{ color: categCompraId === cat.id ? "#FFF" : Cores.texto, fontSize: 13 }}>{cat.nome}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <Text style={[estilos.label, { color: Cores.secundario }]}>Data da Compra</Text>
              <TouchableOpacity
                style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda }]}
                onPress={() => setMostrarDataPicker(true)}
              >
                <Text style={{ color: Cores.texto }}>
                  {dataCompra.toLocaleDateString("pt-BR")}
                </Text>
              </TouchableOpacity>
              {mostrarDataPicker && (
                <DateTimePicker
                  value={dataCompra}
                  mode="date"
                  display="default"
                  onChange={(_, d) => { setMostrarDataPicker(false); if (d) setDataCompra(d); }}
                />
              )}

              <View style={estilos.modalBtns}>
                <TouchableOpacity
                  style={[estilos.modalBtn, { backgroundColor: Cores.pillFundo }]}
                  onPress={() => setModalNovaCompra(false)}
                >
                  <Text style={[estilos.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[estilos.modalBtn, { backgroundColor: Cores.primary }]}
                  onPress={salvarCompra}
                  disabled={loadingCompra}
                >
                  <Text style={[estilos.modalBtnText, { color: "#FFF" }]}>
                    {loadingCompra ? "Salvando..." : "Salvar Compra"}
                  </Text>
                </TouchableOpacity>
              </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Modal: Pagamento da Fatura — selecionar conta */}
      {modalPagamento && cartaoAberto && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalPagamento(false)}>
          <KeyboardAvoidingView
            style={estilos.modalFaturaOverlay}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={[estilos.modalFaturaContent, { backgroundColor: Cores.card }]}>
              <ScrollView
                style={estilos.modalFormScroll}
                contentContainerStyle={[estilos.modalFormContent, cartoesKeyboardVisivel && estilos.modalFormContentKeyboard]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                showsVerticalScrollIndicator={false}
              >
              <View style={estilos.modalHeaderRow}>
                <View style={estilos.modalTitleGroup}>
                  <View style={[estilos.modalHeaderIcon, { backgroundColor: Cores.primarySoft }]}>
                    <MaterialIcons name="account-balance-wallet" size={22} color={Cores.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Pagar fatura</Text>
                    <Text style={[estilos.modalSubtitle, { color: Cores.secundario }]}>{cartaoAberto.nome} · {formatarMes(mesPagamento)}</Text>
                  </View>
                </View>
                <TouchableOpacity style={[estilos.modalClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalPagamento(false)} accessibilityLabel="Fechar">
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>

              <View style={[estilos.valorDestaque, { backgroundColor: Cores.primarySoft, borderColor: `${Cores.primary}35` }]}>
                <View style={[estilos.valorDestaqueIcone, { backgroundColor: `${Cores.primary}1F` }]}>
                  <MaterialIcons name="receipt-long" size={20} color={Cores.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[estilos.valorDestaqueLabel, { color: Cores.secundario }]}>Total em aberto</Text>
                  <Text style={[estilos.valorDestaqueNumero, { color: Cores.primary }]}>
                  {fmtReais(calcularTotalFatura(cartaoAberto.id, mesPagamento))}
                  </Text>
                </View>
              </View>

              <Text style={[estilos.label, { color: Cores.secundario }]}>Valor pago (R$)</Text>
              <TextInput
                style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                value={valorPagamento}
                onChangeText={(texto) => {
                  setValorPagamento(formatarEntradaMoeda(texto));
                  pagamentoRequestIdRef.current = createInvoiceOperationRequestId();
                }}
                keyboardType="number-pad"
                placeholder="0,00"
                placeholderTextColor={Cores.secundario}
                selectTextOnFocus={false}
                editable={!loadingPagamento}
              />

              <Text style={[estilos.label, { color: Cores.secundario }]}>Pagar com qual conta?</Text>
              {contas.map((conta) => (
                <TouchableOpacity
                  key={conta.id}
                  style={[estilos.contaOpcao, { borderColor: contaPagamentoId === conta.id ? Cores.primary : Cores.borda, backgroundColor: contaPagamentoId === conta.id ? Cores.primarySoft : Cores.pillFundo }]}
                  onPress={() => {
                    setContaPagamentoId(conta.id);
                    pagamentoRequestIdRef.current = createInvoiceOperationRequestId();
                  }}
                  disabled={loadingPagamento}
                >
                  <View style={[estilos.opcaoIcone, { backgroundColor: contaPagamentoId === conta.id ? `${Cores.primary}1F` : Cores.input }]}>
                    <MaterialIcons name="account-balance-wallet" size={18} color={contaPagamentoId === conta.id ? Cores.primary : Cores.secundario} />
                  </View>
                  <Text style={{ color: contaPagamentoId === conta.id ? Cores.primary : Cores.texto, fontWeight: "700", marginLeft: 10, flex: 1 }}>{conta.nome}</Text>
                  {contaPagamentoId === conta.id && <MaterialIcons name="check-circle" size={18} color={Cores.primary} />}
                </TouchableOpacity>
              ))}

              <View style={estilos.modalBtns}>
                <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalPagamento(false)} disabled={loadingPagamento}>
                  <Text style={[estilos.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: Cores.primary }, (!contaPagamentoId || loadingPagamento) && estilos.botaoDesabilitado]} onPress={confirmarPagamentoFatura} disabled={!contaPagamentoId || loadingPagamento}>
                  <MaterialIcons name="check" size={18} color="#FFF" />
                  <Text style={[estilos.modalBtnText, { color: "#FFF" }]}>{loadingPagamento ? "Processando..." : "Confirmar"}</Text>
                </TouchableOpacity>
              </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Modal: Editar Cartão */}
      {modalPagamentoParcial && cartaoAberto && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalPagamentoParcial(false)}>
          <View style={estilos.modalFaturaOverlay}>
            <View style={[estilos.modalFaturaContent, { backgroundColor: Cores.card }]}>
              <View style={estilos.modalHeaderRow}>
                <View style={estilos.modalTitleGroup}>
                  <View style={[estilos.modalHeaderIcon, { backgroundColor: `${FinFlowColors.orange}1A` }]}>
                    <MaterialIcons name="call-split" size={22} color={FinFlowColors.orange} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Pagamento parcial</Text>
                    <Text style={[estilos.modalSubtitle, { color: Cores.secundario }]}>Escolha como tratar o saldo restante.</Text>
                  </View>
                </View>
                <TouchableOpacity style={[estilos.modalClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalPagamentoParcial(false)} accessibilityLabel="Fechar">
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>
              <View style={[estilos.resumoPagamento, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}>
                <Text style={[estilos.resumoPagamentoTexto, { color: Cores.secundario }]}>Valor informado</Text>
                <Text style={[estilos.resumoPagamentoValor, { color: Cores.texto }]}>{fmtReais(valorDaEntradaMoeda(valorPagamento))}</Text>
                <Text style={[estilos.resumoPagamentoTexto, { color: Cores.secundario }]}>de {fmtReais(calcularTotalFatura(cartaoAberto.id, mesPagamento))}</Text>
              </View>
              <TouchableOpacity style={[estilos.opcaoAcaoCard, { borderColor: Cores.borda, backgroundColor: Cores.pillFundo }, loadingPagamento && estilos.botaoDesabilitado]} onPress={() => registrarPagamentoMenor(false)} disabled={loadingPagamento}>
                <View style={[estilos.opcaoIcone, { backgroundColor: `${FinFlowColors.blue}1A` }]}>
                  <MaterialIcons name="payments" size={20} color={FinFlowColors.blue} />
                </View>
                <View style={estilos.opcaoTexto}>
                  <Text style={[estilos.opcaoTitulo, { color: Cores.texto }]}>Manter fatura em aberto</Text>
                  <Text style={[estilos.opcaoDescricao, { color: Cores.secundario }]}>Registra o pagamento parcial e mantém o restante nesta fatura.</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={Cores.secundario} />
              </TouchableOpacity>
              <TouchableOpacity style={[estilos.opcaoAcaoCard, { borderColor: `${FinFlowColors.orange}66`, backgroundColor: Cores.pillFundo }, loadingPagamento && estilos.botaoDesabilitado]} onPress={() => { setModalPagamentoParcial(false); setModalJuros(true); }} disabled={loadingPagamento}>
                <View style={[estilos.opcaoIcone, { backgroundColor: `${FinFlowColors.orange}1A` }]}>
                  <MaterialIcons name="event-repeat" size={20} color={FinFlowColors.orange} />
                </View>
                <View style={estilos.opcaoTexto}>
                  <Text style={[estilos.opcaoTitulo, { color: Cores.texto }]}>Levar para a próxima fatura</Text>
                  <Text style={[estilos.opcaoDescricao, { color: Cores.secundario }]}>Transfere o saldo restante e permite informar juros.</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={FinFlowColors.orange} />
              </TouchableOpacity>
              <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: Cores.pillFundo, marginTop: 4, flex: 0 }]} onPress={() => setModalPagamentoParcial(false)}>
                <Text style={[estilos.modalBtnText, { color: Cores.texto }]}>Voltar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {modalJuros && cartaoAberto && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalJuros(false)}>
          <KeyboardAvoidingView
            style={estilos.modalFaturaOverlay}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={[estilos.modalFaturaContent, { backgroundColor: Cores.card }]}>
              <View style={estilos.modalHeaderRow}>
                <View style={estilos.modalTitleGroup}>
                  <View style={[estilos.modalHeaderIcon, { backgroundColor: `${FinFlowColors.orange}1A` }]}>
                    <MaterialIcons name="percent" size={22} color={FinFlowColors.orange} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Juros do saldo</Text>
                    <Text style={[estilos.modalSubtitle, { color: Cores.secundario }]}>Opcional · pode permanecer zerado.</Text>
                  </View>
                </View>
                <TouchableOpacity style={[estilos.modalClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalJuros(false)} accessibilityLabel="Fechar">
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>
              <Text style={[estilos.dialogoTexto, { color: Cores.secundario }]}>
                Informe os juros cobrados pelo banco. Este campo é opcional e pode ficar zerado.
              </Text>
              <View style={[estilos.tipoCompraRow, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}>
                {(["valor", "percentual"] as const).map((tipo) => (
                  <TouchableOpacity
                    key={tipo}
                    onPress={() => {
                      setTipoJuros(tipo);
                      setValorJuros("");
                      pagamentoRequestIdRef.current = createInvoiceOperationRequestId();
                    }}
                    disabled={loadingPagamento}
                    style={[estilos.tipoCompraBtn, tipoJuros === tipo && { backgroundColor: Cores.primary }]}
                  >
                    <Text style={{ color: tipoJuros === tipo ? "#FFF" : Cores.texto, fontWeight: "700" }}>{tipo === "valor" ? "Valor em R$" : "Percentual %"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[estilos.label, { color: Cores.secundario }]}>{tipoJuros === "valor" ? "Valor dos juros (R$)" : "Percentual dos juros (%)"}</Text>
              <TextInput
                style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                value={valorJuros}
                onChangeText={(texto) => {
                  setValorJuros(tipoJuros === "valor" ? formatarEntradaMoeda(texto) : texto.replace(/[^0-9,]/g, ""));
                  pagamentoRequestIdRef.current = createInvoiceOperationRequestId();
                }}
                keyboardType={tipoJuros === "valor" ? "number-pad" : "decimal-pad"}
                placeholder={tipoJuros === "valor" ? "0,00 (opcional)" : "0 (opcional)"}
                placeholderTextColor={Cores.secundario}
                selectTextOnFocus={false}
                editable={!loadingPagamento}
              />
              <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: Cores.primary, flex: 0 }, loadingPagamento && estilos.botaoDesabilitado]} onPress={() => registrarPagamentoMenor(true)} disabled={loadingPagamento}>
                <MaterialIcons name="arrow-forward" size={18} color="#FFF" />
                <Text style={[estilos.modalBtnText, { color: "#FFF" }]}>{loadingPagamento ? "Processando..." : "Confirmar e lançar na próxima fatura"}</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {modalEditarCartao && cartaoEditando && (
        <Modal animationType="slide" transparent visible onRequestClose={() => setModalEditarCartao(false)}>
          <KeyboardAvoidingView
            style={estilos.modalOverlay}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={[estilos.modalContent, { backgroundColor: Cores.card }]}>
              <View style={[estilos.sheetHandle, { backgroundColor: Cores.borda }]} />
              <ScrollView
                style={estilos.modalFormScroll}
                contentContainerStyle={[estilos.modalFormContent, cartoesKeyboardVisivel && estilos.modalFormContentKeyboard]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                showsVerticalScrollIndicator={false}
              >
              <View style={estilos.modalHeaderRow}>
                <View style={estilos.modalTitleGroup}>
                  <View style={[estilos.modalHeaderIcon, { backgroundColor: `${cartaoEditando.cor}20` }]}>
                    <MaterialIcons name="edit" size={22} color={cartaoEditando.cor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Editar cartão</Text>
                    <Text style={[estilos.modalSubtitle, { color: Cores.secundario }]}>Atualize os dados e o ciclo da fatura.</Text>
                  </View>
                </View>
                <TouchableOpacity style={[estilos.modalClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalEditarCartao(false)} accessibilityLabel="Fechar">
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>

              <Text style={[estilos.label, { color: Cores.secundario }]}>Nome do Cartão</Text>
              <TextInput style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]} placeholder="Ex: Nubank" placeholderTextColor={Cores.secundario} value={editNome} onChangeText={setEditNome} />

              <Text style={[estilos.label, { color: Cores.secundario }]}>Limite (R$)</Text>
              <TextInput style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]} placeholder="R$ 0,00" placeholderTextColor={Cores.secundario} value={editLimite} onChangeText={(texto) => setEditLimite(formatarEntradaMoeda(texto))} keyboardType="decimal-pad" />

              <View style={estilos.doisCampos}>
                <View style={{ flex: 1 }}>
                  <Text style={[estilos.label, { color: Cores.secundario }]}>Dia Vencimento</Text>
                  <TextInput style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]} value={editVenc} onChangeText={setEditVenc} keyboardType="number-pad" maxLength={2} />
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[estilos.label, { color: Cores.secundario }]}>Dia Fechamento</Text>
                  <TextInput style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]} value={editFecha} onChangeText={setEditFecha} keyboardType="number-pad" maxLength={2} />
                </View>
              </View>

              <Text style={[estilos.label, { color: Cores.secundario }]}>Cor do Cartão</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {CORES_CARTAO.map((cor) => (
                    <TouchableOpacity key={cor} style={[estilos.corCirculo, { backgroundColor: cor }, editCor === cor && estilos.corSelecionada]} onPress={() => setEditCor(cor)}>
                      {editCor === cor && <MaterialIcons name="check" size={14} color="#FFF" />}
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <View style={estilos.modalBtns}>
                <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalEditarCartao(false)}>
                  <Text style={[estilos.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: Cores.primary }]} onPress={salvarEdicaoCartao} disabled={loadingEditar}>
                  <Text style={[estilos.modalBtnText, { color: "#FFF" }]}>{loadingEditar ? "Salvando..." : "Salvar"}</Text>
                </TouchableOpacity>
              </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Modal: Opções do Cartão (long-press) */}
      {modalOpcoesCartao && (
        <FinFlowPopup animationType="fade" transparent visible onRequestClose={() => setModalOpcoesCartao(null)}>
          <View style={estilos.modalFaturaOverlay}>
            <View style={[estilos.modalFaturaContent, { backgroundColor: Cores.card }]}>
              <View style={estilos.modalHeaderRow}>
                <View style={estilos.modalTitleGroup}>
                  <View style={[estilos.modalHeaderIcon, { backgroundColor: `${modalOpcoesCartao.cor}20` }]}>
                    <MaterialIcons name="credit-card" size={22} color={modalOpcoesCartao.cor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>{modalOpcoesCartao.nome}</Text>
                    <Text style={[estilos.modalSubtitle, { color: Cores.secundario }]}>Gerencie os dados e a situação do cartão.</Text>
                  </View>
                </View>
                <TouchableOpacity style={[estilos.modalClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalOpcoesCartao(null)} accessibilityLabel="Fechar">
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[estilos.opcaoAcaoCard, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}
                onPress={() => { setModalOpcoesCartao(null); abrirEditarCartao(modalOpcoesCartao); }}
              >
                <View style={[estilos.opcaoIcone, { backgroundColor: `${FinFlowColors.blue}1A` }]}>
                  <MaterialIcons name="edit" size={20} color={FinFlowColors.blue} />
                </View>
                <View style={estilos.opcaoTexto}>
                  <Text style={[estilos.opcaoTitulo, { color: Cores.texto }]}>Editar cartão</Text>
                  <Text style={[estilos.opcaoDescricao, { color: Cores.secundario }]}>Nome, limite, datas e cor.</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={Cores.secundario} />
              </TouchableOpacity>

              {itens.some(i => i.cartao_id === modalOpcoesCartao.id) ? (
                <TouchableOpacity
                  style={[estilos.opcaoAcaoCard, { backgroundColor: Cores.pillFundo, borderColor: `${FinFlowColors.orange}66` }]}
                  onPress={() => arquivarCartaoConfirm(modalOpcoesCartao)}
                >
                  <View style={[estilos.opcaoIcone, { backgroundColor: `${FinFlowColors.orange}1A` }]}>
                    <MaterialIcons name="archive" size={20} color={FinFlowColors.orange} />
                  </View>
                  <View style={estilos.opcaoTexto}>
                    <Text style={[estilos.opcaoTitulo, { color: Cores.texto }]}>Arquivar cartão</Text>
                    <Text style={[estilos.opcaoDescricao, { color: Cores.secundario }]}>Oculta o cartão e preserva o histórico.</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={FinFlowColors.orange} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[estilos.opcaoAcaoCard, { backgroundColor: Cores.pillFundo, borderColor: `${FinFlowColors.red}66` }]}
                  onPress={() => deletarCartaoConfirm(modalOpcoesCartao)}
                >
                  <View style={[estilos.opcaoIcone, { backgroundColor: `${FinFlowColors.red}1A` }]}>
                    <MaterialIcons name="delete-outline" size={20} color={FinFlowColors.red} />
                  </View>
                  <View style={estilos.opcaoTexto}>
                    <Text style={[estilos.opcaoTitulo, { color: FinFlowColors.red }]}>Excluir cartão</Text>
                    <Text style={[estilos.opcaoDescricao, { color: Cores.secundario }]}>Remove definitivamente este cartão vazio.</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={FinFlowColors.red} />
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[estilos.modalBtn, { backgroundColor: Cores.pillFundo, flex: 0, marginTop: 4 }]}
                onPress={() => setModalOpcoesCartao(null)}
              >
                <Text style={[estilos.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </FinFlowPopup>
      )}

      {/* Modal: Excluir Item de Fatura */}
      {modalExcluirItem && (
        <FinFlowPopup animationType="fade" transparent visible onRequestClose={() => setModalExcluirItem(null)}>
          <View style={estilos.modalFaturaOverlay}>
            <View style={[estilos.modalFaturaContent, { backgroundColor: Cores.card }]}>
              <View style={estilos.modalHeaderRow}>
                <View style={estilos.modalTitleGroup}>
                  <View style={[estilos.modalHeaderIcon, { backgroundColor: `${FinFlowColors.red}1A` }]}>
                    <MaterialIcons name="delete-outline" size={22} color={FinFlowColors.red} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Excluir compra</Text>
                    <Text style={[estilos.modalSubtitle, { color: Cores.secundario }]}>Esta ação altera o total da fatura.</Text>
                  </View>
                </View>
                <TouchableOpacity style={[estilos.modalClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalExcluirItem(null)} accessibilityLabel="Fechar">
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>
              <View style={[estilos.itemConfirmacao, { backgroundColor: Cores.pillFundo, borderColor: Cores.borda }]}>
                <MaterialIcons name="shopping-bag" size={19} color={Cores.secundario} />
                <Text style={[estilos.itemConfirmacaoTexto, { color: Cores.texto }]} numberOfLines={2}>{modalExcluirItem.descricao}</Text>
              </View>

              {(modalExcluirItem.total_parcelas > 1 || modalExcluirItem.descricao.endsWith("(Fixa)")) && (
                <TouchableOpacity
                  style={[estilos.opcaoAcaoCard, { backgroundColor: Cores.pillFundo, borderColor: `${FinFlowColors.orange}66` }]}
                  onPress={async () => {
                    setModalExcluirItem(null);
                    await executarExclusao([modalExcluirItem.id]);
                  }}
                >
                  <View style={[estilos.opcaoIcone, { backgroundColor: `${FinFlowColors.orange}1A` }]}>
                    <MaterialIcons name="event" size={20} color={FinFlowColors.orange} />
                  </View>
                  <View style={estilos.opcaoTexto}>
                    <Text style={[estilos.opcaoTitulo, { color: Cores.texto }]}>{modalExcluirItem.total_parcelas > 1 ? `Excluir só esta (${modalExcluirItem.parcela_atual}/${modalExcluirItem.total_parcelas})` : "Excluir somente este mês"}</Text>
                    <Text style={[estilos.opcaoDescricao, { color: Cores.secundario }]}>As demais cobranças serão preservadas.</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={FinFlowColors.orange} />
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[estilos.opcaoAcaoCard, { backgroundColor: Cores.pillFundo, borderColor: `${FinFlowColors.red}66` }]}
                onPress={async () => {
                  const item = modalExcluirItem;
                  setModalExcluirItem(null);
                  if (item.total_parcelas > 1 || item.descricao.endsWith("(Fixa)")) {
                    const ids = itens
                      .filter(i => i.grupo_parcela_id === (item.grupo_parcela_id || item.id)
                        && !i.pago
                        && !isInvoicePaymentAdjustment(i.descricao))
                      .map(i => i.id);
                    await executarExclusao(ids);
                  } else {
                    await executarExclusao([item.id]);
                  }
                }}
              >
                <View style={[estilos.opcaoIcone, { backgroundColor: `${FinFlowColors.red}1A` }]}>
                  <MaterialIcons name="delete-forever" size={20} color={FinFlowColors.red} />
                </View>
                <View style={estilos.opcaoTexto}>
                  <Text style={[estilos.opcaoTitulo, { color: FinFlowColors.red }]}>{modalExcluirItem.descricao.endsWith("(Fixa)") ? "Excluir todos os meses" : modalExcluirItem.total_parcelas > 1 ? "Excluir todas as parcelas" : "Excluir compra"}</Text>
                  <Text style={[estilos.opcaoDescricao, { color: Cores.secundario }]}>Esta opção não poderá ser desfeita.</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={FinFlowColors.red} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[estilos.modalBtn, { backgroundColor: Cores.pillFundo, flex: 0, marginTop: 4 }]}
                onPress={() => setModalExcluirItem(null)}
              >
                <Text style={[estilos.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </FinFlowPopup>
      )}

      {estornoPendente && (
        <FinFlowPopup animationType="fade" transparent visible onRequestClose={() => setEstornoPendente(null)}>
          <View style={estilos.modalFaturaOverlay}>
            <View style={[estilos.modalFaturaContent, { backgroundColor: Cores.card }]}>
              <View style={estilos.modalHeaderRow}>
                <View style={estilos.modalTitleGroup}>
                  <View style={[estilos.modalHeaderIcon, { backgroundColor: `${FinFlowColors.orange}1A` }]}>
                    <MaterialIcons name="undo" size={22} color={FinFlowColors.orange} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Estornar pagamento</Text>
                    <Text style={[estilos.modalSubtitle, { color: Cores.secundario }]}>Somente o pagamento mais recente será afetado.</Text>
                  </View>
                </View>
                <TouchableOpacity style={[estilos.modalClose, { backgroundColor: Cores.pillFundo }]} onPress={() => setEstornoPendente(null)} accessibilityLabel="Fechar">
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>
              <View style={[estilos.avisoCard, { backgroundColor: `${FinFlowColors.orange}12`, borderColor: `${FinFlowColors.orange}55` }]}>
                <MaterialIcons name="info-outline" size={20} color={FinFlowColors.orange} />
                <Text style={[estilos.avisoCardTexto, { color: Cores.secundario }]}>O pagamento mais recente da fatura de <Text style={{ color: Cores.texto, fontWeight: "800" }}>{formatarMes(estornoPendente.mes)}</Text> será estornado. Se houver pagamentos anteriores, eles continuarão registrados e poderão ser estornados individualmente no Histórico.</Text>
              </View>
              <View style={estilos.modalBtns}>
                <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: Cores.pillFundo }]} onPress={() => setEstornoPendente(null)} disabled={loadingEstorno}>
                  <Text style={[estilos.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: FinFlowColors.orange }, loadingEstorno && estilos.botaoDesabilitado]} onPress={confirmarEstornoFatura} disabled={loadingEstorno}>
                  <MaterialIcons name="undo" size={18} color="#FFF" />
                  <Text style={[estilos.modalBtnText, { color: "#FFF" }]}>{loadingEstorno ? "Estornando..." : "Estornar"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </FinFlowPopup>
      )}
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const estilos = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { paddingBottom: 34 },
  header: {
    position: "relative",
    overflow: "hidden",
    marginHorizontal: 12,
    marginTop: 6,
    minHeight: 206,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 17,
    borderRadius: 26,
    ...FinFlowShadow,
  },
  headerDecoracaoUm: {
    position: "absolute",
    width: 300,
    height: 125,
    right: -138,
    top: 48,
    borderRadius: 160,
    backgroundColor: "rgba(255,255,255,0.09)",
    transform: [{ rotate: "-10deg" }],
  },
  headerDecoracaoDois: {
    position: "absolute",
    width: 240,
    height: 92,
    left: -125,
    bottom: -18,
    borderRadius: 130,
    backgroundColor: "rgba(2,60,51,0.14)",
    transform: [{ rotate: "11deg" }],
  },
  headerTopRow: { flexDirection: "row", alignItems: "center", zIndex: 2 },
  voltarBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.15)" },
  headerTitleGroup: { flex: 1, paddingHorizontal: 12 },
  headerEyebrow: { color: "rgba(255,255,255,0.68)", fontSize: 9, fontWeight: "900", letterSpacing: 1.35 },
  titulo: { color: "#FFF", fontSize: 21, fontWeight: "900", letterSpacing: -0.35, marginTop: 1 },
  headerSubtitle: { color: "rgba(255,255,255,0.78)", fontSize: 11, lineHeight: 16, marginTop: 15, zIndex: 2 },
  btnNovo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 13,
    borderRadius: FinFlowRadius.pill,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  btnNovoText: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  headerResumo: { flexDirection: "row", alignItems: "center", marginTop: 17, padding: 12, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.12)", zIndex: 2 },
  headerResumoItem: { flex: 1 },
  headerResumoDivisor: { width: 1, height: 34, backgroundColor: "rgba(255,255,255,0.18)", marginHorizontal: 14 },
  headerResumoLabel: { color: "rgba(255,255,255,0.68)", fontSize: 9, fontWeight: "700", marginBottom: 3 },
  headerResumoValor: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 18, marginTop: 23, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "900" },
  sectionSubtitle: { fontSize: 10, marginTop: 2 },
  sectionIcon: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tipoCompraRow: { flexDirection: "row", borderRadius: FinFlowRadius.medium, borderWidth: 1, padding: 4, marginBottom: 14 },
  tipoCompraBtn: { flex: 1, minHeight: 38, paddingHorizontal: 5, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  emptyCard: {
    marginHorizontal: 16,
    borderRadius: FinFlowRadius.large,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 34,
  },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  emptyTitulo: { fontSize: 16, fontWeight: "800" },
  emptySubtitulo: { fontSize: 12, lineHeight: 17, marginTop: 5, textAlign: "center" },

  cartoesLista: { paddingHorizontal: 16, gap: 12, marginBottom: 4 },
  cartaoCard: {
    position: "relative",
    overflow: "hidden",
    minHeight: 176,
    borderRadius: 22,
    padding: 18,
    justifyContent: "space-between",
    shadowColor: "#061A15",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.19,
    shadowRadius: 12,
    elevation: 5,
  },
  cartaoDecoracao: { position: "absolute", width: 190, height: 190, borderRadius: 95, right: -77, top: -92, backgroundColor: "rgba(255,255,255,0.10)" },
  cartaoTopo: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  cartaoIcone: { width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)" },
  cartaoNome: { color: "#FFF", fontWeight: "800", fontSize: 16, flex: 1 },
  cartaoFaturaLabel: { color: "rgba(255,255,255,0.70)", fontSize: 10, fontWeight: "600" },
  cartaoFatura: { color: "#FFF", fontSize: 25, fontWeight: "900", letterSpacing: -0.35, marginTop: 2, marginBottom: 14 },
  cartaoRodape: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.16)" },
  cartaoRodapeCol: { gap: 2 },
  cartaoRodapeLabel: { color: "rgba(255,255,255,0.62)", fontSize: 9, fontWeight: "600" },
  cartaoLimite: { color: "rgba(255,255,255,0.94)", fontSize: 11, fontWeight: "800" },
  cartaoVenc: { color: "rgba(255,255,255,0.94)", fontSize: 11, fontWeight: "800" },

  modalFaturaOverlay: {
    flex: 1,
    backgroundColor: "rgba(2,12,15,0.78)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalFaturaContent: {
    width: "100%",
    maxWidth: 560,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(128,145,138,0.22)",
    padding: 22,
    maxHeight: "88%",
    ...FinFlowShadow,
  },
  faturaHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  faturaCartaoNome: { fontSize: 15, fontWeight: "800", marginBottom: 5 },
  faturaTotal: { fontSize: 29, fontWeight: "900", letterSpacing: -0.45 },
  faturaStatus: { fontSize: 10, fontWeight: "800", marginTop: 3 },

  limiteContainer: { borderRadius: 17, padding: 14, marginBottom: 17 },
  limiteRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  limiteLbl: { fontSize: 12 },
  limiteVal: { fontSize: 12, fontWeight: "600" },
  progressoBg: { height: 7, borderRadius: 4, overflow: "hidden", marginBottom: 7 },
  progressoBar: { height: 7, borderRadius: 4 },
  limiteDisp: { fontSize: 12, fontWeight: "bold" },

  mesNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 42,
    marginBottom: 13,
  },
  mesTitulo: { fontSize: 14, fontWeight: "800" },

  acoesRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  acaoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 46,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  acaoBtnText: { color: "#FFF", fontWeight: "800", fontSize: 12 },

  faturaVazia: { alignItems: "center", paddingVertical: 28 },
  faturaVaziaText: { fontSize: 14, marginTop: 8 },

  itensList: {},
  itemFatura: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 58,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  itemFaturaLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: 10 },
  itemStatus: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  itemDesc: { fontSize: 14, fontWeight: "500" },
  itemData: { fontSize: 11, marginTop: 2 },
  itemValor: { fontSize: 15, fontWeight: "bold" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(2,12,15,0.78)",
    justifyContent: "flex-end",
  },
  modalContent: {
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "rgba(128,145,138,0.22)",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    maxHeight: "94%",
    ...FinFlowShadow,
  },
  modalFormScroll: { width: "100%" },
  modalFormContent: { paddingBottom: 24 },
  // Espaço extra só existe enquanto o teclado está aberto (usado pelos 4
  // formulários de modal desta tela: nova compra, pagar fatura, cartão).
  // Sem ele, campos perto do fim do formulário ficam presos atrás do
  // teclado sem jeito de rolar até eles; deixá-lo sempre ativo, porém,
  // criava uma área vazia arrastável mesmo com o teclado fechado.
  modalFormContentKeyboard: { paddingBottom: 320 },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  modalTitleGroup: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 11 },
  modalHeaderIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  modalSubtitle: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  modalClose: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", marginLeft: 10 },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 15 },
  modalTitulo: { fontSize: 19, fontWeight: "900", letterSpacing: -0.25 },
  label: { fontSize: 11, fontWeight: "800", marginBottom: 7, letterSpacing: 0.15 },
  input: {
    borderWidth: 1,
    borderRadius: FinFlowRadius.medium,
    paddingHorizontal: 14,
    minHeight: 52,
    paddingVertical: 13,
    fontSize: 15,
    marginBottom: 17,
  },
  doisCampos: { flexDirection: "row" },
  corCirculo: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  corSelecionada: { borderWidth: 3, borderColor: "#FFF", transform: [{ scale: 1.06 }] },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 10 },
  modalBtn: { flex: 1, minHeight: 50, paddingHorizontal: 10, borderRadius: FinFlowRadius.medium, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" },
  modalBtnText: { fontWeight: "800", fontSize: 13 },
  botaoDesabilitado: { opacity: 0.45 },
  previewParcelas: { borderRadius: 14, padding: 11, marginBottom: 16, alignItems: "center" },
  previewText: { fontSize: 13 },
  catPill: { minHeight: 38, paddingHorizontal: 13, paddingVertical: 8, borderRadius: FinFlowRadius.pill, justifyContent: "center" },
  contaOpcao: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 58,
    padding: 13,
    borderRadius: FinFlowRadius.medium,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  valorDestaque: {
    minHeight: 80,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 18,
  },
  valorDestaqueIcone: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  valorDestaqueLabel: { fontSize: 10, fontWeight: "700", marginBottom: 2 },
  valorDestaqueNumero: { fontSize: 24, fontWeight: "900", letterSpacing: -0.35 },
  resumoPagamento: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 5, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16 },
  resumoPagamentoTexto: { fontSize: 11, fontWeight: "600" },
  resumoPagamentoValor: { fontSize: 18, fontWeight: "900" },
  dialogoTexto: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  opcaoAcaoCard: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: FinFlowRadius.medium,
    padding: 12,
    marginBottom: 10,
  },
  opcaoIcone: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  opcaoTexto: { flex: 1, minWidth: 0, paddingHorizontal: 11 },
  opcaoTitulo: { fontSize: 13, fontWeight: "800" },
  opcaoDescricao: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  itemConfirmacao: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 54, borderWidth: 1, borderRadius: 15, padding: 12, marginBottom: 16 },
  itemConfirmacaoTexto: { flex: 1, fontSize: 13, fontWeight: "700" },
  avisoCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 6 },
  avisoCardTexto: { flex: 1, fontSize: 12, lineHeight: 18 },
  // Modal centralizado (novo cartão)
  modalCentradoOverlay: {
    flex: 1,
    backgroundColor: "rgba(2,12,15,0.78)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCentradoContent: {
    width: "100%",
    maxWidth: 540,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(128,145,138,0.22)",
    padding: 22,
    maxHeight: "90%",
    ...FinFlowShadow,
  },
  // Arquivados
  cartaoArquivado: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 60,
    padding: 13,
    borderRadius: FinFlowRadius.medium,
    borderWidth: 1,
    marginBottom: 8,
  },
  corPill: { width: 12, height: 12, borderRadius: 6 },
  desarquivarBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
});
