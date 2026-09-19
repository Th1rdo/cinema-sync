import { MODULE_ID, warn } from "./const.js";

/** Cache de vídeos já baixados neste cliente: src → objectURL. */
const cache = new Map();

/** O navegador consegue tocar este arquivo? Evita descobrir isso na hora da cena. */
export function suportaCodec(src) {
  const ext = src.split("?")[0].split(".").pop()?.toLowerCase();
  const tipos = { webm: 'video/webm; codecs="vp9"', mp4: 'video/mp4; codecs="avc1.42E01E"', ogv: "video/ogg", m4v: "video/mp4" };
  const tipo = tipos[ext];
  if (!tipo) return true;                       // desconhecido: deixa tentar
  const probe = document.createElement("video");
  return probe.canPlayType(tipo) !== "";
}

export function jaEmCache(src) { return cache.has(src); }
export function urlLocal(src) { return cache.get(src) ?? src; }

export function limparCache() {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}

/**
 * Baixa o vídeo inteiro para memória e devolve um blob: URL.
 *
 * Preferimos fetch com streaming porque dá porcentagem exata e garante que o
 * arquivo está inteiro aqui antes de qualquer reprodução — sem stall no meio da
 * cena. Se o CORS do host bloquear (pode acontecer com CDN de terceiros),
 * caímos para o preload do próprio <video>, que funciona mas só estima o
 * progresso pelos ranges já bufferizados.
 */
export async function preloadVideo(src, onProgress = () => {}) {
  if (cache.has(src)) { onProgress(1); return cache.get(src); }

  try {
    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const total = Number(resp.headers.get("content-length")) || 0;
    const reader = resp.body.getReader();
    const pedacos = [];
    let recebido = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pedacos.push(value);
      recebido += value.length;
      onProgress(total ? Math.min(0.99, recebido / total) : 0.5);
    }

    const blob = new Blob(pedacos, { type: resp.headers.get("content-type") || "video/mp4" });
    const url = URL.createObjectURL(blob);
    cache.set(src, url);
    onProgress(1);
    return url;
  } catch (err) {
    warn(`fetch falhou para ${src} (${err.message}); usando preload do <video>`);
    return preloadViaElemento(src, onProgress);
  }
}

/** Fallback: deixa o próprio elemento baixar e acompanha pelo buffer. */
function preloadViaElemento(src, onProgress) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.src = src;

    const progresso = () => {
      if (!v.duration || !v.buffered.length) return;
      onProgress(Math.min(0.99, v.buffered.end(v.buffered.length - 1) / v.duration));
    };

    v.addEventListener("progress", progresso);
    v.addEventListener("canplaythrough", () => {
      onProgress(1);
      cache.set(src, src);            // sem blob: o navegador já tem em cache
      resolve(src);
    }, { once: true });
    v.addEventListener("error", () => reject(new Error(`não consegui carregar ${src}`)), { once: true });

    v.load();
  });
}
