import { MODULE_ID, MSG, PHASE, SYNC, warn } from "./const.js";
import { enviar } from "./net.js";
import { Reprodutor } from "./player.js";
import { abaixarMusica, restaurarMusica, congelarCanvas, descongelarCanvas } from "./ambiente.js";
import { estaEmTelaCheia } from "./telacheia.js";
import { srcParaEste, lembrarTeto } from "./biblioteca.js";
import { pausarDownloads, retomarDownloads } from "./preload.js";

/**
 * A tela do jogador: preto, o filme, a mesa de volta.
 *
 * Imersão é o critério: nenhum texto, nenhum botão, nenhum cursor. O preto dos
 * segundos iniciais é a cortina; o filme entra em fade. A única coisa que pode
 * aparecer é o aviso de som, e só se o navegador bloqueou o áudio.
 * O mestre nunca usa esta classe — assiste na janela do monitor.js.
 */
class TelaDeCinema {
  #root = null;
  #reprodutor = null;
  #exibicao = null;          // { exibicaoId, itemId }
  #watchdog = null;
  #entrouFullscreen = false;
  #telaCheiaPermitida = true;
  #esconderControles = null;
  #geracao = 0;              // cada iniciar/encerrar invalida o que uma cena anterior ainda tinha a meio
  #downloadsPausados = false;

  get ativo() { return !!this.#root; }

  async iniciar({ item, startAt, exibicaoId }) {
    if (this.#root) await this.encerrar({ fade: false });
    const minha = ++this.#geracao;
    this.#exibicao = { exibicaoId, itemId: item.id };

    const root = this.#montar();
    congelarCanvas();
    abaixarMusica();

    // tela cheia só pelo botão do canto — nunca sozinha, nunca por um clique na cena
    this.#telaCheiaPermitida = item.pedirTelaCheia ?? true;
    root.querySelector(".cinema-btn-telacheia").hidden = !this.#telaCheiaPermitida;

    const escolha = await srcParaEste(item);
    if (minha !== this.#geracao) return;                   // encerrada (ou substituída) durante a espera
    Object.assign(this.#exibicao, { versao: `${escolha.altura}p`, original: !!escolha.original });

    const volume = game.settings.get(MODULE_ID, "volume") * (item.volume ?? 1);
    const reprodutor = await Reprodutor.criar({
      src: escolha.src,
      escada: escolha.escada,
      degrau: escolha.degrau,
      palco: root.querySelector(".cinema-palco"),
      volume,
      mudo: !!game.audio?.locked,
      onRelato: (r) => {
        if (r.mudo) root.querySelector(".cinema-som").hidden = false;
        this.#reportar(PHASE.PLAYING, r);
      },
      // desceu a meio da cena: este computador não aguenta acima disto, e as
      // próximas cenas já começam no degrau certo
      onTroca: (degrau) => {
        lembrarTeto(degrau.altura);
        if (this.#exibicao) Object.assign(this.#exibicao, { versao: `${degrau.altura}p`, original: false });
      },
      onFim: () => {
        this.#soltarDownloads();             // parado no último fotograma já não precisa da banda
        this.#reportar(PHASE.ENDED);
        if (game.settings.get(MODULE_ID, "fecharNoFim")) this.encerrar();
      }
    });
    if (minha !== this.#geracao) return reprodutor.destruir();   // encerrada enquanto lia o cache
    this.#reprodutor = reprodutor;
    pausarDownloads();                                    // a banda é da cena; os downloads retomam no fim
    this.#downloadsPausados = true;

    this.#reprodutor.video.addEventListener("playing", () => clearTimeout(this.#watchdog), { once: true });
    this.#reprodutor.agendar(startAt);

    this.#watchdog = setTimeout(() => {
      warn("a cena não começou a tempo; liberando a tela");
      this.#reportar(PHASE.FAILED, { erro: "não começou a tempo" });
      this.encerrar({ fade: false });
    }, Math.max(0, startAt - game.time.serverTime) + SYNC.START_TIMEOUT);
  }

  /** Clique na cena: só devolve o som, se o navegador o tinha bloqueado. */
  #aoClicar = () => {
    if (this.#reprodutor?.mudo) {
      this.#reprodutor.desmutar();
      this.#root.querySelector(".cinema-som").hidden = true;
    }
  };

  /** Só a cena vai para tela cheia, e ela é desfeita no fim: o alt-tab depois fica intocado. */
  async #entrarEmTelaCheia() {
    if (!this.#root || estaEmTelaCheia()) return;
    try {
      await this.#root.requestFullscreen({ navigationUI: "hide" });
      this.#entrouFullscreen = true;
    } catch { /* recusado: o overlay continua a cobrir a janela */ }
  }

  /**
   * Como num player de vídeo: mexer o rato mostra o cursor e o botão de tela
   * cheia; dois segundos parado, somem. Quem não mexe o rato não vê nada.
   */
  #aoMexer = () => {
    if (!this.#root) return;
    this.#root.classList.add("cinema-mexeu");
    clearTimeout(this.#esconderControles);
    this.#esconderControles = setTimeout(() => this.#root?.classList.remove("cinema-mexeu"), 2000);
  };

  /** O botão alterna. O clique nele é o gesto que o navegador exige. */
  #aoBotaoTelaCheia = (ev) => {
    ev.stopPropagation();                         // não deixar o clique da tela repetir o pedido
    if (document.fullscreenElement === this.#root) {
      document.exitFullscreen().catch(() => {});
      this.#entrouFullscreen = false;
    } else {
      this.#entrarEmTelaCheia();
    }
  };

  #atualizarBotao = () => {
    const btn = this.#root?.querySelector(".cinema-btn-telacheia");
    if (!btn) return;
    const nossa = document.fullscreenElement === this.#root;
    // já no ecrã inteiro pelo navegador (F11, app): o botão não teria o que fazer
    btn.classList.toggle("cinema-inutil", !nossa && estaEmTelaCheia());
    btn.querySelector("i").className = nossa ? "fa-solid fa-compress" : "fa-solid fa-expand";
    btn.title = game.i18n.localize(nossa ? "CINEMA.SairTelaCheia" : "CINEMA.TelaCheia");
  };

  /** Esc: cada jogador pode sair da própria tela; o mestre vê "saiu". */
  #aoTeclar = (ev) => {
    if (ev.key !== "Escape" || !this.#root || document.fullscreenElement) return;   // 1.º Esc: sai da tela cheia
    // o Esc é nosso: sem isto o Foundry também o recebia e abria o menu do jogo
    ev.preventDefault();
    ev.stopImmediatePropagation();
    this.#reportar(PHASE.LEFT);
    this.encerrar();
  };

  async encerrar({ fade = true } = {}) {
    clearTimeout(this.#watchdog);
    const root = this.#root;
    if (!root) return;

    // Tudo o que uma próxima cena reutiliza é desfeito JÁ, antes do fade. Se o
    // mestre trocar de cena durante estes 1,2 s, a nova já está a montar-se, e
    // o fim da antiga não pode tocar no vídeo, nas teclas nem no estado dela.
    const reprodutor = this.#reprodutor;
    const tinhaTelaCheia = this.#entrouFullscreen;
    this.#geracao++;
    this.#root = null;
    this.#reprodutor = null;
    this.#exibicao = null;
    this.#entrouFullscreen = false;
    window.removeEventListener("keydown", this.#aoTeclar, true);
    document.removeEventListener("fullscreenchange", this.#atualizarBotao);
    clearTimeout(this.#esconderControles);
    this.#soltarDownloads();

    // a mesa volta a ser desenhada POR BAIXO do preto antes do fade começar:
    // quando o preto some, ela já está lá, e a música volta junto
    document.body.classList.remove("cinema-ativo");
    descongelarCanvas();
    restaurarMusica();

    if (fade) {
      root.classList.add("cinema-saindo");                 // o filme apaga, depois o preto some
      await new Promise(r => setTimeout(r, 1200));
    }
    reprodutor?.destruir();
    if (tinhaTelaCheia && document.fullscreenElement === root) await document.exitFullscreen().catch(() => {});
    root.remove();
  }

  #montar() {
    document.body.classList.add("cinema-ativo");
    const root = document.createElement("div");
    root.id = "cinema-sync-overlay";
    root.innerHTML = `
      <div class="cinema-palco"></div>
      <div class="cinema-som" hidden>${game.i18n.localize("CINEMA.CliqueParaSom")}</div>
      <button type="button" class="cinema-btn-telacheia" title="${game.i18n.localize("CINEMA.TelaCheia")}">
        <i class="fa-solid fa-expand"></i>
      </button>`;
    root.addEventListener("click", this.#aoClicar);
    root.addEventListener("mousemove", this.#aoMexer);
    root.querySelector(".cinema-btn-telacheia").addEventListener("click", this.#aoBotaoTelaCheia);
    document.addEventListener("fullscreenchange", this.#atualizarBotao);
    window.addEventListener("keydown", this.#aoTeclar, true);
    document.body.appendChild(root);
    this.#root = root;
    this.#atualizarBotao();
    return root;
  }

  #soltarDownloads() {
    if (!this.#downloadsPausados) return;
    this.#downloadsPausados = false;
    retomarDownloads();
  }

  #reportar(phase, extra = {}) {
    enviar(MSG.STATUS, { ...this.#exibicao, userId: game.user.id, phase, ...extra });
  }
}

export const tela = new TelaDeCinema();
