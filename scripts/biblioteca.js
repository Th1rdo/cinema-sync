import { MODULE_ID, MSG, PHASE, log, warn } from "./const.js";
import { enviar } from "./net.js";
import { guardar, temGuardado, esquecer, suportaCodec, urlParaTocar, soltar, baixando } from "./preload.js";
import { nomeDoArquivo, nomeDaVersao, escadaDoItem, escolherDegrau } from "./logica.js";

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

/**
 * Procura as versões geradas pelo ferramentas/versoes.sh ao lado do original
 * ("Cena-1080p.mp4", "Cena-720p.mp4", "Cena-480p.mp4"). Um HEAD por versão:
 * funciona no Forge e em qualquer host, sem depender da API do FilePicker.
 *
 * @returns {Promise<{src: string, altura: number}[]|null>}  null = a rede
 *   falhou e não dá para saber (não é o mesmo que "não há versões")
 */
export async function detetarVersoes(src, alturaOriginal = 99999) {
  const encontradas = [];
  let duvida = false;
  for (const altura of [1440, 1080, 720, 480]) {
    if (altura >= alturaOriginal) continue;
    const candidata = nomeDaVersao(src, altura);
    try {
      const r = await fetch(candidata, { method: "HEAD" });
      if (r.ok) encontradas.push({ src: candidata, altura });
      else if (r.status >= 500) duvida = true;
    } catch {
      duvida = true;                               // rede caiu, ou o host não deixa ver
    }
  }
  return duvida ? null : encontradas;
}

/**
 * Procura versões novas de todas as cutscenes (o mestre carregou-as no Forge
 * depois de adicionar a cutscene). Uma vez por sessão por item; só grava se mudou.
 */
const jaProcurados = new Set();
export async function atualizarVersoes() {
  if (!game.user.isGM) return false;
  const novas = new Map();   // itemId → versões, só as que mudaram
  for (const item of itens()) {
    if (jaProcurados.has(item.id)) continue;
    jaProcurados.add(item.id);
    const versoes = await detetarVersoes(item.src, item.altura ?? 99999);
    if (!versoes) { jaProcurados.delete(item.id); continue; }   // rede falhou: mantém as que tinha e tenta na próxima
    if (JSON.stringify(versoes) !== JSON.stringify(item.versoes ?? [])) novas.set(item.id, versoes);
  }
  if (!novas.size) return false;
  // relê a biblioteca: durante a procura o mestre pode ter adicionado ou editado cutscenes
  await gravar(itens().map(i => (novas.has(i.id) ? { ...i, versoes: novas.get(i.id) } : i)));
  return true;
}

export async function adicionar(src) {
  const meta = await lerMetadados(src);
  const versoes = (await detetarVersoes(src, meta.altura ?? 99999)) ?? [];
  const item = {
    id: foundry.utils.randomID(),
    nome: nomeDoArquivo(src),
    src,
    ...meta,
    versoes,                  // escada detetada pelo nome; o original é o degrau de cima
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
  if (item) for (const { src } of escadaDoItem(item)) enviar(MSG.ESQUECER, { src }, { local: true });
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
      // sem isto, um ficheiro pendurado bloqueava a fila de miniaturas para a sessão toda
      const limite = setTimeout(() => {
        v.removeAttribute("src"); v.load();
        reject(new Error("demorou demais"));
      }, 15000);
      v.muted = true;
      v.preload = "metadata";         // o navegador busca só o cabeçalho e o trecho do seek
      v.crossOrigin = "anonymous";
      v.onloadedmetadata = () => { v.currentTime = Math.min(3, (v.duration || 10) * 0.15); };
      v.onseeked = () => {
        clearTimeout(limite);
        try {
          const c = document.createElement("canvas");
          c.width = 320; c.height = 180;
          c.getContext("2d").drawImage(v, 0, 0, 320, 180);
          resolve(c.toDataURL("image/jpeg", 0.72));
        } catch (err) { reject(err); }
        finally { v.removeAttribute("src"); v.load(); }
      };
      v.onerror = () => { clearTimeout(limite); reject(new Error("não carregou")); };
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
const CHAVE_TETO = `${MODULE_ID}.teto`;
const decisoes = new Map();    // itemId → { src, altura, degrau, escada }: pré-carga e exibição concordam

const tetoLocal = () => Number(localStorage.getItem(CHAVE_TETO)) || undefined;

/** Taxa típica por altura, para perguntar ao navegador se decodifica com folga. */
const taxa = (h) => h >= 2160 ? 20e6 : h >= 1440 ? 12e6 : h >= 1080 ? 8e6 : h >= 720 ? 4e6 : 2e6;

/** Por altura da escada: o navegador deste computador toca com fluidez, e por hardware? */
async function capacidades(item, escada) {
  const mc = navigator.mediaCapabilities;
  if (!mc?.decodingInfo || escada.length < 2) return {};
  const webm = /\.webm($|\?)/i.test(item.src);
  const proporcao = item.largura && item.altura ? item.largura / item.altura : 16 / 9;
  const resultado = {};
  for (const { altura } of escada) {
    if (altura > 10000) continue;
    try {
      const r = await mc.decodingInfo({
        type: "file",
        video: {
          contentType: webm ? 'video/webm; codecs="vp09.00.51.08"' : 'video/mp4; codecs="avc1.640033"',
          width: Math.round(altura * proporcao), height: altura, bitrate: taxa(altura), framerate: 30
        }
      });
      resultado[altura] = { suave: r.smooth, eficiente: r.powerEfficient };
    } catch { /* sem resposta: não rebaixa */ }
  }
  return resultado;
}

/** Qual degrau da escada este computador usa para este item. */
export async function srcParaEste(item) {
  if (decisoes.has(item.id)) return decisoes.get(item.id);
  const escada = escadaDoItem(item);
  const degrau = escolherDegrau({
    escada,
    teto: tetoLocal(),
    alturaTela: Math.round((globalThis.screen?.height ?? 0) * (globalThis.devicePixelRatio ?? 1)),
    capacidades: await capacidades(item, escada)
  });
  const decisao = { ...escada[degrau], degrau, escada };
  decisoes.set(item.id, decisao);
  return decisao;
}

/** Este computador sofreu nesta altura: daí em diante, no máximo `altura`. */
export function lembrarTeto(altura) {
  const atual = tetoLocal();
  if (!atual || altura < atual) localStorage.setItem(CHAVE_TETO, String(altura));
  decisoes.clear();
}

/** A biblioteca mudou (versões novas, preferência): cada computador decide de novo. */
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
  const { src, altura, original } = await srcParaEste(item);
  const reportar = (phase, extra = {}) =>
    enviar(MSG.STATUS, { itemId: item.id, userId: game.user.id, phase, versao: `${altura}p`, original: !!original, ...extra },
           { local: game.user.isGM });

  if (!suportaCodec(src)) return reportar(PHASE.NOCODEC, { erro: "este navegador não toca este formato" });

  // já a baixar (pré-carga de fundo): espera o mesmo download em vez de abrir
  // outro, e não reinicia a barra do mestre a 0% — o primeiro já relata o progresso
  const jaEmCurso = baixando(src);
  let ultimoPct = -1, ultimosBytes = 0;
  try {
    if (!jaEmCurso) reportar(PHASE.LOADING, { pct: 0 });
    await guardar(src, (pct, bytes) => {
      const passou = pct === null ? bytes - ultimosBytes >= 16e6 : pct - ultimoPct >= 0.1 || pct === 1;
      if (!passou) return;
      ultimoPct = pct ?? ultimoPct;
      ultimosBytes = bytes;
      reportar(PHASE.LOADING, { pct, mb: Math.round(bytes / 1e6) });
    });
    reportar(PHASE.READY, { pct: 1, somBloqueado: !!game.audio?.locked });
    preparaDegrauDeBaixo(item);
  } catch (err) {
    console.error(`${MODULE_ID} | download falhou (${src})`, err);
    reportar(PHASE.FAILED, { erro: err.message || String(err) });
  }
}

/**
 * O degrau imediatamente abaixo, guardado em silêncio: se este computador
 * engasgar a meio da cena, a troca é instantânea em vez de depender da rede.
 * Só um degrau — o custo fica pequeno (uns 40 MB para quem toca 4K).
 */
async function preparaDegrauDeBaixo(item) {
  const { degrau, escada } = await srcParaEste(item);
  const baixo = escada[degrau + 1];
  if (!baixo || await temGuardado(baixo.src)) return;
  try {
    await guardar(baixo.src);
    log(`degrau de reserva pronto: ${item.nome} ${baixo.altura}p`);
  } catch (err) {
    warn(`degrau de reserva falhou (${baixo.altura}p): ${err.message}`);   // não é grave: a troca vai pela rede
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
