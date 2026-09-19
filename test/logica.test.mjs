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

import { pareceTelaCheia } from "../scripts/logica.js";

const tela = { screenWidth: 1512, screenHeight: 982 };

test("tela cheia pedida pela página é detectada com certeza", () => {
  assert.equal(pareceTelaCheia({ ...tela, fullscreenElement: {}, innerWidth: 800, innerHeight: 600 }), true);
});

test("F11 / ⌃⌘F: janela do tamanho da tela conta como tela cheia", () => {
  assert.equal(pareceTelaCheia({ ...tela, innerWidth: 1512, innerHeight: 982 }), true);
  assert.equal(pareceTelaCheia({ ...tela, innerWidth: 1511, innerHeight: 981 }), true);   // arredondamento
});

test("janela maximizada com barra de abas e menu não é tela cheia", () => {
  assert.equal(pareceTelaCheia({ ...tela, innerWidth: 1512, innerHeight: 862 }), false);
});

test("sem informação de tela, não arrisca", () => {
  assert.equal(pareceTelaCheia({ innerWidth: 1512, innerHeight: 982 }), false);
});

import { quemAguardar, nomeDaVersao, escadaDoItem, escolherDegrau, deveDescer } from "../scripts/logica.js";

test("não espera por quem já falhou o download ou não tem codec", () => {
  const inv = new Map([["ana", new Set(["x"])]]);
  const relatos = new Map([
    ["bia", { itemId: "x", phase: "failed" }],
    ["caio", { itemId: "x", phase: "loading" }],
    ["davi", { itemId: "outro", phase: "failed" }]
  ]);
  assert.deepEqual(quemAguardar(["ana", "bia", "caio", "davi"], inv, relatos, "x"), ["caio", "davi"]);
});

test("nome da versão junta o sufixo antes da extensão", () => {
  assert.equal(nomeDaVersao("cenas/O Uliginoso (Cinematic).mp4", 720), "cenas/O Uliginoso (Cinematic)-720p.mp4");
  assert.equal(nomeDaVersao("https://cdn.x/a%20b.mp4?v=2", 1080), "https://cdn.x/a%20b-1080p.mp4?v=2");
});

test("escada ordenada da mais pesada para a mais leve, com o srcLeve antigo incluído", () => {
  const e = escadaDoItem({ src: "o.mp4", altura: 2160, versoes: [{ src: "o-480p.mp4", altura: 480 }, { src: "o-1080p.mp4", altura: 1080 }], srcLeve: "leve.mp4", alturaLeve: 720 });
  assert.deepEqual(e.map(d => d.altura), [2160, 1080, 720, 480]);
  assert.equal(e[0].original, true);
});

const escada = [2160, 1080, 720, 480].map(altura => ({ src: `${altura}.mp4`, altura }));
const alturaDe = (i) => escada[i].altura;

test("sem outras versões, sempre o original", () => {
  assert.equal(escolherDegrau({ escada: escada.slice(0, 1), capacidades: { 2160: { suave: false } } }), 0);
});

const forte = { 2160: { suave: true, eficiente: true }, 1080: { suave: true, eficiente: true } };

test("máquina forte, confirmada pelo navegador, e ecrã Retina: 4K", () => {
  assert.equal(alturaDe(escolherDegrau({ escada, alturaTela: 1964, capacidades: forte })), 2160);
});

test("sem confirmação do navegador, nunca começa acima de 1080p (o caso dos 71%)", () => {
  assert.equal(alturaDe(escolherDegrau({ escada, alturaTela: 1964 })), 1080);
  assert.equal(alturaDe(escolherDegrau({ escada, alturaTela: 1964, capacidades: { 2160: { suave: true } } })), 1080);
});

test("ecrã de 1080p: não passa de 1080p, o 4K seria peso invisível", () => {
  assert.equal(alturaDe(escolherDegrau({ escada, alturaTela: 1080 })), 1080);
  assert.equal(alturaDe(escolherDegrau({ escada, alturaTela: 768 })), 720);    // 720 ≥ 90% de 768
});

test("desce só o necessário para a máquina tocar com fluidez", () => {
  const capacidades = { 2160: { suave: false }, 1080: { eficiente: false }, 720: { suave: true, eficiente: true } };
  assert.equal(alturaDe(escolherDegrau({ escada, alturaTela: 1964, capacidades })), 720);
});

test("respeita o teto que este computador já mostrou aguentar", () => {
  assert.equal(alturaDe(escolherDegrau({ escada, alturaTela: 1964, capacidades: forte, teto: 720 })), 720);
});

test("nada toca bem: fica com a mais leve", () => {
  const capacidades = Object.fromEntries(escada.map(d => [d.altura, { suave: false }]));
  assert.equal(alturaDe(escolherDegrau({ escada, capacidades })), 480);
});

// amostras acumuladas por segundo, como o getVideoPlaybackQuality devolve
const acumular = (porSegundo) => porSegundo.reduce((acc, [q, p]) => {
  const ant = acc.at(-1) ?? { total: 0, perdidos: 0 };
  return [...acc, { total: ant.total + q, perdidos: ant.perdidos + p }];
}, [{ total: 0, perdidos: 0 }]);

test("desce quando perde mais de 20% dos quadros por 3 s seguidos (o caso dos 71%)", () => {
  assert.equal(deveDescer(acumular([[30, 21], [30, 22], [30, 20]])), true);
});

test("um pico isolado não faz descer", () => {
  assert.equal(deveDescer(acumular([[30, 25], [30, 1], [30, 25]])), false);
});

test("vídeo parado ou aba oculta (quase nenhum quadro) não decide nada", () => {
  assert.equal(deveDescer(acumular([[2, 2], [1, 1], [3, 3]])), false);
});

test("sem amostras suficientes ainda não decide", () => {
  assert.equal(deveDescer(acumular([[30, 25], [30, 25]])), false);
});
