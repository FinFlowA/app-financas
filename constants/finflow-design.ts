// Design Tokens v1.0 — ramps teal/green/mint da marca
export const FinFlowColors = {
  primary: "#34A164",
  primaryDark: "#2A8552",
  primarySoft: "#ECF8F0",
  mint: "#6FCB84",
  blue: "#4D76E8",
  orange: "#F28A55",
  red: "#C0392E",
  purple: "#805AD5",
} as const;

export const finFlowTheme = (isDark: boolean) => ({
  background: isDark ? "#0C161A" : "#F7F9F9",
  surface: isDark ? "#142226" : "#FFFFFF",
  surfaceElevated: isDark ? "#1F3237" : "#EAF4F6",
  surfaceMuted: isDark ? "#1A2A2F" : "#EFF2F3",
  text: isDark ? "#F2F6F6" : "#131819",
  textMuted: isDark ? "#8E9C9F" : "#6E7C80",
  border: isDark ? "#2A3639" : "#DFE5E6",
  // Tons 300/400 no escuro — os 500+ das ramps não passam contraste sobre fundo escuro
  primary: isDark ? "#52B87A" : FinFlowColors.primary,
  primaryDark: isDark ? "#79CD98" : FinFlowColors.primaryDark,
  primarySoft: isDark ? "#1A5233" : FinFlowColors.primarySoft,
  header: isDark ? "#0A2B32" : "#0E3B45",
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
