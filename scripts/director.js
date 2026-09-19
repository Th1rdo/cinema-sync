import { MODULE_ID, MSG, PHASE, SYNC, log } from "./const.js";
import { enviar, ao, plateia } from "./net.js";
import { serverNow } from "./clock.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const PRONTOS = [PHASE.READY, PHASE.PLAYING, PHASE.ENDED];
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Painel do mestre: escolher, pré-carregar, exibir, acompanhar. */
export class Diretor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "cinema-diretor",
    tag: "div",
    window: { title: "CINEMA.Diretor", icon: "fa-solid fa-clapperboard", resizable: true },
    position: { width: 460, height: "auto" },
    classes: ["cinema-diretor"],
    actions: {
      escolher: Diretor.#escolher,
      armar: Diretor.#armar,
      exibir: Diretor.#exibir,
      encerrar: Diretor.#encerrar
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/director.hbs` } };

  static cue = null;              // { cueId, src, titulo }
  static duracao = null;          // segundos, lida só dos metadados
  static startAt = null;          // instante combinado da exibição em cartaz
  static estados = new Map();     // userId → último relato
  static #instancia = null;
  static #renderPendente = null;
  #relogio = null;

  static abrir() {
    Diretor.#instancia ??= new Diretor();
    Diretor.#instancia.render({ force: true });
    return Diretor.#instancia;
  }

  /**
   * Re-render agrupado: no máximo um a cada 250 ms, não importa quantos relatos
   * cheguem. Antes cada relato redesenhava o painel inteiro.
   */
  static atualizar() {
    if (!Diretor.#instancia?.rendered || Diretor.#renderPendente) return;
    Diretor.#renderPendente = setTimeout(() => {
      Diretor.#renderPendente = null;
      Diretor.#instancia?.render();
    }, 250);
  }

  async _prepareContext() {
    const mestreAssiste = game.settings.get(MODULE_ID, "mestreAssiste");
    const jogadores = plateia({ incluirMestre: mestreAssiste }).map(u => {
      const e = Diretor.estados.get(u.id) ?? { phase: PHASE.IDLE };
      return {
        nome: u.isGM ? `${u.name} (${game.i18n.localize("CINEMA.Monitor")})` : u.name,
        cor: u.color?.css ?? u.color ?? "#999",
        fase: e.phase,
        rotulo: game.i18n.localize(`CINEMA.Fase.${e.phase}`),
        carregando: e.phase === PHASE.LOADING,
        pct: Math.round((e.pct ?? 0) * 100),
        erro: e.erro,
        somBloqueado: !!e.somBloqueado || !!e.mudo,
        engasgando: (e.perdidos ?? 0) >= 10,
        perdidos: e.perdidos ?? 0,
        desvio: e.desvio,
        pronto: PRONTOS.includes(e.phase)
      };
    });

    const prontos = jogadores.filter(j => j.pronto).length;
    return {
      cue: Diretor.cue,
      duracao: Diretor.duracao ? mmss(Diretor.duracao) : null,
      emCartaz: !!Diretor.startAt,
      jogadores,
      prontos,
      total: jogadores.length,
      todosProntos: jogadores.length > 0 && prontos === jogadores.length,
      podeExibir: !!Diretor.cue && prontos > 0 && !Diretor.startAt,
      desvioMax: Math.max(0, ...jogadores.map(j => Math.abs(j.desvio ?? 0)))
    };
  }

  /** Linha do tempo: atualiza só o texto e a barra, sem re-render do painel. */
  _onRender() {
    clearInterval(this.#relogio);
    if (!Diretor.startAt) return;
    const barra = this.element.querySelector(".cinema-tempo-barra > span");
    const texto = this.element.querySelector(".cinema-tempo-texto");
    const tick = () => {
      const t = Math.max(0, (serverNow() - Diretor.startAt) / 1000);
      if (texto) texto.textContent = Diretor.duracao ? `${mmss(t)} / ${mmss(Diretor.duracao)}` : mmss(t);
      if (barra && Diretor.duracao) barra.style.width = `${Math.min(100, 100 * t / Diretor.duracao)}%`;
      // acabou pelo relógio: libera o painel mesmo que alguém não tenha avisado
      if (Diretor.duracao && t > Diretor.duracao + 2) {
        Diretor.startAt = null;
        Diretor.atualizar();
      }
    };
    tick();
    this.#relogio = setInterval(tick, 500);
  }

  _onClose(options) {
    clearInterval(this.#relogio);
    super._onClose?.(options);
  }

  // ------------------------------------------------------------------ ações
  static async #escolher() {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "video",
      current: Diretor.cue?.src ?? "",
      callback: (caminho) => {
        Diretor.cue = {
          cueId: foundry.utils.randomID(),
          src: caminho,
          titulo: decodeURIComponent(caminho.split("/").pop())
        };
        Diretor.duracao = null;
        Diretor.startAt = null;
        Diretor.estados.clear();
        lerDuracao(caminho).then(d => { Diretor.duracao = d; Diretor.atualizar(); });
        Diretor.atualizar();
      }
    }).render(true);
  }

  static #armar() {
    if (!Diretor.cue) return;
    Diretor.estados.clear();
    enviar(MSG.ARM, { cue: Diretor.cue }, { local: game.settings.get(MODULE_ID, "mestreAssiste") });
    ui.notifications.info(game.i18n.localize("CINEMA.Avisos.Armando"));
    Diretor.atualizar();
  }

  static #exibir() {
    if (!Diretor.cue || Diretor.startAt) return;
    const startAt = serverNow() + SYNC.LEAD_MS;
    Diretor.startAt = startAt;
    enviar(MSG.START, { cue: Diretor.cue, startAt }, { local: true });
    log(`exibindo em ${SYNC.LEAD_MS}ms`);
    Diretor.atualizar();
  }

  static #encerrar() {
    Diretor.startAt = null;
    enviar(MSG.STOP, { cueId: Diretor.cue?.cueId }, { local: true });
    Diretor.atualizar();
  }
}

/** Duração pelos metadados: baixa o cabeçalho, não o vídeo. */
function lerDuracao(src) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => { resolve(Number.isFinite(v.duration) ? v.duration : null); v.src = ""; };
    v.onerror = () => resolve(null);
    v.src = src;
  });
}

/** O que só o mestre escuta. */
export function ouvirComoMestre() {
  ao(MSG.STATUS, (msg) => {
    if (!game.user.isGM) return;
    const anterior = Diretor.estados.get(msg.userId) ?? {};
    Diretor.estados.set(msg.userId, { ...anterior, ...msg });
    Diretor.atualizar();
  });

  // chegou atrasado: reenvia o mesmo instante combinado, só para ele
  ao(MSG.REJOIN, (msg) => {
    if (!game.user.isGM || !Diretor.cue || !Diretor.startAt) return;
    log(`${game.users.get(msg.from)?.name} chegou atrasado — reenviando a largada`);
    enviar(MSG.START, { cue: Diretor.cue, startAt: Diretor.startAt, to: msg.from });
  });
}
