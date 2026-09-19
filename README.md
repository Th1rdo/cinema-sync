# Cinema — Cutscenes Sincronizadas

Exibe uma cutscene em vídeo **em tela cheia, para a mesa inteira, ao mesmo tempo**, com o áudio junto.

Feito para o problema real: quando o mestre dispara um vídeo e uma música por caminhos separados,
cada jogador recebe num instante diferente, cada um baixa em velocidade diferente, e alguém
sempre assiste dessincronizado — ou mudo, porque o navegador bloqueou o autoplay.

## Como funciona

**1. Pré-carregar (invisível).** Os clientes baixam o vídeo em background enquanto vocês jogam.
O mestre acompanha quem já tem, quem está em 60% e quem falhou — e é avisado de antemão se o
navegador de alguém ainda vai bloquear o som.

**2. Exibir.** O mestre não manda "toca agora": manda "toca no instante `T`", medido em
`game.time.serverTime`. Os jogadores recebem **3 segundos de tela preta** — a cortina — e o
filme começa para todos no mesmo instante. O jitter da rede sai da conta.

**Sincroniza uma vez, e bem.** Na largada o cliente ancora o relógio; daí em diante confia no
próprio relógio monotônico. Só intervém quando algo realmente deu errado — buffer secou,
alt-tab, reconexão — e aí dá **um** pulo para o ponto certo. Nunca mexe na velocidade:
`playbackRate ≠ 1` liga o *time-stretching* do áudio, que custa CPU e produz estalos.

### Enquanto a cena passa

- **O canvas do Foundry sai do ar nos jogadores** (1 fps, invisível) e volta no fim. Sem isso ele
  continuaria renderizando iluminação e visão a 60 fps atrás da tela preta.
- **A música das playlists abaixa** e volta ao volume anterior quando a cena termina.
- **O mestre não entra em tela cheia.** Assiste numa janela móvel, com som, sem perder HUD nem
  canvas — e com a linha do tempo da cena no painel.

O painel mostra, por jogador: progresso de download, estado, desvio real em ms, 🔇 se o som vai
ser bloqueado, e 🌡 se o computador dele estiver perdendo quadros.

## Requisitos

Foundry VTT **v13+** (verificado na v14). Nenhuma dependência de outro módulo.

Vídeo com **áudio embutido** (`.webm` ou `.mp4`). O módulo checa o codec de cada cliente no
pré-carregamento e avisa o mestre *antes* da cena, com o nome de quem não consegue tocar.

## Prepare o vídeo (isto importa para o calor)

Use **H.264 em `.mp4`, 1080p, 30 fps**. É decodificado em hardware em qualquer máquina.
VP9/AV1 em `.webm` pode cair em decodificação por software em alguns navegadores — é CPU em vez
de chip dedicado, e é aí que o computador esquenta. 4K a 60 fps é quatro vezes o trabalho de
1080p a 30 fps, para um vídeo visto numa janela de navegador.

```bash
ffmpeg -i entrada.mov -c:v libx264 -preset slow -crf 20 -vf "scale=-2:1080" -r 30 \
       -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart cutscene.mp4
```

`+faststart` põe os metadados no começo do arquivo: a duração aparece no painel na hora.

## Configuração

| Opção | Escopo | Padrão |
|---|---|---|
| Volume da cutscene | por cliente | 0.8 |
| O mestre assiste numa janela | mundo | sim |
| Silenciar a música durante a cutscene | mundo | sim |
| Fechar ao terminar | mundo | sim |

## API

```js
game.cinema.diretor();      // abre o painel
game.cinema.encerrar();     // fecha a tela neste cliente
game.cinema.limparCache();  // libera os vídeos guardados em memória
```

## Desenvolvimento

```bash
npm test              # sincronia: re-sync sem correção falsa, buffer, alt-tab, deriva de 10 min
python3 test/verificar.py   # integridade: ações sem handler, i18n faltando, caminhos quebrados
```

`package.json` existe só para os testes — o Foundry não o usa.

## Limitações conhecidas

- **Safari não é alvo.** Se algum jogador usar, o codec provavelmente falha (e o painel avisa).
- Tela cheia do sistema exige um clique recente; sem ele, a sobreposição cobre a janela inteira do navegador.
- O vídeo vai inteiro para a memória do cliente antes de tocar. Para arquivos muito grandes
  (centenas de MB), o fallback de streaming entra sozinho, mas o carregamento fica menos preciso.
