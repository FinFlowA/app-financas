import { MaterialIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type MaterialIconName = React.ComponentProps<typeof MaterialIcons>["name"];

type TutorialStep = {
  icon: MaterialIconName;
  eyebrow: string;
  title: string;
  description: string;
  hint: string;
};

const STEPS: TutorialStep[] = [
  {
    icon: "account-balance-wallet",
    eyebrow: "Início",
    title: "Monte sua visão financeira",
    description:
      "Na tela Início, toque no seletor de contas para criar, editar, arquivar e escolher quais contas entram no saldo geral.",
    hint: "O ícone de olho oculta seus valores. O sino reúne atrasos, vencimentos de hoje e os próximos agendamentos.",
  },
  {
    icon: "receipt-long",
    eyebrow: "Transações",
    title: "Registre cada movimentação",
    description:
      "Use Transação para lançar uma receita, despesa ou transferência. Escolha conta, categoria, valor, data e se já aconteceu ou ficou pendente.",
    hint: "Você também pode parcelar ou criar uma recorrência. Transferências entre suas contas não são receitas nem despesas.",
  },
  {
    icon: "history",
    eyebrow: "Histórico",
    title: "Encontre e conclua lançamentos",
    description:
      "No Histórico, navegue pelos meses e filtre por situação, conta, categoria e tipo para localizar rapidamente o que procura.",
    hint: "Ao dar baixa em um lançamento pendente, confirme a data e o valor realmente pago ou recebido.",
  },
  {
    icon: "savings",
    eyebrow: "Objetivos",
    title: "Guarde dinheiro em caixinhas",
    description:
      "Crie um objetivo com valor e data, depois use Guardar ou Resgatar para mover dinheiro entre uma conta e a caixinha.",
    hint: "Guardar ou resgatar é uma transferência e não altera o balanço do mês. Uma despesa paga depois do resgate entra normalmente.",
  },
  {
    icon: "credit-card",
    eyebrow: "Cartões",
    title: "Acompanhe compras e faturas",
    description:
      "Cadastre seus cartões, lance compras na fatura correta e acompanhe fechamento, vencimento e pagamentos.",
    hint: "Você pode pagar a fatura inteira, fazer um pagamento parcial ou levar o saldo restante para a próxima fatura.",
  },
  {
    icon: "query-stats",
    eyebrow: "Fluxo de caixa",
    title: "Entenda o presente e o futuro",
    description:
      "Compare no mesmo gráfico as entradas, saídas e a evolução do saldo realizado e previsto ao longo dos meses.",
    hint: "Selecione uma ou mais contas e arraste o gráfico para os lados para consultar outros meses.",
  },
  {
    icon: "auto-awesome",
    eyebrow: "IA FinFlow",
    title: "Peça ajuda em linguagem natural",
    description:
      "Consulte seus dados financeiros ou peça para a IA preparar ações, como criar lançamentos, contas, categorias e objetivos.",
    hint: "Revise a prévia antes de confirmar: a IA nunca deve alterar seus dados sem sua confirmação.",
  },
  {
    icon: "shield",
    eyebrow: "Ajustes e segurança",
    title: "Proteja e personalize sua conta",
    description:
      "Em Ajustes, escolha tema e notificações, atualize dados de acesso, ative a proteção do app e gerencie vínculos e privacidade.",
    hint: "Tudo pronto. Você pode pular este tutorial agora e consultar as funções do app quando precisar.",
  },
];

type FinFlowOnboardingProps = {
  visible: boolean;
  isDark: boolean;
  onFinish: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
};

export default function FinFlowOnboarding({
  visible,
  isDark,
  onFinish,
  onSkip,
}: FinFlowOnboardingProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS.find((_, index) => index === stepIndex) ?? STEPS[0];
  const lastStep = stepIndex === STEPS.length - 1;

  useEffect(() => {
    if (visible) setStepIndex(0);
  }, [visible]);

  const colors = isDark
    ? {
        surface: "#101D21",
        surfaceSoft: "#17272B",
        border: "#294147",
        text: "#F7FBFA",
        muted: "#AFC0BD",
        hint: "#D5E5E1",
        overlay: "rgba(3, 12, 14, 0.84)",
      }
    : {
        surface: "#FFFFFF",
        surfaceSoft: "#EDF8F4",
        border: "#D1E8E1",
        text: "#112723",
        muted: "#60736F",
        hint: "#385B54",
        overlay: "rgba(8, 24, 22, 0.62)",
      };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      statusBarTranslucent
      onRequestClose={() => void onSkip()}
    >
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.topRow}>
            <View
              style={[styles.stepBadge, { backgroundColor: colors.surfaceSoft }]}
              accessibilityLabel={`Etapa ${stepIndex + 1} de ${STEPS.length}`}
            >
              <Text style={[styles.stepBadgeText, { color: "#159C7C" }]}>
                {stepIndex + 1} de {STEPS.length}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => void onSkip()}
              accessibilityRole="button"
              accessibilityLabel="Pular tutorial"
              hitSlop={12}
              style={styles.skipButton}
            >
              <Text style={[styles.skipText, { color: colors.muted }]}>Pular</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            key={stepIndex}
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.illustration}>
              <View style={[styles.glowLarge, { backgroundColor: "rgba(35, 191, 142, 0.12)" }]} />
              <View style={[styles.glowSmall, { backgroundColor: "rgba(93, 220, 177, 0.15)" }]} />
              <View style={styles.iconCircle}>
                <MaterialIcons name={step.icon} size={46} color="#FFFFFF" />
              </View>
            </View>

            <Text style={styles.eyebrow}>{step.eyebrow}</Text>
            <Text style={[styles.title, { color: colors.text }]}>{step.title}</Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              {step.description}
            </Text>

            <View
              style={[
                styles.hintBox,
                { backgroundColor: colors.surfaceSoft, borderColor: colors.border },
              ]}
            >
              <MaterialIcons name="tips-and-updates" size={20} color="#159C7C" />
              <Text style={[styles.hintText, { color: colors.hint }]}>{step.hint}</Text>
            </View>

            <View style={styles.dots} accessibilityElementsHidden>
              {STEPS.map((item, index) => (
                <View
                  key={item.title}
                  style={[
                    styles.dot,
                    index === stepIndex
                      ? styles.dotActive
                      : { backgroundColor: isDark ? "#365057" : "#C7DAD5" },
                  ]}
                />
              ))}
            </View>
          </ScrollView>

          <View style={styles.actions}>
            {stepIndex > 0 ? (
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: colors.border }]}
                onPress={() => setStepIndex((current) => current - 1)}
                accessibilityRole="button"
                accessibilityLabel="Voltar uma etapa"
              >
                <MaterialIcons name="arrow-back" size={20} color={colors.hint} />
                <Text style={[styles.secondaryButtonText, { color: colors.hint }]}>Voltar</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.primaryButton, stepIndex === 0 && styles.primaryButtonFull]}
              onPress={() => {
                if (lastStep) {
                  void onFinish();
                  return;
                }
                setStepIndex((current) => current + 1);
              }}
              accessibilityRole="button"
              accessibilityLabel={lastStep ? "Começar a usar o FinFlow" : "Ir para a próxima etapa"}
            >
              <Text style={styles.primaryButtonText}>
                {lastStep ? "Começar agora" : "Próximo"}
              </Text>
              <MaterialIcons name={lastStep ? "check" : "arrow-forward"} size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
    maxHeight: "92%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.28,
    shadowRadius: 32,
    elevation: 18,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bodyScroll: { flexShrink: 1 },
  bodyContent: { flexGrow: 0 },
  stepBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  stepBadgeText: { fontSize: 12, fontWeight: "800" },
  skipButton: { paddingVertical: 7, paddingLeft: 14 },
  skipText: { fontSize: 14, fontWeight: "700" },
  illustration: {
    height: 144,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginTop: 8,
  },
  glowLarge: {
    position: "absolute",
    width: 174,
    height: 174,
    borderRadius: 87,
  },
  glowSmall: {
    position: "absolute",
    width: 122,
    height: 122,
    borderRadius: 61,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: "#159C7C",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#159C7C",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 8,
  },
  eyebrow: {
    color: "#159C7C",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textAlign: "center",
    textTransform: "uppercase",
  },
  title: {
    fontSize: 27,
    lineHeight: 33,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 8,
  },
  description: {
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
    marginTop: 10,
  },
  hintBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    marginTop: 20,
  },
  hintText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 7,
    marginVertical: 22,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotActive: { width: 24, backgroundColor: "#159C7C" },
  actions: { flexDirection: "row", gap: 10 },
  secondaryButton: {
    minHeight: 52,
    flex: 0.8,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  secondaryButtonText: { fontSize: 14, fontWeight: "800" },
  primaryButton: {
    minHeight: 52,
    flex: 1.2,
    borderRadius: 15,
    backgroundColor: "#159C7C",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonFull: { flex: 1 },
  primaryButtonText: { color: "#FFF", fontSize: 15, fontWeight: "900" },
});
