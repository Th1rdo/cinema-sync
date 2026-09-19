import { SOCKET, MODULE_ID } from "./const.js";

/**
 * Camada de socket.
 *
 * Detalhe que morde: game.socket.emit NÃO ecoa para quem enviou. Como o mestre
 * também assiste à cutscene, toda mensagem pode pedir entrega local além da
 * remota (`local: true`).
 */
const ouvintes = new Map();

export function iniciarRede() {
  game.socket.on(SOCKET, (msg) => despachar(msg));
}

function despachar(msg) {
  if (!msg?.type) return;
  if (msg.to && msg.to !== game.user.id) return;   // mensagem endereçada a outro cliente
  for (const fn of ouvintes.get(msg.type) ?? []) {
    try { fn(msg); } catch (e) { console.error(`${MODULE_ID} | erro em ${msg.type}`, e); }
  }
}

export function ao(type, handler) {
  if (!ouvintes.has(type)) ouvintes.set(type, []);
  ouvintes.get(type).push(handler);
}

/**
 * @param {string} type
 * @param {object} payload
 * @param {{local?: boolean}} opts  local=true também entrega neste cliente
 *   Para endereçar a um cliente só, passe `to: userId` no payload.
 */
export function enviar(type, payload = {}, { local = false } = {}) {
  const msg = { type, from: game.user.id, ...payload };
  game.socket.emit(SOCKET, msg);
  if (local) despachar(msg);
  return msg;
}

/** Jogadores conectados que devem assistir (o mestre é opcional). */
export function plateia({ incluirMestre = true } = {}) {
  return game.users.filter(u => u.active && (incluirMestre || !u.isGM));
}
