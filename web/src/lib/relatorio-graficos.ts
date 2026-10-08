// Desenha os gráficos do relatório numa imagem (PNG), no navegador. A mesma
// imagem vai para o PDF e para o Excel, então os dois mostram o mesmo gráfico.
import type { BlocoRelatorio, GraficoRelatorio } from "./relatorio-tipos";

export type ImagemGrafico = { png: ArrayBuffer; dataUrl: string; largura: number; altura: number; escala: number };

const ESCALA = 2;
const CORES = {
  receita: "#16966E",
  despesa: "#D2463C",
  linha: "#16966E",
  grade: "#E2E8E5",
  eixo: "#9AA8A3",
  texto: "#4B5A55",
  forte: "#1E2A27",
  barra: "#3F8F7A",
};
const FONTE = "Helvetica, Arial, sans-serif";

/** "R$ 12,3 mil", "R$ 1,2 mi", "R$ 950": cabe no eixo sem esconder a ordem de grandeza. */
export function reaisCompacto(valor: number): string {
  const absoluto = Math.abs(valor);
  const sinal = valor < 0 ? "-" : "";
  if (absoluto >= 1_000_000) return `${sinal}R$ ${(absoluto / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (absoluto >= 1_000) return `${sinal}R$ ${(absoluto / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `${sinal}R$ ${absoluto.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

function reaisCompletos(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor).replace(/ /g, " ");
}

/** Limites "redondos" para o eixo, com folga acima e abaixo dos dados. */
export function escalaDoEixo(minimo: number, maximo: number, incluirZero: boolean): { piso: number; teto: number; passo: number } {
  let baixo = incluirZero ? Math.min(0, minimo) : minimo;
  let alto = incluirZero ? Math.max(0, maximo) : maximo;
  if (alto - baixo < 1) {
    alto += 1;
    baixo -= incluirZero && baixo === 0 ? 0 : 1;
  }
  const folga = (alto - baixo) * 0.08;
  if (!(incluirZero && baixo === 0)) baixo -= folga;
  alto += folga;
  const bruto = (alto - baixo) / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((fator) => fator * potencia).find((candidato) => candidato >= bruto) ?? bruto;
  return { piso: Math.floor(baixo / passo) * passo, teto: Math.ceil(alto / passo) * passo, passo };
}

function prepararTela(largura: number, altura: number) {
  const tela = document.createElement("canvas");
  tela.width = largura * ESCALA;
  tela.height = altura * ESCALA;
  const ctx = tela.getContext("2d");
  if (!ctx) throw new Error("Sem suporte a gráficos neste navegador.");
  ctx.scale(ESCALA, ESCALA);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, largura, altura);
  ctx.textBaseline = "middle";
  return { tela, ctx };
}

function eixoY(ctx: CanvasRenderingContext2D, area: { x: number; y: number; w: number; h: number }, escala: { piso: number; teto: number; passo: number }) {
  const yDe = (valor: number) => area.y + area.h - ((valor - escala.piso) / (escala.teto - escala.piso)) * area.h;
  ctx.font = `11px ${FONTE}`;
  ctx.textAlign = "right";
  for (let valor = escala.piso; valor <= escala.teto + escala.passo / 2; valor += escala.passo) {
    const y = yDe(valor);
    ctx.strokeStyle = Math.abs(valor) < escala.passo / 1000 ? CORES.eixo : CORES.grade;
    ctx.lineWidth = Math.abs(valor) < escala.passo / 1000 ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
    ctx.stroke();
    ctx.fillStyle = CORES.texto;
    ctx.fillText(reaisCompacto(valor), area.x - 8, y);
  }
  return yDe;
}

function rotulosX(ctx: CanvasRenderingContext2D, rotulos: string[], xDe: (indice: number) => number, y: number) {
  ctx.font = `11px ${FONTE}`;
  ctx.textAlign = "center";
  ctx.fillStyle = CORES.texto;
  // Muitos pontos: mostra um rótulo a cada tantos, sem amontoar.
  const salto = Math.max(1, Math.ceil(rotulos.length / 14));
  rotulos.forEach((rotulo, indice) => {
    if (indice % salto === 0 || indice === rotulos.length - 1) ctx.fillText(rotulo, xDe(indice), y);
  });
}

function desenharLinha(grafico: Extract<GraficoRelatorio, { tipo: "linha" }>, largura: number, altura: number) {
  const { tela, ctx } = prepararTela(largura, altura);
  const area = { x: 84, y: 18, w: largura - 84 - 28, h: altura - 18 - 34 };
  const escala = escalaDoEixo(Math.min(...grafico.valores), Math.max(...grafico.valores), false);
  const yDe = eixoY(ctx, area, escala);
  const n = grafico.valores.length;
  const xDe = (indice: number) => area.x + (n <= 1 ? area.w / 2 : (indice / (n - 1)) * area.w);
  rotulosX(ctx, grafico.rotulos, xDe, area.y + area.h + 18);

  const projetadoDesde = grafico.projetadoDesde ?? n;
  const trecho = (de: number, ate: number, tracejado: boolean) => {
    if (ate <= de) return;
    ctx.save();
    ctx.strokeStyle = CORES.linha;
    ctx.lineWidth = 2.5;
    ctx.setLineDash(tracejado ? [7, 6] : []);
    ctx.beginPath();
    for (let indice = de; indice <= ate; indice += 1) {
      const x = xDe(indice);
      const y = yDe(grafico.valores[indice]);
      if (indice === de) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  };
  trecho(0, Math.min(projetadoDesde - 1, n - 1), false);
  trecho(Math.max(0, projetadoDesde - 1), n - 1, true);

  grafico.valores.forEach((valor, indice) => {
    ctx.beginPath();
    ctx.arc(xDe(indice), yDe(valor), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = indice >= projetadoDesde ? "#FFFFFF" : CORES.linha;
    ctx.strokeStyle = CORES.linha;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  });

  // Valor do último ponto realizado e do último projetado.
  ctx.font = `bold 11px ${FONTE}`;
  ctx.fillStyle = CORES.forte;
  // O realizado fica acima do ponto e o previsto, abaixo: os dois não se sobrepõem.
  const anotar = (indice: number, prefixo: string, abaixo: boolean) => {
    if (indice < 0 || indice >= n) return;
    const x = xDe(indice);
    ctx.textAlign = x > area.x + area.w - 70 ? "right" : x < area.x + 60 ? "left" : "center";
    const deslocamento = ctx.textAlign === "right" ? -6 : ctx.textAlign === "left" ? 6 : 0;
    ctx.fillText(`${prefixo}${reaisCompacto(grafico.valores[indice])}`, x + deslocamento, yDe(grafico.valores[indice]) + (abaixo ? 15 : -13));
  };
  anotar(Math.min(projetadoDesde, n) - 1, "", false);
  if (projetadoDesde < n) anotar(n - 1, "Previsto: ", true);
  return tela;
}

function desenharBarras(grafico: Extract<GraficoRelatorio, { tipo: "barras" }>, largura: number, altura: number) {
  const { tela, ctx } = prepararTela(largura, altura);
  const area = { x: 84, y: 30, w: largura - 84 - 20, h: altura - 30 - 34 };
  const todos = grafico.series.flatMap((serie) => serie.valores);
  const escala = escalaDoEixo(Math.min(0, ...todos), Math.max(0, ...todos), true);
  const yDe = eixoY(ctx, area, escala);
  const grupos = grafico.rotulos.length;
  const larguraGrupo = area.w / Math.max(1, grupos);
  const larguraBarra = Math.min(26, (larguraGrupo * 0.7) / grafico.series.length);
  const xDe = (indice: number) => area.x + larguraGrupo * indice + larguraGrupo / 2;
  grafico.series.forEach((serie, ordem) => {
    ctx.fillStyle = serie.tom === "receita" ? CORES.receita : CORES.despesa;
    serie.valores.forEach((valor, indice) => {
      const x = xDe(indice) - (larguraBarra * grafico.series.length) / 2 + ordem * larguraBarra;
      const topo = yDe(Math.max(0, valor));
      const base = yDe(Math.min(0, valor));
      ctx.fillRect(x + 1, topo, larguraBarra - 2, Math.max(1, base - topo));
    });
  });
  rotulosX(ctx, grafico.rotulos, xDe, area.y + area.h + 18);
  // Legenda no alto, à direita.
  ctx.font = `12px ${FONTE}`;
  ctx.textAlign = "left";
  let x = area.x + area.w;
  for (const serie of [...grafico.series].reverse()) {
    const largura = ctx.measureText(serie.nome).width;
    x -= largura + 34;
    ctx.fillStyle = serie.tom === "receita" ? CORES.receita : CORES.despesa;
    ctx.fillRect(x, 9, 12, 12);
    ctx.fillStyle = CORES.texto;
    ctx.fillText(serie.nome, x + 17, 15);
  }
  return tela;
}

function desenharBarrasHorizontais(grafico: Extract<GraficoRelatorio, { tipo: "barras_horizontais" }>, largura: number, altura: number) {
  const { tela, ctx } = prepararTela(largura, altura);
  const margemRotulo = 190;
  const margemValor = 170;
  const linhas = grafico.rotulos.length;
  const alturaLinha = Math.min(30, (altura - 16) / Math.max(1, linhas));
  const maximo = Math.max(...grafico.valores, 1);
  const larguraUtil = largura - margemRotulo - margemValor - 16;
  ctx.font = `12px ${FONTE}`;
  grafico.rotulos.forEach((rotulo, indice) => {
    const y = 8 + indice * alturaLinha + alturaLinha / 2;
    ctx.textAlign = "right";
    ctx.fillStyle = CORES.forte;
    const texto = rotulo.length > 26 ? `${rotulo.slice(0, 25)}…` : rotulo;
    ctx.fillText(texto, margemRotulo - 10, y);
    const barra = Math.max(2, (grafico.valores[indice] / maximo) * larguraUtil);
    ctx.fillStyle = CORES.barra;
    ctx.fillRect(margemRotulo, y - alturaLinha * 0.32, barra, alturaLinha * 0.64);
    ctx.textAlign = "left";
    ctx.fillStyle = CORES.texto;
    const percentual = `${(grafico.percentuais[indice] * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    ctx.fillText(`${reaisCompletos(grafico.valores[indice])} · ${percentual}`, margemRotulo + barra + 8, y);
  });
  return tela;
}

/** Tamanho em que o gráfico aparece (em pixels "de tela"; a imagem tem o dobro, para ficar nítida). */
export function tamanhoDoGrafico(grafico: GraficoRelatorio): { largura: number; altura: number } {
  if (grafico.tipo === "barras_horizontais") return { largura: 900, altura: Math.max(90, 16 + grafico.rotulos.length * 30) };
  return { largura: 900, altura: 250 };
}

async function paraPng(tela: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob | null>((resolve) => tela.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Não foi possível gerar o gráfico.");
  return blob.arrayBuffer();
}

/** Desenha todos os gráficos do relatório. */
export async function desenharGraficos(blocos: BlocoRelatorio[]): Promise<Map<string, ImagemGrafico>> {
  const imagens = new Map<string, ImagemGrafico>();
  for (const bloco of blocos) {
    if (bloco.tipo !== "grafico") continue;
    const { grafico } = bloco;
    const { largura, altura } = tamanhoDoGrafico(grafico);
    const tela = grafico.tipo === "linha"
      ? desenharLinha(grafico, largura, altura)
      : grafico.tipo === "barras"
        ? desenharBarras(grafico, largura, altura)
        : desenharBarrasHorizontais(grafico, largura, altura);
    imagens.set(grafico.id, { png: await paraPng(tela), dataUrl: tela.toDataURL("image/png"), largura, altura, escala: ESCALA });
  }
  return imagens;
}
