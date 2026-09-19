/** Identidade do módulo e constantes compartilhadas. */
export const MODULE_ID = "cinema-sync";
export const SOCKET = `module.${MODULE_ID}`;

/** Mensagens do protocolo. Toda mensagem carrega { type, cueId, from }. */
export const MSG = {
  ARM:      "arm",       // mestre → todos: preparem este vídeo
  STATUS:   "status",    // cliente → mestre: como estou
  CURTAIN:  "curtain",   // mestre → todos: subam a cortina (clique destrava áudio+fullscreen)
  START:    "start",     // mestre → todos: comecem em startAt (tempo de servidor)
  STOP:     "stop",      // mestre → todos: encerrem agora
  ENDED:    "ended",     // cliente → mestre: o vídeo acabou aqui
  REJOIN:   "rejoin"     // cliente → mestre: cheguei atrasado, o que está rodando?
};

/** Estados que um cliente reporta ao mestre. */
export const PHASE = {
  IDLE:      "idle",
  LOADING:   "loading",
  READY:     "ready",
  CURTAINED: "curtained",   // clicou: áudio destravado, cortina no ar
  PLAYING:   "playing",
  ENDED:     "ended",
  FAILED:    "failed",
  NOCODEC:   "nocodec"
};

/** Sincronia. Tudo em segundos, exceto os *_MS. */
export const SYNC = {
  LEAD_MS:     1200,   // antecedência entre "exibir" e o instante combinado
  CHECK_MS:    2000,   // de quanto em quanto tempo conferir o desvio
  DEAD_ZONE:   0.05,   // até 50 ms: não mexe
  HARD_SEEK:   0.35,   // acima de 350 ms: pula direto para o ponto certo
  MAX_RATE:    0.04,   // correção suave: no máximo ±4% na velocidade
  ARM_TIMEOUT: 120000, // desiste de esperar um cliente carregar
  CURTAIN_TIMEOUT: 300000 // cortina esquecida no ar libera o jogador
};

export const log = (...args) => console.log(`${MODULE_ID} |`, ...args);
export const warn = (...args) => console.warn(`${MODULE_ID} |`, ...args);
