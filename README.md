# Cinema — Cutscenes Sincronizadas

Exibe uma cutscene em vídeo **em tela cheia, para a mesa inteira, ao mesmo tempo**, com o áudio junto.

Feito para o problema real: quando o mestre dispara um vídeo e uma música por caminhos separados,
cada jogador recebe num instante diferente, cada um baixa em velocidade diferente, e alguém
sempre assiste dessincronizado — ou mudo, porque o navegador bloqueou o autoplay.

## Como funciona

**1. Pré-carregar (invisível).** Os clientes baixam o vídeo em background enquanto vocês jogam.
O mestre acompanha quem já tem, quem está em 60% e quem falhou.

**2. Cortina.** Cada jogador recebe uma tela preta com um clique. Esse clique é o **gesto que o
navegador exige** para liberar áudio e tela cheia — por isso ele acontece *antes* da cena, e não
durante. Ninguém vê carregamento, ninguém vê a interface do Foundry.

**3. Exibir.** O mestre não manda "toca agora": manda "toca no instante `T`", medido em
`game.time.serverTime` — o relógio que o Foundry mantém sincronizado entre todos os clientes.
Cada cliente espera o próprio atraso local, então o jitter da rede sai da conta.

**4. Correção contínua.** A cada 2 s, cada cliente compara onde o vídeo está com onde deveria
estar. Até 50 ms, ignora. Até 350 ms, corrige a velocidade em no máximo ±4% (imperceptível).
Acima disso, pula direto para o ponto certo. Quem cair e voltar entra sincronizado.

O mestre vê o **desvio real em milissegundos** de cada cliente no painel, durante a exibição.

## Uso

Atalho **Ctrl+Shift+C**, ou uma macro:

```js
game.cinema.diretor();
```

No painel: escolher o vídeo → **1. Pré-carregar** → **2. Cortina** → **3. Exibir**.
O botão *Exibir* só libera quando alguém está pronto; espere o contador ficar verde.

### Saídas de emergência

- **Esc** antes da cena começar sai da cortina (qualquer jogador).
- **Esc** durante a cena encerra para todos — só o mestre.
- Cortina esquecida no ar por 5 minutos libera o jogador sozinho.

## Requisitos

Foundry VTT **v13+** (verificado na v14). Nenhuma dependência de outro módulo.

Vídeo com **áudio embutido** (`.webm` ou `.mp4`). O módulo checa o codec de cada cliente no
pré-carregamento e avisa o mestre *antes* da cena, com o nome de quem não consegue tocar.

## Configuração

| Opção | Escopo | Padrão |
|---|---|---|
| Volume da cutscene | por cliente | 0.8 |
| O mestre também assiste | mundo | sim |
| Fechar ao terminar | mundo | sim |

## API

```js
game.cinema.diretor();      // abre o painel
game.cinema.encerrar();     // fecha a tela neste cliente
game.cinema.limparCache();  // libera os vídeos guardados em memória
```

## Desenvolvimento

```bash
npm test              # lógica de sincronia: zona morta, correção, convergência, agendamento
python3 test/verificar.py   # integridade: ações sem handler, i18n faltando, caminhos quebrados
```

`package.json` existe só para os testes — o Foundry não o usa.

## Limitações conhecidas

- **Safari não é alvo.** Se algum jogador usar, o codec provavelmente falha (e o painel avisa).
- Fullscreen pode ser recusado pelo navegador; nesse caso a sobreposição cobre tudo do mesmo jeito.
- O vídeo vai inteiro para a memória do cliente antes de tocar. Para arquivos muito grandes
  (centenas de MB), o fallback de streaming entra sozinho, mas o carregamento fica menos preciso.
