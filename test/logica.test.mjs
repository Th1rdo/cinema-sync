import test from "node:test";
import assert from "node:assert/strict";
import { resolverAudiencia, quemFalta, coberturaDoCache, pesoDoVideo, comandoDaMacro, nomeDoArquivo, mmss } from "../scripts/logica.js";

const usuarios = [
  { id: "gm",  isGM: true,  active: true },
  { id: "ana", isGM: false, active: true },
  { id: "bia", isGM: false, active: true },
  { id: "caio", isGM: false, active: false },   // offline
  { id: "davi", isGM: false, active: true }
];

test("audiência padrão: todos os jogadores conectados, nunca o mestre nem quem está offline", () => {
  assert.deepEqual(resolverAudiencia({ audiencia: null }, null, usuarios), ["ana", "bia", "davi"]);
});

test("audiência do item filtra; escolha na hora sobrepõe a do item", () => {
  const item = { audiencia: ["ana", "caio"] };
  assert.deepEqual(resolverAudiencia(item, null, usuarios), ["ana"]);           // caio está offline
  assert.deepEqual(resolverAudiencia(item, ["bia"], usuarios), ["bia"]);
});

test("quem falta: só quem não tem o item no inventário", () => {
  const inv = new Map([["ana", new Set(["x"])], ["bia", new Set()]]);
  assert.deepEqual(quemFalta(["ana", "bia", "davi"], inv, "x"), ["bia", "davi"]);
  assert.deepEqual(quemFalta([], inv, "x"), []);
});

test("cobertura do cache conta só a audiência conectada", () => {
  const inv = new Map([["ana", new Set(["x"])], ["bia", new Set(["x"])], ["caio", new Set(["x"])]]);
  assert.deepEqual(coberturaDoCache({ id: "x", audiencia: null }, usuarios, inv), { tem: 2, total: 3, completo: false });
  assert.deepEqual(coberturaDoCache({ id: "x", audiencia: ["ana", "bia"] }, usuarios, inv), { tem: 2, total: 2, completo: true });
});

test("peso do vídeo: 4K avisa, 1080p não", () => {
  assert.deepEqual(pesoDoVideo({ largura: 3840, altura: 2160 }), { rotulo: "4K", pesado: true });
  assert.equal(pesoDoVideo({ largura: 1920, altura: 1080 }).pesado, false);
  assert.equal(pesoDoVideo({}).rotulo, null);
});

test("comando da macro é JS válido mesmo com aspas no id", () => {
  assert.equal(comandoDaMacro("abc"), 'game.cinema.exibir("abc");');
  assert.doesNotThrow(() => new Function(comandoDaMacro('a"b\\c')));
});

test("nome legível a partir do arquivo", () => {
  assert.equal(nomeDoArquivo("assets/cenas/O_Juizo-Final%20ato%202.mp4"), "O Juizo Final ato 2");
  assert.equal(nomeDoArquivo("https://cdn.x/y/intro.webm?v=3"), "intro");
});

test("mm:ss", () => {
  assert.equal(mmss(80), "1:20");
  assert.equal(mmss(5), "0:05");
});
