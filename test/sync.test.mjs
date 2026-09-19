import test from "node:test";
import assert from "node:assert/strict";
import { decidir, tempoEsperado, scheduleAt } from "../scripts/clock.js";
import { SYNC } from "../scripts/const.js";

// ---------------------------------------------------------------- decisão
test("desvio dentro do limiar: não mexe no vídeo", () => {
  for (const d of [0, 0.1, -0.3, 0.5]) assert.equal(decidir(d), "hold");
});

test("desvio real: pula, nunca ajusta velocidade", () => {
  for (const d of [0.51, -0.8, 3]) assert.equal(decidir(d), "seek");
});

test("na largada o limiar é mais fino (absorve o atraso do decodificador)", () => {
  assert.equal(decidir(0.08, SYNC.LIMIAR_INICIO), "hold");   // play levou 80ms: normal
  assert.equal(decidir(0.4, SYNC.LIMIAR_INICIO), "seek");    // 400ms: corrige já
});

// ---------------------------------------------------------------- relógio
test("tempo esperado soma o atraso da âncora ao tempo local decorrido", () => {
  const t = tempoEsperado({ startAt: 10_000, ancoraServer: 10_050, ancoraLocal: 500, agoraLocal: 2_500 });
  assert.equal(t, 0.05 + 2);
});

test("re-sync do servidor não gera correção falsa (a causa do estalo no áudio)", () => {
  // o serverTime é lido UMA vez, na âncora; depois só o relógio local conta.
  // Simula 5 minutos com o relógio do servidor pulando ±80ms a cada re-sync:
  const startAt = 0;
  const ancora = { server: 30, local: 0 };
  let seeks = 0;
  for (let s = 1; s <= 300; s++) {
    const _servidorComRuido = s * 1000 + (s % 17 === 0 ? 80 : 0);   // ignorado de propósito
    const esperado = tempoEsperado({ startAt, ancoraServer: ancora.server, ancoraLocal: ancora.local, agoraLocal: s * 1000 });
    const real = 0.03 + s;                                          // vídeo tocando certinho
    if (decidir(esperado - real) === "seek") seeks++;
  }
  assert.equal(seeks, 0, `${seeks} correções falsas em 5 minutos`);
});

// ---------------------------------------------------------------- cenários reais
/**
 * Simula uma cutscene segundo a segundo, como o Reprodutor faz: a conferência
 * de rotina fica suspensa durante a travada (buffer vazio ou aba oculta) e há
 * uma conferência extra no instante em que o vídeo volta.
 */
function simular({ segundos, taxa = 1, eventos = {} }) {
  let esperado = 0, real = 0, seeks = 0, pior = 0, travado = false;
  for (let s = 1; s <= segundos; s++) {
    esperado += 1;
    const trava = eventos[s] === "trava";
    real += trava ? 0 : taxa;
    pior = Math.max(pior, Math.abs(esperado - real));

    if (trava) { travado = true; continue; }          // rotina suspensa
    const motivo = travado;                           // acabou de voltar?
    travado = false;
    if (decidir(esperado - real) === "seek" || (motivo && decidir(esperado - real) === "seek")) {
      real = esperado; seeks++;
    }
  }
  return { seeks, pior, final: Math.abs(esperado - real) };
}

test("reprodução normal: nenhuma intervenção em 10 minutos", () => {
  // relógio da placa de som 50 ppm fora: deriva real de hardware
  const r = simular({ segundos: 600, taxa: 1 - 50e-6 });
  assert.equal(r.seeks, 0);
  assert.ok(r.pior < 0.05, `deriva de ${(r.pior * 1000).toFixed(0)}ms`);
});

test("buffer secou por 2 s: um único pulo e volta sincronizado", () => {
  const r = simular({ segundos: 60, eventos: { 20: "trava", 21: "trava" } });
  assert.equal(r.seeks, 1);
  assert.ok(r.final <= SYNC.LIMIAR);
});

test("alt-tab de 5 s com o vídeo estrangulado: um pulo na volta", () => {
  const eventos = Object.fromEntries([30, 31, 32, 33, 34].map(s => [s, "trava"]));
  const r = simular({ segundos: 90, eventos });
  assert.equal(r.seeks, 1);
  assert.equal(r.final, 0);
});

// ---------------------------------------------------------------- agendamento
test("scheduleAt dispara quando o relógio chega no alvo", async () => {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 8);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  const alvo = Date.now() + 300;
  const quando = await new Promise(r => scheduleAt(alvo, () => r(Date.now()), () => Date.now()));
  assert.ok(Math.abs(quando - alvo) < 60, `erro de ${Math.abs(quando - alvo)}ms`);
});

test("scheduleAt pode ser cancelado", async () => {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 8);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  let disparou = false;
  scheduleAt(Date.now() + 120, () => { disparou = true; }, () => Date.now())();
  await new Promise(r => setTimeout(r, 250));
  assert.equal(disparou, false);
});
