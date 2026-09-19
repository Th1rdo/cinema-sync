import { MODULE_ID, MSG, PHASE, log, warn } from "./const.js";
import { enviar } from "./net.js";
import { guardar, temGuardado, esquecer, suportaCodec, urlParaTocar, soltar } from "./preload.js";
import { nomeDoArquivo, escolherVersao } from "./logica.js";

/**
 * A biblioteca de cutscenes: o que está salvo, o que cada cliente já tem em
 * disco, e a fila que baixa em segundo plano.
 *
 * Os itens moram numa configuração de mundo (só o mestre escreve; o Foundry
 * sincroniza com todos). Miniaturas ficam só no navegador do mestre — jogador
 * nunca vê a biblioteca, e assim a configuração continua pequena.
 */

// ------------------------------------------------------------------ itens
export const itens = () => game.settings.get(MODULE_ID, "biblioteca")?.itens ?? [];
export const obter = (id) => itens().find(i => i.id === id) ?? null;

async function gravar(lista) {
  await game.settings.set(MODULE_ID, "biblioteca", { itens: lista });
}

/** Lê duração e resolução só pelo cabeçalho do arquivo. */
export function lerMetadados(src) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      resolve({
        duracao: Number.isFinite(v.duration) ? v.duration : null,
        largura: v.videoWidth || null,
        altura: v.videoHeight || null
      });
      v.removeAttribute("src");
      v.load();
    };
    v.onerror = () => resolve({ duracao: null, largura: null, altura: null });
    v.src = src;
  });
}

export async function adicionar(src) {
  const meta = await lerMetadados(src);
  const item = {
    id: foundry.utils.randomID(),
    nome: nomeDoArquivo(src),
    src,
    ...meta,
    audiencia: null,          // null = todos os jogadores
    preCarregar: true,        // baixa sozinho quando o jogador entra
    pedirTelaCheia: true,     // mostra o ⛶ no preto a quem não estiver em tela cheia
    volume: 1,                // multiplica o volume de cada cliente
    criado: Date.now()
  };
  await gravar([...itens(), item]);
  return item;
}

export async function atualizar(id, patch) {
  await gravar(itens().map(i => (i.id === id ? { ...i, ...patch } : i)));
}

export async function remover(id) {
  const item = obter(id);
  await gravar(itens().filter(i => i.id !== id));
  localStorage.removeItem(chaveMiniatura(id));
  if (item) for (const src of [item.src, item.srcLeve].filter(Boolean)) enviar(MSG.ESQUECER, { src }, { local: true });
}

// ------------------------------------------------------------------ miniaturas
const chaveMiniatura = (id) => `${MODULE_ID}.miniatura.${id}`;

/**
 * Um quadro do vídeo, 320×180, guardado no navegador do mestre.
 * Se o host não liberar CORS o canvas fica "contaminado" e não exporta: o card
 * mostra a claquete no lugar. Não é erro, é só sem miniatura.
 */
const emAndamento = new Map();   // id → Promise: re-renders não disparam a mesma miniatura duas vezes
let fila = Promise.resolve();    // uma de cada vez: abrir a biblioteca não dispara N vídeos juntos

export function miniatura(item) {
  const guardada = localStorage.getItem(chaveMiniatura(item.id));
  if (guardada) return Promise.resolve(guardada);
  if (emAndamento.has(item.id)) return emAndamento.get(item.id);

  const p = (fila = fila.then(() => gerarMiniatura(item)).catch(() => null));
  emAndamento.set(item.id, p);
  p.finally(() => emAndamento.delete(item.id));
  return p;
}

async function gerarMiniatura(item) {
  const url = await urlParaTocar(item.src);
  try {
    const imagem = await new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "metadata";         // o navegador busca só o cabeçalho e o trecho do seek
      v.crossOrigin = "anonymous";
      v.onloadedmetadata = () => { v.currentTime = Math.min(3, (v.duration || 10) * 0.15); };
      v.onseeked = () => {
        try {
          const c = document.createElement("canvas");
          c.width = 320; c.height = 180;
          c.getContext("2d").drawImage(v, 0, 0, 320, 180);
          resolve(c.toDataURL("image/jpeg", 0.72));
        } catch (err) { reject(err); }
        finally { v.removeAttribute("src"); v.load(); }
      };
      v.onerror = () => reject(new Error("não carregou"));
      v.src = url;
    });
    localStorage.setItem(chaveMiniatura(item.id), imagem);
    return imagem;
  } catch (err) {
    warn(`sem miniatura para ${item.nome}: ${err.message}`);
    return null;
  } finally {
    soltar(url);
  }
}

// ------------------------------------------------------------------ versão
const CHAVE_LEMBRAR = `${MODULE_ID}.lembrarLeve`;
const decisoes = new Map();    // itemId → { src, versao }: pré-carga e exibição concordam

/** O navegador deste computador toca o original com fluidez, e por hardware? */
async function capacidade(item) {
  const mc = navigator.mediaCapabilities;
  if (!mc?.decodingInfo || !item.largura || !item.altura) return {};
  const webm = /\.webm($|\?)/i.test(item.src);
  try {
    const r = await mc.decodingInfo({
      type: "file",
      video: {
        contentType: webm ? 'video/webm; codecs="vp09.00.51.08"' : 'video/mp4; codecs="avc1.640033"',
        width: item.largura, height: item.altura,
        bitrate: item.largura * item.altura >= 3840 * 2160 ? 20_000_000 : 8_000_000,
        framerate: 30
      }
    });
    return { suave: r.smooth, eficiente: r.powerEfficient };
  } catch { return {}; }
}

/** Qual ficheiro este computador usa para este item. */
export async function srcParaEste(item) {
  if (decisoes.has(item.id)) return decisoes.get(item.id);
  const { suave, eficiente } = item.srcLeve ? await capacidade(item) : {};
  const versao = escolherVersao({
    temLeve: !!item.srcLeve,
    preferencia: game.settings.get(MODULE_ID, "qualidade"),
    lembrarLeve: localStorage.getItem(CHAVE_LEMBRAR) === "1",
    suave, eficiente,
    alturaTela: Math.round((globalThis.screen?.height ?? 0) * (globalThis.devicePixelRatio ?? 1)),
    alturaLeve: item.alturaLeve ?? 1080
  });
  const decisao = { src: versao === "leve" ? item.srcLeve : item.src, versao };
  decisoes.set(item.id, decisao);
  return decisao;
}

/** Este computador perdeu muitos quadros no original: daí em diante, leve. */
export function lembrarQueSofreu() {
  localStorage.setItem(CHAVE_LEMBRAR, "1");
  decisoes.clear();
}

/** A biblioteca mudou (item editado, versão leve adicionada): decide de novo. */
export const esquecerDecisoes = () => decisoes.clear();

// ------------------------------------------------------------------ cliente
/** Estou na audiência deste item? (o mestre só se for assistir na janela) */
export function souAudiencia(item, audienciaDaExibicao = null) {
  if (game.user.isGM) return game.settings.get(MODULE_ID, "mestreAssiste");
  const alvo = audienciaDaExibicao ?? item.audiencia;
  return !alvo || alvo.includes(game.user.id);
}

/** Conta ao mestre o que este cliente já tem em disco. */
export async function relatarInventario() {
  const ids = [];
  for (const item of itens()) if (await temGuardado((await srcParaEste(item)).src)) ids.push(item.id);
  enviar(MSG.INVENTARIO, { userId: game.user.id, ids }, { local: game.user.isGM });
}

/** Baixa um item (na versão deste computador), reportando progresso ao mestre. */
export async function baixar(item) {
  const { src, versao } = await srcParaEste(item);
  const reportar = (phase, extra = {}) =>
    enviar(MSG.STATUS, { itemId: item.id, userId: game.user.id, phase, versao, ...extra }, { local: game.user.isGM });

  if (!suportaCodec(src)) return reportar(PHASE.NOCODEC, { erro: "este navegador não toca este formato" });

  let ultimoPct = -1, ultimosBytes = 0;
  try {
    reportar(PHASE.LOADING, { pct: 0 });
    await guardar(src, (pct, bytes) => {
      const passou = pct === null ? bytes - ultimosBytes >= 16e6 : pct - ultimoPct >= 0.1 || pct === 1;
      if (!passou) return;
      ultimoPct = pct ?? ultimoPct;
      ultimosBytes = bytes;
      reportar(PHASE.LOADING, { pct, mb: Math.round(bytes / 1e6) });
    });
    reportar(PHASE.READY, { pct: 1, somBloqueado: !!game.audio?.locked });
  } catch (err) {
    console.error(`${MODULE_ID} | download falhou (${src})`, err);
    reportar(PHASE.FAILED, { erro: err.message || String(err) });
  }
}

/**
 * Fila de segundo plano: baixa, um de cada vez, tudo que estiver marcado para
 * pré-carregar e ainda não estiver em disco. Um de cada vez para não roubar a
 * banda do resto da sessão (mapas, tokens, áudio).
 */
let rodando = false;
export async function filaDeFundo() {
  if (rodando) return;
  rodando = true;
  try {
    for (const item of itens()) {
      if (!item.preCarregar || !souAudiencia(item)) continue;
      if (await temGuardado((await srcParaEste(item)).src)) continue;
      log(`pré-carregando em segundo plano: ${item.nome}`);
      await baixar(item);
    }
  } finally {
    rodando = false;
  }
}

export async function esquecerLocal(src) {
  await esquecer(src);
}
