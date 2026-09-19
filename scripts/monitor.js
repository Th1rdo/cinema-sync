import { MODULE_ID, MSG, PHASE } from "./const.js";
import { enviar } from "./net.js";
import { Reprodutor } from "./player.js";
import { abaixarMusica, restaurarMusica, aliviarCanvas, desaliviarCanvas } from "./ambiente.js";
import { Cinema } from "./cinema.js";
import { srcParaEste } from "./biblioteca.js";
import { pausarDownloads, retomarDownloads } from "./preload.js";

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
  #geracao = 0;             // cada montar/desmontar invalida um montar anterior ainda a meio

  /** Abre (ou reaproveita) a janela e toca a cena no instante combinado. */
  static exibir(exibicao) {
    Monitor.#instancia ??= new Monitor();
    const m = Monitor.#instancia;
    m.#pendente = exibicao;
    if (m.rendered) m.#montar();
    else m.render({ force: true });
    return m;
  }

  /**
   * @param {{fechar?: boolean}} [o]  fechar=false: troca de cena — a janela fica
   *   aberta à espera da próxima, em vez de fechar e reabrir a meio da animação
   */
  static parar({ fechar = true } = {}) {
    const m = Monitor.#instancia;
    if (!m) return;
    if (fechar && m.rendered) m.close();          // _onClose desmonta
    else m.#desmontar();
  }

  _onRender() {
    if (this.#pendente) this.#montar();
  }

  async #montar() {
    const { item, startAt, exibicaoId } = this.#pendente;
    this.#pendente = null;
    this.#desmontar();
    const minha = ++this.#geracao;
    // fechar invalida pela geração (_onClose → #desmontar); isConnected cobre a
    // janela já retirada do DOM, sem depender da ordem de estados do ApplicationV2
    const aindaVale = () => minha === this.#geracao && !!this.element?.isConnected;

    const ids = { exibicaoId, itemId: item.id, userId: game.user.id };
    const escolha = await srcParaEste(item);
    if (!aindaVale()) return;                     // encerrada ou trocada durante a espera
    const reprodutor = await Reprodutor.criar({
      src: escolha.src,
      escada: escolha.escada,
      degrau: escolha.degrau,
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
    if (!aindaVale()) return reprodutor.destruir();   // ler 200 MB do cache leva tempo: pode ter sido encerrada

    // só agora, com o reprodutor montado: #desmontar desfaz exatamente isto
    this.#reprodutor = reprodutor;
    abaixarMusica();
    if (game.settings.get(MODULE_ID, "aliviarCanvasMestre")) aliviarCanvas(30);
    pausarDownloads();
    reprodutor.agendar(startAt);
  }

  #desmontar() {
    this.#geracao++;
    if (!this.#reprodutor) return;
    this.#reprodutor.destruir();
    this.#reprodutor = null;
    restaurarMusica();
    desaliviarCanvas();
    retomarDownloads();
  }

  /** Fechar a janela só tira o mestre da cena — os jogadores continuam assistindo. */
  _onClose(options) {
    this.#desmontar();
    super._onClose?.(options);
  }
}
