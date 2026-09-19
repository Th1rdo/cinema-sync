import test from "node:test";
import assert from "node:assert/strict";
import { correcao, scheduleAt } from "../scripts/clock.js";

test("zona morta: desvio pequeno não mexe no vídeo", () => {
  for (const d of [0, 0.01, -0.04, 0.05]) {
    assert.equal(correcao(d).acao, "hold");
    assert.equal(correcao(d).rate, 1);
  }
});

test("desvio médio acelera ou desacelera, sempre dentro do limite", () => {
  const atrasado = correcao(0.2);     // esperado > real: precisa correr
  assert.equal(atrasado.acao, "nudge");
  assert.ok(atrasado.rate > 1 && atrasado.rate <= 1.04, `rate=${atrasado.rate}`);

  const adiantado = correcao(-0.2);
  assert.equal(adiantado.acao, "nudge");
  assert.ok(adiantado.rate < 1 && adiantado.rate >= 0.96, `rate=${adiantado.rate}`);
});

test("desvio grande pula direto em vez de arrastar", () => {
  assert.equal(correcao(0.35).acao, "seek");
  assert.equal(correcao(-2).acao, "seek");
  assert.equal(correcao(0.35).rate, 1);
});

test("atraso grande é resolvido de uma vez, com um seek", () => {
  let relogio = 0, video = -0.5;          // meio segundo atrasado
  const { acao } = correcao(relogio - video);
  assert.equal(acao, "seek");

  video = relogio;                        // é o que o cliente faz
  relogio += 2; video += 2;
  assert.ok(Math.abs(relogio - video) <= 0.05, "depois do seek fica na zona morta");
});

test("atraso médio converge suave, sem seek e sem oscilar", () => {
  const PASSO = 2;
  let relogio = 0, video = -0.25;         // dentro da faixa de correção suave
  const historico = [];
  let houveSeek = false;

  for (let i = 0; i < 12; i++) {
    const { acao, rate } = correcao(relogio - video);
    if (acao === "seek") houveSeek = true;
    relogio += PASSO;
    video += PASSO * rate;
    historico.push(Math.abs(relogio - video));
  }

  assert.equal(houveSeek, false, "250ms não deveria justificar um pulo");
  assert.ok(historico[0] > historico[4], "o desvio precisa estar caindo");
  assert.ok(historico.at(-1) <= 0.05, `terminou com ${(historico.at(-1) * 1000).toFixed(0)}ms`);
  assert.ok(Math.max(...historico.slice(6)) <= 0.05, "não pode passar do ponto e voltar");
});

test("correção aguenta deriva contínua (cliente 1% mais lento)", () => {
  const PASSO = 2;
  let relogio = 0, video = 0, pior = 0;

  for (let i = 0; i < 60; i++) {           // 2 minutos de cutscene
    const { acao, rate } = correcao(relogio - video);
    if (acao === "seek") video = relogio;
    relogio += PASSO;
    video += PASSO * (acao === "seek" ? 1 : rate) * 0.99;   // decodificador 1% lento
    pior = Math.max(pior, Math.abs(relogio - video));
  }

  assert.ok(pior < 0.25, `pior desvio ${(pior * 1000).toFixed(0)}ms deveria ficar abaixo de 250ms`);
});

test("scheduleAt dispara quando o relógio do servidor chega no alvo", async () => {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 8);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  const inicio = Date.now();
  const alvo = inicio + 300;
  const quando = await new Promise((resolve) => {
    scheduleAt(alvo, () => resolve(Date.now()), () => Date.now());
  });

  const erro = Math.abs(quando - alvo);
  assert.ok(erro < 60, `disparou com ${erro}ms de erro`);
});

test("scheduleAt pode ser cancelado", async () => {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 8);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  let disparou = false;
  const cancelar = scheduleAt(Date.now() + 120, () => { disparou = true; }, () => Date.now());
  cancelar();
  await new Promise(r => setTimeout(r, 250));
  assert.equal(disparou, false);
});
