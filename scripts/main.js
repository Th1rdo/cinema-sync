import { MODULE_ID, MSG, log } from "./const.js";
import { iniciarRede, ao, enviar } from "./net.js";
import { tela } from "./screen.js";
import { Diretor, ouvirComoMestre } from "./director.js";
import { Monitor } from "./monitor.js";
import { canvasFoiRedesenhado } from "./ambiente.js";
import { limparCache } from "./preload.js";

Hooks.once("init", () => {
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

  game.keybindings.register(MODULE_ID, "diretor", {
    name: "CINEMA.Atalho.Diretor",
    editable: [{ key: "KeyC", modifiers: ["Control", "Shift"] }],
    restricted: true,
    onDown: () => { Diretor.abrir(); return true; }
  });
});

/**
 * Claquete na barra de ferramentas da esquerda.
 * v13+: o hook recebe um Record indexado por nome. Entramos como ferramenta do
 * grupo de tokens em vez de criar grupo próprio (grupo sem camada pode não renderizar).
 */
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM || Array.isArray(controls)) return;
  const grupo = controls.tokens ?? Object.values(controls)[0];
  if (!grupo?.tools) return;
  grupo.tools.cinema = {
    name: "cinema",
    order: Object.keys(grupo.tools).length + 1,
    title: "CINEMA.Diretor",
    icon: "fa-solid fa-clapperboard",
    button: true,
    visible: true,
    onChange: () => Diretor.abrir()
  };
});

// o Foundry reconfigura o FPS ao redesenhar o canvas; se houver cena passando, re-congela
Hooks.on("canvasReady", () => canvasFoiRedesenhado());

Hooks.once("ready", () => {
  iniciarRede();

  // pré-carga: jogadores sempre; o mestre só se for assistir na janela
  ao(MSG.ARM, (m) => tela.armar(m.cue));

  // largada: jogador vai para a tela cheia, mestre para a janela
  ao(MSG.START, (m) => {
    if (!game.user.isGM) return tela.iniciar(m.cue, m.startAt);
    if (game.settings.get(MODULE_ID, "mestreAssiste")) Monitor.exibir(m.cue, m.startAt);
  });

  ao(MSG.STOP, () => {
    if (game.user.isGM) Monitor.parar();
    else tela.encerrar();
  });

  if (game.user.isGM) ouvirComoMestre();
  else enviar(MSG.REJOIN, {});        // cheguei agora: tem algo em cartaz?

  game.cinema = {
    diretor: () => Diretor.abrir(),
    encerrar: () => (game.user.isGM ? Monitor.parar() : tela.encerrar()),
    limparCache,
    tela,
    Diretor,
    Monitor
  };

  log("pronto");
});
