import { MaterialIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
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
import {
  descricaoBaseRecorrencia,
  descricaoVisivel,
  dataEfetivaTransacao,
  getContaDestinoTransferencia,
  isRecorrenciaFixa,
  isTransferencia,
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
  dia_vencimento: number;
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

export default function TransacoesScreen() {
  const { isDark, session, showToast } = useAppTheme();
  const router = useRouter();

  const Cores = {
    fundo: isDark ? "#121212" : "#F5F2EC",
    textoPrincipal: isDark ? "#ffffff" : "#27313A",
    textoSecundario: isDark ? "#AAAAAA" : "#68727D",
    cardFundo: isDark ? "#1E1E1E" : "#FFFDF9",
    blocoData: isDark ? "#2C2C2C" : "#EEEAE3",
    borda: isDark ? "#333333" : "#E5DED3",
    pillFundo: isDark ? "#2C2C2C" : "#EEEAE3",
    headerTabela: isDark ? "#252525" : "#EDE8E0",
    rowPar: isDark ? "#161616" : "#FAF8F4",
    rowImpar: isDark ? "#1C1C1C" : "#FFFDF9",
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
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "concluidos" | "pendentes">("todos");
  const [busca, setBusca] = useState("");
  const [paginaAtual, setPaginaAtual] = useState(1);
  const ITENS_POR_PAGINA = 30;

  const [modalFiltroConta, setModalFiltroConta] = useState(false);
  const [modalFiltroCat, setModalFiltroCat] = useState(false);
  const [modalFiltroTipo, setModalFiltroTipo] = useState(false);

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
  const mesAtualIdx = hoje.getMonth();
  const [anoSelecionado, setAnoSelecionado] = useState<number>(anoAtualNum);
  const [mesSelecionado, setMesSelecionado] = useState<string>(
    `${anoAtualNum}-${String(hoje.getMonth() + 1).padStart(2, "0")}`
  );
  const mesesScrollRef = useRef<any>(null);

  const alterarAno = (direcao: number) => {
    const novoAno = anoSelecionado + direcao;
    setAnoSelecionado(novoAno);
    const mesNum = mesSelecionado.split("-")[1];
    setMesSelecionado(`${novoAno}-${mesNum}`);
  };

  const carregarDados = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const [resCategorias, resContas, resTransacoes, resCartoes, resFaturas] = await Promise.all([
        supabase.from("categorias").select("*").eq("user_id", session.user.id),
        supabase.from("contas").select("*"),
        supabase.from("transacoes").select("*"),
        supabase.from("cartoes").select("id, nome, cor, dia_vencimento").eq("user_id", session.user.id).eq("ativo", true),
        supabase.from("fatura_itens").select("id, cartao_id, valor, mes_fatura, pago").eq("user_id", session.user.id),
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
              dia_vencimento: cartaoMap[item.cartao_id]?.dia_vencimento ?? 1,
            };
          }
          grupos[key].total += Number(item.valor);
          if (!item.pago) grupos[key].pago = false;
          grupos[key].itens_ids.push(item.id);
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
    // Scroll para o mês atual ao entrar na aba
    setTimeout(() => {
      mesesScrollRef.current?.scrollTo({ x: mesAtualIdx * 72, animated: true });
    }, 150);
  }, [carregarDados, mesAtualIdx]));

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

    const descricao = transacao.descricao ?? "";
    let nomeCaixinha: string | null = null;
    let operacao: "reverter_guardar" | "reverter_resgatar" | null = null;

    if (descricao.startsWith("Guardar em: ")) { nomeCaixinha = descricao.replace("Guardar em: ", "").trim(); operacao = "reverter_guardar"; }
    else if (descricao.startsWith("Resgate de: ")) { nomeCaixinha = descricao.replace("Resgate de: ", "").trim(); operacao = "reverter_resgatar"; }

    if (transacao.status === "paga" && nomeCaixinha && operacao) {
      const { data: caixinhaData } = await supabase.from("caixinhas").select("id, saldo_atual").ilike("nome", nomeCaixinha).single();
      if (caixinhaData) {
        const novoSaldo = operacao === "reverter_guardar"
          ? Math.max(0, Number(caixinhaData.saldo_atual) - Number(transacao.valor))
          : Number(caixinhaData.saldo_atual) + Number(transacao.valor);
        await supabase.from("caixinhas").update({ saldo_atual: novoSaldo }).eq("id", caixinhaData.id);
      }
    }
    carregarDados();
  };

  const deletarFuturas = async (transacao: Transacao) => {
    const desc = transacao.descricao ?? "";
    const isFixa = isRecorrenciaFixa(desc);
    const parceladaMatch = desc.match(/^(.+) \((\d+)\/(\d+)\)$/);
    if (isFixa) {
      const { error } = await supabase.from("transacoes")
        .delete()
        .eq("user_id", session.user.id)
        .eq("descricao", desc)
        .gte("data_vencimento", transacao.data_vencimento)
        .neq("status", "paga");
      if (error) Alert.alert("Erro", "Não foi possível apagar.");
    } else if (parceladaMatch) {
      const base = parceladaMatch[1];
      const currentNum = parseInt(parceladaMatch[2]);
      const totalStr = parceladaMatch[3];
      const ids = transacoes
        .filter((t) => {
          const m = t.descricao.match(/^(.+) \((\d+)\/(\d+)\)$/);
          return m && m[1] === base && m[3] === totalStr && parseInt(m[2]) >= currentNum && t.status !== "paga";
        })
        .map((t) => t.id);
      if (ids.length > 0) {
        const { error } = await supabase.from("transacoes").delete().in("id", ids);
        if (error) Alert.alert("Erro", "Não foi possível apagar.");
      }
    }
    carregarDados();
  };

  const deletarSerie = async (base: string, tipo: "fixa" | "parcelada", totalParcelas?: string) => {
    if (tipo === "fixa") {
      const dataCorte = `${mesSelecionado}-01`;
      const idsParaDeletar = transacoes
        .filter((t) => isRecorrenciaFixa(t.descricao) && descricaoBaseRecorrencia(t.descricao) === base && t.data_vencimento >= dataCorte && t.status !== "paga")
        .map((t) => t.id);
      const { error } = idsParaDeletar.length
        ? await supabase.from("transacoes").delete().in("id", idsParaDeletar)
        : { error: null };
      if (error) Alert.alert("Erro", "Não foi possível apagar a série.");
    } else {
      const idsParaDeletar = transacoes
        .filter((t) => {
          const m = t.descricao.match(/^(.+) \(\d+\/(\d+)\)$/);
          return m && m[1] === base && m[2] === totalParcelas && t.status !== "paga";
        })
        .map((t) => t.id);
      if (idsParaDeletar.length === 0) return;
      const { error } = await supabase.from("transacoes").delete().in("id", idsParaDeletar);
      if (error) Alert.alert("Erro", "Não foi possível apagar a série.");
    }
    carregarDados();
  };

  const deletarTransacao = (id: number) => {
    const transacao = transacoes.find((t) => t.id === id);
    if (!transacao) return;

    const descricao = transacao.descricao ?? "";
    const isFixa = isRecorrenciaFixa(descricao);
    const parceladaMatch = descricao.match(/^(.+) \((\d+)\/(\d+)\)$/);

    if (transacao.status !== "paga" && (isFixa || parceladaMatch)) {
      setModalOpcoesSerie({
        titulo: "Apagar Agendamento",
        descricao: "Esta transação faz parte de uma série. O que deseja apagar?",
        labelSimples: "Apenas esta",
        // Parceladas: "Esta e as próximas" | Recorrentes: "Toda a série"
        ...(parceladaMatch ? {
          labelFuturas: "Esta e as próximas",
          onFuturas: () => { setModalOpcoesSerie(null); deletarFuturas(transacao); },
        } : {
          labelSerie: "Toda a série",
          corSerie: "#E76F51",
          onSerie: () => {
            setModalOpcoesSerie(null);
            const base = descricaoBaseRecorrencia(descricao);
            deletarSerie(base, "fixa");
          },
        }),
        onSimples: () => { setModalOpcoesSerie(null); executarDeleteUma(transacao); },
      });
    } else {
      setModalDeleteSimples(transacao);
    }
  };

  const isRecorrente = (t: Transacao) =>
    isRecorrenciaFixa(t.descricao) || /\(\d+\/\d+\)(?:\s*\[Destino:\d+\])?$/.test(t.descricao);

  const descricaoBase = (desc: string) =>
    descricaoBaseRecorrencia(desc);

  const abrirEditarTransacao = (t: Transacao) => {
    setTransacaoEditando(t);
    setEditDescricao(isRecorrente(t) ? descricaoBase(t.descricao) : t.descricao);
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
    const valorNum = parseFloat(editValor.replace(",", "."));
    if (isNaN(valorNum) || valorNum <= 0) return Alert.alert("Aviso", "Valor inválido.");
    const dataFormatada = `${editData.getFullYear()}-${String(editData.getMonth() + 1).padStart(2, "0")}-${String(editData.getDate()).padStart(2, "0")}`;
    const campos = { valor: valorNum, status: editStatus, categoria_id: editCategoriaId, conta_id: editContaId };

    if (apenasEsta) {
      const { error } = await supabase.from("transacoes").update({ ...campos, descricao: editDescricao, data_vencimento: dataFormatada }).eq("id", transacaoEditando.id);
      if (error) return Alert.alert("Erro", "Não foi possível salvar as alterações.");
    } else {
      const base = descricaoBase(transacaoEditando.descricao);
      const novoBase = descricaoBase(editDescricao);
      const novoDia = editData.getDate();
      const { data: serie } = await supabase.from("transacoes")
        .select("id, descricao, data_vencimento, status")
        .eq("user_id", session.user.id)
        .eq("conta_id", transacaoEditando.conta_id)
        .eq("tipo", transacaoEditando.tipo);
      const itens = (serie ?? []).filter((t) => descricaoBase(t.descricao) === base && t.status !== "paga");
      const resultados = await Promise.all(
        itens.map((item) => {
          const partes = (item.data_vencimento || dataFormatada).split("-");
          const ano = parseInt(partes[0]);
          const mes = parseInt(partes[1]) - 1;
          const diasNoMes = new Date(ano, mes + 1, 0).getDate();
          const diaFinal = Math.min(novoDia, diasNoMes);
          const novaData = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(diaFinal).padStart(2, "0")}`;
          const sufixo = item.descricao.slice(descricaoBase(item.descricao).length);
          const novaDescricao = novoBase + sufixo;
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
      const desc = transacao.descricao ?? "";
      let nomeCaixinha: string | null = null;
      let operacao: "guardar" | "resgatar" | null = null;
      if (desc.startsWith("Guardar em: ")) { nomeCaixinha = desc.replace("Guardar em: ", "").trim(); operacao = "guardar"; }
      else if (desc.startsWith("Resgate de: ")) { nomeCaixinha = desc.replace("Resgate de: ", "").trim(); operacao = "resgatar"; }
      if (nomeCaixinha && operacao) {
        const { data: caixinhaData } = await supabase.from("caixinhas").select("id, saldo_atual").ilike("nome", nomeCaixinha).single();
        if (caixinhaData) {
          let novoSaldo = Number(caixinhaData.saldo_atual);
          if (novoStatus === "paga") {
            novoSaldo = operacao === "guardar" ? novoSaldo + Number(transacao.valor) : Math.max(0, novoSaldo - Number(transacao.valor));
          } else {
            novoSaldo = operacao === "guardar" ? Math.max(0, novoSaldo - Number(transacao.valor)) : novoSaldo + Number(transacao.valor);
          }
          await supabase.from("caixinhas").update({ saldo_atual: novoSaldo }).eq("id", caixinhaData.id);
        }
      }
    }

    carregarDados();
    setTransacaoConfirmar(null);
    setAjusteTipo("nenhum");
    setAjusteValor("");
    const tipo = transacao.tipo;
    if (novoStatus === "paga") {
      const label = tipo === "receita" ? "Receita recebida ✓" : "Despesa paga ✓";
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

  const hojeRef = new Date(); hojeRef.setHours(0, 0, 0, 0);

  const normalizar = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const termoBusca = normalizar(busca.trim());

  const transacoesDoMes = transacoes
    .filter((t) => {
      const contaDaTransacao = contas.find((conta) => conta.id === t.conta_id);
      if (t.status === "paga" && contaDaTransacao?.arquivado) return false;
      const passaBusca = !termoBusca || normalizar(t.descricao).includes(termoBusca);
      if (filtroVencidas) {
        const p = (dataEfetivaTransacao(t) || "0000-00-00").split("-");
        const d = new Date(+p[0], +p[1] - 1, +p[2]);
        return t.status === "pendente" && d < hojeRef && passaBusca;
      }
      const passaConta = filtroContas.length === 0 || filtroContas.includes(t.conta_id);
      const dataSegura = dataEfetivaTransacao(t) || new Date().toISOString().split("T")[0];
      const passaMes = dataSegura.startsWith(mesSelecionado);
      const isTransferencia = t.descricao.includes("[Transf.]");
      const passaCategoria = filtroCategorias.length === 0
        || isTransferencia
        || (t.categoria_id !== null && filtroCategorias.includes(t.categoria_id));
      let passaTipo = true;
      if (filtroTipo === "transferencia") passaTipo = isTransferencia;
      else if (filtroTipo === "receita") passaTipo = t.tipo === "receita" && !isTransferencia;
      else if (filtroTipo === "despesa") passaTipo = t.tipo === "despesa" && !isTransferencia;
      let passaStatus = true;
      if (filtroStatus === "concluidos") passaStatus = t.status === "paga";
      else if (filtroStatus === "pendentes") passaStatus = t.status === "pendente";
      return passaConta && passaCategoria && passaMes && passaTipo && passaStatus && passaBusca;
    })
    .sort((a, b) => dataEfetivaTransacao(b).localeCompare(dataEfetivaTransacao(a)));

  const transacoesPaginadas = transacoesDoMes.slice(0, paginaAtual * ITENS_POR_PAGINA);
  const temMais = transacoesPaginadas.length < transacoesDoMes.length;

  const faturaGruposDoMes = faturaGrupos.filter((g) => {
    if (g.mes_fatura !== mesSelecionado) return false;
    if (filtroStatus === "concluidos" && !g.pago) return false;
    if (filtroStatus === "pendentes" && g.pago) return false;
    if (!filtroVencidas) return true;
    const [ano, mes] = g.mes_fatura.split("-").map(Number);
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const vencimento = new Date(ano, mes - 1, Math.min(g.dia_vencimento, ultimoDia));
    return !g.pago && vencimento < hojeRef;
  });

  const totalReceitas = transacoesDoMes
    .filter((t) => t.tipo === "receita" && !t.descricao.includes("[Transf.]"))
    .reduce((acc, t) => acc + t.valor, 0);
  const totalDespesas = transacoesDoMes
    .filter((t) => t.tipo === "despesa" && !t.descricao.includes("[Transf.]"))
    .reduce((acc, t) => acc + t.valor, 0);

  const mesesDoAno = Array.from({ length: 12 }, (_, i) => `${anoSelecionado}-${String(i + 1).padStart(2, "0")}`);

  const temVencidas = transacoes.some(t => {
    if (t.status !== "pendente") return false;
    const p = (dataEfetivaTransacao(t) || "0000-00-00").split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]) < hojeRef;
  });
  const temFiltroAtivo = filtroContas.length > 0 || filtroCategorias.length > 0 || filtroTipo !== "todas" || filtroVencidas || filtroStatus !== "todos";
  const limparFiltros = () => {
    setFiltroContas([]); setFiltroCategorias([]); setFiltroTipo("todas"); setFiltroVencidas(false); setFiltroStatus("todos"); setBusca(""); setPaginaAtual(1);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: Cores.fundo }]}>
      {/* CABEÇALHO */}
      <View style={[styles.header, { backgroundColor: Cores.fundo }]}>
        <Text style={[styles.title, { color: Cores.textoPrincipal }]}>Extrato</Text>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", marginLeft: 10 }}>
          <TextInput
            value={busca}
            onChangeText={(t) => { setBusca(t); setPaginaAtual(1); }}
            placeholder="Buscar..."
            placeholderTextColor={Cores.textoSecundario}
            style={{ flex: 1, backgroundColor: Cores.pillFundo, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, color: Cores.textoPrincipal, fontSize: 13 }}
          />
          {busca.length > 0 && (
            <TouchableOpacity onPress={() => setBusca("")} style={{ padding: 4, marginLeft: 4 }}>
              <MaterialIcons name="close" size={16} color={Cores.textoSecundario} />
            </TouchableOpacity>
          )}
        </View>
        {temVencidas && (
          <TouchableOpacity
            onPress={() => { setFiltroVencidas(!filtroVencidas); setPaginaAtual(1); }}
            style={{ padding: 6, marginLeft: 4, borderRadius: 20, backgroundColor: filtroVencidas ? "#E76F5133" : "transparent" }}
          >
            <MaterialIcons name={filtroVencidas ? "close" : "warning"} size={24} color="#E76F51" />
          </TouchableOpacity>
        )}
      </View>

      {/* NAVEGADOR DE ANO */}
      <View style={[styles.anoNavBar, { backgroundColor: Cores.pillFundo }]}>
        <TouchableOpacity onPress={() => alterarAno(-1)} style={styles.anoNavBtn}>
          <MaterialIcons name="chevron-left" size={28} color={Cores.textoPrincipal} />
        </TouchableOpacity>
        <Text style={[styles.anoNavText, { color: Cores.textoPrincipal }]}>{anoSelecionado}</Text>
        <TouchableOpacity onPress={() => alterarAno(1)} style={styles.anoNavBtn}>
          <MaterialIcons name="chevron-right" size={28} color={Cores.textoPrincipal} />
        </TouchableOpacity>
      </View>

      {/* FILTROS */}
      <View style={styles.filterButtonsRow}>
        <TouchableOpacity style={[styles.mainFilterButton, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalFiltroTipo(true)}>
          <MaterialIcons name="swap-vert" size={18} color={filtroTipo !== "todas" ? "#F4A261" : Cores.textoSecundario} />
          <Text style={[styles.mainFilterText, { color: filtroTipo !== "todas" ? "#F4A261" : Cores.textoSecundario }]} numberOfLines={1}>
            {filtroTipo === "todas" ? "Tipo" : filtroTipo === "receita" ? "Receitas" : filtroTipo === "despesa" ? "Despesas" : "Transf."}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.mainFilterButton, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalFiltroConta(true)}>
          <MaterialIcons name="account-balance-wallet" size={18} color={filtroContas.length > 0 ? "#457B9D" : Cores.textoSecundario} />
          <Text style={[styles.mainFilterText, { color: filtroContas.length > 0 ? "#457B9D" : Cores.textoSecundario }]} numberOfLines={1}>
            Contas {filtroContas.length > 0 ? `(${filtroContas.length})` : ""}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.mainFilterButton, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalFiltroCat(true)}>
          <MaterialIcons name="label" size={18} color={filtroCategorias.length > 0 ? "#2A9D8F" : Cores.textoSecundario} />
          <Text style={[styles.mainFilterText, { color: filtroCategorias.length > 0 ? "#2A9D8F" : Cores.textoSecundario }]} numberOfLines={1}>
            Categ. {filtroCategorias.length > 0 ? `(${filtroCategorias.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {/* FILTRO DE STATUS */}
      <View style={{ flexDirection: "row", paddingHorizontal: 15, paddingBottom: 8, gap: 8 }}>
        {(["todos", "concluidos", "pendentes"] as const).map((opcao) => {
          const ativo = filtroStatus === opcao;
          const label = opcao === "todos" ? "Todos" : opcao === "concluidos" ? "Concluídos" : "Pendentes";
          const cor = opcao === "concluidos" ? "#2A9D8F" : opcao === "pendentes" ? "#E9C46A" : Cores.textoPrincipal;
          return (
            <TouchableOpacity
              key={opcao}
              onPress={() => { setFiltroStatus(opcao); setPaginaAtual(1); }}
              style={{
                flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6,
                borderRadius: 20, borderWidth: 1,
                backgroundColor: ativo ? cor + "22" : Cores.pillFundo,
                borderColor: ativo ? cor : Cores.borda,
              }}
            >
              {opcao !== "todos" && (
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: cor, marginRight: 5 }} />
              )}
              <Text style={{ fontSize: 12, fontWeight: ativo ? "700" : "500", color: ativo ? cor : Cores.textoSecundario }}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {temFiltroAtivo && (
        <TouchableOpacity
          onPress={limparFiltros}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 6, marginHorizontal: 15, marginBottom: 8, borderRadius: 8, backgroundColor: "#E76F5122" }}
        >
          <MaterialIcons name="close" size={14} color="#E76F51" />
          <Text style={{ color: "#E76F51", fontSize: 13, fontWeight: "600", marginLeft: 4 }}>Limpar filtros</Text>
        </TouchableOpacity>
      )}

      {/* SELETOR DE MÊS */}
      <View style={styles.mesesScrollContainer}>
        <ScrollView ref={mesesScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15 }}>
          {mesesDoAno.map((yyyymm) => {
            const isAtivo = mesSelecionado === yyyymm;
            return (
              <TouchableOpacity
                key={yyyymm}
                style={[styles.mesPill, { backgroundColor: isAtivo ? Cores.textoPrincipal : Cores.pillFundo, borderColor: isAtivo ? Cores.textoPrincipal : Cores.borda }]}
                onPress={() => { setMesSelecionado(yyyymm); setPaginaAtual(1); }}
              >
                <Text style={[styles.mesPillText, { color: isAtivo ? Cores.fundo : Cores.textoSecundario }]}>
                  {getNomeMes(yyyymm.split("-")[1])?.substring(0, 3)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* RESUMO RÁPIDO DO MÊS */}
      <View style={[styles.resumoBar, { backgroundColor: Cores.cardFundo, borderBottomColor: Cores.borda }]}>
        <View style={styles.resumoItem}>
          <MaterialIcons name="arrow-upward" size={14} color="#2A9D8F" />
          <Text style={styles.resumoReceita}>{fmtReais(totalReceitas)}</Text>
        </View>
        <View style={[styles.resumoDivider, { backgroundColor: Cores.borda }]} />
        <View style={styles.resumoItem}>
          <MaterialIcons name="arrow-downward" size={14} color="#E76F51" />
          <Text style={styles.resumoDespesa}>{fmtReais(totalDespesas)}</Text>
        </View>
        <View style={[styles.resumoDivider, { backgroundColor: Cores.borda }]} />
        <View style={styles.resumoItem}>
          <MaterialIcons name="account-balance" size={14} color={totalReceitas - totalDespesas >= 0 ? "#2A9D8F" : "#E76F51"} />
          <Text style={[styles.resumoBalanco, { color: totalReceitas - totalDespesas >= 0 ? "#2A9D8F" : "#E76F51" }]}>
            {fmtReais(totalReceitas - totalDespesas)}
          </Text>
        </View>
      </View>

      {/* LISTA DE TRANSAÇÕES */}
      <ScrollView style={styles.listContainer}>
        <View style={[styles.tabelaCard, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
          {/* Cabeçalho do mês */}
          <View style={[styles.monthHeader, { backgroundColor: isDark ? "#252525" : "#F8F9FA", borderColor: Cores.borda }]}>
            <Text style={[styles.monthHeaderText, { color: Cores.textoPrincipal }]}>
              {formatarMesAno(mesSelecionado)}
            </Text>
            {transacoesDoMes.length > 0 && (
              <Text style={[styles.contadorText, { color: Cores.textoSecundario }]}>
                {transacoesDoMes.length} registro{transacoesDoMes.length !== 1 ? "s" : ""}
              </Text>
            )}
          </View>

          {transacoesDoMes.length === 0 ? (
            <View style={styles.emptyContainer}>
              {filtroContas.length > 0 || filtroCategorias.length > 0 || filtroTipo !== "todas" ? (
                <>
                  <MaterialIcons name="search-off" size={40} color={Cores.textoSecundario} style={{ marginBottom: 10 }} />
                  <Text style={[styles.emptyMonthText, { color: Cores.textoSecundario }]}>
                    Nenhum resultado com os filtros aplicados.
                  </Text>
                  <TouchableOpacity
                    onPress={() => { setFiltroContas([]); setFiltroCategorias([]); setFiltroTipo("todas"); }}
                    style={{ marginTop: 12, backgroundColor: "#457B9D22", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 }}
                  >
                    <Text style={{ color: "#457B9D", fontWeight: "600" }}>Limpar filtros</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <MaterialIcons name="receipt-long" size={40} color={Cores.textoSecundario} style={{ marginBottom: 10 }} />
                  <Text style={[styles.emptyMonthText, { color: Cores.textoSecundario }]}>
                    Nenhuma transação em {formatarMesAno(mesSelecionado)}.
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
              const estiloConta = conta ? getEstiloBanco(conta.nome, isDark) : { bg: isDark ? "#333" : "#E3F2FD", text: isDark ? "#FFF" : "#1976D2" };
              const partes = (dataEfetivaTransacao(t) || "0000-00-00").split("-");
              const isPendente = t.status === "pendente";
              const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
              const dataT = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
              const isVencida = isPendente && dataT < hoje;
              const transferencia = isTransferencia(t.descricao);
              const corValor = transferencia ? "#F4A261" : t.tipo === "receita" ? "#2A9D8F" : "#E76F51";
              const prefixoValor = t.tipo === "receita" ? "+" : "-";
              const bgRow = index % 2 === 0 ? Cores.rowImpar : Cores.rowPar;
              const corStatus = isVencida ? "#DC2626" : "#F59E0B";
              const textoStatus = isVencida ? "Vencida" : t.tipo === "receita" ? "A receber" : "A pagar";

              return (
                <TouchableOpacity
                  key={t.id}
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
                  {/* Coluna esquerda: data */}
                  <View style={[styles.dataBadge, { backgroundColor: Cores.blocoData }]}>
                    <Text style={[styles.dataDia, { color: Cores.textoPrincipal }]}>{partes[2]}</Text>
                    <Text style={[styles.dataMes, { color: Cores.textoSecundario }]}>
                      {getNomeMes(partes[1])?.substring(0, 3).toUpperCase()}
                    </Text>
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
          {faturaGruposDoMes.length > 0 && filtroTipo !== "receita" && (
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
                    if (g.pago) {
                      setFaturaEstornar(g);
                    } else {
                      router.push({ pathname: "/cartoes", params: { pagarCartaoId: String(g.cartao_id), mesFatura: g.mes_fatura } } as any);
                    }
                  }}
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
                        {g.pago ? "Paga" : "Em aberto"}
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
      </ScrollView>

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
        const transferencia = isTransferencia(t.descricao);
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
                  <View style={styles.detalheLinha}><Text style={{ color: Cores.textoSecundario }}>Status</Text><Text style={{ color: concluida ? "#2A9D8F" : "#F59E0B", fontWeight: "700" }}>{concluida ? "Concluído" : "Previsto"}</Text></View>
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
              {transacaoEditando && !transacaoEditando.descricao.includes("[Transf.]") && (
                <>
                  <Text style={{ color: isDark ? "#AAA" : "#666", fontSize: 12, marginBottom: 6 }}>Categoria:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                    {categorias.filter((c) => c.ativa !== 0 && c.tipo === transacaoEditando.tipo).map((cat) => (
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

      <Modal animationType="fade" transparent visible={modalFiltroTipo} onRequestClose={() => setModalFiltroTipo(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo }]}>
            <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Filtrar por Tipo</Text>
            <View style={styles.wrapContainer}>
              {[
                { key: "todas" as const, label: "Mostrar Tudo", bgAtivo: "#457B9D" },
                { key: "receita" as const, label: "Receitas", bgAtivo: "#2A9D8F" },
                { key: "despesa" as const, label: "Despesas", bgAtivo: "#E76F51" },
                { key: "transferencia" as const, label: "Transferências", bgAtivo: "#F4A261" },
              ].map((op) => {
                const isAtivo = filtroTipo === op.key;
                return (
                  <TouchableOpacity key={op.key} style={[styles.filterPill, { backgroundColor: isAtivo ? op.bgAtivo : Cores.pillFundo, borderWidth: 1, borderColor: isAtivo ? op.bgAtivo : Cores.borda }]} onPress={() => setFiltroTipo(op.key)}>
                    <Text style={[styles.filterPillText, { color: isAtivo ? "#FFF" : Cores.textoPrincipal }]}>{op.label}</Text>
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
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo }]}>
            <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Filtrar por Conta</Text>
            <View style={styles.wrapContainer}>
              <TouchableOpacity style={[styles.filterPill, { backgroundColor: filtroContas.length === 0 ? "#457B9D" : Cores.pillFundo, borderWidth: 1, borderColor: filtroContas.length === 0 ? "#457B9D" : Cores.borda }]} onPress={() => setFiltroContas([])}>
                <Text style={[styles.filterPillText, { color: filtroContas.length === 0 ? "#FFF" : Cores.textoPrincipal }]}>Todas</Text>
              </TouchableOpacity>
              {contas.map((c) => (
                <TouchableOpacity key={`fc-${c.id}`} style={[styles.filterPill, { backgroundColor: filtroContas.includes(c.id) ? "#457B9D" : Cores.pillFundo, borderWidth: 1, borderColor: filtroContas.includes(c.id) ? "#457B9D" : Cores.borda }]} onPress={() => toggleFiltroConta(c.id)}>
                  <Text style={[styles.filterPillText, { color: filtroContas.includes(c.id) ? "#FFF" : Cores.textoPrincipal }]}>{c.nome}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.modalBotaoAplicar, { backgroundColor: "#457B9D" }]} onPress={() => setModalFiltroConta(false)}>
              <Text style={styles.modalBotaoTexto}>Aplicar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={modalFiltroCat} onRequestClose={() => setModalFiltroCat(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, maxHeight: "85%" }]}>
            <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Filtrar por Categoria</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Todas */}
              <View style={[styles.wrapContainer, { marginBottom: 8 }]}>
                <TouchableOpacity
                  style={[styles.filterPill, { backgroundColor: filtroCategorias.length === 0 ? "#2A9D8F" : Cores.pillFundo, borderWidth: 1, borderColor: filtroCategorias.length === 0 ? "#2A9D8F" : Cores.borda }]}
                  onPress={() => setFiltroCategorias([])}
                >
                  <Text style={[styles.filterPillText, { color: filtroCategorias.length === 0 ? "#FFF" : Cores.textoPrincipal }]}>Todas</Text>
                </TouchableOpacity>
              </View>

              {/* Receitas */}
              {categorias.filter((c) => c.ativa !== 0 && c.tipo === "receita").length > 0 && (
                <>
                  <View style={styles.catSecaoHeader}>
                    <MaterialIcons name="arrow-upward" size={13} color="#2A9D8F" />
                    <Text style={[styles.catSecaoTitulo, { color: "#2A9D8F" }]}>Receitas</Text>
                  </View>
                  <View style={[styles.wrapContainer, { marginBottom: 12 }]}>
                    {categorias.filter((c) => c.ativa !== 0 && c.tipo === "receita").map((c) => (
                      <TouchableOpacity
                        key={`fcat-${c.id}`}
                        style={[styles.filterPill, { backgroundColor: filtroCategorias.includes(c.id) ? c.cor : Cores.pillFundo, borderWidth: 1, borderColor: filtroCategorias.includes(c.id) ? c.cor : Cores.borda }]}
                        onPress={() => toggleFiltroCategoria(c.id)}
                      >
                        <View style={[styles.colorDot, { backgroundColor: filtroCategorias.includes(c.id) ? "#FFF" : c.cor }]} />
                        <Text style={[styles.filterPillText, { color: filtroCategorias.includes(c.id) ? "#FFF" : Cores.textoPrincipal }]}>{c.nome}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* Despesas */}
              {categorias.filter((c) => c.ativa !== 0 && c.tipo === "despesa").length > 0 && (
                <>
                  <View style={styles.catSecaoHeader}>
                    <MaterialIcons name="arrow-downward" size={13} color="#E76F51" />
                    <Text style={[styles.catSecaoTitulo, { color: "#E76F51" }]}>Despesas</Text>
                  </View>
                  <View style={[styles.wrapContainer, { marginBottom: 12 }]}>
                    {categorias.filter((c) => c.ativa !== 0 && c.tipo === "despesa").map((c) => (
                      <TouchableOpacity
                        key={`fcat-${c.id}`}
                        style={[styles.filterPill, { backgroundColor: filtroCategorias.includes(c.id) ? c.cor : Cores.pillFundo, borderWidth: 1, borderColor: filtroCategorias.includes(c.id) ? c.cor : Cores.borda }]}
                        onPress={() => toggleFiltroCategoria(c.id)}
                      >
                        <View style={[styles.colorDot, { backgroundColor: filtroCategorias.includes(c.id) ? "#FFF" : c.cor }]} />
                        <Text style={[styles.filterPillText, { color: filtroCategorias.includes(c.id) ? "#FFF" : Cores.textoPrincipal }]}>{c.nome}</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { padding: 20, paddingTop: 30, paddingBottom: 15, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "bold" },

  filterButtonsRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 15, marginBottom: 12 },
  mainFilterButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, paddingHorizontal: 5, borderRadius: 10, marginHorizontal: 4 },
  mainFilterText: { marginLeft: 4, fontSize: 13, fontWeight: "bold" },

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

  listContainer: { flex: 1, paddingHorizontal: 12 },
  tabelaCard: { marginBottom: 20, borderRadius: 12, borderWidth: 1, overflow: "hidden" },

  monthHeader: { paddingVertical: 12, paddingHorizontal: 15, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  monthHeaderText: { fontSize: 16, fontWeight: "bold", textTransform: "capitalize" },
  contadorText: { fontSize: 12 },

  // Novo layout de card de transação
  transacaoCard: { flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1 },
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
  modalOverlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.7)", justifyContent: "center", alignItems: "center" },
  modalContent: { width: "90%", padding: 25, borderRadius: 16, elevation: 5 },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 20, textAlign: "center" },
  wrapContainer: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 25, justifyContent: "center" },
  filterPill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, flexDirection: "row", alignItems: "center" },
  filterPillText: { fontSize: 14, fontWeight: "500" },
  colorDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  modalBotaoAplicar: { paddingVertical: 12, borderRadius: 10, alignItems: "center" },
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
