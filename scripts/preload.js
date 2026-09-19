import { warn, log } from "./const.js";

/**
 * Cache de vídeos.
 *
 * Primeira versão guardava o arquivo inteiro na RAM (Blob): um 4K de 194 MB
 * custava 194 MB por jogador, e com várias cutscenes pré-carregadas isso vira
 * gigabytes. Agora usamos a Cache Storage do navegador: fica em DISCO e
 * sobrevive entre sessões — o jogador baixa uma vez e na semana seguinte já tem.
 *
 * Cache Storage exige contexto seguro (https). O Forge é https. Num Foundry
 * local em http, caímos para o modo antigo em memória.
 */
const NOME = "cinema-sync-v1";
const emDisco = () => globalThis.isSecureContext && "caches" in globalThis;
const memoria = new Map();     // fallback http: src → objectURL

let pedidoDePersistencia = false;

/** Pede ao navegador para não despejar o cache sob pressão (melhor esforço). */
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

/** Chave estável: o mesmo arquivo com querystring diferente não duplica. */
const chave = (src) => new URL(src, globalThis.location?.href).href;

/** Este cliente já tem o vídeo guardado? */
export async function temGuardado(src) {
  if (!emDisco()) return memoria.has(src);
  try {
    const cache = await caches.open(NOME);
    return !!(await cache.match(chave(src)));
  } catch { return false; }
}

/**
 * Baixa e guarda. Reporta progresso de 0 a 1.
 *
 * O corpo da resposta é bifurcado (tee): um ramo vai direto para o disco, o
 * outro só é contado para a barra de progresso e descartado. A RAM fica plana,
 * não importa o tamanho do vídeo.
 */
export async function guardar(src, onProgress = () => {}) {
  if (await temGuardado(src)) { onProgress(1); return; }
  if (!emDisco()) return guardarEmMemoria(src, onProgress);

  pedirPersistencia();
  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  if (!resp.body) throw new Error("resposta sem corpo");

  const total = Number(resp.headers.get("content-length")) || 0;
  const [contar, gravar] = resp.body.tee();
  const cache = await caches.open(NOME);
  const salvando = cache.put(chave(src), new Response(gravar, {
    status: 200,
    headers: { "content-type": resp.headers.get("content-type") || "video/mp4",
               ...(total ? { "content-length": String(total) } : {}) }
  }));

  const leitor = contar.getReader();
  let recebido = 0;
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    recebido += value.length;
    onProgress(total ? Math.min(0.99, recebido / total) : 0.5);
  }
  await salvando;
  onProgress(1);
  log(`guardado em disco: ${src} (${Math.round(recebido / 1e6)} MB)`);
}

/**
 * URL para dar ao <video>. Se o vídeo está no disco, vira um blob local
 * (sem tocar a rede); se não está, toca direto da origem.
 * Quem recebe um blob: URL deve chamar `soltar()` depois.
 */
export async function urlParaTocar(src) {
  if (!emDisco()) return memoria.get(src) ?? src;
  try {
    const cache = await caches.open(NOME);
    const resp = await cache.match(chave(src));
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

/** Tira um vídeo do cache (cutscene removida da biblioteca). */
export async function esquecer(src) {
  if (!emDisco()) {
    const url = memoria.get(src);
    if (url) URL.revokeObjectURL(url);
    return memoria.delete(src);
  }
  try { return (await caches.open(NOME)).delete(chave(src)); } catch { return false; }
}

/** Apaga todo o cache deste módulo neste cliente. */
export async function limparCache() {
  for (const url of memoria.values()) URL.revokeObjectURL(url);
  memoria.clear();
  if (emDisco()) await caches.delete(NOME).catch(() => {});
}

// ------------------------------------------------------------ fallback http
async function guardarEmMemoria(src, onProgress) {
  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const total = Number(resp.headers.get("content-length")) || 0;
  const leitor = resp.body.getReader();
  const pedacos = [];
  let recebido = 0;
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    pedacos.push(value);
    recebido += value.length;
    onProgress(total ? Math.min(0.99, recebido / total) : 0.5);
  }
  memoria.set(src, URL.createObjectURL(new Blob(pedacos, { type: resp.headers.get("content-type") || "video/mp4" })));
  onProgress(1);
}
