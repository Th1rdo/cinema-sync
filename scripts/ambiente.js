import { MODULE_ID, warn } from "./const.js";

/**
 * O que está em volta da cutscene: a música das playlists e o canvas do Foundry.
 * Tudo aqui é local a este cliente e sempre reversível.
 */

// ------------------------------------------------------------------ música
let musicaGuardada = [];   // [{ som, volume }]

/** Abaixa a música das playlists para a trilha da cutscene reinar sozinha. */
export function abaixarMusica(duracao = 1000) {
  if (!game.settings.get(MODULE_ID, "silenciarMusica")) return;
  restaurarMusica(0);   // nunca empilhar duas vezes
  for (const playlist of game.playlists?.playing ?? []) {
    for (const ps of playlist.sounds.filter(s => s.playing)) {
      const som = ps.sound;
      if (!som) continue;
      musicaGuardada.push({ som, volume: som.volume });
      som.fade(0, { duration: duracao });
    }
  }
}

/** Devolve a música ao volume de antes. */
export function restaurarMusica(duracao = 1500) {
  for (const { som, volume } of musicaGuardada) {
    try { som.fade(volume, { duration: duracao }); } catch { /* som já foi descartado */ }
  }
  musicaGuardada = [];
}

// ------------------------------------------------------------------ canvas
let canvasGuardado = null;

/**
 * Tira o canvas do Foundry do ar enquanto a cena passa.
 *
 * Sem isso, o PIXI continua renderizando iluminação, visão e animações a 60 fps
 * atrás da tela preta: trabalho dobrado de GPU para algo que ninguém vê.
 * Usamos maxFPS = 1 em vez de parar o ticker: se algo der errado na volta, o
 * canvas fica lento, nunca congelado.
 */
export function congelarCanvas() {
  const app = canvas?.app;
  if (!app || canvasGuardado) return;
  const vista = app.view ?? app.canvas;
  canvasGuardado = {
    maxFPS: app.ticker?.maxFPS ?? 0,
    visibilidade: vista?.style.visibility ?? ""
  };
  try {
    if (app.ticker) app.ticker.maxFPS = 1;
    if (vista) vista.style.visibility = "hidden";
  } catch (err) {
    warn("não consegui congelar o canvas:", err.message);
  }
}

export function descongelarCanvas() {
  const app = canvas?.app;
  if (!app || !canvasGuardado) return;
  const vista = app.view ?? app.canvas;
  try {
    if (app.ticker) app.ticker.maxFPS = canvasGuardado.maxFPS;
    if (vista) vista.style.visibility = canvasGuardado.visibilidade;
  } finally {
    canvasGuardado = null;
  }
}

/** O Foundry reconfigura o ticker quando o canvas é redesenhado: re-congela. */
export function canvasFoiRedesenhado() {
  if (!canvasGuardado) return;
  canvasGuardado = null;
  congelarCanvas();
}
