/**
 * Regras puras do módulo — sem `game`, sem DOM. É o que os testes cobrem.
 */

/**
 * Quem assiste a uma exibição.
 * @param {object} item        cutscene da biblioteca ({ audiencia: string[]|null })
 * @param {string[]|null} escolha  audiência escolhida na hora (sobrepõe a do item)
 * @param {{id: string, isGM: boolean, active: boolean}[]} usuarios
 * @returns {string[]} ids dos jogadores conectados que devem ver
 */
export function resolverAudiencia(item, escolha, usuarios) {
  const alvo = escolha ?? item?.audiencia ?? null;
  return usuarios
    .filter(u => u.active && !u.isGM)
    .filter(u => !alvo || alvo.includes(u.id))
    .map(u => u.id);
}

/** Quem da audiência ainda não tem o vídeo guardado. */
export function quemFalta(audiencia, inventario, itemId) {
  return audiencia.filter(id => !inventario.get(id)?.has(itemId));
}

/** Resumo de cache de um item para o card: "4/5". */
export function coberturaDoCache(item, usuarios, inventario) {
  const audiencia = resolverAudiencia(item, null, usuarios);
  const tem = audiencia.filter(id => inventario.get(id)?.has(item.id)).length;
  return { tem, total: audiencia.length, completo: audiencia.length > 0 && tem === audiencia.length };
}

/** Classifica o peso do vídeo para avisar o mestre antes que vire calor na mesa. */
export function pesoDoVideo({ largura, altura } = {}) {
  const pixels = (largura ?? 0) * (altura ?? 0);
  if (!pixels) return { rotulo: null, pesado: false };
  if (pixels > 2560 * 1440) return { rotulo: "4K", pesado: true };
  if (pixels > 1920 * 1080) return { rotulo: "1440p", pesado: false };
  return { rotulo: `${altura}p`, pesado: false };
}

/** mm:ss */
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Comando da macro de hotbar para um item. JSON.stringify protege contra aspas no id. */
export const comandoDaMacro = (itemId) => `game.cinema.exibir(${JSON.stringify(itemId)});`;

/** Nome legível a partir do caminho do arquivo. */
export function nomeDoArquivo(caminho) {
  const base = decodeURIComponent(caminho.split("?")[0].split("/").pop() ?? "");
  return base.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Cutscene";
}

/**
 * O jogador já está vendo o monitor inteiro?
 *
 * Tela cheia pedida pela página (Fullscreen API) é detectada com certeza.
 * A do próprio navegador (F11, ⌃⌘F) não é reportada pela API: comparamos o
 * tamanho da janela com o da tela, com 2px de folga para arredondamento.
 */
export function pareceTelaCheia({ fullscreenElement, displayModeFullscreen, innerWidth, innerHeight, screenWidth, screenHeight }) {
  if (fullscreenElement || displayModeFullscreen) return true;
  if (!screenWidth || !screenHeight) return false;
  return Math.abs(innerWidth - screenWidth) <= 2 && Math.abs(innerHeight - screenHeight) <= 2;
}

/**
 * Por quem vale a pena esperar antes de começar.
 * Quem já falhou o download (ou não tem codec) não vai ficar pronto: ele vê a
 * cena pela rede, e o resto da mesa não fica 25 s à espera dele.
 */
export function quemAguardar(audiencia, inventario, relatos, itemId) {
  return quemFalta(audiencia, inventario, itemId).filter(id => {
    const r = relatos.get(id);
    return !(r && r.itemId === itemId && (r.phase === "failed" || r.phase === "nocodec"));
  });
}

/** Nome do ficheiro de uma versão: "Cena.mp4" → "Cena-720p.mp4" (preserva a query). */
export function nomeDaVersao(src, altura) {
  return src.replace(/(\.[^./?]+)(\?.*)?$/, `-${altura}p$1$2`);
}

/**
 * A escada de versões de uma cutscene, da mais pesada para a mais leve.
 * O original é o primeiro degrau. `srcLeve` (0.8) continua a valer como degrau.
 */
export function escadaDoItem(item) {
  const degraus = [{ src: item.src, altura: item.altura ?? 99999, original: true }];
  for (const v of item.versoes ?? []) degraus.push({ src: v.src, altura: v.altura });
  if (item.srcLeve && !degraus.some(d => d.src === item.srcLeve)) {
    degraus.push({ src: item.srcLeve, altura: item.alturaLeve ?? 1080 });
  }
  return degraus.sort((a, b) => b.altura - a.altura);
}

/**
 * Que degrau este computador toca no arranque. Ninguém escolhe: é calculado.
 *
 * - nunca acima do que o ecrã mostra (acima disso é peso invisível);
 * - nunca acima do que este computador já mostrou não aguentar;
 * - acima de 1080p, só com o navegador a CONFIRMAR que toca com fluidez e por
 *   hardware. Sem confirmação, fica em 1080p — que em quase todos os ecrãs é
 *   igual à vista. (O primeiro teste real foi um 4K "não recusado" que perdeu
 *   71% dos quadros.)
 * - até 1080p basta o navegador não dizer que engasga.
 *
 * @param {object} o
 * @param {{src: string, altura: number}[]} o.escada   da mais pesada para a mais leve
 * @param {number} [o.teto]          altura máxima que este computador já mostrou aguentar
 * @param {number} [o.alturaTela]    pixels físicos do ecrã
 * @param {Record<number, {suave?: boolean, eficiente?: boolean}>} [o.capacidades]  por altura
 * @returns {number} índice do degrau
 */
export function escolherDegrau({ escada, teto, alturaTela, capacidades = {} }) {
  const ultimo = escada.length - 1;
  if (ultimo <= 0) return 0;

  let topo = 0;
  if (alturaTela) {
    for (let i = ultimo; i >= 0; i--) if (escada[i].altura >= alturaTela * 0.9) { topo = i; break; }
  }

  for (let i = topo; i <= ultimo; i++) {
    const { altura } = escada[i];
    if (teto && altura > teto) continue;
    const c = capacidades[altura] ?? {};
    const confirmado = c.suave === true && c.eficiente === true;
    const recusado = c.suave === false || c.eficiente === false;
    if (altura > 1080 ? !confirmado : recusado) continue;
    return i;
  }
  return ultimo;
}

/**
 * Descer um degrau a meio da cena?
 *
 * `amostras` são leituras acumuladas de getVideoPlaybackQuality(), uma por
 * segundo. Desce se nos últimos `segundos` TODOS os intervalos perderam mais
 * de `limiar` dos quadros — um pico isolado (alt-tab, notificação) não conta.
 */
export function deveDescer(amostras, { limiar = 0.2, segundos = 3, minimoQuadros = 10 } = {}) {
  if (amostras.length < segundos + 1) return false;
  const recentes = amostras.slice(-(segundos + 1));
  for (let i = 1; i < recentes.length; i++) {
    const quadros = recentes[i].total - recentes[i - 1].total;
    const perdidos = recentes[i].perdidos - recentes[i - 1].perdidos;
    if (quadros < minimoQuadros) return false;          // vídeo parado ou aba oculta: não decide
    if (perdidos / quadros < limiar) return false;
  }
  return true;
}
