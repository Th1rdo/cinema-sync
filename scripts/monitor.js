import { MODULE_ID, MSG, PHASE } from "./const.js";
import { enviar } from "./net.js";
import { Reprodutor } from "./player.js";
import { abaixarMusica, restaurarMusica } from "./ambiente.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A janela do mestre: a mesma cena, sincronizada, com som — mas numa janela
 * que se move e redimensiona. O mestre nunca perde o HUD nem o canvas.
 */
export class Monitor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "cinema-monitor",
    tag: "div",
    window: { title: "CINEMA.Monitor", icon: "fa-solid fa-display", resizable: true },
    position: { width: 560, height: 360 },
    classes: ["cinema-monitor"]
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/monitor.hbs` } };

  static #instancia = null;
  #reprodutor = null;
  #pendente = null;         // { cue, startAt } esperando o primeiro render

  /** Abre (ou reaproveita) a janela e toca a cena no instante combinado. */
  static exibir(cue, startAt) {
    Monitor.#instancia ??= new Monitor();
    const m = Monitor.#instancia;
    m.#pendente = { cue, startAt };
    if (m.rendered) m.#montar();
    else m.render({ force: true });
    return m;
  }

  static parar() { Monitor.#instancia?.#desmontar(); }

  _onRender() {
    if (this.#pendente) this.#montar();
  }

  #montar() {
    const { cue, startAt } = this.#pendente;
    this.#pendente = null;
    this.#desmontar();

    const palco = this.element.querySelector(".cinema-monitor-palco");
    abaixarMusica();
    this.#reprodutor = new Reprodutor({
      src: cue.src,
      palco,
      volume: game.settings.get(MODULE_ID, "volume"),
      onRelato: (r) => enviar(MSG.STATUS, { cueId: cue.cueId, userId: game.user.id, phase: PHASE.PLAYING, ...r }, { local: true }),
      onFim: () => {
        enviar(MSG.STATUS, { cueId: cue.cueId, userId: game.user.id, phase: PHASE.ENDED }, { local: true });
        restaurarMusica();
      }
    });
    this.#reprodutor.agendar(startAt);
  }

  #desmontar() {
    if (!this.#reprodutor) return;
    this.#reprodutor.destruir();
    this.#reprodutor = null;
    restaurarMusica();
  }

  /** Fechar a janela só tira o mestre da cena — os jogadores continuam assistindo. */
  _onClose(options) {
    this.#desmontar();
    super._onClose?.(options);
  }
}
