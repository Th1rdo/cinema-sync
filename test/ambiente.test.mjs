import test from "node:test";
import assert from "node:assert/strict";

// o mínimo do Foundry que ambiente.js toca
const vista = { style: { visibility: "" } };
const ticker = { maxFPS: 60 };
globalThis.canvas = { app: { view: vista, ticker } };
const som = { volume: 0.7, fade(v) { this.volume = v; } };
globalThis.game = {
  settings: { get: () => true },
  playlists: { playing: [{ sounds: [{ playing: true, sound: som }] }] }
};

const amb = await import("../scripts/ambiente.js");

test("mudar de cena durante a cutscene não deixa o mapa invisível no fim", () => {
  amb.congelarCanvas();
  assert.equal(vista.style.visibility, "hidden");
  ticker.maxFPS = 60;                       // o Foundry reconfigura ao redesenhar
  amb.canvasFoiRedesenhado();
  assert.equal(ticker.maxFPS, 1);
  assert.equal(vista.style.visibility, "hidden");
  amb.descongelarCanvas();
  assert.equal(vista.style.visibility, "");
  assert.equal(ticker.maxFPS, 60);
});

test("alívio do mestre: redesenho não prende o canvas a 30 fps", () => {
  ticker.maxFPS = 60;
  amb.aliviarCanvas(30);
  amb.canvasFoiRedesenhado();               // o Foundry não repôs: continua 30
  assert.equal(ticker.maxFPS, 30);
  amb.desaliviarCanvas();
  assert.equal(ticker.maxFPS, 60);
});

test("cena seguida de outra: a música volta ao volume original, não ao de meio do fade", () => {
  som.volume = 0.7;
  amb.abaixarMusica();
  assert.equal(som.volume, 0);
  // fim da cena: o restauro começa, mas o volume real ainda está perto de 0
  som.fade = function () { /* fade de 1,5 s: nada muda já */ };
  amb.restaurarMusica();
  som.fade = function (v) { this.volume = v; };
  amb.abaixarMusica();                      // cena seguinte começa logo
  amb.restaurarMusica();                    // e acaba
  assert.equal(som.volume, 0.7);
});
