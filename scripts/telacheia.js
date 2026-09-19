import { MODULE_ID, MSG } from "./const.js";
import { enviar } from "./net.js";
import { pareceTelaCheia } from "./logica.js";
import * as bib from "./biblioteca.js";

/**
 * Tela cheia.
 *
 * O navegador só entra em tela cheia em resposta a um clique (ou tecla) da
 * própria pessoa, feito nos últimos segundos — regra de segurança, nenhum
 * módulo contorna. Então o clique precisa acontecer num momento que não custe
 * imersão: no começo da sessão. Quem aceita tem todas as cutscenes em tela
 * cheia sem prompt nenhum; o convite dentro da cena é só a rede de segurança.
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

/** Pede tela cheia para a página inteira. Só funciona dentro de um clique. */
export async function entrarNaSessao() {
  if (document.fullscreenElement) return true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    return true;
  } catch {
    return false;
  }
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

// ------------------------------------------------------------ convite de sessão
function convidar() {
  if (document.getElementById("cinema-convite") || estaEmTelaCheia()) return;   // deu F11 enquanto carregava

  const card = document.createElement("div");
  card.id = "cinema-convite";
  card.innerHTML = `
    <i class="fa-solid fa-expand"></i>
    <div class="cinema-convite-texto">
      <strong>${game.i18n.localize("CINEMA.Convite.Titulo")}</strong>
      <small>${game.i18n.localize("CINEMA.Convite.Texto")}</small>
    </div>
    <div class="cinema-convite-botoes">
      <button type="button" data-acao="entrar">${game.i18n.localize("CINEMA.Convite.Entrar")}</button>
      <button type="button" data-acao="sempre" title="${game.i18n.localize("CINEMA.Convite.SempreHint")}">${game.i18n.localize("CINEMA.Convite.Sempre")}</button>
      <button type="button" data-acao="agora-nao">${game.i18n.localize("CINEMA.Convite.AgoraNao")}</button>
    </div>`;

  const fechar = () => { card.classList.add("cinema-convite-saindo"); setTimeout(() => card.remove(), 400); };
  card.addEventListener("click", async (ev) => {
    const acao = ev.target.closest("[data-acao]")?.dataset.acao;
    if (!acao) return;
    // o pedido de tela cheia vem PRIMEIRO, ainda dentro do clique: o navegador
    // só aceita por alguns segundos depois do gesto, e salvar a configuração antes
    // gastaria parte dessa janela
    const entrando = (acao === "entrar" || acao === "sempre") ? entrarNaSessao() : null;
    fechar();
    await entrando;
    if (acao === "sempre") await game.settings.set(MODULE_ID, "telaCheia", "automatico");
  });

  document.body.appendChild(card);
  setTimeout(() => card.isConnected && fechar(), 30000);                       // ignorado: sai sozinho
  document.addEventListener("fullscreenchange", () => estaEmTelaCheia() && fechar(), { once: true });
}

/**
 * Começo da sessão de um jogador.
 * - "convidar": mostra o convite (se houver cutscenes nesta mesa)
 * - "automatico": o primeiro clique da sessão já entra em tela cheia
 * - "nunca": não faz nada
 */
export function iniciarTelaCheia() {
  if (game.user.isGM) return;                                  // o mestre assiste na janela
  document.addEventListener("fullscreenchange", relatar);
  let redimensionando = null;
  globalThis.addEventListener("resize", () => {
    clearTimeout(redimensionando);
    redimensionando = setTimeout(relatar, 500);                // F11 dispara resize, não fullscreenchange
  });
  relatar();

  if (estaEmTelaCheia()) return;
  const modo = game.settings.get(MODULE_ID, "telaCheia");

  if (modo === "automatico") {
    // o clique é do jogador e segue normalmente; só aproveitamos o gesto
    document.addEventListener("pointerdown", () => { if (!estaEmTelaCheia()) entrarNaSessao(); },
                              { capture: true, once: true });
  } else if (modo === "convidar" && bib.itens().length) {
    setTimeout(convidar, 2500);                                 // deixa o mundo terminar de carregar
  }
}
