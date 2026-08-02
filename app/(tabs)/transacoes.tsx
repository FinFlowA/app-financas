import { MaterialIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
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
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../_layout";
import { fmtReais } from "../../lib/utils";
import { FinFlowTabHeader, finFlowTheme } from "../../constants/finflow-design";
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
  tipo: string;
  valor: number;
  data_vencimento: string;
  data_realizacao?: string | null;
  descricao: string;
  categoria_id: number | null;
  conta_id: number;
  status: string;
}

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

export default function TransacoesScreen() {
  const { isDark, session, showToast } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ filtroPeriodo?: "proximos-7-dias" | "atrasados" | string }>();
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

  const [filtroContas, setFiltroContas] = useState<number[]>([]);
  const [filtroCategorias, setFiltroCategorias] = useState<number[]>([]);
  const [filtroTipo, setFiltroTipo] = useState<"todas" | "receita" | "despesa" | "transferencia">("todas");
  const [filtroVencidas, setFiltroVencidas] = useState(false);
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
  const [dataRealizacao, setDataRealizacao] = useState(new Date());
  const [mostrarDataRealizacao, setMostrarDataRealizacao] = useState(false);
  const [ajusteTipo, setAjusteTipo] = useState<"nenhum" | "juros" | "desconto">("nenhum");
  const [ajusteValor, setAjusteValor] = useState("");

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
    setFiltroProximosSeteDias(false);
    setFiltroVencidas(false);
    const novoAno = anoSelecionado + direcao;
    setAnoSelecionado(novoAno);
    const mesNum = mesSelecionado.split("-")[1];
    setMesSelecionado(`${novoAno}-${mesNum}`);
    setPaginaAtual(1);
  };

  const alterarMes = (direcao: number) => {
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
        supabase.from("categorias").select("*").eq("user_id", session.user.id),
        supabase.from("contas").select("*"),
        supabase.from("transacoes").select("*"),
        supabase.from("cartoes").select("id, nome, cor, dia_vencimento").eq("user_id", session.user.id).eq("ativo", true),
        supabase.from("fatura_itens").select("id, cartao_id, descricao, valor, mes_fatura, pago, categoria_id").eq("user_id", session.user.id),
      ]);
      if (resCategorias.data) {
        setCategorias([...resCategorias.data].sort((a, b) =>
          a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
        ));
      }
      if (resContas.data) setContas(resContas.data);
      if (resTransacoes.data) setTransacoes(resTransacoes.data);

      // Agrupar fatura_itens por (cartao_id, mes_fatura)
      if (resCartoes.data && resFaturas.data) {
        const cartaoMap: Record<number, { nome: string; cor: string; dia_vencimento: number }> = {};
        resCartoes.data.forEach((c: any) => { cartaoMap[c.id] = { nome: c.nome, cor: c.cor, dia_vencimento: c.dia_vencimento }; });

        const grupos: Record<string, FaturaGrupo> = {};
        resFaturas.data.forEach((item: any) => {
          // Ignora itens de cartões arquivados (não estão no cartaoMap)
          if (!cartaoMap[item.cartao_id]) return;
          const key = `${item.cartao_id}_${item.mes_fatura}`;
          if (!grupos[key]) {
            grupos[key] = {
              cartao_id: item.cartao_id,
              cartao_nome: cartaoMap[item.cartao_id]?.nome ?? "Cartão",
              cartao_cor: cartaoMap[item.cartao_id]?.cor ?? "#457B9D",
              mes_fatura: item.mes_fatura,
              total: 0,
              pago: true,
              itens_ids: [],
              itens: [],
              dia_vencimento: cartaoMap[item.cartao_id]?.dia_vencimento ?? 1,
            };
          }
          grupos[key].total += Number(item.valor);
          if (!item.pago) grupos[key].pago = false;
          grupos[key].itens_ids.push(item.id);
          grupos[key].itens.push({
            id: item.id,
            descricao: item.descricao || "",
            valor: Number(item.valor),
            categoria_id: item.categoria_id ?? null,
          });
        });
        setFaturaGrupos(Object.values(grupos));
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
    return () => subscription.remove();
  }, [carregarDados]);

  React.useEffect(() => {
    const filtroRecebido = params.filtroPeriodo;
    if (filtroRecebido !== "proximos-7-dias" && filtroRecebido !== "atrasados") return;

    const agora = new Date();
    setAnoSelecionado(agora.getFullYear());
    setMesSelecionado(`${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`);
    setFiltroContas([]);
    setFiltroCategorias([]);
    setFiltroTipo("todas");
    setFiltroVencidas(filtroRecebido === "atrasados");
    setFiltroStatus("todos");
    setBusca("");
    setPaginaAtual(1);
    setFiltroProximosSeteDias(filtroRecebido === "proximos-7-dias");
    router.setParams({ filtroPeriodo: "" });
    requestAnimationFrame(() => paginaScrollRef.current?.scrollTo({ y: 0, animated: true }));
    // O parâmetro do sino é consumido uma vez; os filtros podem ser alterados livremente depois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.filtroPeriodo]);

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

  const executarDeleteUma = async (transacao: Transacao) => {
    const pagamentoFatura = (transacao.descricao ?? "").match(/\[PagFatura:(\d+):(\d{4}-\d{2}):([^:\]]+)(?::(\d+))?\]/);
    if (pagamentoFatura) {
      const cartaoId = Number(pagamentoFatura[1]);
      const mes = pagamentoFatura[2];
      const modo = pagamentoFatura[3];
      const itemId = pagamentoFatura[4] ? Number(pagamentoFatura[4]) : null;
      if (modo === "parcial" && itemId) {
        await supabase.from("fatura_itens").delete().eq("id", itemId);
      } else {
        await supabase.from("fatura_itens").update({ pago: false })
          .eq("cartao_id", cartaoId).eq("mes_fatura", mes);
        if (itemId) await supabase.from("fatura_itens").delete().eq("id", itemId);
      }
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
      const { error } = await supabase.from("transacoes")
        .delete()
        .eq("user_id", session.user.id)
        .eq("descricao", desc)
        .gte("data_vencimento", transacao.data_vencimento)
        .neq("status", "paga");
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
            && parcela.atual >= parcelaReferencia.atual
            && t.conta_id === transacao.conta_id
            && t.tipo === transacao.tipo
            && t.status !== "paga";
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
          && t.conta_id === transacao.conta_id
          && t.tipo === transacao.tipo
          && t.status !== "paga";
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
        if (!isRecorrenciaFixa(t.descricao) || t.status === "paga") return false;
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
    setTransacaoEditando(t);
    setEditDescricao(isRecorrente(t) ? descricaoBase(t.descricao) : descricaoVisivel(t.descricao));
    setEditValor(t.valor.toFixed(2).replace(".", ","));
    const partes = (t.data_vencimento || new Date().toISOString().split("T")[0]).split("-");
    setEditData(new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2])));
    setEditStatus(t.status === "paga" ? "paga" : "pendente");
    setEditCategoriaId(t.categoria_id);
    setEditContaId(t.conta_id);
    setModalEditarTransVisivel(true);
  };

  const executarEdicao = async (apenasEsta: boolean) => {
    if (!transacaoEditando) return;
    if (!validarCategoriaEdicao()) return;
    const valorNum = parseFloat(editValor.replace(",", "."));
    if (isNaN(valorNum) || valorNum <= 0) return Alert.alert("Aviso", "Valor inválido.");
    const dataFormatada = `${editData.getFullYear()}-${String(editData.getMonth() + 1).padStart(2, "0")}-${String(editData.getDate()).padStart(2, "0")}`;
    const campos = { valor: valorNum, status: editStatus, categoria_id: editCategoriaId, conta_id: editContaId };

    if (apenasEsta) {
      const descricaoAtualizada = substituirDescricaoBase(transacaoEditando.descricao, editDescricao);
      const { error } = await supabase.from("transacoes").update({ ...campos, descricao: descricaoAtualizada, data_vencimento: dataFormatada }).eq("id", transacaoEditando.id);
      if (error) return Alert.alert("Erro", "Não foi possível salvar as alterações.");
    } else {
      const base = descricaoBase(transacaoEditando.descricao);
      const serieId = getIdSerie(transacaoEditando.descricao);
      const novoBase = descricaoBase(editDescricao);
      const novoDia = editData.getDate();
      const { data: serie } = await supabase.from("transacoes")
        .select("id, descricao, data_vencimento, status")
        .eq("user_id", session.user.id)
        .eq("conta_id", transacaoEditando.conta_id)
        .eq("tipo", transacaoEditando.tipo);
      const itens = (serie ?? []).filter((t) =>
        t.status !== "paga"
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
    const valorNum = parseFloat(editValor.replace(",", "."));
    if (isNaN(valorNum) || valorNum <= 0) return Alert.alert("Aviso", "Valor inválido.");

    if (isRecorrente(transacaoEditando) && transacaoEditando.status !== "paga") {
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
    const atualizacao: { status: string; data_realizacao?: string | null; valor?: number } = {
      status: novoStatus,
      data_realizacao: novoStatus === "pendente" ? null : undefined,
    };
    if (novoStatus === "paga" && data) {
      atualizacao.data_realizacao = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
      const agendada = new Date(`${transacao.data_vencimento}T00:00:00`);
      const realizada = new Date(data); realizada.setHours(0, 0, 0, 0);
      const ajuste = Number(ajusteValor.replace(",", "."));
      if (realizada > agendada && ajusteTipo !== "nenhum" && Number.isFinite(ajuste) && ajuste > 0) {
        atualizacao.valor = ajusteTipo === "juros"
          ? Number(transacao.valor) + ajuste
          : Math.max(0.01, Number(transacao.valor) - ajuste);
      }
    }
    const { error } = await supabase.from("transacoes").update(atualizacao).eq("id", transacao.id);
    if (error) { Alert.alert("Erro", "Não foi possível atualizar o estado."); return; }

    if (transacao) {
      const { movimento, caixinha } = await buscarObjetivoDoMovimento(transacao.descricao);
      if (movimento && caixinha) {
          let novoSaldo = Number(caixinha.saldo_atual);
          if (novoStatus === "paga") {
            novoSaldo = movimento.operacao === "guardar" ? novoSaldo + Number(transacao.valor) : Math.max(0, novoSaldo - Number(transacao.valor));
          } else {
            novoSaldo = movimento.operacao === "guardar" ? Math.max(0, novoSaldo - Number(transacao.valor)) : novoSaldo + Number(transacao.valor);
          }
          await supabase.from("caixinhas").update({ saldo_atual: novoSaldo }).eq("id", caixinha.id);
      }
    }

    carregarDados();
    setTransacaoConfirmar(null);
    setAjusteTipo("nenhum");
    setAjusteValor("");
    const tipo = transacao.tipo;
    if (novoStatus === "paga") {
      const label = isTransferencia(transacao.descricao) || isMovimentoObjetivo(transacao.descricao)
        ? "Transferência concluída ✓"
        : tipo === "receita" ? "Receita recebida ✓" : "Despesa paga ✓";
      showToast(label, transacao.tipo === "receita" ? "success" : "info");
    } else {
      showToast("Marcado como pendente", "info");
    }
  };

  const alternarStatus = async (id: number, statusAtual: string, _tipo: string) => {
    const transacao = transacoes.find((t) => t.id === id);
    if (!transacao) return;
    const conta = contas.find((c) => c.id === transacao.conta_id);
    if (statusAtual !== "paga" && conta?.arquivado) {
      Alert.alert("Conta arquivada", "Reative a conta antes de concluir este lançamento.");
      return;
    }
    if (statusAtual === "paga") {
      aplicarStatus(transacao, "pendente");
      return;
    }
    setDataRealizacao(new Date());
    setAjusteTipo("nenhum");
    setAjusteValor("");
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

  const selecionarFiltroTipo = (tipo: "todas" | "receita" | "despesa" | "transferencia") => {
    setFiltroTipo(tipo);
    setPaginaAtual(1);
    if (tipo === "transferencia") {
      setFiltroCategorias([]);
      return;
    }
    if (tipo === "receita" || tipo === "despesa") {
      const idsCompativeis = new Set(categorias.filter((categoria) => categoria.tipo === tipo || categoria.tipo === "ambos").map((categoria) => categoria.id));
      setFiltroCategorias((atuais) => atuais.filter((id) => idsCompativeis.has(id)));
    }
  };

  const hojeRef = new Date(); hojeRef.setHours(0, 0, 0, 0);
  const limiteProximosSeteDias = new Date(hojeRef);
  limiteProximosSeteDias.setDate(limiteProximosSeteDias.getDate() + 7);
  const chaveHoje = chaveDataLocal(hojeRef);
  const chaveLimiteProximosSeteDias = chaveDataLocal(limiteProximosSeteDias);

  const normalizar = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const termoBusca = normalizar(busca.trim());

  const passaFiltrosBasicosHistorico = (t: Transacao) => {
    const contaDaTransacao = contas.find((conta) => conta.id === t.conta_id);
    if (t.status === "paga" && contaDaTransacao?.arquivado) return false;

    const transferencia = isTransferencia(t.descricao) || isMovimentoObjetivo(t.descricao);
    const passaBusca = !termoBusca || normalizar(t.descricao).includes(termoBusca);
    const passaConta = filtroContas.length === 0 || filtroContas.includes(t.conta_id);
    const passaCategoria = filtroCategorias.length === 0
      || (!transferencia && t.categoria_id !== null && filtroCategorias.includes(t.categoria_id));

    let passaTipo = true;
    if (filtroTipo === "transferencia") passaTipo = transferencia;
    else if (filtroTipo === "receita") passaTipo = t.tipo === "receita" && !transferencia;
    else if (filtroTipo === "despesa") passaTipo = t.tipo === "despesa" && !transferencia;

    return passaConta && passaCategoria && passaTipo && passaBusca;
  };

  const quantidadeAtrasadasNoEscopo = transacoes.filter((t) => {
    const dataSegura = dataEfetivaTransacao(t).slice(0, 10);
    return t.status === "pendente"
      && Boolean(dataSegura)
      && dataSegura < chaveHoje
      && passaFiltrosBasicosHistorico(t);
  }).length;

  const timestampDataLocal = (valor: string) => {
    const [ano, mes, dia] = valor.slice(0, 10).split("-").map(Number);
    if (!ano || !mes || !dia) return Number.NaN;
    return new Date(ano, mes - 1, dia).getTime();
  };
  const hojeTimestamp = hojeRef.getTime();

  const transacoesDoMes = transacoes
    .filter((t) => {
      const dataSegura = dataEfetivaTransacao(t).slice(0, 10);
      const passaFiltrosBasicos = passaFiltrosBasicosHistorico(t);
      if (filtroVencidas) {
        return t.status === "pendente" && Boolean(dataSegura) && dataSegura < chaveHoje && passaFiltrosBasicos;
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
    .sort((a, b) => {
      const dataA = timestampDataLocal(dataEfetivaTransacao(a));
      const dataB = timestampDataLocal(dataEfetivaTransacao(b));
      const distanciaA = Number.isFinite(dataA) ? Math.abs(dataA - hojeTimestamp) : Number.POSITIVE_INFINITY;
      const distanciaB = Number.isFinite(dataB) ? Math.abs(dataB - hojeTimestamp) : Number.POSITIVE_INFINITY;

      if (distanciaA !== distanciaB) return distanciaA - distanciaB;

      const aVencida = Number.isFinite(dataA) && dataA < hojeTimestamp;
      const bVencida = Number.isFinite(dataB) && dataB < hojeTimestamp;
      if (aVencida !== bVencida) return aVencida ? -1 : 1;
      if (dataA !== dataB) return aVencida ? dataB - dataA : dataA - dataB;
      return b.id - a.id;
    });

  const transacoesPaginadas = transacoesDoMes.slice(0, paginaAtual * ITENS_POR_PAGINA);
  const temMais = transacoesPaginadas.length < transacoesDoMes.length;

  const faturaGruposDoMes = faturaGrupos.flatMap((g) => {
    if (filtroProximosSeteDias) return [];
    // Compras no cartão ainda não possuem uma conta bancária associada.
    if (filtroContas.length > 0) return [];
    if (g.mes_fatura !== mesSelecionado) return [];
    if (filtroStatus === "concluidos" && !g.pago) return [];
    if (filtroStatus === "pendentes" && g.pago) return [];
    if (filtroVencidas) {
    const [ano, mes] = g.mes_fatura.split("-").map(Number);
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const vencimento = new Date(ano, mes - 1, Math.min(g.dia_vencimento, ultimoDia));
      if (g.pago || vencimento >= hojeRef) return [];
    }
    let itensEncontrados = g.itens;
    if (filtroCategorias.length > 0) {
      itensEncontrados = itensEncontrados.filter((item) =>
        item.categoria_id !== null && filtroCategorias.includes(item.categoria_id),
      );
    }
    if (termoBusca) {
      itensEncontrados = itensEncontrados.filter((item) => normalizar(item.descricao).includes(termoBusca));
    }
    if (!termoBusca && filtroCategorias.length === 0) return [g];
    if (itensEncontrados.length === 0) return [];
    return [{
      ...g,
      total: itensEncontrados.reduce((total, item) => total + item.valor, 0),
      filtrada: true,
    }];
  });

  const totalReceitas = transacoesDoMes
    .filter((t) => t.tipo === "receita" && !isTransferencia(t.descricao) && !isMovimentoObjetivo(t.descricao))
    .reduce((acc, t) => acc + t.valor, 0);
  const totalDespesas = transacoesDoMes
    .filter((t) => t.tipo === "despesa" && !isTransferencia(t.descricao) && !isMovimentoObjetivo(t.descricao))
    .reduce((acc, t) => acc + t.valor, 0);

  const temFiltroAtivo = mesSelecionado !== mesAtualChave
    || filtroContas.length > 0
    || filtroCategorias.length > 0
    || filtroTipo !== "todas"
    || filtroVencidas
    || filtroProximosSeteDias
    || filtroStatus !== "todos";
  const categoriasReceitaVisiveis = categorias.filter((categoria) => categoria.ativa !== 0 && (categoria.tipo === "receita" || (filtroTipo === "receita" && categoria.tipo === "ambos")));
  const categoriasDespesaVisiveis = categorias.filter((categoria) => categoria.ativa !== 0 && (categoria.tipo === "despesa" || (filtroTipo === "despesa" && categoria.tipo === "ambos")));
  const categoriasAmbasVisiveis = categorias.filter((categoria) => categoria.ativa !== 0 && categoria.tipo === "ambos");
  const limparFiltros = () => {
    setAnoSelecionado(anoAtualNum);
    setMesSelecionado(mesAtualChave);
    setFiltroContas([]);
    setFiltroCategorias([]);
    setFiltroTipo("todas");
    setFiltroVencidas(false);
    setFiltroProximosSeteDias(false);
    setFiltroStatus("todos");
    setBusca("");
    setPaginaAtual(1);
  };
  const resumoFiltroTipo = filtroTipo === "todas" ? "Todos" : filtroTipo === "receita" ? "Receitas" : filtroTipo === "despesa" ? "Despesas" : "Transferências";
  const resumoFiltroContas = filtroContas.length === 0
    ? "Todas"
    : filtroContas.length === 1
      ? contas.find((conta) => conta.id === filtroContas[0])?.nome ?? "1 conta"
      : `${filtroContas.length} contas`;
  const resumoFiltroCategorias = filtroTipo === "transferencia"
    ? "Não se aplica"
    : filtroCategorias.length === 0
      ? "Todas"
      : filtroCategorias.length === 1
        ? categorias.find((categoria) => categoria.id === filtroCategorias[0])?.nome ?? "1 categoria"
        : `${filtroCategorias.length} categorias`;
  const tituloPeriodo = filtroProximosSeteDias
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
  const onScrollHistorico = Animated.event(
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
        scrollEventThrottle={16}
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
          const ativo = !filtroProximosSeteDias && (item.key === "atrasados" ? filtroVencidas : (!filtroVencidas && filtroStatus === item.key));
          return (
            <TouchableOpacity
              key={item.key}
              onPress={() => {
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
            style={[styles.mainFilterButton, { backgroundColor: filtroTipo !== "todas" ? "#F4A26114" : Cores.pillFundo, borderColor: filtroTipo !== "todas" ? "#F4A261" : Cores.borda }]}
            onPress={() => setModalFiltroTipo(true)}
            accessibilityLabel={`Filtrar por tipo. Seleção atual: ${resumoFiltroTipo}`}
          >
            <View style={styles.mainFilterLabelRow}>
              <MaterialIcons name="swap-vert" size={15} color={filtroTipo !== "todas" ? "#F4A261" : Cores.textoSecundario} />
              <Text style={[styles.mainFilterLabel, { color: Cores.textoSecundario }]}>TIPO</Text>
            </View>
            <Text style={[styles.mainFilterValue, { color: filtroTipo !== "todas" ? "#D98324" : Cores.textoPrincipal }]} numberOfLines={1}>{resumoFiltroTipo}</Text>
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
            disabled={filtroTipo === "transferencia"}
            style={[styles.mainFilterButton, { backgroundColor: filtroCategorias.length > 0 ? "#2A9D8F14" : Cores.pillFundo, borderColor: filtroCategorias.length > 0 ? "#2A9D8F" : Cores.borda, opacity: filtroTipo === "transferencia" ? 0.48 : 1 }]}
            onPress={() => setModalFiltroCat(true)}
            accessibilityLabel={`Filtrar por categoria. Seleção atual: ${resumoFiltroCategorias}`}
          >
            <View style={styles.mainFilterLabelRow}>
              <MaterialIcons name={filtroTipo === "transferencia" ? "label-off" : "label"} size={15} color={filtroCategorias.length > 0 ? "#2A9D8F" : Cores.textoSecundario} />
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
            {transacoesDoMes.length > 0 && (
              <Text style={[styles.contadorText, { color: Cores.textoSecundario }]}>
                {transacoesDoMes.length} registro{transacoesDoMes.length !== 1 ? "s" : ""}
              </Text>
            )}
          </View>

          {transacoesDoMes.length === 0 ? (
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
            transacoesPaginadas.map((t, index) => {
              const conta = contas.find((c) => c.id === t.conta_id);
              const categoria = categorias.find((c) => c.id === t.categoria_id);
              const estiloConta = conta ? getEstiloBanco(conta.nome, isDark) : { bg: isDark ? "#333" : "#E3F2FD", text: isDark ? "#FFF" : "#1976D2" };
              const dataEfetiva = dataEfetivaTransacao(t) || "0000-00-00";
              const partes = dataEfetiva.split("-");
              const isPendente = t.status === "pendente";
              const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
              const dataT = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
              const isVencida = isPendente && dataT < hoje;
              const transferencia = isTransferencia(t.descricao) || isMovimentoObjetivo(t.descricao);
              const corValor = transferencia ? "#F4A261" : t.tipo === "receita" ? "#2A9D8F" : "#E76F51";
              const prefixoValor = t.tipo === "receita" ? "+" : "-";
              const bgRow = index % 2 === 0 ? Cores.rowImpar : Cores.rowPar;
              const corStatus = isVencida ? "#DC2626" : "#F59E0B";
              const textoStatus = isVencida ? "Vencida" : t.tipo === "receita" ? "A receber" : "A pagar";
              const dataAnterior = index > 0 ? dataEfetivaTransacao(transacoesPaginadas[index - 1]) : null;
              const mostrarCabecalhoDia = index === 0 || dataAnterior !== dataEfetiva;
              const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
              const chaveHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
              const chaveOntem = `${ontem.getFullYear()}-${String(ontem.getMonth() + 1).padStart(2, "0")}-${String(ontem.getDate()).padStart(2, "0")}`;
              const rotuloDia = dataEfetiva === chaveHoje
                ? "Hoje"
                : dataEfetiva === chaveOntem
                  ? "Ontem"
                  : `${partes[2]} ${getNomeMes(partes[1])?.substring(0, 3)}`;

              return (
                <React.Fragment key={t.id}>
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
                  onPress={() => setTransacaoDetalhe(t)}
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
                      {prefixoValor} {fmtReais(t.valor)}
                    </Text>
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
                Ver mais ({transacoesDoMes.length - transacoesPaginadas.length} restantes)
              </Text>
            </TouchableOpacity>
          )}

          {/* ─── Faturas de Cartão do Mês (oculto no filtro de receita) ─── */}
          {faturaGruposDoMes.length > 0 && (filtroTipo === "todas" || filtroTipo === "despesa") && (
            <>
              <View style={[styles.faturaSecHeader, { backgroundColor: isDark ? "#252525" : "#F3F4F6", borderColor: Cores.borda }]}>
                <MaterialIcons name="credit-card" size={14} color={Cores.textoSecundario} />
                <Text style={[styles.faturaSecLabel, { color: Cores.textoSecundario }]}>Faturas de Cartão</Text>
              </View>
              {faturaGruposDoMes.map((g) => (
                <TouchableOpacity
                  key={`${g.cartao_id}_${g.mes_fatura}`}
                  style={[styles.transacaoCard, {
                    backgroundColor: Cores.rowImpar,
                    borderBottomColor: Cores.borda,
                    borderLeftWidth: 3,
                    borderLeftColor: g.cartao_cor,
                  }]}
                  onPress={() => {
                    if (g.filtrada) return;
                    if (g.pago) {
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
                    <View style={[{ backgroundColor: g.cartao_cor + "22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: "flex-start", marginBottom: 4 }]}>
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
              ))}
            </>
          )}

          {/* Rodapé */}
          {transacoesDoMes.length > 0 && (
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
        const concluida = t.status === "paga";
        return (
          <Modal animationType="fade" transparent visible onRequestClose={() => setTransacaoDetalhe(null)}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, borderTopWidth: 4, borderTopColor: transferencia ? "#F4A261" : t.tipo === "receita" ? "#2A9D8F" : "#E76F51" }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalTitle, { color: Cores.textoPrincipal, textAlign: "left", marginBottom: 4 }]}>Detalhes do lançamento</Text>
                    <Text style={{ color: Cores.textoSecundario, fontSize: 13 }}>{descricaoVisivel(t.descricao)}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setTransacaoDetalhe(null)} style={{ padding: 6 }}>
                    <MaterialIcons name="close" size={24} color={Cores.textoSecundario} />
                  </TouchableOpacity>
                </View>
                <View style={{ backgroundColor: Cores.blocoData, borderRadius: 12, padding: 14, gap: 10 }}>
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Valor</Text><Text style={{ color: t.tipo === "receita" ? "#2A9D8F" : "#E76F51", fontWeight: "800" }}>{fmtReais(t.valor)}</Text></View>
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Status</Text><Text style={{ color: concluida ? "#2A9D8F" : "#F59E0B", fontWeight: "700" }}>{concluida ? "Concluído" : "Pendente"}</Text></View>
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Data agendada</Text><Text style={{ color: Cores.textoPrincipal }}>{t.data_vencimento.split("-").reverse().join("/")}</Text></View>
                  {t.data_realizacao && <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Data realizada</Text><Text style={{ color: Cores.textoPrincipal }}>{t.data_realizacao.split("-").reverse().join("/")}</Text></View>}
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Conta</Text><Text style={{ color: Cores.textoPrincipal }}>{conta?.nome ?? "Não informada"}</Text></View>
                  {destino && <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Destino</Text><Text style={{ color: Cores.textoPrincipal }}>{destino.nome}</Text></View>}
                  {categoria && <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Categoria</Text><Text style={{ color: categoria.cor, fontWeight: "700" }}>{categoria.nome}</Text></View>}
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Tipo</Text><Text style={{ color: Cores.textoPrincipal }}>{transferencia ? "Transferência" : t.tipo === "receita" ? "Receita" : "Despesa"}</Text></View>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 18, gap: 10 }}>
                  <TouchableOpacity style={[styles.detalheAcao, { backgroundColor: "#457B9D22" }]} onPress={() => { setTransacaoDetalhe(null); abrirEditarTransacao(t); }}>
                    <MaterialIcons name="edit" size={20} color="#457B9D" /><Text style={{ color: "#457B9D", fontWeight: "700" }}>Editar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.detalheAcao, { backgroundColor: "#2A9D8F22" }]} onPress={() => { setTransacaoDetalhe(null); alternarStatus(t.id, t.status, t.tipo); }}>
                    <MaterialIcons name={concluida ? "undo" : "check-circle"} size={20} color="#2A9D8F" /><Text style={{ color: "#2A9D8F", fontWeight: "700" }}>{concluida ? "Reabrir" : "Concluir"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.detalheAcao, { backgroundColor: "#E76F5122" }]} onPress={() => { setTransacaoDetalhe(null); deletarTransacao(t.id); }}>
                    <MaterialIcons name="delete-outline" size={20} color="#E76F51" /><Text style={{ color: "#E76F51", fontWeight: "700" }}>Excluir</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        );
      })()}

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
                A fatura de {faturaEstornar.cartao_nome} — {formatarMesAno(faturaEstornar.mes_fatura)} voltará a ficar em aberto.
              </Text>
              <TouchableOpacity style={{ backgroundColor: "#F59E0B", minHeight: 50, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 9 }} onPress={async () => {
                const g = faturaEstornar;
                setFaturaEstornar(null);
                const descricao = `Fatura ${g.cartao_nome} - ${formatarMesAno(g.mes_fatura)}`;
                await Promise.all([
                  supabase.from("fatura_itens").update({ pago: false }).in("id", g.itens_ids),
                  supabase.from("transacoes").delete().eq("user_id", session!.user.id).like("descricao", `${descricao}%`),
                ]);
                carregarDados();
              }}>
                <Text style={{ color: "#FFF", fontWeight: "800" }}>Confirmar estorno</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ backgroundColor: Cores.pillFundo, minHeight: 48, borderRadius: 11, alignItems: "center", justifyContent: "center" }} onPress={() => setFaturaEstornar(null)}>
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
                  onChange={(_e, d) => { setMostrarDataRealizacao(false); if (d) setDataRealizacao(d); }}
                />
              )}
              {dataRealizacao > new Date(`${transacaoConfirmar.data_vencimento}T23:59:59`) && (
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
                      <TouchableOpacity key={tipo} onPress={() => { setAjusteTipo(tipo); if (tipo === "nenhum") setAjusteValor(""); }} style={{ flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center", backgroundColor: ajusteTipo === tipo ? (tipo === "desconto" ? "#2A9D8F" : tipo === "juros" ? "#E76F51" : "#68727D") : Cores.cardFundo }}>
                        <Text style={{ color: ajusteTipo === tipo ? "#FFF" : Cores.textoSecundario, fontSize: 12, fontWeight: "700" }}>{tipo === "nenhum" ? "Sem ajuste" : tipo === "juros" ? "Juros" : "Desconto"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {ajusteTipo !== "nenhum" && (
                    <View style={[styles.editInput, { marginTop: 10, marginBottom: 0, backgroundColor: Cores.cardFundo, borderColor: Cores.borda, flexDirection: "row", alignItems: "center" }]}>
                      <Text style={{ color: Cores.textoSecundario, marginRight: 6 }}>R$</Text>
                      <TextInput value={ajusteValor} onChangeText={setAjusteValor} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={Cores.textoSecundario} style={{ color: Cores.textoPrincipal, flex: 1 }} />
                    </View>
                  )}
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 10, alignItems: "center", backgroundColor: Cores.blocoData }} onPress={() => setTransacaoConfirmar(null)}>
                  <Text style={{ color: Cores.textoSecundario, fontWeight: "bold" }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 10, alignItems: "center", backgroundColor: "#2A9D8F" }} onPress={() => aplicarStatus(transacaoConfirmar, "paga", dataRealizacao)}>
                  <Text style={{ color: "#FFF", fontWeight: "bold" }}>Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAIS DE FILTRO */}
      {/* MODAL EDITAR TRANSAÇÃO */}
      <Modal animationType="slide" transparent visible={modalEditarTransVisivel} onRequestClose={() => setModalEditarTransVisivel(false)}>
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
                  onValueChange={(v) => setEditStatus(v ? "paga" : "pendente")}
                  trackColor={{ false: "#767577", true: "#2A9D8F" }}
                />
              </View>

              {/* Descrição */}
              <TextInput
                style={[styles.editInput, { backgroundColor: isDark ? "#2C2C2C" : "#F5F5F5", color: isDark ? "#FFF" : "#1A1A1A", borderColor: isDark ? "#444" : "#DDD" }]}
                placeholder="Descrição"
                placeholderTextColor={isDark ? "#888" : "#AAA"}
                value={editDescricao}
                onChangeText={setEditDescricao}
              />

              {/* Valor */}
              <View style={[styles.editInput, { backgroundColor: isDark ? "#2C2C2C" : "#F5F5F5", borderColor: isDark ? "#444" : "#DDD", flexDirection: "row", alignItems: "center" }]}>
                <Text style={{ color: isDark ? "#888" : "#AAA", fontSize: 15, marginRight: 4 }}>R$</Text>
                <TextInput
                  style={{ flex: 1, color: isDark ? "#FFF" : "#1A1A1A", fontSize: 15 }}
                  placeholder="0,00"
                  placeholderTextColor={isDark ? "#888" : "#AAA"}
                  value={editValor}
                  onChangeText={setEditValor}
                  keyboardType="decimal-pad"
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
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalDeleteSimples(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: isDark ? "#1E1E1E" : "#FFF", borderTopWidth: 3, borderTopColor: "#E76F51" }]}>
              <View style={{ alignItems: "center", marginBottom: 12 }}>
                <MaterialIcons name="delete-outline" size={36} color="#E76F51" />
              </View>
              <Text style={[styles.modalTitle, { color: isDark ? "#FFF" : "#1A1A1A" }]}>Excluir</Text>
              <Text style={{ color: isDark ? "#AAA" : "#555", textAlign: "center", marginBottom: 24, fontSize: 14 }}>
                Tem certeza que deseja apagar esta transação?
              </Text>
              <TouchableOpacity
                style={{ paddingVertical: 13, borderRadius: 10, alignItems: "center", backgroundColor: "#E76F51", marginBottom: 10 }}
                onPress={() => { const t = modalDeleteSimples; setModalDeleteSimples(null); executarDeleteUma(t); }}
              >
                <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>Apagar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ paddingVertical: 13, borderRadius: 10, alignItems: "center", backgroundColor: isDark ? "#2C2C2C" : "#F0F0F0" }}
                onPress={() => setModalDeleteSimples(null)}
              >
                <Text style={{ color: isDark ? "#AAA" : "#666", fontWeight: "bold" }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      <Modal animationType="fade" transparent visible={modalFiltroAno} onRequestClose={() => setModalFiltroAno(false)}>
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

      <Modal animationType="fade" transparent visible={modalFiltroTipo} onRequestClose={() => setModalFiltroTipo(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda, borderWidth: 1 }]}>
            <View style={styles.filterModalHeader}>
              <View style={[styles.filterModalHeaderIcon, { backgroundColor: "#F4A2611F" }]}><MaterialIcons name="swap-vert" size={22} color="#F4A261" /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.filterModalTitle, { color: Cores.textoPrincipal }]}>Tipo de lançamento</Text>
                <Text style={[styles.filterModalSubtitle, { color: Cores.textoSecundario }]}>Escolha uma opção para refinar o histórico.</Text>
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
              ].map((op) => {
                const isAtivo = filtroTipo === op.key;
                return (
                  <TouchableOpacity key={op.key} style={[styles.filterModalOption, { backgroundColor: isAtivo ? op.bgAtivo : Cores.pillFundo, borderColor: isAtivo ? op.bgAtivo : Cores.borda }]} onPress={() => selecionarFiltroTipo(op.key)}>
                    <MaterialIcons name={op.icon} size={18} color={isAtivo ? "#FFF" : op.bgAtivo} />
                    <Text style={[styles.filterModalOptionText, { color: isAtivo ? "#FFF" : Cores.textoPrincipal }]} numberOfLines={1}>{op.label}</Text>
                    <MaterialIcons name={isAtivo ? "check-circle" : "radio-button-unchecked"} size={18} color={isAtivo ? "#FFF" : Cores.textoSecundario} />
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

      <Modal animationType="fade" transparent visible={modalFiltroConta} onRequestClose={() => setModalFiltroConta(false)}>
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

      <Modal animationType="fade" transparent visible={modalFiltroCat} onRequestClose={() => setModalFiltroCat(false)}>
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
              {(filtroTipo === "todas" || filtroTipo === "receita") && categoriasReceitaVisiveis.length > 0 && (
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
              {(filtroTipo === "todas" || filtroTipo === "despesa") && categoriasDespesaVisiveis.length > 0 && (
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

              {filtroTipo === "todas" && categoriasAmbasVisiveis.length > 0 && (
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
  faturaSecHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: 1, borderBottomWidth: 1 },
  faturaSecLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: "700" },
  contaTag: { fontSize: 11, fontWeight: "700" },
  transacaoDesc: { fontSize: 13, fontWeight: "600" },
  transacaoValor: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  detalheLinha: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  detalheAcao: { flex: 1, minHeight: 54, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 3 },
});
