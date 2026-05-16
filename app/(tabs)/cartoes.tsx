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
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../_layout";
import { fmtReais } from "../../lib/utils";
import { agendarNotificacoesDoApp } from "../../lib/notifications";

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

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function CartoesScreen() {
  const { isDark, session, showToast, verificarLimite } = useAppTheme();
  const router = useRouter();

  const Cores = {
    fundo: isDark ? "#121212" : "#F5F7FB",
    texto: isDark ? "#FFFFFF" : "#111827",
    secundario: isDark ? "#AAAAAA" : "#6B7280",
    card: isDark ? "#1E1E1E" : "#FFFFFF",
    borda: isDark ? "#333" : "#E5E7EB",
    input: isDark ? "#2C2C2C" : "#F3F4F6",
    pillFundo: isDark ? "#2C2C2C" : "#F3F4F6",
  };

  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [itens, setItens] = useState<FaturaItem[]>([]);
  const [loading, setLoading] = useState(false);

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

  // Modal pagamento — selecionar conta
  const [modalPagamento, setModalPagamento] = useState(false);
  const [mesPagamento, setMesPagamento] = useState("");
  const [contaPagamentoId, setContaPagamentoId] = useState<number | null>(null);

  // Modal opções cartão (long-press) — substitui Alert
  const [modalOpcoesCartao, setModalOpcoesCartao] = useState<Cartao | null>(null);

  // Modal excluir item de fatura — substitui Alert
  const [modalExcluirItem, setModalExcluirItem] = useState<FaturaItem | null>(null);

  // Cartões arquivados
  const [cartoesArquivados, setCartoesArquivados] = useState<Cartao[]>([]);
  const [mostrarArquivados, setMostrarArquivados] = useState(false);

  const carregarDados = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);

    const [resCartoes, resItens, resCats, resContas, resArquivados] = await Promise.all([
      supabase.from("cartoes").select("*").eq("user_id", session.user.id).eq("ativo", true).order("id"),
      supabase.from("fatura_itens").select("*").eq("user_id", session.user.id).order("data_compra", { ascending: false }),
      supabase.from("categorias").select("id, nome, cor, icone, tipo").eq("user_id", session.user.id).eq("ativa", true).order("nome"),
      supabase.from("contas").select("id, nome, cor").eq("user_id", session.user.id).eq("arquivado", false).order("nome"),
      supabase.from("cartoes").select("*").eq("user_id", session.user.id).eq("ativo", false).order("id"),
    ]);

    if (resCartoes.data) setCartoes(resCartoes.data);
    if (resItens.data) setItens(resItens.data);
    if (resCats.data) setCategorias(resCats.data as Categoria[]);
    if (resContas.data) setContas(resContas.data as ContaSimples[]);
    if (resArquivados.data) setCartoesArquivados(resArquivados.data);
    setLoading(false);

    // Alerta de limite próximo do máximo para cada cartão
    if (resCartoes.data && resItens.data && session?.user?.id) {
      const mesAtual = mesAtualStr();
      const cartoesComLimite = resCartoes.data.map((c: any) => {
        const limiteUsado = resItens.data!
          .filter((i: any) => i.cartao_id === c.id && i.mes_fatura >= mesAtual && !i.pago)
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

  // ─── Cálculos ──────────────────────────────────────────────────────────────

  const calcularTotalFatura = (cartaoId: number, mes: string): number => {
    return itens
      .filter((i) => i.cartao_id === cartaoId && i.mes_fatura === mes && !i.pago)
      .reduce((acc, i) => acc + Number(i.valor), 0);
  };

  const calcularLimiteUsado = (cartaoId: number): number => {
    const mes = mesAtualStr();
    return itens
      .filter((i) => i.cartao_id === cartaoId && i.mes_fatura >= mes && !i.pago)
      .reduce((acc, i) => acc + Number(i.valor), 0);
  };

  // ─── Criar cartão ──────────────────────────────────────────────────────────

  const salvarNovoCartao = async () => {
    if (!nomeCartao.trim()) return Alert.alert("Aviso", "Informe o nome do cartão.");
    const limiteNum = parseFloat(limiteCartao.replace(",", ".")) || 0;
    if (limiteNum <= 0) return Alert.alert("Aviso", "Informe um limite válido.");
    const venc = parseInt(diaVencimento);
    const fecha = parseInt(diaFechamento);
    if (isNaN(venc) || venc < 1 || venc > 31) return Alert.alert("Aviso", "Dia de vencimento inválido (1–31).");
    if (isNaN(fecha) || fecha < 1 || fecha > 31) return Alert.alert("Aviso", "Dia de fechamento inválido (1–31).");

    // Verificar limite do plano
    if (!verificarLimite("cartoes", cartoes.length)) return;

    setLoadingNovoCartao(true);
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
    const valor = parseFloat(valorCompra.replace(",", "."));
    if (isNaN(valor) || valor <= 0) return Alert.alert("Aviso", "Informe um valor válido.");
    const parcelas = parseInt(parcelasCompra) || 1;
    if (parcelas < 1 || parcelas > 48) return Alert.alert("Aviso", "Número de parcelas inválido (1–48).");

    const valorParcela = +(valor / parcelas).toFixed(2);
    const mesPrimeiro = mesParaFatura(dataCompra, cartaoAberto.dia_fechamento);

    setLoadingCompra(true);

    const itensInserir: any[] = [];
    let grupoPrimeiroId: number | null = null;

    for (let i = 0; i < parcelas; i++) {
      const mes = adicionarMeses(mesPrimeiro, i);
      const dataCompraStr = dataCompra.toISOString().slice(0, 10);
      const desc = parcelas > 1 ? `${descCompra} (${i + 1}/${parcelas})` : descCompra;
      itensInserir.push({
        cartao_id: cartaoAberto.id,
        user_id: session.user.id,
        descricao: desc,
        valor: valorParcela,
        data_compra: dataCompraStr,
        mes_fatura: mes,
        parcela_atual: i + 1,
        total_parcelas: parcelas,
        grupo_parcela_id: null,
        categoria_id: categCompraId,
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
    if (parcelas > 1) {
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
    setDescCompra(""); setValorCompra(""); setParcelasCompra("1"); setDataCompra(new Date()); setCategCompraId(null);
    setModalNovaCompra(false);
    showToast(`Compra adicionada${parcelas > 1 ? ` em ${parcelas}x` : ""} ✓`, "success");
    carregarDados();
  };

  // ─── Pagar fatura — abre modal de seleção de conta ───────────────────────

  const iniciarPagamentoFatura = (mes: string) => {
    const totalFatura = calcularTotalFatura(cartaoAberto!.id, mes);
    if (totalFatura === 0) return showToast("Fatura já está zerada", "info");
    setMesPagamento(mes);
    setContaPagamentoId(contas[0]?.id ?? null);
    setModalPagamento(true);
  };

  const confirmarPagamentoFatura = async () => {
    if (!cartaoAberto || !contaPagamentoId) return;
    const totalFatura = calcularTotalFatura(cartaoAberto.id, mesPagamento);
    const hoje = new Date().toISOString().slice(0, 10);
    const descPagamento = `Fatura ${cartaoAberto.nome} - ${formatarMes(mesPagamento)}`;

    const [resUpdate, resTrans] = await Promise.all([
      supabase.from("fatura_itens").update({ pago: true }).eq("cartao_id", cartaoAberto.id).eq("mes_fatura", mesPagamento).eq("pago", false),
      supabase.from("transacoes").insert([{
        user_id: session!.user.id,
        tipo: "despesa",
        valor: totalFatura,
        descricao: descPagamento,
        data_vencimento: hoje,
        conta_id: contaPagamentoId,
        status: "paga",
        categoria_id: null,
      }]),
    ]);

    if (resUpdate.error || resTrans.error) {
      showToast("Erro ao registrar pagamento", "error");
      return;
    }

    setModalPagamento(false);
    showToast("Fatura paga ✓", "success");
    carregarDados();
  };

  const estornarFatura = async (cartaoId: number, mes: string) => {
    const totalFatura = calcularTotalFatura(cartaoId, mes) === 0
      ? itens.filter(i => i.cartao_id === cartaoId && i.mes_fatura === mes && i.pago).reduce((a, i) => a + Number(i.valor), 0)
      : 0;

    const nomeCartao = cartoes.find(c => c.id === cartaoId)?.nome ?? "";
    const descPagamento = `Fatura ${nomeCartao} - ${formatarMes(mes)}`;

    Alert.alert("Estornar Pagamento", `Desfazer o pagamento da fatura ${formatarMes(mes)}?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Estornar",
        style: "destructive",
        onPress: async () => {
          await Promise.all([
            supabase.from("fatura_itens").update({ pago: false }).eq("cartao_id", cartaoId).eq("mes_fatura", mes).eq("pago", true),
            supabase.from("transacoes").delete().eq("user_id", session!.user.id).eq("descricao", descPagamento),
          ]);
          showToast("Pagamento estornado", "success");
          carregarDados();
        },
      },
    ]);
  };

  // ─── Editar cartão ─────────────────────────────────────────────────────────

  const abrirEditarCartao = (c: Cartao) => {
    setCartaoEditando(c);
    setEditNome(c.nome);
    setEditCor(c.cor);
    setEditLimite(c.limite.toString());
    setEditVenc(c.dia_vencimento.toString());
    setEditFecha(c.dia_fechamento.toString());
    setModalEditarCartao(true);
  };

  const salvarEdicaoCartao = async () => {
    if (!cartaoEditando) return;
    if (!editNome.trim()) return showToast("Informe o nome", "error");
    const limiteNum = parseFloat(editLimite.replace(",", ".")) || 0;
    if (limiteNum <= 0) return showToast("Limite inválido", "error");
    const venc = parseInt(editVenc);
    const fecha = parseInt(editFecha);
    if (isNaN(venc) || venc < 1 || venc > 31) return showToast("Vencimento inválido (1–31)", "error");
    if (isNaN(fecha) || fecha < 1 || fecha > 31) return showToast("Fechamento inválido (1–31)", "error");

    setLoadingEditar(true);
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
  const limiteUsado = cartaoAberto ? calcularLimiteUsado(cartaoAberto.id) : 0;
  const limiteDisponivel = cartaoAberto ? Math.max(0, cartaoAberto.limite - limiteUsado) : 0;
  const pctUsado = cartaoAberto && cartaoAberto.limite > 0
    ? Math.min(100, (limiteUsado / cartaoAberto.limite) * 100)
    : 0;

  return (
    <SafeAreaView style={[estilos.safeArea, { backgroundColor: Cores.fundo }]}>
      <ScrollView>
        {/* Header */}
        <View style={estilos.header}>
          <TouchableOpacity onPress={() => router.back()} style={estilos.voltarBtn}>
            <MaterialIcons name="arrow-back" size={24} color={Cores.texto} />
          </TouchableOpacity>
          <Text style={[estilos.titulo, { color: Cores.texto }]}>Cartões de Crédito</Text>
          <TouchableOpacity
            style={[estilos.btnNovo, { backgroundColor: "#457B9D" }]}
            onPress={() => setModalNovoCartao(true)}
          >
            <MaterialIcons name="add" size={18} color="#FFF" />
            <Text style={estilos.btnNovoText}>Novo</Text>
          </TouchableOpacity>
        </View>

        {/* Lista de cartões */}
        {cartoes.length === 0 ? (
          <TouchableOpacity
            onPress={() => setModalNovoCartao(true)}
            style={[estilos.emptyCard, { borderColor: Cores.borda }]}
          >
            <MaterialIcons name="credit-card" size={48} color={Cores.borda} />
            <Text style={[estilos.emptyTitulo, { color: Cores.secundario }]}>Nenhum cartão cadastrado</Text>
            <Text style={[estilos.emptySubtitulo, { color: "#457B9D" }]}>Toque para adicionar seu primeiro cartão</Text>
          </TouchableOpacity>
        ) : (
          <View style={estilos.cartoesLista}>
            {cartoes.map((c) => {
              const total = calcularTotalFatura(c.id, mesAtualStr());
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
                    setMesFaturaAtivo(mesAtualStr());
                    setModalFaturaVisivel(true);
                  }}
                  onLongPress={() => !bloqueado && opcoesCartao(c)}
                  activeOpacity={bloqueado ? 1 : 0.85}
                >
                  <View style={estilos.cartaoTopo}>
                    {bloqueado
                      ? <MaterialIcons name="lock" size={18} color="rgba(255,255,255,0.9)" />
                      : <MaterialIcons name="credit-card" size={22} color="rgba(255,255,255,0.8)" />
                    }
                    <Text style={estilos.cartaoNome}>{c.nome}</Text>
                  </View>
                  {bloqueado ? (
                    <Text style={[estilos.cartaoFaturaLabel, { marginTop: 4 }]}>Bloqueado — faça upgrade</Text>
                  ) : (
                    <>
                      <Text style={estilos.cartaoFaturaLabel}>Fatura atual</Text>
                      <Text style={estilos.cartaoFatura}>{fmtReais(total)}</Text>
                      <View style={estilos.cartaoRodapeCol}>
                        <Text style={estilos.cartaoLimite}>Disponível: {fmtReais(disponivel)}</Text>
                        <Text style={estilos.cartaoVenc}>Vence dia {c.dia_vencimento}</Text>
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
                  style={[estilos.desarquivarBtn, { backgroundColor: "#2A9D8F22", borderColor: "#2A9D8F" }]}
                  onPress={() => desarquivarCartao(c)}
                >
                  <MaterialIcons name="unarchive" size={14} color="#2A9D8F" />
                  <Text style={{ color: "#2A9D8F", fontSize: 12, fontWeight: "700" }}>Reativar</Text>
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
                <View>
                  <Text style={[estilos.faturaCartaoNome, { color: Cores.texto }]}>{cartaoAberto.nome}</Text>
                  <Text style={[estilos.faturaTotal, { color: totalFaturaAtiva > 0 ? "#E76F51" : "#2A9D8F" }]}>
                    {fmtReais(totalFaturaAtiva)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setModalFaturaVisivel(false)}>
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
                        backgroundColor: pctUsado >= 90 ? "#E76F51" : pctUsado >= 70 ? "#F4A261" : "#2A9D8F",
                      },
                    ]}
                  />
                </View>
                <Text style={[estilos.limiteDisp, { color: "#2A9D8F" }]}>
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
                  style={[estilos.acaoBtn, { backgroundColor: "#2563EB" }]}
                  onPress={() => setModalNovaCompra(true)}
                >
                  <MaterialIcons name="add-shopping-cart" size={16} color="#FFF" />
                  <Text style={estilos.acaoBtnText}>Add Compra</Text>
                </TouchableOpacity>
                {totalFaturaAtiva > 0 ? (
                  <TouchableOpacity
                    style={[estilos.acaoBtn, { backgroundColor: "#10B981" }]}
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
                    <MaterialIcons name="receipt" size={32} color={Cores.borda} />
                    <Text style={[estilos.faturaVaziaText, { color: Cores.secundario }]}>
                      Nenhuma compra nesta fatura
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
                          <View style={[estilos.itemStatus, { backgroundColor: item.pago ? "#2A9D8F22" : "#E76F5122" }]}>
                            <MaterialIcons
                              name={item.pago ? "check-circle" : "radio-button-unchecked"}
                              size={14}
                              color={item.pago ? "#2A9D8F" : "#E76F51"}
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
          <View style={estilos.modalCentradoOverlay}>
            <View style={[estilos.modalCentradoContent, { backgroundColor: Cores.card }]}>
              <View style={estilos.modalHeaderRow}>
                <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Novo Cartão</Text>
                <TouchableOpacity onPress={() => setModalNovoCartao(false)}>
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
                placeholder="Ex: 5000"
                placeholderTextColor={Cores.secundario}
                value={limiteCartao}
                onChangeText={setLimiteCartao}
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
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
                  style={[estilos.modalBtn, { backgroundColor: "#457B9D" }]}
                  onPress={salvarNovoCartao}
                  disabled={loadingNovoCartao}
                >
                  <Text style={[estilos.modalBtnText, { color: "#FFF" }]}>
                    {loadingNovoCartao ? "Salvando..." : "Salvar"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Modal: Nova Compra */}
      {modalNovaCompra && cartaoAberto && (
        <Modal animationType="slide" transparent visible onRequestClose={() => setModalNovaCompra(false)}>
          <View style={estilos.modalOverlay}>
            <View style={[estilos.modalContent, { backgroundColor: Cores.card }]}>
              <View style={estilos.modalHeaderRow}>
                <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>
                  Nova Compra — {cartaoAberto.nome}
                </Text>
                <TouchableOpacity onPress={() => setModalNovaCompra(false)}>
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>

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
                  <Text style={[estilos.label, { color: Cores.secundario }]}>Valor Total (R$)</Text>
                  <TextInput
                    style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                    placeholder="Ex: 120,00"
                    placeholderTextColor={Cores.secundario}
                    value={valorCompra}
                    onChangeText={setValorCompra}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ width: 12 }} />
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
              </View>

              {/* Preview de parcelas */}
              {parseFloat(valorCompra.replace(",", ".")) > 0 && parseInt(parcelasCompra) > 1 && (
                <View style={[estilos.previewParcelas, { backgroundColor: Cores.pillFundo }]}>
                  <Text style={[estilos.previewText, { color: Cores.secundario }]}>
                    {parseInt(parcelasCompra)}x de{" "}
                    <Text style={{ color: Cores.texto, fontWeight: "bold" }}>
                      {fmtReais(parseFloat(valorCompra.replace(",", ".")) / parseInt(parcelasCompra))}
                    </Text>
                  </Text>
                </View>
              )}

              <Text style={[estilos.label, { color: Cores.secundario }]}>Categoria</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {categorias.filter(c => c.tipo === "despesa" || c.tipo === "ambos").map((cat) => (
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
                  style={[estilos.modalBtn, { backgroundColor: "#2563EB" }]}
                  onPress={salvarCompra}
                  disabled={loadingCompra}
                >
                  <Text style={[estilos.modalBtnText, { color: "#FFF" }]}>
                    {loadingCompra ? "Salvando..." : "Salvar Compra"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Modal: Pagamento da Fatura — selecionar conta */}
      {modalPagamento && cartaoAberto && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalPagamento(false)}>
          <View style={estilos.modalFaturaOverlay}>
            <View style={[estilos.modalFaturaContent, { backgroundColor: Cores.card }]}>
              <View style={estilos.modalHeaderRow}>
                <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Pagar Fatura</Text>
                <TouchableOpacity onPress={() => setModalPagamento(false)}>
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>

              <View style={[{ backgroundColor: Cores.pillFundo, borderRadius: 12, padding: 14, marginBottom: 16, alignItems: "center" }]}>
                <Text style={{ color: Cores.secundario, fontSize: 12, marginBottom: 4 }}>Valor da Fatura {formatarMes(mesPagamento)}</Text>
                <Text style={{ color: "#10B981", fontSize: 26, fontWeight: "bold" }}>
                  {fmtReais(calcularTotalFatura(cartaoAberto.id, mesPagamento))}
                </Text>
              </View>

              <Text style={[estilos.label, { color: Cores.secundario }]}>Pagar com qual conta?</Text>
              {contas.map((conta) => (
                <TouchableOpacity
                  key={conta.id}
                  style={[estilos.contaOpcao, { borderColor: contaPagamentoId === conta.id ? "#10B981" : Cores.borda, backgroundColor: contaPagamentoId === conta.id ? "#D1FAE5" : Cores.pillFundo }]}
                  onPress={() => setContaPagamentoId(conta.id)}
                >
                  <MaterialIcons name="account-balance-wallet" size={18} color={contaPagamentoId === conta.id ? "#10B981" : Cores.secundario} />
                  <Text style={{ color: contaPagamentoId === conta.id ? "#065F46" : Cores.texto, fontWeight: "600", marginLeft: 10, flex: 1 }}>{conta.nome}</Text>
                  {contaPagamentoId === conta.id && <MaterialIcons name="check-circle" size={18} color="#10B981" />}
                </TouchableOpacity>
              ))}

              <View style={[estilos.modalBtns, { marginTop: 16 }]}>
                <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalPagamento(false)}>
                  <Text style={[estilos.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: "#10B981" }]} onPress={confirmarPagamentoFatura} disabled={!contaPagamentoId}>
                  <Text style={[estilos.modalBtnText, { color: "#FFF" }]}>Confirmar Pagamento</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Modal: Editar Cartão */}
      {modalEditarCartao && cartaoEditando && (
        <Modal animationType="slide" transparent visible onRequestClose={() => setModalEditarCartao(false)}>
          <View style={estilos.modalOverlay}>
            <View style={[estilos.modalContent, { backgroundColor: Cores.card }]}>
              <View style={estilos.modalHeaderRow}>
                <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Editar Cartão</Text>
                <TouchableOpacity onPress={() => setModalEditarCartao(false)}>
                  <MaterialIcons name="close" size={24} color={Cores.secundario} />
                </TouchableOpacity>
              </View>

              <Text style={[estilos.label, { color: Cores.secundario }]}>Nome do Cartão</Text>
              <TextInput style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]} placeholder="Ex: Nubank" placeholderTextColor={Cores.secundario} value={editNome} onChangeText={setEditNome} />

              <Text style={[estilos.label, { color: Cores.secundario }]}>Limite (R$)</Text>
              <TextInput style={[estilos.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]} placeholder="Ex: 5000" placeholderTextColor={Cores.secundario} value={editLimite} onChangeText={setEditLimite} keyboardType="decimal-pad" />

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
                <TouchableOpacity style={[estilos.modalBtn, { backgroundColor: "#2563EB" }]} onPress={salvarEdicaoCartao} disabled={loadingEditar}>
                  <Text style={[estilos.modalBtnText, { color: "#FFF" }]}>{loadingEditar ? "Salvando..." : "Salvar"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Modal: Opções do Cartão (long-press) */}
      {modalOpcoesCartao && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalOpcoesCartao(null)}>
          <View style={estilos.modalFaturaOverlay}>
            <View style={[estilos.modalFaturaContent, { backgroundColor: Cores.card }]}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 20, gap: 10 }}>
                <View style={[{ width: 14, height: 14, borderRadius: 7, backgroundColor: modalOpcoesCartao.cor }]} />
                <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>{modalOpcoesCartao.nome}</Text>
              </View>

              <TouchableOpacity
                style={[estilos.opcaoModalBtn, { backgroundColor: "#2563EB" }]}
                onPress={() => { setModalOpcoesCartao(null); abrirEditarCartao(modalOpcoesCartao); }}
              >
                <MaterialIcons name="edit" size={18} color="#FFF" />
                <Text style={estilos.opcaoModalBtnText}>Editar Cartão</Text>
              </TouchableOpacity>

              {itens.some(i => i.cartao_id === modalOpcoesCartao.id) ? (
                <TouchableOpacity
                  style={[estilos.opcaoModalBtn, { backgroundColor: "#F59E0B" }]}
                  onPress={() => arquivarCartaoConfirm(modalOpcoesCartao)}
                >
                  <MaterialIcons name="archive" size={18} color="#FFF" />
                  <Text style={estilos.opcaoModalBtnText}>Arquivar Cartão</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[estilos.opcaoModalBtn, { backgroundColor: "#EF4444" }]}
                  onPress={() => deletarCartaoConfirm(modalOpcoesCartao)}
                >
                  <MaterialIcons name="delete-outline" size={18} color="#FFF" />
                  <Text style={estilos.opcaoModalBtnText}>Excluir Cartão</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[estilos.opcaoModalBtn, { backgroundColor: Cores.pillFundo }]}
                onPress={() => setModalOpcoesCartao(null)}
              >
                <Text style={[estilos.opcaoModalBtnText, { color: Cores.secundario }]}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Modal: Excluir Item de Fatura */}
      {modalExcluirItem && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalExcluirItem(null)}>
          <View style={estilos.modalFaturaOverlay}>
            <View style={[estilos.modalFaturaContent, { backgroundColor: Cores.card }]}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <MaterialIcons name="delete-outline" size={22} color="#EF4444" style={{ marginRight: 10 }} />
                <Text style={[estilos.modalTitulo, { color: Cores.texto }]}>Excluir Compra</Text>
              </View>
              <Text style={{ color: Cores.secundario, fontSize: 14, marginBottom: 20 }} numberOfLines={2}>
                "{modalExcluirItem.descricao}"
              </Text>

              {modalExcluirItem.total_parcelas > 1 && (
                <TouchableOpacity
                  style={[estilos.opcaoModalBtn, { backgroundColor: "#F59E0B" }]}
                  onPress={async () => {
                    setModalExcluirItem(null);
                    await executarExclusao([modalExcluirItem.id]);
                  }}
                >
                  <Text style={estilos.opcaoModalBtnText}>
                    Excluir só esta ({modalExcluirItem.parcela_atual}/{modalExcluirItem.total_parcelas})
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[estilos.opcaoModalBtn, { backgroundColor: "#EF4444" }]}
                onPress={async () => {
                  const item = modalExcluirItem;
                  setModalExcluirItem(null);
                  if (item.total_parcelas > 1) {
                    const ids = itens
                      .filter(i => i.grupo_parcela_id === (item.grupo_parcela_id || item.id))
                      .map(i => i.id);
                    await executarExclusao(ids);
                  } else {
                    await executarExclusao([item.id]);
                  }
                }}
              >
                <MaterialIcons name="delete-forever" size={18} color="#FFF" />
                <Text style={estilos.opcaoModalBtnText}>
                  {modalExcluirItem.total_parcelas > 1 ? "Excluir todas as parcelas" : "Excluir"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[estilos.opcaoModalBtn, { backgroundColor: Cores.pillFundo }]}
                onPress={() => setModalExcluirItem(null)}
              >
                <Text style={[estilos.opcaoModalBtnText, { color: Cores.secundario }]}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const estilos = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    paddingTop: 28,
    paddingBottom: 10,
  },
  voltarBtn: { padding: 4 },
  titulo: { fontSize: 24, fontWeight: "bold", flex: 1, textAlign: "center" },
  btnNovo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  btnNovoText: { color: "#FFF", fontWeight: "bold", fontSize: 14 },

  emptyCard: {
    margin: 20,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyTitulo: { fontSize: 16, fontWeight: "600", marginTop: 12 },
  emptySubtitulo: { fontSize: 13, marginTop: 4 },

  cartoesLista: { paddingHorizontal: 16, gap: 12, marginBottom: 4 },
  cartaoCard: {
    borderRadius: 16,
    padding: 16,
    justifyContent: "space-between",
  },
  cartaoTopo: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  cartaoNome: { color: "#FFF", fontWeight: "bold", fontSize: 15, flex: 1 },
  cartaoFaturaLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11 },
  cartaoFatura: { color: "#FFF", fontSize: 22, fontWeight: "bold", marginBottom: 8 },
  cartaoRodapeCol: { gap: 2 },
  cartaoLimite: { color: "rgba(255,255,255,0.8)", fontSize: 11 },
  cartaoVenc: { color: "rgba(255,255,255,0.8)", fontSize: 11 },

  modalFaturaOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalFaturaContent: {
    width: "100%",
    borderRadius: 20,
    padding: 20,
    maxHeight: "85%",
  },
  faturaHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  faturaCartaoNome: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
  faturaTotal: { fontSize: 28, fontWeight: "bold" },

  limiteContainer: { borderRadius: 10, padding: 12, marginBottom: 16 },
  limiteRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  limiteLbl: { fontSize: 12 },
  limiteVal: { fontSize: 12, fontWeight: "600" },
  progressoBg: { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 6 },
  progressoBar: { height: 6, borderRadius: 3 },
  limiteDisp: { fontSize: 12, fontWeight: "bold" },

  mesNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  mesTitulo: { fontSize: 15, fontWeight: "bold" },

  acoesRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  acaoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  acaoBtnText: { color: "#FFF", fontWeight: "bold", fontSize: 13 },

  faturaVazia: { alignItems: "center", paddingVertical: 28 },
  faturaVaziaText: { fontSize: 14, marginTop: 8 },

  itensList: {},
  itemFatura: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  itemFaturaLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: 10 },
  itemStatus: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  itemDesc: { fontSize: 14, fontWeight: "500" },
  itemData: { fontSize: 11, marginTop: 2 },
  itemValor: { fontSize: 15, fontWeight: "bold" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: "92%",
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitulo: { fontSize: 18, fontWeight: "bold" },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 16,
  },
  doisCampos: { flexDirection: "row" },
  corCirculo: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  corSelecionada: { borderWidth: 3, borderColor: "#FFF" },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 8 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  modalBtnText: { fontWeight: "bold", fontSize: 15 },
  previewParcelas: { borderRadius: 8, padding: 10, marginBottom: 16, alignItems: "center" },
  previewText: { fontSize: 13 },
  catPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  contaOpcao: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 10,
  },
  // Modal centralizado (novo cartão)
  modalCentradoOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCentradoContent: {
    width: "100%",
    borderRadius: 20,
    padding: 24,
    maxHeight: "90%",
  },
  // Opções modais (substituem Alert)
  opcaoModalBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  opcaoModalBtnText: { color: "#FFF", fontWeight: "bold", fontSize: 15 },
  // Arquivados
  cartaoArquivado: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 12,
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
