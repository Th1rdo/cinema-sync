import { MODULE_ID, MSG, PHASE, SYNC, log, warn } from "./const.js";
import { enviar } from "./net.js";
import { serverNow, scheduleAt, correcao } from "./clock.js";
import { preloadVideo, urlLocal, suportaCodec } from "./preload.js";

/**
 * A tela do jogador: cortina, reprodução e sincronia.
 *
 * Só existe uma instância por cliente. O mestre também usa esta mesma classe
 * quando opta por assistir junto.
 */
class TelaDeCinema {
  #root = null;        // overlay
  #video = null;
  #cue = null;         // { cueId, src, titulo }
  #startAt = null;     // instante combinado (tempo de servidor)
  #cancelarAgendamento = null;
  #loopDesvio = null;
  #gestoOk = false;    // o jogador já clicou? (destrava áudio e fullscreen)
  #entramosFullscreen = false;
  #tocando = false;
  #watchdog = null;    // solta o jogador se a cortina ficar esquecida no ar

  get ativo() { return !!this.#root; }
  get cue() { return this.#cue; }

  // ---------------------------------------------------------------- fase 1
  /** Baixa o vídeo em background, sem nada na tela, e reporta o progresso. */
  async armar(cue) {
    this.#cue = cue;

    if (!suportaCodec(cue.src)) {
      return this.#reportar(PHASE.NOCODEC, { erro: "navegador não toca este formato" });
    }

    this.#reportar(PHASE.LOADING, { pct: 0 });
    let ultimo = 0;
    try {
      await preloadVideo(cue.src, (pct) => {
        // não inundar o socket: só avisa a cada 5%
        if (pct - ultimo >= 0.05 || pct === 1) {
          ultimo = pct;
          this.#reportar(PHASE.LOADING, { pct });
        }
      });
      this.#reportar(PHASE.READY, { pct: 1 });
    } catch (err) {
      this.#reportar(PHASE.FAILED, { erro: err.message });
    }
  }

  // ---------------------------------------------------------------- fase 2
  /**
   * Sobe a cortina: preto em tela cheia com um clique.
   * Esse clique é o gesto que o navegador exige para liberar áudio e fullscreen
   * — por isso ele acontece ANTES do vídeo começar, nunca durante.
   */
  cortina(cue) {
    this.#cue = cue ?? this.#cue;
    this.#montarOverlay();
    this.#root.classList.add("cinema-cortina");
    this.#root.querySelector(".cinema-aviso").hidden = false;

    // se o mestre esquecer (ou cair) e a exibição nunca vier, ninguém fica preso
    clearTimeout(this.#watchdog);
    this.#watchdog = setTimeout(() => {
      if (this.#tocando) return;
      warn("cortina no ar sem exibição; liberando o jogador");
      ui.notifications?.warn(game.i18n.localize("CINEMA.Avisos.CortinaExpirou"));
      this.encerrar({ fade: false });
    }, SYNC.CURTAIN_TIMEOUT);
  }

  /**
   * Escape.
   * Antes de começar, qualquer um sai — é a saída de emergência da cortina.
   * Durante a cena, só o mestre, e aí o encerramento vale para a mesa inteira.
   */
  #aoTeclar = (ev) => {
    if (ev.key !== "Escape" || !this.#root) return;
    if (!this.#tocando) return void this.encerrar({ fade: false });
    if (game.user.isGM) {
      ev.preventDefault();
      enviar(MSG.STOP, { cueId: this.#cue?.cueId }, { local: true });
    }
  };

  #aoClicar = async () => {
    if (this.#gestoOk) return;
    this.#gestoOk = true;

    const aviso = this.#root?.querySelector(".cinema-aviso");
    if (aviso) {
      aviso.querySelector(".cinema-chamada").textContent = game.i18n.localize("CINEMA.Aguardando");
      aviso.querySelector(".cinema-dica").hidden = true;
    }

    let fullscreen = false;
    try {
      await this.#root.requestFullscreen({ navigationUI: "hide" });
      this.#entramosFullscreen = fullscreen = true;
    } catch { /* o navegador pode recusar; a cortina cobre tudo do mesmo jeito */ }

    // se o vídeo já estava tocando mudo (jogador distraído), devolve o som
    if (this.#video?.muted) {
      this.#video.muted = false;
      this.#video.volume = this.#volume();
    }

    this.#reportar(PHASE.CURTAINED, { fullscreen });
  };

  // ---------------------------------------------------------------- fase 3
  /** Começa a tocar no instante combinado. */
  async iniciar(cue, startAt) {
    this.#cue = cue ?? this.#cue;
    this.#startAt = startAt;
    if (!this.#root) this.#montarOverlay();

    const v = this.#criarVideo();
    const jaComecou = serverNow() - startAt;
    v.currentTime = jaComecou > 0 ? jaComecou / 1000 : 0;   // entrou atrasado

    this.#cancelarAgendamento = scheduleAt(startAt, async () => {
      this.#root?.classList.remove("cinema-cortina");
      const aviso = this.#root?.querySelector(".cinema-aviso");
      if (aviso) aviso.hidden = true;

      try {
        await v.play();
      } catch (err) {
        // sem gesto o navegador recusa áudio: toca mudo e avisa
        warn("autoplay recusado, tocando sem som:", err.message);
        v.muted = true;
        await v.play().catch(() => {});
        this.#mostrarDicaDeSom();
      }
      this.#tocando = true;
      clearTimeout(this.#watchdog);
      this.#reportar(PHASE.PLAYING);
      this.#iniciarLoopDeDesvio(v);
    });
  }

  /** Compara onde o vídeo está com onde deveria estar e corrige. */
  #iniciarLoopDeDesvio(v) {
    clearInterval(this.#loopDesvio);
    this.#loopDesvio = setInterval(() => {
      if (!v || v.paused || v.ended) return;
      const esperado = (serverNow() - this.#startAt) / 1000;
      const desvio = esperado - v.currentTime;
      const { acao, rate } = correcao(desvio);

      if (acao === "seek") {
        log(`desvio de ${(desvio * 1000).toFixed(0)}ms — pulando para o ponto certo`);
        v.currentTime = Math.max(0, esperado);
        v.playbackRate = 1;
      } else if (acao === "nudge") {
        v.playbackRate = rate;
      } else if (v.playbackRate !== 1) {
        v.playbackRate = 1;
      }

      // o mestre acompanha o desvio real de cada cliente em tempo real
      this.#reportar(PHASE.PLAYING, { desvio: Math.round(desvio * 1000) });
    }, SYNC.CHECK_MS);
  }

  /** Encerra tudo e devolve a mesa ao jogador. */
  async encerrar({ fade = true } = {}) {
    this.#cancelarAgendamento?.();
    this.#cancelarAgendamento = null;
    clearInterval(this.#loopDesvio);
    this.#loopDesvio = null;
    clearTimeout(this.#watchdog);
    this.#watchdog = null;
    this.#tocando = false;
    window.removeEventListener("keydown", this.#aoTeclar, true);

    const root = this.#root;
    if (!root) return;

    if (fade) {
      root.classList.add("cinema-saindo");
      await new Promise(r => setTimeout(r, 600));
    }
    if (this.#entramosFullscreen && document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
    this.#entramosFullscreen = false;
    this.#video?.pause();
    this.#video?.remove();
    this.#video = null;
    root.remove();
    this.#root = null;
    this.#cue = null;
    this.#startAt = null;
    this.#gestoOk = false;
    document.body.classList.remove("cinema-ativo");
  }

  // ---------------------------------------------------------------- interno
  #volume() {
    return game.settings.get(MODULE_ID, "volume") ?? 0.8;
  }

  #montarOverlay() {
    if (this.#root) return this.#root;
    document.body.classList.add("cinema-ativo");

    const root = document.createElement("div");
    root.id = "cinema-sync-overlay";
    root.innerHTML = `
      <div class="cinema-palco"></div>
      <div class="cinema-aviso" hidden>
        <p class="cinema-chamada">${game.i18n.localize("CINEMA.CliqueParaComecar")}</p>
        <p class="cinema-dica">${game.i18n.localize("CINEMA.CliqueDica")}</p>
      </div>
      <div class="cinema-som" hidden>${game.i18n.localize("CINEMA.CliqueParaSom")}</div>`;
    root.addEventListener("click", this.#aoClicar);
    window.addEventListener("keydown", this.#aoTeclar, true);
    document.body.appendChild(root);
    this.#root = root;
    return root;
  }

  #criarVideo() {
    const v = document.createElement("video");
    v.src = urlLocal(this.#cue.src);
    v.playsInline = true;
    v.controls = false;
    v.disablePictureInPicture = true;
    v.preload = "auto";
    v.volume = this.#volume();
    v.muted = !this.#gestoOk;        // sem gesto, só resta tocar mudo
    v.addEventListener("ended", () => {
      enviar(MSG.ENDED, { cueId: this.#cue?.cueId }, { local: game.user.isGM });
      this.#reportar(PHASE.ENDED);
      if (game.settings.get(MODULE_ID, "fecharNoFim")) this.encerrar();
    }, { once: true });

    this.#root.querySelector(".cinema-palco").appendChild(v);
    this.#video = v;
    return v;
  }

  #mostrarDicaDeSom() {
    const dica = this.#root?.querySelector(".cinema-som");
    if (dica) dica.hidden = false;
  }

  #reportar(phase, extra = {}) {
    enviar(MSG.STATUS, {
      cueId: this.#cue?.cueId,
      userId: game.user.id,
      phase,
      ...extra
    }, { local: game.user.isGM });
  }
}

export const tela = new TelaDeCinema();
