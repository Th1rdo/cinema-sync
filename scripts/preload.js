import { warn, log } from "./const.js";

/**
 * Cache de vídeos em disco (Cache Storage), com fallback em memória.
 *
 * O download vai em bocados de 8 MB com Range, cada um com novas tentativas.
 * A primeira versão pedia o ficheiro inteiro num só pedido: se a ligação caía
 * uma vez a meio de 194 MB, perdia-se tudo — foi o "50% e falhou" do primeiro
 * teste com um jogador real (os 50% eram um marcador, não progresso).
 */
const NOME = "cinema-sync-v1";
const SEGMENTO = 8 * 1024 * 1024;
const emDisco = () => globalThis.isSecureContext && "caches" in globalThis;
const memoria = new Map();     // src → objectURL (http, ou disco cheio/recusado)

let pedidoDePersistencia = false;
async function pedirPersistencia() {
  if (pedidoDePersistencia) return;
  pedidoDePersistencia = true;
  try { await navigator.storage?.persist?.(); } catch { /* opcional */ }
}

export function suportaCodec(src) {
  const ext = src.split("?")[0].split(".").pop()?.toLowerCase();
  const tipos = { webm: 'video/webm; codecs="vp9"', mp4: 'video/mp4; codecs="avc1.42E01E"', m4v: "video/mp4", ogv: "video/ogg" };
  const tipo = tipos[ext];
  if (!tipo) return true;
  return document.createElement("video").canPlayType(tipo) !== "";
}

const chave = (src) => new URL(src, globalThis.location?.href).href;

export async function temGuardado(src) {
  if (memoria.has(src)) return true;
  if (!emDisco()) return false;
  try { return !!(await (await caches.open(NOME)).match(chave(src))); } catch { return false; }
}

// ------------------------------------------------------------------ download
/**
 * Durante uma cena, os downloads param entre bocados: quem vê a cena pela rede
 * (começou antes de acabar de baixar) fica com a banda toda. Retomam no fim.
 */
let pausas = 0;
let portao = null;           // Promise que só se resolve quando as pausas acabam
let abrirPortao = null;
export function pausarDownloads() {
  if (pausas++ === 0) portao = new Promise(r => (abrirPortao = r));
}
export function retomarDownloads() {
  if (pausas === 0 || --pausas > 0) return;
  abrirPortao();
  portao = null;
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms));
const valeTentarDeNovo = (status) => !status || status >= 500 || status === 408 || status === 429;

/** Um pedido, com até `tentativas` repetições e espera crescente (1 s, 2 s, 4 s…). */
async function comRetentativas(fn, { tentativas = 4, pausa = esperar } = {}) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fn();
      if (resp.ok || !valeTentarDeNovo(resp.status)) return resp;
      ultimoErro = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      ultimoErro = err;                              // rede caiu: tenta de novo
    }
    if (i < tentativas - 1) await pausa(1000 * 2 ** i);
  }
  throw ultimoErro;
}

/**
 * Baixa em bocados com Range. Uma quebra de ligação custa um bocado, não o
 * ficheiro. Se o servidor ignorar Range (responde 200), cai para um pedido
 * único — também com novas tentativas.
 *
 * @param {object} o
 * @param {(pct: number|null, bytes: number) => void} [o.onProgress]
 * @returns {Promise<Blob>}
 */
export async function baixarSegmentado(src, { fetchFn = fetch, onProgress = () => {}, segmento = SEGMENTO, pausa = esperar } = {}) {
  // o tamanho total vem do HEAD (Content-Length é legível mesmo entre domínios)
  let total = 0;
  try {
    const head = await fetchFn(src, { method: "HEAD" });
    if (head.ok) total = Number(head.headers.get("content-length")) || 0;
  } catch { /* sem HEAD: descobrimos o fim pelo último bocado */ }

  const partes = [];
  let recebido = 0;
  let tipo = "video/mp4";

  while (!total || recebido < total) {
    if (portao) await portao;
    const fim = recebido + segmento - 1;
    let resp;
    try {
      resp = await comRetentativas(
        () => fetchFn(src, { headers: { Range: `bytes=${recebido}-${fim}` } }),
        { pausa }
      );
    } catch (err) {
      // Nem todo servidor aceita Range vindo de outro domínio. Se nem o primeiro
      // bocado veio, volta ao pedido único — que era o que funcionava antes.
      if (recebido > 0) throw err;
      return baixarInteiro(src, { fetchFn, onProgress, pausa });
    }
    tipo = resp.headers.get("content-type") || tipo;

    if (resp.status === 200) {
      // servidor não suporta Range: veio o ficheiro inteiro neste pedido
      const blob = await resp.blob();
      onProgress(1, blob.size);
      return new Blob([blob], { type: tipo });
    }
    if (resp.status !== 206) throw new Error(`HTTP ${resp.status}`);

    if (!total) {
      const m = /\/(\d+)\s*$/.exec(resp.headers.get("content-range") ?? "");
      if (m) total = Number(m[1]);
    }

    const bocado = await resp.blob();
    if (!bocado.size) break;
    partes.push(bocado);
    recebido += bocado.size;
    onProgress(total ? Math.min(0.99, recebido / total) : null, recebido);

    if (!total && bocado.size < segmento) break;       // último bocado, sem saber o total
  }

  onProgress(1, recebido);
  return new Blob(partes, { type: tipo });             // junta sem copiar os bocados
}

/** Um pedido só, sem Range, com novas tentativas. */
async function baixarInteiro(src, { fetchFn, onProgress, pausa }) {
  const resp = await comRetentativas(() => fetchFn(src), { pausa });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  onProgress(1, blob.size);
  return blob;
}

/**
 * Baixa e guarda. Disco primeiro; se o disco recusar (quota, modo privado),
 * guarda em memória — o vídeo toca na mesma.
 */
const emCurso = new Map();   // src → Promise: o mesmo ficheiro nunca baixa duas vezes em paralelo

export function guardar(src, onProgress = () => {}) {
  if (emCurso.has(src)) return emCurso.get(src);
  const p = guardarAgora(src, onProgress).finally(() => emCurso.delete(src));
  emCurso.set(src, p);
  return p;
}

async function guardarAgora(src, onProgress) {
  if (await temGuardado(src)) { onProgress(1, 0); return "cache"; }
  pedirPersistencia();

  const blob = await baixarSegmentado(src, { onProgress });

  if (emDisco()) {
    try {
      const cache = await caches.open(NOME);
      await cache.put(chave(src), new Response(blob, {
        status: 200,
        headers: { "content-type": blob.type || "video/mp4", "content-length": String(blob.size) }
      }));
      log(`guardado em disco: ${src} (${Math.round(blob.size / 1e6)} MB)`);
      return "disco";
    } catch (err) {
      warn(`o disco recusou (${err.name}: ${err.message}); guardando em memória`);
    }
  }
  memoria.set(src, URL.createObjectURL(blob));
  return "memoria";
}

export const baixando = (src) => emCurso.has(src);

/** URL para o <video>: disco ou memória se houver, senão a origem (streaming). */
export async function urlParaTocar(src) {
  if (memoria.has(src)) return memoria.get(src);
  if (!emDisco()) return src;
  try {
    const resp = await (await caches.open(NOME)).match(chave(src));
    if (!resp) return src;
    return URL.createObjectURL(await resp.blob());
  } catch (err) {
    warn("não consegui ler do cache, tocando da rede:", err.message);
    return src;
  }
}

export function soltar(url) {
  if (url?.startsWith("blob:") && ![...memoria.values()].includes(url)) URL.revokeObjectURL(url);
}

export async function esquecer(src) {
  const url = memoria.get(src);
  if (url) { URL.revokeObjectURL(url); memoria.delete(src); }
  if (!emDisco()) return true;
  try { return (await caches.open(NOME)).delete(chave(src)); } catch { return false; }
}

export async function limparCache() {
  for (const url of memoria.values()) URL.revokeObjectURL(url);
  memoria.clear();
  if (emDisco()) await caches.delete(NOME).catch(() => {});
}
