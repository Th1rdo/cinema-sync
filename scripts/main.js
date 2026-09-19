import { MODULE_ID, MSG, log } from "./const.js";
import { iniciarRede, ao, enviar } from "./net.js";
import { tela } from "./screen.js";
import { Diretor, ouvirComoMestre } from "./director.js";
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

  log("inicializado");
});

/**
 * Botão na barra de ferramentas da esquerda (scene controls).
 *
 * A partir da v13 o hook recebe um Record indexado por nome, não mais um array.
 * Entramos como ferramenta dentro do grupo de tokens em vez de criar um grupo
 * próprio: grupo sem camada de canvas associada pode não renderizar.
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

Hooks.once("ready", () => {
  iniciarRede();

  // --- o que todo cliente faz ---
  ao(MSG.ARM,     (m) => tela.armar(m.cue));
  ao(MSG.CURTAIN, (m) => tela.cortina(m.cue));
  ao(MSG.START,   (m) => tela.iniciar(m.cue, m.startAt));
  ao(MSG.STOP,    ()  => tela.encerrar());

  // --- o que só o mestre faz ---
  if (game.user.isGM) ouvirComoMestre();
  else enviar(MSG.REJOIN, {});          // cheguei agora: tem algo em cartaz?

  game.cinema = {
    diretor: () => Diretor.abrir(),
    encerrar: () => tela.encerrar(),
    limparCache,
    tela,
    Diretor
  };

  log("pronto");
});
