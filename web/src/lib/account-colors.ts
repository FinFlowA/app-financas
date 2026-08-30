export const ACCOUNT_COLORS = [
  "#2A9D8F", "#E9C46A", "#F4A261", "#E76F51",
  "#264653", "#8AB17D", "#8A05BE", "#EC7000",
  "#457B9D", "#CC092F", "#005CA9", "#1D3557",
  "#E63946", "#6D597A", "#B56576", "#3A86FF",
  "#8338EC", "#FF006E", "#3A5A40", "#D97706",
] as const;

export function isAccountColor(value: string) {
  return (ACCOUNT_COLORS as readonly string[]).includes(value);
}
