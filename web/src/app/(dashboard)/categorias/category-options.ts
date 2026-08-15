/**
 * Valores persistidos pelo aplicativo mobile no Supabase.
 *
 * O site usa os mesmos identificadores Material Icons; não converta nem
 * renomeie esses valores ao salvar, pois app e web leem a mesma categoria.
 */
// Mesma paleta persistida e oferecida pelo aplicativo mobile. Manter esta
// lista compartilhada por valor evita que uma categoria criada no site abra
// com uma cor "inválida" ao ser editada no app (e vice-versa).
export const CATEGORY_COLORS = [
  "#2A9D8F", "#E9C46A", "#F4A261", "#E76F51",
  "#264653", "#8AB17D", "#457B9D", "#8A05BE",
  "#E63946", "#1D3557", "#EC7000", "#CC092F",
  "#005CA9", "#6D597A", "#B56576", "#3A86FF",
] as const;

export const CATEGORY_ICONS = [
  "label", "restaurant", "directions-car", "home", "favorite",
  "shopping-cart", "school", "fitness-center", "local-hospital",
  "flight", "beach-access", "pets", "work", "sports-esports",
  "music-note", "local-movies", "attach-money", "savings",
  "card-giftcard", "build", "coffee", "local-gas-station", "child-care",
  "spa", "book", "camera-alt", "palette", "two-wheeler", "commute",
  "electrical-services", "water-drop", "wifi", "phone-android", "laptop",
  "checkroom", "local-grocery-store", "bakery-dining", "medical-services",
  "payments", "trending-up", "volunteer-activism", "business-center",
  // Valores legados continuam renderizáveis para não quebrar cadastros antigos.
  "wallet", "shopping-bag", "more-horiz",
] as const;

export type CategoryIconName = (typeof CATEGORY_ICONS)[number];
export type CategoryColor = (typeof CATEGORY_COLORS)[number];
