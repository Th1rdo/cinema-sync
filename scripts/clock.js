import { SYNC } from "./const.js";

/**
 * Relógio compartilhado.
 *
 * game.time.serverTime é o tempo do servidor estimado pelo core usando o
 * algoritmo de Cristian (última sincronização + metade da latência medida).
 * É a única referência que todos os clientes têm em comum — é nela que os
 * instantes de partida são combinados, nunca em Date.now() local.
 */
export const serverNow = () => game.time.serverTime;

/**
 * Executa `callback` quando o relógio do servidor alcançar `targetMs`.
 *
 * setTimeout sozinho erra dezenas de milissegundos; requestAnimationFrame
 * sozinho gastaria CPU à toa. Então dormimos no setTimeout até faltar pouco e
 * só aí entramos no rAF, que acerta no frame.
 *
 * @returns {() => void} função para cancelar o agendamento
 */
export function scheduleAt(targetMs, callback, nowFn = serverNow) {
  let cancelado = false;
  let timer = null;
  let raf = null;

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
 * Decide o que fazer com o desvio entre onde o vídeo está e onde deveria estar.
 * Função pura: é o miolo da sincronia e é o que os testes cobrem.
 *
 * @param {number} desvio  esperado - real, em segundos (positivo = atrasado)
 * @returns {{acao: "hold"|"nudge"|"seek", rate: number}}
 */
export function correcao(desvio, cfg = SYNC) {
  const m = Math.abs(desvio);
  if (m <= cfg.DEAD_ZONE) return { acao: "hold", rate: 1 };
  if (m >= cfg.HARD_SEEK) return { acao: "seek", rate: 1 };
  // proporcional, mas limitado: acelerar demais é audível
  const ajuste = Math.min(cfg.MAX_RATE, m * 0.15) * Math.sign(desvio);
  return { acao: "nudge", rate: Number((1 + ajuste).toFixed(4)) };
}
