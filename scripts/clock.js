import { SYNC } from "./const.js";

/**
 * Relógio compartilhado: game.time.serverTime, sincronizado pelo core com o
 * algoritmo de Cristian. Usado para combinar o instante da largada — e só.
 * Depois da largada o cliente usa performance.now(), que é monotônico: o
 * serverTime é re-sincronizado de tempos em tempos e pode dar pequenos saltos,
 * que antes eram confundidos com desvio e disparavam correções à toa.
 */
export const serverNow = () => game.time.serverTime;

/**
 * Executa `callback` quando o relógio do servidor alcançar `targetMs`.
 * Dorme no setTimeout e só entra em requestAnimationFrame nos últimos 250 ms.
 *
 * @returns {() => void} função para cancelar
 */
export function scheduleAt(targetMs, callback, nowFn = serverNow) {
  let cancelado = false, timer = null, raf = null;

  const tick = () => {
    if (cancelado) return;
    const falta = targetMs - nowFn();
    if (falta <= 0) return callback();
    if (falta > 250) timer = setTimeout(tick, falta - 200);
    else raf = requestAnimationFrame(tick);
  };

  tick();
  return () => {
    cancelado = true;
    if (timer) clearTimeout(timer);
    if (raf) cancelAnimationFrame(raf);
  };
}

/**
 * Onde o vídeo deveria estar agora, em segundos.
 *
 * `ancoraServer` é o serverTime lido UMA vez, logo depois do play começar de
 * verdade; `ancoraLocal` é o performance.now() do mesmo instante. Daí em diante
 * só o relógio local conta — imune aos re-syncs do servidor.
 */
export function tempoEsperado({ startAt, ancoraServer, ancoraLocal, agoraLocal }) {
  return (ancoraServer - startAt) / 1000 + (agoraLocal - ancoraLocal) / 1000;
}

/**
 * Decide se intervém. Só existe "segura" ou "pula": sem ajuste de velocidade.
 * @param {number} desvio  esperado - real, em segundos
 */
export function decidir(desvio, limiar = SYNC.LIMIAR) {
  return Math.abs(desvio) > limiar ? "seek" : "hold";
}
