import { MODULE_ID, MSG, PHASE, SYNC, warn } from "./const.js";
import { enviar } from "./net.js";
import { preloadVideo, suportaCodec } from "./preload.js";
import { Reprodutor } from "./player.js";
import { abaixarMusica, restaurarMusica, congelarCanvas, descongelarCanvas } from "./ambiente.js";

/**
 * A tela do jogador: preto, depois o filme, depois a mesa de volta.
 * O mestre nunca usa esta classe — ele assiste numa janela (monitor.js).
 */
class TelaDeCinema {
  #root = null;
  #reprodutor = null;
  #cue = null;
  #watchdog = null;
  #entrouFullscreen = false;

  get ativo() { return !!this.#root; }
  get cue() { return this.#cue; }

  // ------------------------------------------------------------ pré-carga
  /** Baixa em background, sem nada na tela, e reporta progresso. */
  async armar(cue) {
    this.#cue = cue;
    if (!suportaCodec(cue.src)) {
      return this.#reportar(PHASE.NOCODEC, { erro: "navegador não toca este formato" });
    }

    this.#reportar(PHASE.LOADING, { pct: 0 });
    let ultimo = 0;
    try {
      await preloadVideo(cue.src, (pct) => {
        if (pct - ultimo >= 0.1 || pct === 1) {   // a cada 10%: o painel não precisa de mais
          ultimo = pct;
          this.#reportar(PHASE.LOADING, { pct });
        }
      });
      // game.audio.locked: o navegador ainda não recebeu nenhum clique nesta página
      this.#reportar(PHASE.READY, { pct: 1, somBloqueado: !!game.audio?.locked });
    } catch (err) {
      this.#reportar(PHASE.FAILED, { erro: err.message });
    }
  }

  // ------------------------------------------------------------ exibição
  /**
   * Recebeu a largada: tela preta na hora, filme no instante combinado.
   * Os segundos de preto são a "cortina" — sem exigir clique de ninguém.
   */
  async iniciar(cue, startAt) {
    if (this.#root) await this.encerrar({ fade: false });
    this.#cue = cue;

    const root = this.#montar();
    congelarCanvas();
    abaixarMusica();

    this.#reprodutor = new Reprodutor({
      src: cue.src,
      palco: root.querySelector(".cinema-palco"),
      volume: game.settings.get(MODULE_ID, "volume"),
      mudo: !!game.audio?.locked,       // sem clique prévio, só dá para tocar mudo
      onRelato: (r) => {
        if (r.mudo) root.querySelector(".cinema-som").hidden = false;
        this.#reportar(PHASE.PLAYING, r);
      },
      onFim: () => {
        this.#reportar(PHASE.ENDED);
        enviar(MSG.ENDED, { cueId: this.#cue?.cueId });
        if (game.settings.get(MODULE_ID, "fecharNoFim")) this.encerrar();
      }
    });

    // a chamada some quando o filme começa
    this.#reprodutor.video.addEventListener("playing", () => {
      root.querySelector(".cinema-aviso").hidden = true;
      clearTimeout(this.#watchdog);
    }, { once: true });

    this.#reprodutor.agendar(startAt);

    // preto que nunca vira filme não pode prender ninguém
    this.#watchdog = setTimeout(() => {
      warn("a cena não começou a tempo; liberando a tela");
      this.#reportar(PHASE.FAILED, { erro: "não começou a tempo" });
      this.encerrar({ fade: false });
    }, Math.max(0, startAt - game.time.serverTime) + SYNC.START_TIMEOUT);
  }

  /** Clique durante a cena: tela cheia (se o navegador deixar) e som (se estava mudo). */
  #aoClicar = async () => {
    if (this.#reprodutor?.mudo) {
      this.#reprodutor.desmutar();
      this.#root.querySelector(".cinema-som").hidden = true;
    }
    if (!document.fullscreenElement && this.#root) {
      try {
        await this.#root.requestFullscreen({ navigationUI: "hide" });
        this.#entrouFullscreen = true;
      } catch { /* recusado: o overlay já cobre a janela inteira */ }
    }
  };

  /** Esc: cada jogador pode sair da própria tela. O mestre fica sabendo. */
  #aoTeclar = (ev) => {
    if (ev.key !== "Escape" || !this.#root) return;
    if (document.fullscreenElement) return;       // o primeiro Esc é do navegador (sai da tela cheia)
    this.#reportar(PHASE.LEFT);
    this.encerrar();
  };

  async encerrar({ fade = true } = {}) {
    clearTimeout(this.#watchdog);
    this.#watchdog = null;

    const root = this.#root;
    if (!root) return;
    this.#root = null;

    if (fade) {
      root.classList.add("cinema-saindo");
      await new Promise(r => setTimeout(r, 600));
    }
    this.#reprodutor?.destruir();
    this.#reprodutor = null;

    if (this.#entrouFullscreen && document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
    this.#entrouFullscreen = false;

    window.removeEventListener("keydown", this.#aoTeclar, true);
    root.remove();
    document.body.classList.remove("cinema-ativo");
    descongelarCanvas();
    restaurarMusica();
    this.#cue = null;
  }

  // ------------------------------------------------------------ interno
  #montar() {
    document.body.classList.add("cinema-ativo");
    const root = document.createElement("div");
    root.id = "cinema-sync-overlay";
    root.innerHTML = `
      <div class="cinema-palco"></div>
      <div class="cinema-aviso"><p class="cinema-chamada">${game.i18n.localize("CINEMA.ACenaVaiComecar")}</p></div>
      <div class="cinema-som" hidden>${game.i18n.localize("CINEMA.CliqueParaSom")}</div>`;
    root.addEventListener("click", this.#aoClicar);
    window.addEventListener("keydown", this.#aoTeclar, true);
    document.body.appendChild(root);
    this.#root = root;
    return root;
  }

  #reportar(phase, extra = {}) {
    enviar(MSG.STATUS, { cueId: this.#cue?.cueId, userId: game.user.id, phase, ...extra });
  }
}

export const tela = new TelaDeCinema();
