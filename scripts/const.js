/** Identidade do módulo e constantes compartilhadas. */
export const MODULE_ID = "cinema-sync";
export const SOCKET = `module.${MODULE_ID}`;

/** Mensagens do protocolo. Toda mensagem carrega { type, from }. */
export const MSG = {
  ARM:    "arm",      // mestre → todos: preparem este vídeo
  STATUS: "status",   // cliente → mestre: como estou
  START:  "start",    // mestre → todos: a cena começa em startAt (tempo de servidor)
  STOP:   "stop",     // mestre → todos: encerrem agora
  ENDED:  "ended",    // cliente → mestre: o vídeo acabou aqui
  REJOIN: "rejoin"    // cliente → mestre: cheguei atrasado, o que está rodando?
};

/** Estados que um cliente reporta ao mestre. */
export const PHASE = {
  IDLE:    "idle",
  LOADING: "loading",
  READY:   "ready",
  PLAYING: "playing",
  ENDED:   "ended",
  LEFT:    "left",      // o jogador saiu da cena por conta própria
  FAILED:  "failed",
  NOCODEC: "nocodec"
};

/**
 * Sincronia.
 *
 * A estratégia é sincronizar UMA vez, com precisão, na largada — e depois
 * confiar no relógio monotônico de cada cliente. Só há intervenção quando algo
 * realmente deu errado (buffer secou, alt-tab, reconexão). Nada de mexer na
 * velocidade: playbackRate ≠ 1 liga o time-stretching de áudio, que custa CPU
 * e produz estalos audíveis.
 */
export const SYNC = {
  LEAD_MS:       3000,   // tela preta antes da cena: tempo de todos receberem e se prepararem
  CHECK_MS:      1000,   // de quanto em quanto tempo conferir (só leitura, custo zero)
  LIMIAR_INICIO: 0.25,   // na largada: absorve o atraso do decodificador ao dar play
  LIMIAR:        0.5,    // durante a cena: só pula se o desvio for real
  RELATO_A_CADA: 10,     // conferências entre um relato e outro ao mestre
  START_TIMEOUT: 20000,  // tela preta que nunca vira vídeo é desfeita
  ARM_TIMEOUT:   120000
};

export const log = (...args) => console.log(`${MODULE_ID} |`, ...args);
export const warn = (...args) => console.warn(`${MODULE_ID} |`, ...args);
