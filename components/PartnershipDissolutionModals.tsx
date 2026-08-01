import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { finFlowTheme, FinFlowRadius, FinFlowShadow } from "../constants/finflow-design";

export type ItemResumoDissolucao = {
  id: number;
  tipo: "conta" | "caixinha";
  source_id: number;
  source_owner_id: string;
  nome: string;
  saldo_final: number | string;
  possui_lancamentos: boolean;
  estado: "informativo" | "pendente" | "mantida" | "arquivada" | "removida";
};

export type ResumoDissolucao = {
  resumo_id: number;
  parceria_id: number;
  iniciada_por: string;
  criado_em: string;
  itens: ItemResumoDissolucao[];
};

export type DecisaoContaDissolucao = {
  id: number;
  nome: string;
  saldo_final: number | string;
  possui_lancamentos: boolean;
};

type Props = {
  isDark: boolean;
  resumo: ResumoDissolucao | null;
  decisaoConta: DecisaoContaDissolucao | null;
  mostrarResumo: boolean;
  mostrarDecisaoConta: boolean;
  processando: boolean;
  onConfirmarResumo: () => void;
  onResolverConta: (manterAtiva: boolean) => void;
};

const formatarReais = (valor: number | string) => Number(valor || 0).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

const descricaoEstado = (item: ItemResumoDissolucao) => {
  if (item.tipo === "caixinha") return "Saldo total na separação; sua parte será definida na próxima etapa.";
  if (item.estado === "pendente") return "Você escolherá se esta conta ficará ativa ou arquivada.";
  if (item.estado === "removida") return "Sem saldo ou lançamentos; ela não aparecerá mais no seu FinFlow.";
  if (item.estado === "arquivada") return "Esta conta permanece arquivada e agora é individual.";
  if (item.estado === "mantida") return "Esta conta foi mantida ativa e agora é individual.";
  return "A conta pertence ao criador e saiu da sua visão após o vínculo.";
};

export default function PartnershipDissolutionModals({
  isDark,
  resumo,
  decisaoConta,
  mostrarResumo,
  mostrarDecisaoConta,
  processando,
  onConfirmarResumo,
  onResolverConta,
}: Props) {
  const theme = finFlowTheme(isDark);
  const contas = resumo?.itens.filter((item) => item.tipo === "conta") ?? [];
  const caixinhas = resumo?.itens.filter((item) => item.tipo === "caixinha") ?? [];

  const renderItens = (titulo: string, itens: ItemResumoDissolucao[]) => {
    if (itens.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{titulo}</Text>
        {itens.map((item) => (
          <View key={`${item.tipo}-${item.id}`} style={[styles.item, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
            <View style={[styles.itemIcon, { backgroundColor: theme.primarySoft }]}>
              <MaterialIcons name={item.tipo === "conta" ? "account-balance-wallet" : "savings"} size={20} color={theme.primary} />
            </View>
            <View style={styles.itemText}>
              <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>{item.nome}</Text>
              <Text style={[styles.itemDescription, { color: theme.textMuted }]}>{descricaoEstado(item)}</Text>
            </View>
            <View style={styles.balanceColumn}>
              <Text style={[styles.balanceLabel, { color: theme.textMuted }]}>
                {item.tipo === "conta" ? "Seu saldo final" : "Saldo na separação"}
              </Text>
              <Text style={[styles.balanceValue, { color: Number(item.saldo_final) < 0 ? "#E76F51" : theme.primary }]}>
                {formatarReais(item.saldo_final)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <>
      <Modal transparent animationType="fade" visible={mostrarResumo && Boolean(resumo)} onRequestClose={() => {}}>
        <View style={styles.overlay}>
          <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
            <View style={[styles.topIcon, { backgroundColor: theme.primarySoft }]}>
              <MaterialIcons name="link-off" size={30} color={theme.primary} />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>Parceria encerrada</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              Confira como ficaram as contas e os objetivos que eram compartilhados.
            </Text>

            <ScrollView style={styles.itemsScroll} contentContainerStyle={styles.itemsContent} showsVerticalScrollIndicator={false}>
              {resumo?.itens.length === 0 ? (
                <View style={[styles.empty, { backgroundColor: theme.surfaceMuted }]}>
                  <MaterialIcons name="check-circle-outline" size={24} color={theme.primary} />
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>Não havia contas ou objetivos compartilhados.</Text>
                </View>
              ) : (
                <>
                  {renderItens("CONTAS", contas)}
                  {renderItens("OBJETIVOS", caixinhas)}
                </>
              )}
            </ScrollView>

            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.primary }, processando && styles.disabled]} onPress={onConfirmarResumo} disabled={processando}>
              {processando
                ? <ActivityIndicator color="#FFF" />
                : <><Text style={styles.primaryButtonText}>Continuar</Text><MaterialIcons name="arrow-forward" size={18} color="#FFF" /></>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal transparent animationType="fade" visible={mostrarDecisaoConta && Boolean(decisaoConta)} onRequestClose={() => {}}>
        <View style={styles.overlay}>
          <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
            <View style={[styles.topIcon, { backgroundColor: theme.primarySoft }]}>
              <MaterialIcons name="account-balance-wallet" size={30} color={theme.primary} />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>Conta após a parceria</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              A conta “{decisaoConta?.nome ?? ""}” agora é individual. Escolha como ela deve aparecer no FinFlow.
            </Text>

            <View style={[styles.accountSummary, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
              <Text style={[styles.accountSummaryLabel, { color: theme.textMuted }]}>Saldo final da conta</Text>
              <Text style={[styles.accountSummaryValue, { color: Number(decisaoConta?.saldo_final ?? 0) < 0 ? "#E76F51" : theme.text }]}>
                {formatarReais(decisaoConta?.saldo_final ?? 0)}
              </Text>
              <Text style={[styles.accountSummaryHint, { color: theme.textMuted }]}>
                {decisaoConta?.possui_lancamentos
                  ? "O histórico de lançamentos continuará vinculado à conta."
                  : "A conta possui saldo e continuará disponível no seu arquivo."}
              </Text>
            </View>

            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.primary }, processando && styles.disabled]} onPress={() => onResolverConta(true)} disabled={processando}>
              {processando ? <ActivityIndicator color="#FFF" /> : <><MaterialIcons name="visibility" size={18} color="#FFF" /><Text style={styles.primaryButtonText}>Manter ativa</Text></>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryButton, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }, processando && styles.disabled]} onPress={() => onResolverConta(false)} disabled={processando}>
              <MaterialIcons name="archive" size={18} color={theme.textMuted} />
              <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Arquivar conta</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.76)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 540, maxHeight: "90%", borderRadius: FinFlowRadius.large, borderWidth: 1, padding: 22, alignItems: "center", ...FinFlowShadow },
  topIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title: { fontSize: 21, fontWeight: "900", textAlign: "center" },
  subtitle: { fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7, marginBottom: 16, paddingHorizontal: 8 },
  itemsScroll: { width: "100%", maxHeight: 390, flexShrink: 1 },
  itemsContent: { paddingBottom: 4 },
  section: { width: "100%", marginBottom: 14 },
  sectionTitle: { fontSize: 10, fontWeight: "900", letterSpacing: 1.1, marginBottom: 7, marginLeft: 3 },
  item: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 15, padding: 11, marginBottom: 8, gap: 9 },
  itemIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  itemText: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 13, fontWeight: "800" },
  itemDescription: { fontSize: 9.5, lineHeight: 13.5, marginTop: 3 },
  balanceColumn: { alignItems: "flex-end", maxWidth: 115 },
  balanceLabel: { fontSize: 8.5 },
  balanceValue: { fontSize: 12, fontWeight: "900", marginTop: 2 },
  empty: { width: "100%", borderRadius: 15, padding: 18, alignItems: "center", gap: 7 },
  emptyText: { fontSize: 12, textAlign: "center" },
  accountSummary: { width: "100%", borderRadius: 17, borderWidth: 1, padding: 16, alignItems: "center", marginBottom: 16 },
  accountSummaryLabel: { fontSize: 10, fontWeight: "700" },
  accountSummaryValue: { fontSize: 25, fontWeight: "900", marginTop: 4 },
  accountSummaryHint: { fontSize: 10.5, lineHeight: 15, textAlign: "center", marginTop: 8 },
  primaryButton: { width: "100%", minHeight: 50, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 },
  primaryButtonText: { color: "#FFF", fontSize: 14, fontWeight: "900" },
  secondaryButton: { width: "100%", minHeight: 48, borderRadius: 15, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 },
  secondaryButtonText: { fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.58 },
});
