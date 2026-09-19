import { MODULE_ID, MSG, PHASE, SYNC, log } from "./const.js";
import { enviar, ao, plateia } from "./net.js";
import { serverNow } from "./clock.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Painel do mestre: escolher, pré-carregar, chamar e exibir. */
export class Diretor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "cinema-diretor",
    tag: "div",
    window: { title: "CINEMA.Diretor", icon: "fa-solid fa-clapperboard", resizable: true },
    position: { width: 480, height: "auto" },
    classes: ["cinema-diretor"],
    actions: {
      escolher: Diretor.#escolher,
      armar: Diretor.#armar,
      cortina: Diretor.#cortina,
      exibir: Diretor.#exibir,
      encerrar: Diretor.#encerrar
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/director.hbs` } };

  /** Estado da cutscene em preparo. */
  static cue = null;                 // { cueId, src, titulo }
  static estados = new Map();        // userId → { phase, pct, erro, fullscreen, desvio }
  static startAt = null;             // instante combinado da exibição em cartaz
  static #instancia = null;

  static abrir() {
    Diretor.#instancia ??= new Diretor();
    Diretor.#instancia.render({ force: true });
    return Diretor.#instancia;
  }

  static atualizar() {
    if (Diretor.#instancia?.rendered) Diretor.#instancia.render();
  }

  async _prepareContext() {
    const cue = Diretor.cue;
    const jogadores = plateia({ incluirMestre: game.settings.get(MODULE_ID, "mestreAssiste") })
      .map(u => {
        const e = Diretor.estados.get(u.id) ?? { phase: PHASE.IDLE };
        return {
          nome: u.name,
          cor: u.color?.css ?? u.color ?? "#999",
          fase: e.phase,
          rotulo: game.i18n.localize(`CINEMA.Fase.${e.phase}`),
          pct: Math.round((e.pct ?? 0) * 100),
          erro: e.erro,
          desvio: e.desvio,
          carregando: e.phase === PHASE.LOADING,
          pronto: [PHASE.READY, PHASE.CURTAINED, PHASE.PLAYING, PHASE.ENDED].includes(e.phase)
        };
      });

    const prontos = jogadores.filter(j => j.pronto).length;
    return {
      cue,
      jogadores,
      prontos,
      total: jogadores.length,
      todosProntos: jogadores.length > 0 && prontos === jogadores.length,
      podeExibir: !!cue && prontos > 0,
      desvioMax: Math.max(0, ...jogadores.map(j => Math.abs(j.desvio ?? 0)))
    };
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
        Diretor.estados.clear();
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

  static #cortina() {
    if (!Diretor.cue) return;
    enviar(MSG.CURTAIN, { cue: Diretor.cue }, { local: game.settings.get(MODULE_ID, "mestreAssiste") });
    Diretor.atualizar();
  }

  static #exibir() {
    if (!Diretor.cue) return;
    const startAt = serverNow() + SYNC.LEAD_MS;
    Diretor.startAt = startAt;
    enviar(MSG.START, { cue: Diretor.cue, startAt }, { local: game.settings.get(MODULE_ID, "mestreAssiste") });
    log(`exibindo em ${SYNC.LEAD_MS}ms (startAt=${startAt})`);
    Diretor.atualizar();
  }

  static #encerrar() {
    Diretor.startAt = null;
    enviar(MSG.STOP, { cueId: Diretor.cue?.cueId }, { local: true });
    Diretor.atualizar();
  }
}

/** Handlers que só o mestre executa. */
export function ouvirComoMestre() {
  ao(MSG.STATUS, (msg) => {
    if (!game.user.isGM) return;
    const anterior = Diretor.estados.get(msg.userId) ?? {};
    Diretor.estados.set(msg.userId, { ...anterior, ...msg });
    Diretor.atualizar();
  });

  ao(MSG.ENDED, (msg) => {
    if (!game.user.isGM) return;
    log(`${game.users.get(msg.from)?.name} terminou`);
  });

  // cliente chegou atrasado: manda o mesmo instante combinado, só para ele
  ao(MSG.REJOIN, (msg) => {
    if (!game.user.isGM) return;
    if (!Diretor.cue || !Diretor.startAt) return;     // nada em cartaz
    log(`${game.users.get(msg.from)?.name} chegou atrasado — reenviando o instante combinado`);
    enviar(MSG.START, { cue: Diretor.cue, startAt: Diretor.startAt, to: msg.from });
  });
}
