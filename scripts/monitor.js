import { MODULE_ID, MSG, PHASE } from "./const.js";
import { enviar } from "./net.js";
import { Reprodutor } from "./player.js";
import { abaixarMusica, restaurarMusica, aliviarCanvas, desaliviarCanvas } from "./ambiente.js";
import { Cinema } from "./cinema.js";

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
    classes: ["cinema-monitor"],
    actions: {
      encerrarTodos: () => Cinema.parar()      // a macro de um clique precisa de um jeito de parar
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/monitor.hbs` } };

  static #instancia = null;
  #reprodutor = null;
  #pendente = null;         // { item, startAt, exibicaoId } esperando o primeiro render

  /** Abre (ou reaproveita) a janela e toca a cena no instante combinado. */
  static exibir(exibicao) {
    Monitor.#instancia ??= new Monitor();
    const m = Monitor.#instancia;
    m.#pendente = exibicao;
    if (m.rendered) m.#montar();
    else m.render({ force: true });
    return m;
  }

  static parar() {
    const m = Monitor.#instancia;
    if (!m) return;
    if (m.rendered) m.close();          // _onClose desmonta
    else m.#desmontar();
  }

  _onRender() {
    if (this.#pendente) this.#montar();
  }

  async #montar() {
    const { item, startAt, exibicaoId } = this.#pendente;
    this.#pendente = null;
    this.#desmontar();

    const ids = { exibicaoId, itemId: item.id, userId: game.user.id };
    abaixarMusica();
    if (game.settings.get(MODULE_ID, "aliviarCanvasMestre")) aliviarCanvas(30);
    this.#reprodutor = await Reprodutor.criar({
      src: item.src,
      palco: this.element.querySelector(".cinema-monitor-palco"),
      volume: game.settings.get(MODULE_ID, "volume") * (item.volume ?? 1),
      onRelato: (r) => enviar(MSG.STATUS, { ...ids, phase: PHASE.PLAYING, ...r }, { local: true }),
      onFim: () => {
        enviar(MSG.STATUS, { ...ids, phase: PHASE.ENDED }, { local: true });
        // antes a janela ficava aberta no último fotograma, a segurar o
        // decodificador e o vídeo inteiro em memória depois da cena acabar
        this.#desmontar();
        if (game.settings.get(MODULE_ID, "fecharNoFim")) this.close();
      }
    });
    this.#reprodutor.agendar(startAt);
  }

  #desmontar() {
    if (!this.#reprodutor) return;
    this.#reprodutor.destruir();
    this.#reprodutor = null;
    restaurarMusica();
    desaliviarCanvas();
  }

  /** Fechar a janela só tira o mestre da cena — os jogadores continuam assistindo. */
  _onClose(options) {
    this.#desmontar();
    super._onClose?.(options);
  }
}
