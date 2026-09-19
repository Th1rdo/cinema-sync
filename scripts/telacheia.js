import { MSG } from "./const.js";
import { enviar } from "./net.js";
import { pareceTelaCheia } from "./logica.js";

/**
 * Tela cheia.
 *
 * O navegador tem dois tipos de "o jogador já clicou":
 * - ativação persistente: clicou alguma vez na sessão. É o que libera o SOM.
 * - ativação transitória: clicou há poucos segundos. É o que a TELA CHEIA exige.
 * A separação é de segurança (um site em tela cheia pode desenhar um ecrã falso),
 * e nenhum módulo a contorna. Por isso a tela cheia só acontece quando o jogador
 * clica no botão do canto da cena.
 */

export function estaEmTelaCheia() {
  return pareceTelaCheia({
    fullscreenElement: document.fullscreenElement,
    displayModeFullscreen: globalThis.matchMedia?.("(display-mode: fullscreen)").matches,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    screenWidth: globalThis.screen?.width,
    screenHeight: globalThis.screen?.height
  });
}

// ------------------------------------------------------------ relato ao mestre
let ultimoRelato = null;
function relatar() {
  const agora = estaEmTelaCheia();
  if (agora === ultimoRelato) return;
  ultimoRelato = agora;
  enviar(MSG.TELA, { userId: game.user.id, telaCheia: agora });
}

export function relatarDeNovo() {
  ultimoRelato = null;
  relatar();
}

/** Mantém o mestre sabendo quem está a ver no ecrã inteiro. Nada aparece para o jogador. */
export function acompanharTelaCheia() {
  if (game.user.isGM) return;
  document.addEventListener("fullscreenchange", relatar);
  let redimensionando = null;
  globalThis.addEventListener("resize", () => {
    clearTimeout(redimensionando);
    redimensionando = setTimeout(relatar, 500);        // F11 dispara resize, não fullscreenchange
  });
  relatar();
}
