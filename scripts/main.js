import { MODULE_ID, MSG, log } from "./const.js";
import { iniciarRede, ao, enviar } from "./net.js";
import { tela } from "./screen.js";
import { Monitor } from "./monitor.js";
import { Cinema, ouvirComoMestre } from "./cinema.js";
import * as bib from "./biblioteca.js";
import { canvasFoiRedesenhado } from "./ambiente.js";
import { limparCache } from "./preload.js";
import { comandoDaMacro } from "./logica.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "biblioteca", {
    scope: "world", config: false, type: Object, default: { itens: [] },
    onChange: () => {
      bib.filaDeFundo();                 // item novo marcado para pré-carregar: começa a baixar
      if (game.user.isGM) Cinema.atualizar();
    }
  });

  game.settings.register(MODULE_ID, "volume", {
    name: "CINEMA.Config.Volume", hint: "CINEMA.Config.VolumeHint",
    scope: "client", config: true, type: Number, default: 0.8,
    range: { min: 0, max: 1, step: 0.05 }
  });

  game.settings.register(MODULE_ID, "mestreAssiste", {
    name: "CINEMA.Config.MestreAssiste", hint: "CINEMA.Config.MestreAssisteHint",
    scope: "world", config: true, type: Boolean, default: true
  });

  game.settings.register(MODULE_ID, "silenciarMusica", {
    name: "CINEMA.Config.SilenciarMusica", hint: "CINEMA.Config.SilenciarMusicaHint",
    scope: "world", config: true, type: Boolean, default: true
  });

  game.settings.register(MODULE_ID, "fecharNoFim", {
    name: "CINEMA.Config.FecharNoFim", hint: "CINEMA.Config.FecharNoFimHint",
    scope: "world", config: true, type: Boolean, default: true
  });

  game.keybindings.register(MODULE_ID, "abrir", {
    name: "CINEMA.Atalho.Abrir",
    editable: [{ key: "KeyC", modifiers: ["Control", "Shift"] }],
    restricted: true,
    onDown: () => { Cinema.abrir(); return true; }
  });
});

/** Claquete na barra de ferramentas da esquerda (v13+: Record indexado por nome). */
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM || Array.isArray(controls)) return;
  const grupo = controls.tokens ?? Object.values(controls)[0];
  if (!grupo?.tools) return;
  grupo.tools.cinema = {
    name: "cinema",
    order: Object.keys(grupo.tools).length + 1,
    title: "CINEMA.Titulo",
    icon: "fa-solid fa-clapperboard",
    button: true,
    visible: true,
    onChange: () => Cinema.abrir()
  };
});

/**
 * Card da biblioteca solto na hotbar: vira macro de um clique.
 * Reaproveita a macro se já existir uma para o mesmo item.
 */
Hooks.on("hotbarDrop", (_hotbar, data, slot) => {
  if (data?.type !== `${MODULE_ID}.Item`) return;
  const item = bib.obter(data.itemId);
  if (!item) return false;

  (async () => {
    const existente = game.macros.find(m => m.getFlag(MODULE_ID, "itemId") === item.id && m.isOwner);
    const macro = existente ?? await Macro.implementation.create({
      name: item.nome,
      type: "script",
      img: `modules/${MODULE_ID}/assets/claquete.svg`,
      command: comandoDaMacro(item.id),
      flags: { [MODULE_ID]: { itemId: item.id } }
    });
    await game.user.assignHotbarMacro(macro, slot);
  })();
  return false;
});

// o Foundry reconfigura o FPS ao redesenhar o canvas; com cena passando, re-congela
Hooks.on("canvasReady", () => canvasFoiRedesenhado());

Hooks.once("ready", () => {
  iniciarRede();

  // baixar: só quem foi chamado
  ao(MSG.ARM, (m) => { if (m.para?.includes(game.user.id)) bib.baixar(m.item); });

  // largada: jogador da audiência vai para a tela cheia; mestre, para a janela
  ao(MSG.START, (m) => {
    const exibicao = { item: m.item, startAt: m.startAt, exibicaoId: m.exibicaoId };
    if (game.user.isGM) {
      if (game.settings.get(MODULE_ID, "mestreAssiste")) Monitor.exibir(exibicao);
    } else if (m.audiencia?.includes(game.user.id)) {
      tela.iniciar(exibicao);
    }
  });

  ao(MSG.STOP, () => (game.user.isGM ? Monitor.parar() : tela.encerrar()));

  // cutscene removida: apaga do disco e atualiza o inventário do mestre
  ao(MSG.ESQUECER, async (m) => { await bib.esquecerLocal(m.src); bib.relatarInventario(); });

  // o mestre entrou ou recarregou: pede a todos o que já têm em disco
  ao(MSG.CENSO, () => { if (!game.user.isGM) bib.relatarInventario(); });

  if (game.user.isGM) {
    ouvirComoMestre();
    enviar(MSG.CENSO, {});
  } else {
    enviar(MSG.REJOIN, {});                    // cheguei agora: tem algo em cartaz?
  }

  // conta o que já tem em disco e baixa em segundo plano o que falta
  bib.relatarInventario().then(() => bib.filaDeFundo());

  game.cinema = {
    abrir: () => Cinema.abrir(),
    exibir: (itemId, audiencia = null) => Cinema.exibirItem(itemId, audiencia),
    parar: () => Cinema.parar(),
    biblioteca: bib,
    limparCache
  };

  log("pronto");
});
