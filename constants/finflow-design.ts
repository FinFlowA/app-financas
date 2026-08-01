export const FinFlowColors = {
  primary: "#16966E",
  primaryDark: "#08745B",
  primarySoft: "#DDF4E9",
  mint: "#56D39B",
  blue: "#4D76E8",
  orange: "#F28A55",
  red: "#EE6B63",
  purple: "#805AD5",
} as const;

export const finFlowTheme = (isDark: boolean) => ({
  background: isDark ? "#081116" : "#F6F8F6",
  surface: isDark ? "#111B20" : "#FFFFFF",
  surfaceElevated: isDark ? "#172328" : "#FFFFFF",
  surfaceMuted: isDark ? "#1C292E" : "#EEF3F0",
  text: isDark ? "#F4F8F6" : "#173129",
  textMuted: isDark ? "#92A49E" : "#6C7D77",
  border: isDark ? "#26363C" : "#DDE7E2",
  primary: FinFlowColors.primary,
  primaryDark: FinFlowColors.primaryDark,
  primarySoft: isDark ? "#113D31" : FinFlowColors.primarySoft,
  header: isDark ? "#075348" : "#1EA778",
  overlay: "rgba(2, 12, 15, 0.78)",
});

export const FinFlowRadius = {
  small: 10,
  medium: 16,
  large: 22,
  pill: 999,
} as const;

export const FinFlowShadow = {
  shadowColor: "#021B12",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.12,
  shadowRadius: 14,
  elevation: 5,
} as const;

/**
 * Medidas compartilhadas do topo verde das abas principais.
 * Manter estes valores centralizados evita que cada tela volte a adotar
 * uma altura ou curvatura diferente.
 */
export const FinFlowTabHeader = {
  expandedHeight: 120,
  compactHeight: 72,
  expandedRadius: 24,
  compactRadius: 17,
} as const;
