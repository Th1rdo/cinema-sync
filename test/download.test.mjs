import test from "node:test";
import assert from "node:assert/strict";
import { baixarSegmentado } from "../scripts/preload.js";

/** Um "servidor" em memória que responde a HEAD e a Range, com falhas programadas. */
function servidor(bytes, { falhas = new Set(), semRange = false, semTamanho = false, escondeContentRange = false } = {}) {
  let pedido = 0;
  const pedidos = [];
  const fetchFn = async (_src, opts = {}) => {
    if (opts.method === "HEAD") {
      return new Response(null, { status: 200, headers: semTamanho ? {} : { "content-length": String(bytes.length) } });
    }
    const n = pedido++;
    pedidos.push(opts.headers?.Range);
    if (falhas.has(n)) throw new TypeError("Failed to fetch");          // a ligação caiu
    if (semRange) return new Response(bytes, { status: 200, headers: { "content-type": "video/mp4" } });
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
    const ini = Number(a), fim = Math.min(Number(b), bytes.length - 1);
    const headers = { "content-type": "video/mp4" };
    if (!escondeContentRange) headers["content-range"] = `bytes ${ini}-${fim}/${bytes.length}`;
    return new Response(bytes.slice(ini, fim + 1), { status: 206, headers });
  };
  return { fetchFn, pedidos };
}

const video = new Uint8Array(100_000).map((_, i) => i % 251);
const semEspera = async () => {};
const igual = async (blob) => assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), video);

test("baixa em bocados e remonta o ficheiro exato", async () => {
  const { fetchFn, pedidos } = servidor(video);
  await igual(await baixarSegmentado("v.mp4", { fetchFn, segmento: 16_000, pausa: semEspera }));
  assert.equal(pedidos.length, 7);                       // 100000 / 16000 → 7 bocados
});

test("a ligação cai a meio: só o bocado perdido é pedido de novo", async () => {
  const { fetchFn, pedidos } = servidor(video, { falhas: new Set([3, 4]) });   // cai duas vezes seguidas no 4º bocado
  await igual(await baixarSegmentado("v.mp4", { fetchFn, segmento: 16_000, pausa: semEspera }));
  assert.equal(pedidos.length, 9);                       // 7 bocados + 2 repetições
  assert.equal(pedidos[3], pedidos[5], "a repetição pede o mesmo intervalo, não recomeça do zero");
});

test("progresso real, nunca o 50% fixo", async () => {
  const { fetchFn } = servidor(video);
  const vistos = [];
  await baixarSegmentado("v.mp4", { fetchFn, segmento: 25_000, pausa: semEspera, onProgress: (p) => vistos.push(p) });
  assert.deepEqual(vistos, [0.25, 0.5, 0.75, 0.99, 1]);
});

test("sem tamanho conhecido: progresso em bytes e para no último bocado", async () => {
  const { fetchFn } = servidor(video, { semTamanho: true, escondeContentRange: true });
  const vistos = [];
  await igual(await baixarSegmentado("v.mp4", { fetchFn, segmento: 30_000, pausa: semEspera, onProgress: (p, b) => vistos.push([p, b]) }));
  assert.equal(vistos[0][0], null, "percentagem desconhecida não é inventada");
  assert.equal(vistos[0][1], 30_000);
});

test("servidor sem Range: um pedido só, ficheiro inteiro", async () => {
  const { fetchFn, pedidos } = servidor(video, { semRange: true });
  await igual(await baixarSegmentado("v.mp4", { fetchFn, segmento: 16_000, pausa: semEspera }));
  assert.equal(pedidos.length, 1);
});

test("rede morta de vez: tenta bocados, tenta o pedido único, e desiste com erro", async () => {
  let pedidos = 0;
  const fetchFn = async (_src, opts = {}) => {
    if (opts.method === "HEAD") throw new TypeError("Failed to fetch");
    pedidos++;
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(baixarSegmentado("v.mp4", { fetchFn, segmento: 16_000, pausa: semEspera }), /Failed to fetch/);
  assert.equal(pedidos, 8, "4 tentativas com Range + 4 com pedido único, e para");
});

test("servidor que recusa Range entre domínios: volta ao pedido único", async () => {
  const pedidos = [];
  const fetchFn = async (_src, opts = {}) => {
    if (opts.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": String(video.length) } });
    pedidos.push(opts.headers?.Range ?? "inteiro");
    if (opts.headers?.Range) throw new TypeError("Failed to fetch");      // preflight recusado
    return new Response(video, { status: 200, headers: { "content-type": "video/mp4" } });
  };
  await igual(await baixarSegmentado("v.mp4", { fetchFn, segmento: 16_000, pausa: semEspera }));
  assert.equal(pedidos.at(-1), "inteiro");
});

test("cai a meio DEPOIS de já ter bocados: não recomeça do zero com pedido único", async () => {
  let n = 0;
  const fetchFn = async (_src, opts = {}) => {
    if (opts.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": String(video.length) } });
    if (n++ >= 2) throw new TypeError("Failed to fetch");                 // rede morre de vez no 3.º bocado
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
    return new Response(video.slice(Number(a), Number(b) + 1), { status: 206, headers: { "content-range": `bytes ${a}-${b}/${video.length}` } });
  };
  await assert.rejects(baixarSegmentado("v.mp4", { fetchFn, segmento: 16_000, pausa: semEspera }), /Failed to fetch/);
});
