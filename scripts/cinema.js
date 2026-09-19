import { MODULE_ID, MSG, PHASE, SYNC, log } from "./const.js";
import { enviar, ao } from "./net.js";
import { serverNow } from "./clock.js";
import * as bib from "./biblioteca.js";
import { resolverAudiencia, quemFalta, quemAguardar, coberturaDoCache, pesoDoVideo, mmss } from "./logica.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * A janela Cinema: biblioteca de cutscenes e o controle da exibição ao vivo.
 * Critério de desenho: tudo que o mestre faz no meio da sessão é UM clique.
 */
export class Cinema extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "cinema-sync",
    tag: "div",
    window: { title: "CINEMA.Titulo", icon: "fa-solid fa-clapperboard", resizable: true },
    position: { width: 620, height: 560 },
    classes: ["cinema-app"],
    actions: {
      adicionar: Cinema.#adicionar,
      exibir: Cinema.#exibir,
      exibirPara: Cinema.#exibirPara,
      preCarregar: Cinema.#preCarregar,
      editar: Cinema.#editar,
      comecarJa: Cinema.#comecarJa,
      encerrar: Cinema.#encerrar
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/cinema.hbs`, scrollable: [".cinema-grade"] } };

  // ------------------------------------------------------------------ estado do mestre
  /** userId → Set(itemId) do que cada cliente já tem em disco */
  static inventario = new Map();
  /** itemId → Map(userId → mensagem de erro) do último download que falhou */
  static falhas = new Map();
  /** userId → está em tela cheia agora? */
  static telaCheia = new Map();
  /** userId → último relato durante a exibição atual */
  static relatos = new Map();
  /**
   * Exibição atual.
   * { exibicaoId, itemId, audiencia, estado: "esperando"|"no-ar", startAt, timer }
   */
  static exibicao = null;

  static #instancia = null;
  static #renderPendente = null;
  #relogio = null;

  static abrir() {
    Cinema.#instancia ??= new Cinema();
    Cinema.#instancia.render({ force: true });
    return Cinema.#instancia;
  }

  /** No máximo um re-render a cada 250 ms, não importa quantos relatos cheguem. */
  static atualizar() {
    if (!Cinema.#instancia?.rendered || Cinema.#renderPendente) return;
    Cinema.#renderPendente = setTimeout(() => {
      Cinema.#renderPendente = null;
      Cinema.#instancia?.render();
    }, 250);
  }

  // ------------------------------------------------------------------ contexto
  async _prepareContext() {
    const usuarios = game.users.contents;
    const ex = Cinema.exibicao;

    const cards = bib.itens().map(item => {
      const cache = coberturaDoCache(item, usuarios, Cinema.inventario);
      const peso = pesoDoVideo(item);
      const audiencia = item.audiencia
        ? item.audiencia.map(id => game.users.get(id)).filter(Boolean).map(u => ({ nome: u.name, cor: u.color?.css ?? u.color }))
        : null;
      return {
        ...item,
        duracaoTxt: item.duracao ? mmss(item.duracao) : "",
        peso,
        cache,
        audiencia,
        pedirTelaCheia: item.pedirTelaCheia ?? true,
        temLeve: !!item.srcLeve,
        falhas: [...(Cinema.falhas.get(item.id) ?? new Map())]
          .map(([uid, erro]) => `${game.users.get(uid)?.name ?? "?"}: ${erro}`).join("\n"),
        emCartaz: ex?.itemId === item.id
      };
    });

    let emCartaz = null;
    if (ex) {
      const item = bib.obter(ex.itemId);
      const faltam = quemAguardar(ex.audiencia, Cinema.inventario, Cinema.relatos, ex.itemId);
      emCartaz = {
        nome: item?.nome ?? "—",
        esperando: ex.estado === "esperando",
        faltam: faltam.map(id => {
          const r = Cinema.relatos.get(id) ?? {};
          const progresso = typeof r.pct === "number" ? `${Math.round(r.pct * 100)}%` : (r.mb ? `${r.mb} MB` : "…");
          return { nome: game.users.get(id)?.name ?? "?", progresso };
        }),
        plateia: ex.audiencia.map(id => {
          const u = game.users.get(id);
          const r = Cinema.relatos.get(id) ?? {};
          return {
            nome: u?.name ?? "?",
            cor: u?.color?.css ?? u?.color ?? "#999",
            telaCheia: !!Cinema.telaCheia.get(id),
            fase: r.phase ?? PHASE.IDLE,
            rotulo: game.i18n.localize(`CINEMA.Fase.${r.phase ?? PHASE.IDLE}`),
            somBloqueado: !!(r.somBloqueado || r.mudo),
            engasgando: (r.perdidos ?? 0) >= 10,
            perdidos: r.perdidos ?? 0,
            fluidez: !!r.fluidez,
            leve: r.versao === "leve",
            erro: r.phase === PHASE.FAILED ? r.erro : null,
            desvio: r.desvio
          };
        })
      };
    }

    // quem está na mesa agora, e quem já vai ver no monitor inteiro
    const presentes = game.users.filter(u => u.active && !u.isGM).map(u => ({
      nome: u.name,
      cor: u.color?.css ?? u.color ?? "#999",
      telaCheia: !!Cinema.telaCheia.get(u.id)
    }));

    return { cards, vazio: cards.length === 0, emCartaz, presentes };
  }

  _onRender() {
    // miniaturas chegam depois (ficam no navegador do mestre)
    for (const img of this.element.querySelectorAll("img[data-miniatura]")) {
      const item = bib.obter(img.dataset.miniatura);
      if (item) bib.miniatura(item).then(url => {
        if (!url) return;
        img.src = url;
        img.hidden = false;
        img.parentElement.querySelector(".cinema-thumb-vazia")?.remove();
      });
    }

    // arrastar um card para a hotbar vira macro de um clique
    for (const card of this.element.querySelectorAll(".cinema-card[data-item-id]")) {
      card.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: `${MODULE_ID}.Item`, itemId: card.dataset.itemId }));
      });
    }

    // linha do tempo: atualiza texto e barra sem re-render
    clearInterval(this.#relogio);
    const ex = Cinema.exibicao;
    if (ex?.estado !== "no-ar") return;
    const duracao = bib.obter(ex.itemId)?.duracao;
    const barra = this.element.querySelector(".cinema-tempo-barra > span");
    const texto = this.element.querySelector(".cinema-tempo-texto");
    const tick = () => {
      const t = Math.max(0, (serverNow() - ex.startAt) / 1000);
      if (texto) texto.textContent = duracao ? `${mmss(t)} / ${mmss(duracao)}` : mmss(t);
      if (barra && duracao) barra.style.width = `${Math.min(100, 100 * t / duracao)}%`;
      if (duracao && t > duracao + 2) {                         // acabou pelo relógio
        clearInterval(this.#relogio);
        Cinema.terminar();
      }
    };
    tick();
    this.#relogio = setInterval(tick, 500);
  }

  _onClose(options) {
    clearInterval(this.#relogio);
    super._onClose?.(options);
  }

  // ------------------------------------------------------------------ exibir
  /**
   * Um clique: se toda a audiência já tem o vídeo, começa. Se falta alguém,
   * manda baixar só para quem falta e começa sozinho quando estiverem prontos
   * — ou depois de ESPERA_MAX, ou quando o mestre clicar "começar já".
   */
  static exibirItem(itemId, escolha = null) {
    if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("CINEMA.Avisos.SoMestre"));
    const item = bib.obter(itemId);
    if (!item) return ui.notifications.warn(game.i18n.localize("CINEMA.Avisos.NaoEncontrada"));
    if (Cinema.exibicao) Cinema.parar();

    const audiencia = resolverAudiencia(item, escolha, game.users.contents);
    Cinema.relatos.clear();
    Cinema.exibicao = { exibicaoId: foundry.utils.randomID(), itemId, audiencia, estado: "esperando", startAt: null };

    const faltam = quemFalta(audiencia, Cinema.inventario, itemId);
    if (!faltam.length) return Cinema.largar();

    log(`${faltam.length} ainda sem o vídeo — baixando antes de começar`);
    enviar(MSG.ARM, { item, para: faltam });
    Cinema.exibicao.timer = setTimeout(() => Cinema.largar(), SYNC.ESPERA_MAX);
    Cinema.abrir();
  }

  static largar() {
    const ex = Cinema.exibicao;
    if (!ex || ex.estado === "no-ar") return;
    clearTimeout(ex.timer);
    ex.estado = "no-ar";
    ex.startAt = serverNow() + SYNC.LEAD_MS;
    const item = bib.obter(ex.itemId);
    enviar(MSG.START, { item, startAt: ex.startAt, exibicaoId: ex.exibicaoId, audiencia: ex.audiencia }, { local: true });
    Cinema.atualizar();
  }

  /** Encerra para todos. */
  static parar() {
    const ex = Cinema.exibicao;
    if (ex) clearTimeout(ex.timer);
    Cinema.exibicao = null;
    enviar(MSG.STOP, {}, { local: true });
    Cinema.atualizar();
  }

  /** O vídeo acabou: libera o painel (os clientes fecham sozinhos). */
  static terminar() {
    const ex = Cinema.exibicao;
    if (ex) clearTimeout(ex.timer);
    Cinema.exibicao = null;
    Cinema.atualizar();
  }

  // ------------------------------------------------------------------ ações
  static async #adicionar() {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "video",
      callback: async (caminho) => {
        const item = await bib.adicionar(caminho);
        const peso = pesoDoVideo(item);
        if (peso.pesado) ui.notifications.warn(game.i18n.format("CINEMA.Avisos.Pesado", { rotulo: peso.rotulo }));
        Cinema.atualizar();
      }
    }).render(true);
  }

  static #exibir(ev, alvo) { Cinema.exibirItem(alvo.closest("[data-item-id]").dataset.itemId); }

  static async #exibirPara(ev, alvo) {
    const itemId = alvo.closest("[data-item-id]").dataset.itemId;
    const item = bib.obter(itemId);
    const ativos = game.users.filter(u => u.active && !u.isGM);
    if (!ativos.length) return ui.notifications.warn(game.i18n.localize("CINEMA.SemJogadores"));

    const marcados = new Set(item.audiencia ?? ativos.map(u => u.id));
    const escolha = await DialogV2.wait({
      window: { title: game.i18n.format("CINEMA.ExibirPara", { nome: item.nome }) },
      content: `<div class="cinema-escolha">${ativos.map(u => `
        <label><input type="checkbox" name="u" value="${u.id}" ${marcados.has(u.id) ? "checked" : ""}> ${u.name}</label>`).join("")}</div>`,
      buttons: [{
        action: "ok", label: game.i18n.localize("CINEMA.Exibir"), icon: "fa-solid fa-play", default: true,
        callback: (_e, botao, dialogo) => {
          const form = botao.form ?? dialogo.element.querySelector("form");
          return [...form.querySelectorAll('input[name="u"]:checked')].map(i => i.value);
        }
      }, { action: "cancelar", label: game.i18n.localize("Cancel") }],
      rejectClose: false
    });
    if (Array.isArray(escolha) && escolha.length) Cinema.exibirItem(itemId, escolha);
  }

  static #preCarregar(ev, alvo) {
    const item = bib.obter(alvo.closest("[data-item-id]").dataset.itemId);
    const para = resolverAudiencia(item, null, game.users.contents);
    if (game.settings.get(MODULE_ID, "mestreAssiste")) para.push(game.user.id);
    enviar(MSG.ARM, { item, para }, { local: true });
    ui.notifications.info(game.i18n.format("CINEMA.Avisos.Baixando", { nome: item.nome }));
  }

  static async #editar(ev, alvo) {
    const item = bib.obter(alvo.closest("[data-item-id]").dataset.itemId);
    const jogadores = game.users.filter(u => !u.isGM);
    const todos = !item.audiencia;
    const html = `
      <div class="cinema-editar">
        <label>${game.i18n.localize("CINEMA.Nome")}<input type="text" name="nome" value="${foundry.utils.escapeHTML?.(item.nome) ?? item.nome}"></label>
        <fieldset>
          <legend>${game.i18n.localize("CINEMA.Audiencia")}</legend>
          <label><input type="checkbox" name="todos" ${todos ? "checked" : ""}> ${game.i18n.localize("CINEMA.Todos")}</label>
          ${jogadores.map(u => `<label><input type="checkbox" name="u" value="${u.id}" ${todos || item.audiencia.includes(u.id) ? "checked" : ""}> ${u.name}</label>`).join("")}
        </fieldset>
        <label class="cinema-linha"><input type="checkbox" name="preCarregar" ${item.preCarregar ? "checked" : ""}> ${game.i18n.localize("CINEMA.PreCarregarAoEntrar")}</label>
        <label class="cinema-linha"><input type="checkbox" name="pedirTelaCheia" ${(item.pedirTelaCheia ?? true) ? "checked" : ""}> ${game.i18n.localize("CINEMA.PedirTelaCheia")}</label>
        <label>${game.i18n.localize("CINEMA.Volume")} <input type="range" name="volume" min="0" max="1" step="0.05" value="${item.volume ?? 1}"></label>
        <fieldset>
          <legend>${game.i18n.localize("CINEMA.VersaoLeve")}</legend>
          <p class="cinema-ajuda">${game.i18n.localize("CINEMA.VersaoLeveHint")}</p>
          <div class="cinema-linha">
            <input type="text" name="srcLeve" value="${item.srcLeve ?? ""}" placeholder="${game.i18n.localize("CINEMA.VersaoLeveVazia")}">
            <button type="button" data-escolher-leve><i class="fa-solid fa-folder-open"></i></button>
          </div>
        </fieldset>
      </div>`;

    // o botão de pasta abre o seletor de ficheiros e preenche o campo. Escuta por
    // delegação, só enquanto o diálogo está aberto: não depende da API do DialogV2
    const aoEscolherLeve = (ev) => {
      const botao = ev.target.closest?.("[data-escolher-leve]");
      if (!botao) return;
      const campo = botao.closest(".cinema-editar")?.querySelector('[name="srcLeve"]');
      if (!campo) return;
      const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      new FP({ type: "video", current: campo.value, callback: (c) => { campo.value = c; } }).render(true);
    };
    document.addEventListener("click", aoEscolherLeve, true);

    const resultado = await DialogV2.wait({
      window: { title: game.i18n.format("CINEMA.Editar", { nome: item.nome }) },
      content: html,
      buttons: [
        { action: "salvar", label: game.i18n.localize("CINEMA.Salvar"), icon: "fa-solid fa-check", default: true,
          callback: (_e, botao, dialogo) => {
            const f = botao.form ?? dialogo.element.querySelector("form");
            const marcados = [...f.querySelectorAll('input[name="u"]:checked')].map(i => i.value);
            return {
              nome: f.querySelector('[name="nome"]').value.trim() || item.nome,
              audiencia: f.querySelector('[name="todos"]').checked ? null : marcados,
              preCarregar: f.querySelector('[name="preCarregar"]').checked,
              pedirTelaCheia: f.querySelector('[name="pedirTelaCheia"]').checked,
              srcLeve: f.querySelector('[name="srcLeve"]').value.trim() || null,
              volume: Number(f.querySelector('[name="volume"]').value)
            };
          } },
        { action: "remover", label: game.i18n.localize("CINEMA.Remover"), icon: "fa-solid fa-trash" },
        { action: "cancelar", label: game.i18n.localize("Cancel") }
      ],
      rejectClose: false
    }).finally(() => document.removeEventListener("click", aoEscolherLeve, true));

    if (resultado === "remover") {
      const ok = await DialogV2.confirm({
        window: { title: game.i18n.localize("CINEMA.Remover") },
        content: `<p>${game.i18n.format("CINEMA.ConfirmarRemover", { nome: item.nome })}</p>`
      });
      if (ok) await bib.remover(item.id);
    } else if (resultado && typeof resultado === "object") {
      // versão leve nova: guarda a altura dela (a decisão compara com o ecrã)
      if (resultado.srcLeve && resultado.srcLeve !== item.srcLeve) {
        resultado.alturaLeve = (await bib.lerMetadados(resultado.srcLeve)).altura ?? 1080;
      }
      await bib.atualizar(item.id, resultado);
    }
    Cinema.atualizar();
  }

  static #comecarJa() { Cinema.largar(); }
  static #encerrar() { Cinema.parar(); }
}

// ------------------------------------------------------------------ o que o mestre escuta
export function ouvirComoMestre() {
  ao(MSG.TELA, (m) => {
    if (!game.user.isGM) return;
    Cinema.telaCheia.set(m.userId, !!m.telaCheia);
    Cinema.atualizar();
  });

  ao(MSG.INVENTARIO, (m) => {
    if (!game.user.isGM) return;
    Cinema.inventario.set(m.userId, new Set(m.ids));
    Cinema.atualizar();
  });

  ao(MSG.STATUS, (m) => {
    if (!game.user.isGM) return;
    // terminou de baixar: entra no inventário
    if (m.phase === PHASE.READY && m.itemId) {
      if (!Cinema.inventario.has(m.userId)) Cinema.inventario.set(m.userId, new Set());
      Cinema.inventario.get(m.userId).add(m.itemId);
      Cinema.falhas.get(m.itemId)?.delete(m.userId);
    }
    // falha de download aparece no card, mesmo fora de uma exibição
    if ((m.phase === PHASE.FAILED || m.phase === PHASE.NOCODEC) && m.itemId) {
      if (!Cinema.falhas.has(m.itemId)) Cinema.falhas.set(m.itemId, new Map());
      Cinema.falhas.get(m.itemId).set(m.userId, m.erro ?? m.phase);
    }

    const ex = Cinema.exibicao;
    const daExibicao = ex && (m.exibicaoId === ex.exibicaoId || (!m.exibicaoId && m.itemId === ex.itemId));
    if (daExibicao) {
      Cinema.relatos.set(m.userId, { ...(Cinema.relatos.get(m.userId) ?? {}), ...m });
      // esperando e já não há por quem esperar (prontos, ou falharam e vão pela rede): começa
      if (ex.estado === "esperando" && !quemAguardar(ex.audiencia, Cinema.inventario, Cinema.relatos, ex.itemId).length) {
        Cinema.largar();
      }
      // todos terminaram: libera o painel
      if (ex.estado === "no-ar" && ex.audiencia.length && ex.audiencia.every(id => [PHASE.ENDED, PHASE.LEFT, PHASE.FAILED].includes(Cinema.relatos.get(id)?.phase))) {
        Cinema.terminar();
      }
    }
    Cinema.atualizar();
  });

  // chegou atrasado e está na audiência: reenvia a largada só para ele
  ao(MSG.REJOIN, (m) => {
    const ex = Cinema.exibicao;
    if (!game.user.isGM || ex?.estado !== "no-ar" || !ex.audiencia.includes(m.from)) return;
    log(`${game.users.get(m.from)?.name} chegou atrasado — reenviando a largada`);
    enviar(MSG.START, { item: bib.obter(ex.itemId), startAt: ex.startAt, exibicaoId: ex.exibicaoId,
                        audiencia: ex.audiencia, to: m.from });
  });
}
