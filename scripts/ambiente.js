import { MODULE_ID, warn } from "./const.js";

/**
 * O que está em volta da cutscene: a música das playlists e o canvas do Foundry.
 * Tudo aqui é local a este cliente e sempre reversível.
 */

// ------------------------------------------------------------------ música
let musicaGuardada = [];   // [{ som, volume }]
const aVoltar = new Map();  // som → volume para onde um restauro em curso está a subir
let fimDoRestauro = null;

/** Abaixa a música das playlists para a trilha da cutscene reinar sozinha. */
export function abaixarMusica(duracao = 1000) {
  if (!game.settings.get(MODULE_ID, "silenciarMusica")) return;
  restaurarMusica(0);   // nunca empilhar duas vezes
  for (const playlist of game.playlists?.playing ?? []) {
    for (const ps of playlist.sounds.filter(s => s.playing)) {
      const som = ps.sound;
      if (!som) continue;
      // cena seguida de outra: a música ainda está a subir do fim da anterior,
      // e som.volume é um valor a meio caminho. O volume certo é o de destino.
      musicaGuardada.push({ som, volume: aVoltar.get(som) ?? som.volume });
      som.fade(0, { duration: duracao });
    }
  }
  aVoltar.clear();
}

/** Devolve a música ao volume de antes. */
export function restaurarMusica(duracao = 1500) {
  for (const { som, volume } of musicaGuardada) {
    try { som.fade(volume, { duration: duracao }); } catch { /* som já foi descartado */ }
    aVoltar.set(som, volume);
  }
  musicaGuardada = [];
  clearTimeout(fimDoRestauro);
  fimDoRestauro = setTimeout(() => aVoltar.clear(), duracao + 100);
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

// ------------------------------------------------------------------ alívio (mestre, opcional)
let alivio = null;

/**
 * Baixa o canvas do mestre para `fps` enquanto ele vê a cena no monitor.
 * Opcional e desligado por padrão: o mestre continua a ver e a mexer no canvas,
 * só com menos quadros. Nunca sobe o fps de quem já tem um teto menor.
 */
export function aliviarCanvas(fps = 30) {
  const ticker = canvas?.app?.ticker;
  if (!ticker || alivio) return;
  const atual = ticker.maxFPS;
  if (atual && atual <= fps) return;
  alivio = { maxFPS: atual, fps };
  ticker.maxFPS = fps;
}

export function desaliviarCanvas() {
  if (!alivio) return;
  try { if (canvas?.app?.ticker) canvas.app.ticker.maxFPS = alivio.maxFPS; }
  finally { alivio = null; }
}

/**
 * O Foundry reconfigura o ticker quando o canvas é redesenhado (mudança de cena):
 * re-aplica o que estava ativo SEM voltar a ler o estado. Ler de novo guardaria
 * o próprio congelamento (canvas escondido, 1 fps) como se fosse o original, e
 * no fim da cena o mapa ficava invisível.
 */
export function canvasFoiRedesenhado() {
  const app = canvas?.app;
  if (!app) return;
  if (canvasGuardado) {
    const vista = app.view ?? app.canvas;
    try {
      if (app.ticker) app.ticker.maxFPS = 1;
      if (vista) vista.style.visibility = "hidden";
    } catch (err) {
      warn("não consegui re-congelar o canvas:", err.message);
    }
  }
  if (alivio && app.ticker) {
    // se o Foundry repôs o fps, o valor dele passa a ser o que devolvemos no fim
    const atual = app.ticker.maxFPS;
    if (!atual || atual > alivio.fps) {
      alivio.maxFPS = atual;
      app.ticker.maxFPS = alivio.fps;
    }
  }
}
