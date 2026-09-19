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
