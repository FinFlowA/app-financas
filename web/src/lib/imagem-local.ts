"use client";

/** Imagem lida no navegador (nunca enviada ao servidor). */
export type ImagemLocal = { dataUrl: string; largura: number; altura: number };

const LOGO_CHAVE = "finflow:orcamento:logo";

/** Lê o arquivo e o reduz (lado maior até `maxLado`), em JPEG, para o PDF não ficar pesado. */
export function lerImagemReduzida(arquivo: File, maxLado = 600): Promise<ImagemLocal> {
  return new Promise((resolve, reject) => {
    if (!arquivo.type.startsWith("image/")) return reject(new Error("Escolha um arquivo de imagem."));
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
      const largura = Math.max(1, Math.round(img.naturalWidth * escala));
      const altura = Math.max(1, Math.round(img.naturalHeight * escala));
      const canvas = document.createElement("canvas");
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); return reject(new Error("Não foi possível ler a imagem.")); }
      // Fundo branco: PNG transparente vira JPEG sem fundo preto.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, largura, altura);
      ctx.drawImage(img, 0, 0, largura, altura);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.85), largura, altura });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não foi possível ler a imagem.")); };
    img.src = url;
  });
}

/** A logo fica só neste navegador (localStorage), para não precisar enviar a cada orçamento. */
export function logoGuardada(): ImagemLocal | null {
  try {
    const bruto = window.localStorage.getItem(LOGO_CHAVE);
    const dados = bruto ? JSON.parse(bruto) as ImagemLocal : null;
    return dados && typeof dados.dataUrl === "string" && dados.dataUrl.startsWith("data:image/") ? dados : null;
  } catch { return null; }
}

export function guardarLogo(logo: ImagemLocal | null): void {
  try {
    if (logo) window.localStorage.setItem(LOGO_CHAVE, JSON.stringify(logo));
    else window.localStorage.removeItem(LOGO_CHAVE);
  } catch { /* sem armazenamento (aba anônima ou cheio): a logo vale só nesta página */ }
}
