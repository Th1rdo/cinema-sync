import { SYNC, log, warn } from "./const.js";
import { serverNow, scheduleAt, tempoEsperado, decidir } from "./clock.js";
import { urlLocal } from "./preload.js";

/**
 * Um <video> sincronizado com a mesa.
 *
 * Não sabe onde está montado: a tela cheia do jogador e a janela do mestre usam
 * esta mesma classe. Quem a usa recebe relatos por callback e decide o que
 * fazer com eles.
 */
export class Reprodutor {
  #v;
  #startAt = null;
  #ancora = null;            // { server, local } lidos no instante em que o play começou
  #cancelar = null;
  #loop = null;
  #conferencias = 0;
  #esperandoBuffer = false;
  #onRelato;
  #onFim;
  #onVisibilidade = () => { if (!document.hidden) this.#conferir("voltou de outra aba"); };

  /**
   * @param {object} o
   * @param {string} o.src          caminho original (o blob do preload é resolvido aqui)
   * @param {HTMLElement} o.palco   onde o <video> é montado
   * @param {number} o.volume
   * @param {boolean} [o.mudo]
   * @param {(r: object) => void} [o.onRelato]   desvio, quadros perdidos, correções
   * @param {() => void} [o.onFim]
   */
  constructor({ src, palco, volume, mudo = false, onRelato, onFim }) {
    const v = document.createElement("video");
    v.src = urlLocal(src);
    v.playsInline = true;
    v.controls = false;
    v.disablePictureInPicture = true;
    v.preload = "auto";
    v.volume = volume;
    v.muted = mudo;
    v.addEventListener("ended", () => this.#onFim?.(), { once: true });
    // buffer secou: nada de pular agora — seek durante buffering aborta o
    // download em curso e prolonga a própria travada. Confere uma vez, na volta.
    v.addEventListener("waiting", () => { this.#esperandoBuffer = true; });
    v.addEventListener("playing", () => {
      const vinhaTravado = this.#esperandoBuffer;
      this.#esperandoBuffer = false;
      if (vinhaTravado && this.#ancora) this.#conferir("buffer voltou");
    });

    palco.appendChild(v);
    this.#v = v;
    this.#onRelato = onRelato;
    this.#onFim = onFim;
    document.addEventListener("visibilitychange", this.#onVisibilidade);
  }

  get video() { return this.#v; }

  /** Agenda a largada no instante combinado (tempo de servidor). */
  agendar(startAt) {
    this.#startAt = startAt;
    const jaComecou = serverNow() - startAt;
    if (jaComecou > 0) this.#v.currentTime = jaComecou / 1000;   // chegou atrasado
    this.#cancelar = scheduleAt(startAt, () => this.#largar());
  }

  async #largar() {
    const v = this.#v;
    try {
      await v.play();
    } catch (err) {
      // sem interação prévia o navegador recusa áudio: toca mudo em vez de não tocar
      warn("autoplay com som recusado, tocando mudo:", err.message);
      v.muted = true;
      await v.play().catch(() => {});
      this.#onRelato?.({ mudo: true });
    }

    // âncora: último uso do serverTime; daqui em diante, relógio local
    this.#ancora = { server: serverNow(), local: performance.now() };

    // o play leva algumas dezenas de ms para arrancar: corrige isso uma vez, na largada
    this.#conferir("largada", SYNC.LIMIAR_INICIO);

    this.#loop = setInterval(() => this.#conferir(), SYNC.CHECK_MS);
  }

  /** Lê onde o vídeo está e só intervém se o desvio for real. */
  #conferir(motivo = null, limiar = SYNC.LIMIAR) {
    const v = this.#v;
    if (!v || !this.#ancora || v.paused || v.ended) return;
    // a rotina fica suspensa com a aba oculta ou o buffer vazio; os eventos de volta conferem
    if (!motivo && (document.hidden || this.#esperandoBuffer)) return;

    const esperado = tempoEsperado({
      startAt: this.#startAt,
      ancoraServer: this.#ancora.server,
      ancoraLocal: this.#ancora.local,
      agoraLocal: performance.now()
    });
    const desvio = esperado - v.currentTime;
    const pulou = decidir(desvio, limiar) === "seek";

    if (pulou) {
      log(`desvio de ${Math.round(desvio * 1000)}ms (${motivo ?? "rotina"}) — pulando`);
      v.currentTime = Math.max(0, esperado);
    }

    this.#conferencias++;
    if (pulou || motivo || this.#conferencias % SYNC.RELATO_A_CADA === 0) {
      const q = v.getVideoPlaybackQuality?.();
      this.#onRelato?.({
        desvio: Math.round(desvio * 1000),
        pulou,
        perdidos: q?.totalVideoFrames ? Math.round(100 * q.droppedVideoFrames / q.totalVideoFrames) : 0
      });
    }
  }

  set volume(x) { this.#v.volume = x; }
  desmutar() { this.#v.muted = false; }
  get mudo() { return this.#v.muted; }

  destruir() {
    this.#cancelar?.();
    clearInterval(this.#loop);
    document.removeEventListener("visibilitychange", this.#onVisibilidade);
    this.#v.pause();
    this.#v.removeAttribute("src");
    this.#v.load();                 // solta o decodificador na hora
    this.#v.remove();
    this.#ancora = null;
  }
}
