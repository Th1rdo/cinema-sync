import { SYNC, log, warn } from "./const.js";
import { serverNow, scheduleAt, tempoEsperado, decidir } from "./clock.js";
import { urlParaTocar, soltar } from "./preload.js";
import { deveDescer } from "./logica.js";

/** Espera o <video> ter saltado para o ponto pedido e ter dados para tocar. */
function prontoPara(v, limiteMs) {
  return new Promise((resolve, reject) => {
    const limpar = () => {
      clearTimeout(timer);
      v.removeEventListener("seeked", verificar);
      v.removeEventListener("canplay", verificar);
      v.removeEventListener("error", falhou);
    };
    const verificar = () => { if (!v.seeking && v.readyState >= 3) { limpar(); resolve(); } };
    const falhou = () => { limpar(); reject(new Error("o vídeo não carregou")); };
    const timer = setTimeout(() => { limpar(); reject(new Error("demorou demais a ficar pronto")); }, limiteMs);
    v.addEventListener("seeked", verificar);
    v.addEventListener("canplay", verificar);
    v.addEventListener("error", falhou);
    verificar();
  });
}

/**
 * Passa de um vídeo para o outro: imagem e volume em `ms`.
 * Com setInterval em vez de requestAnimationFrame, que para em abas ocultas.
 */
function crossfade(velho, novo, volume, ms) {
  return new Promise(resolve => {
    const v0 = velho.volume;
    const t0 = performance.now();
    novo.style.transition = `opacity ${ms}ms linear`;
    novo.style.opacity = "1";
    const passo = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      novo.volume = volume * k;
      velho.volume = v0 * (1 - k);
      if (k >= 1) { clearInterval(passo); resolve(); }
    }, 16);
  });
}

/**
 * Um <video> sincronizado com a mesa.
 *
 * Não sabe onde está montado: a tela cheia do jogador e a janela do mestre usam
 * esta mesma classe. Quem a usa recebe relatos por callback e decide o que
 * fazer com eles.
 *
 * Tem uma escada de versões (original, 1080p, 720p, 480p…). Se este computador
 * perder quadros de forma sustentada, desce um degrau a meio da cena — como a
 * Netflix, mas com versões inteiras em vez de bocados de stream.
 */
export class Reprodutor {
  #v;
  #url = null;               // blob: local (do cache em disco) ou a URL original
  #palco;
  #volume = 1;
  #startAt = null;
  #ancora = null;            // { server, local } lidos no instante em que o play começou
  #cancelar = null;
  #loop = null;
  #conferencias = 0;
  #esperandoBuffer = false;
  #saltos = [];              // instantes dos pulos corretivos recentes
  #fluidez = false;          // desistiu de forçar a sincronia neste computador
  #escada;                   // [{ src, altura }] da mais pesada para a mais leve
  #degrau;                   // índice do degrau em uso
  #amostras = [];            // leituras de getVideoPlaybackQuality, uma por segundo
  #ultimaTroca = 0;
  #trocando = false;
  #destruido = false;
  #onRelato;
  #onFim;
  #onTroca;
  #onVisibilidade = () => { if (!document.hidden) this.#retomar("voltou de outra aba"); };

  /**
   * Cria o reprodutor resolvendo antes onde está o vídeo (disco ou rede).
   * @param {object} o
   * @param {string} o.src          o ficheiro do degrau escolhido
   * @param {HTMLElement} o.palco   onde o <video> é montado
   * @param {number} o.volume
   * @param {boolean} [o.mudo]
   * @param {{src: string, altura: number}[]} [o.escada]   todas as versões
   * @param {number} [o.degrau]     índice de `src` na escada
   * @param {(r: object) => void} [o.onRelato]   desvio, quadros perdidos, correções, trocas
   * @param {() => void} [o.onFim]
   * @param {(degrau: {src: string, altura: number}) => void} [o.onTroca]
   */
  static async criar(o) {
    const url = await urlParaTocar(o.src);
    return new Reprodutor({ ...o, url });
  }

  constructor({ url, src, palco, volume, mudo = false, escada, degrau = 0, onRelato, onFim, onTroca }) {
    this.#palco = palco;
    this.#volume = volume;
    this.#escada = escada?.length ? escada : [{ src, altura: 0 }];
    this.#degrau = degrau;
    this.#onRelato = onRelato;
    this.#onFim = onFim;
    this.#onTroca = onTroca;

    this.#url = url;
    this.#v = this.#criarVideo(url, { volume, mudo });
    palco.appendChild(this.#v);
    document.addEventListener("visibilitychange", this.#onVisibilidade);
  }

  get video() { return this.#v; }

  /** Um <video> com os ouvintes de sempre. Só o vídeo ATIVO reage a eventos. */
  #criarVideo(url, { volume, mudo }) {
    const v = document.createElement("video");
    v.src = url;
    v.classList.add("cinema-video");
    v.playsInline = true;
    v.controls = false;
    v.disablePictureInPicture = true;
    v.preload = "auto";
    v.volume = volume;
    v.muted = mudo;

    v.addEventListener("ended", () => {
      if (v !== this.#v) return;
      clearInterval(this.#loop);                // acabou: nada mais para conferir
      this.#loop = null;
      this.#onFim?.();
    });
    // buffer secou: nada de pular agora — seek durante buffering aborta o
    // download em curso e prolonga a própria travada. Confere uma vez, na volta.
    v.addEventListener("waiting", () => { if (v === this.#v) this.#esperandoBuffer = true; });
    v.addEventListener("playing", () => {
      v.classList.add("cinema-no-ar");          // entra do preto em fade (CSS)
      if (v !== this.#v) return;
      const vinhaTravado = this.#esperandoBuffer;
      this.#esperandoBuffer = false;
      if (vinhaTravado && this.#ancora) this.#conferir("buffer voltou");
    });
    return v;
  }

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
    // os primeiros segundos de qualquer decodificador perdem quadros: não conta
    this.#ultimaTroca = performance.now();

    // o play leva algumas dezenas de ms para arrancar: corrige isso uma vez, na largada
    this.#conferir("largada", SYNC.LIMIAR_INICIO);

    this.#loop = setInterval(() => this.#conferir(), SYNC.CHECK_MS);
  }

  /**
   * O Chrome pausa sozinho vídeos mudos em abas ocultas (poupança de energia).
   * Sem isto, um jogador com o som bloqueado que fizesse alt-tab voltava a uma
   * cena congelada para sempre. Pausa que não foi nossa é desfeita, e o vídeo
   * volta para o ponto onde a mesa está.
   */
  async #retomar(motivo) {
    const v = this.#v;
    if (!v || !this.#ancora || this.#destruido || v.ended) return;
    if (v.paused) {
      log(`o navegador pausou o vídeo (${motivo}) — retomando`);
      await v.play().catch(() => {});
    }
    this.#conferir(motivo);
  }

  #esperado() {
    return tempoEsperado({
      startAt: this.#startAt,
      ancoraServer: this.#ancora.server,
      ancoraLocal: this.#ancora.local,
      agoraLocal: performance.now()
    });
  }

  /** Lê onde o vídeo está e só intervém se o desvio for real. */
  #conferir(motivo = null, limiar = SYNC.LIMIAR) {
    const v = this.#v;
    if (!v || !this.#ancora || v.ended) return;
    if (v.paused) {
      if (!document.hidden && !motivo) this.#retomar("pausado sem motivo");
      return;
    }
    // a rotina fica suspensa com a aba oculta ou o buffer vazio; os eventos de volta conferem
    if (!motivo && (document.hidden || this.#esperandoBuffer)) return;

    const esperado = this.#esperado();
    const desvio = esperado - v.currentTime;
    const pulou = !this.#fluidez && decidir(desvio, limiar) === "seek";

    if (pulou) {
      log(`desvio de ${Math.round(desvio * 1000)}ms (${motivo ?? "rotina"}) — pulando`);
      v.currentTime = Math.max(0, esperado);

      // Quem encrava sem parar (máquina ou rede fracas) piora a cada pulo:
      // o pulo obriga a buscar outro trecho e o vídeo encrava de novo. Depois
      // de dois pulos em 20 s, este computador passa a priorizar fluidez —
      // vê a cena contínua, um pouco atrasado, em vez de aos solavancos —
      // e desce um degrau, que é menos para buscar e menos para decodificar.
      if (motivo !== "largada") {
        const agora = performance.now();
        this.#saltos = [...this.#saltos.filter(t => agora - t < 20000), agora];
        if (this.#saltos.length >= 2 && !this.#fluidez) {
          this.#fluidez = true;
          log("encravou repetidamente — a priorizar fluidez em vez de sincronia");
          this.#descer("encravou repetidamente");
        }
      }
    }

    // quadros perdidos de forma sustentada: desce um degrau
    const q = v.getVideoPlaybackQuality?.();
    if (!motivo && q) {
      this.#amostras = [...this.#amostras, { total: q.totalVideoFrames, perdidos: q.droppedVideoFrames }].slice(-8);
      if (performance.now() - this.#ultimaTroca > 5000 && deveDescer(this.#amostras)) {
        this.#descer("perdendo quadros");
      }
    }

    this.#conferencias++;
    if (pulou || motivo || this.#conferencias % SYNC.RELATO_A_CADA === 0) {
      this.#onRelato?.({
        desvio: Math.round(desvio * 1000),
        pulou,
        fluidez: this.#fluidez,
        perdidos: q?.totalVideoFrames ? Math.round(100 * q.droppedVideoFrames / q.totalVideoFrames) : 0
      });
    }
  }

  /**
   * Desce um degrau a meio da cena.
   *
   * O degrau de baixo é montado por baixo do atual, invisível e mudo, já no
   * ponto onde a cena vai estar daqui a pouco. Quando está pronto e o relógio
   * chega lá, os dois cruzam em 300 ms — imagem e volume. O áudio de todas as
   * versões é o mesmo (copiado, não recodificado), então a troca não se ouve.
   * Se o degrau de baixo não ficar pronto a tempo, a troca é abandonada e a
   * cena segue no degrau atual. Só desce, nunca sobe.
   */
  async #descer(motivo) {
    const i = this.#degrau + 1;
    const alvo = this.#escada[i];
    if (!alvo || this.#trocando || this.#destruido || !this.#ancora) return;

    this.#trocando = true;
    this.#ultimaTroca = performance.now();
    const velho = this.#v;
    const velhoUrl = this.#url;
    let novo = null;
    let novoUrl = null;
    log(`${motivo}: a descer para ${alvo.altura}p`);

    try {
      novoUrl = await urlParaTocar(alvo.src);
      if (this.#destruido) throw new Error("cena encerrada");

      novo = this.#criarVideo(novoUrl, { volume: 0, mudo: velho.muted });
      novo.style.opacity = "0";
      this.#palco.appendChild(novo);

      // aponta um pouco à frente: dá tempo de saltar e carregar sem ficar para trás
      novo.currentTime = this.#esperado() + 1.2;
      await prontoPara(novo, 8000);
      if (this.#destruido || velho !== this.#v) throw new Error("cena mudou");

      // espera o relógio da mesa chegar ao ponto onde o novo está parado
      const falta = (novo.currentTime - this.#esperado()) * 1000;
      if (falta > 0) await new Promise(r => setTimeout(r, falta));
      await novo.play();

      await crossfade(velho, novo, this.#volume, 300);

      // o novo passa a ser o vídeo da cena
      this.#v = novo;
      this.#url = novoUrl;
      this.#degrau = i;
      this.#amostras = [];
      this.#ultimaTroca = performance.now();
      novo.style.transition = "";
      novo.style.opacity = "";                  // volta a obedecer ao CSS (fade de saída no fim)
      novo.classList.add("cinema-no-ar");

      velho.pause();
      velho.removeAttribute("src");
      velho.load();
      velho.remove();
      soltar(velhoUrl);

      this.#onTroca?.(alvo);
      this.#onRelato?.({ versao: `${alvo.altura}p`, original: false, trocou: true });
    } catch (err) {
      warn(`troca para ${alvo.altura}p abandonada: ${err.message}`);
      if (novo) { novo.pause(); novo.removeAttribute("src"); novo.load(); novo.remove(); }
      if (novoUrl && novoUrl !== this.#url) soltar(novoUrl);
    } finally {
      this.#trocando = false;
    }
  }

  set volume(x) { this.#volume = x; this.#v.volume = x; }
  desmutar() { this.#v.muted = false; }
  get mudo() { return this.#v.muted; }

  destruir() {
    this.#destruido = true;
    this.#cancelar?.();
    clearInterval(this.#loop);
    document.removeEventListener("visibilitychange", this.#onVisibilidade);
    for (const v of this.#palco?.querySelectorAll("video") ?? []) {
      v.pause();
      v.removeAttribute("src");
      v.load();                     // solta o decodificador na hora
      v.remove();
    }
    soltar(this.#url);              // devolve a memória do blob
    this.#ancora = null;
  }
}
