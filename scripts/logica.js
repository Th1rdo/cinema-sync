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

/**
 * Que versão da cutscene este computador toca.
 *
 * A regra é nunca perder qualidade visível: o original vai para quem o
 * consegue tocar com fluidez E tem ecrã para o mostrar. A versão leve vai
 * para quem sofreria com o original, ou para quem nem veria a diferença.
 *
 * @param {object} o
 * @param {boolean} o.temLeve       a cutscene tem versão leve?
 * @param {"auto"|"leve"|"original"} o.preferencia   escolha do jogador
 * @param {boolean} o.lembrarLeve   este computador já perdeu muitos quadros antes
 * @param {boolean|undefined} o.suave      o navegador diz que decodifica o original sem engasgar
 * @param {boolean|undefined} o.eficiente  …e com hardware (não CPU)
 * @param {number} o.alturaTela     pixels físicos do ecrã
 * @param {number} [o.alturaLeve]   altura da versão leve
 */
export function escolherVersao({ temLeve, preferencia = "auto", lembrarLeve = false, suave, eficiente, alturaTela, alturaLeve = 1080 }) {
  if (!temLeve) return "original";
  if (preferencia === "leve" || preferencia === "original") return preferencia;
  if (lembrarLeve) return "leve";
  if (suave === false || eficiente === false) return "leve";
  if (alturaTela && alturaTela <= alturaLeve * 1.1) return "leve";      // o 4K seria peso invisível
  return "original";
}
