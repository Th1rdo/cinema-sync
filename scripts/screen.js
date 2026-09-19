import { MODULE_ID, MSG, PHASE, SYNC, warn } from "./const.js";
import { enviar } from "./net.js";
import { Reprodutor } from "./player.js";
import { abaixarMusica, restaurarMusica, congelarCanvas, descongelarCanvas } from "./ambiente.js";
import { estaEmTelaCheia, cliqueAindaVale } from "./telacheia.js";

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

  get ativo() { return !!this.#root; }

  async iniciar({ item, startAt, exibicaoId }) {
    if (this.#root) await this.encerrar({ fade: false });
    this.#exibicao = { exibicaoId, itemId: item.id };

    const root = this.#montar();
    congelarCanvas();
    abaixarMusica();

    // o jogador acabou de clicar (moveu um token, abriu uma ficha)? o navegador
    // ainda aceita o pedido: entra em tela cheia sem mostrar nada. Pedido feito
    // já, antes de qualquer espera, enquanto o clique ainda vale.
    this.#telaCheiaPermitida = item.pedirTelaCheia ?? true;
    root.querySelector(".cinema-btn-telacheia").hidden = !this.#telaCheiaPermitida;
    if (this.#telaCheiaPermitida && cliqueAindaVale()) this.#entrarEmTelaCheia();

    const volume = game.settings.get(MODULE_ID, "volume") * (item.volume ?? 1);
    this.#reprodutor = await Reprodutor.criar({
      src: item.src,
      palco: root.querySelector(".cinema-palco"),
      volume,
      mudo: !!game.audio?.locked,
      onRelato: (r) => {
        if (r.mudo) root.querySelector(".cinema-som").hidden = false;
        this.#reportar(PHASE.PLAYING, r);
      },
      onFim: () => {
        this.#reportar(PHASE.ENDED);
        if (game.settings.get(MODULE_ID, "fecharNoFim")) this.encerrar();
      }
    });
    if (!this.#root) return this.#reprodutor.destruir();   // encerrado enquanto resolvia o cache

    this.#reprodutor.video.addEventListener("playing", () => clearTimeout(this.#watchdog), { once: true });
    this.#reprodutor.agendar(startAt);

    this.#watchdog = setTimeout(() => {
      warn("a cena não começou a tempo; liberando a tela");
      this.#reportar(PHASE.FAILED, { erro: "não começou a tempo" });
      this.encerrar({ fade: false });
    }, Math.max(0, startAt - game.time.serverTime) + SYNC.START_TIMEOUT);
  }

  /** Clique na cena: tela cheia (se esta cena permite) e som (se estava mudo). */
  #aoClicar = () => {
    if (this.#reprodutor?.mudo) {
      this.#reprodutor.desmutar();
      this.#root.querySelector(".cinema-som").hidden = true;
    }
    if (this.#telaCheiaPermitida) this.#entrarEmTelaCheia();
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
    if (ev.key !== "Escape" || !this.#root || document.fullscreenElement) return;
    this.#reportar(PHASE.LEFT);
    this.encerrar();
  };

  async encerrar({ fade = true } = {}) {
    clearTimeout(this.#watchdog);
    const root = this.#root;
    if (!root) return;
    this.#root = null;

    // a mesa volta a ser desenhada POR BAIXO do preto antes do fade começar:
    // quando o preto some, ela já está lá, e a música volta junto
    const devolverMesa = () => {
      document.body.classList.remove("cinema-ativo");
      descongelarCanvas();
      restaurarMusica();
    };

    if (fade) {
      devolverMesa();
      root.classList.add("cinema-saindo");                 // o filme apaga, depois o preto some
      await new Promise(r => setTimeout(r, 1200));
    }
    this.#reprodutor?.destruir();
    this.#reprodutor = null;

    if (this.#entrouFullscreen && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    this.#entrouFullscreen = false;

    window.removeEventListener("keydown", this.#aoTeclar, true);
    document.removeEventListener("fullscreenchange", this.#atualizarBotao);
    clearTimeout(this.#esconderControles);
    root.remove();
    if (!fade) devolverMesa();
    this.#exibicao = null;
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

  #reportar(phase, extra = {}) {
    enviar(MSG.STATUS, { ...this.#exibicao, userId: game.user.id, phase, ...extra });
  }
}

export const tela = new TelaDeCinema();
