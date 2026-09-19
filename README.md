# Cinema — Cutscenes Sincronizadas

Cutscenes em vídeo **em tela cheia, para a mesa inteira, ao mesmo tempo**, com o áudio junto —
e a um clique do mestre no meio da sessão.

## Instalar

No Foundry: **Add-on Modules → Install Module** → *Manifest URL*:

```
https://github.com/Th1rdo/cinema-sync/releases/latest/download/module.json
```

## Usar

Abra o **Cinema** pela claquete na barra de ferramentas da esquerda (grupo de tokens) ou com
**Ctrl+Shift+C**.

1. **Adicionar cutscene** → escolha o vídeo. Ele vira um card, com miniatura e duração.
2. **▶ no card** — e só. Se todos já têm o vídeo, a cena começa. Se falta alguém, o vídeo
   é baixado só para quem falta e a cena começa sozinha quando estiverem prontos
   (ou em 25 s, ou quando você clicar *Começar já*).
3. **Arraste o card para a hotbar** e a cena passa a ficar a um clique, sem abrir janela nenhuma.

Em cada card:

| Botão | O que faz |
|---|---|
| ▶ | exibe para a audiência padrão |
| 👤✓ | escolhe na hora quem vê (flashback de um personagem só) |
| ⬇ | baixa agora para a audiência |
| ⚙ | nome, quem assiste por padrão, pré-carregar ao entrar, pedir tela cheia, volume, remover |

O card mostra quantos jogadores já têm o vídeo em disco (`4/5`) e avisa quando o vídeo é 4K.

### Pré-carregar ao entrar

Cutscenes marcadas com ⚡ são baixadas sozinhas, em segundo plano, quando o jogador entra no
mundo — uma de cada vez, para não roubar banda do resto da sessão. **Ficam em disco entre
sessões:** o jogador baixa uma vez e na semana seguinte já tem.

## O que o jogador vê

Preto por três segundos. O filme entra em fade. No fim, apaga e a mesa volta. Nenhum texto,
nenhum botão, nenhum cursor — a menos que o navegador tenha bloqueado o som, e aí aparece
"clique para ouvir".

Durante a cena o jogador pode apertar **Esc** para sair da própria tela. Em tela cheia, o
primeiro Esc é do navegador (sai da tela cheia) e o segundo sai da cena.

Enquanto a cena passa, nos jogadores: o **canvas do Foundry sai do ar** (1 fps, invisível) e a
**música das playlists abaixa**. Tudo volta no fim.

## Tela cheia

Os navegadores só entram em tela cheia em resposta a um clique da própria pessoa, feito nos
últimos segundos. É regra de segurança: nenhum módulo contorna. Então o clique precisa acontecer
num momento que não custe imersão.

**No começo da sessão.** Quando o jogador entra num mundo que tem cutscenes, aparece um convite
discreto no topo:

- **Entrar** — tela cheia agora, para esta sessão.
- **Sempre** — entra agora e, nas próximas sessões, sozinho no primeiro clique do jogador.
- **Agora não** — pergunta de novo na próxima sessão.

Quem aceita tem **todas as cutscenes em tela cheia, sem prompt nenhum**. F11 (ou ⌃⌘F no Mac)
também vale, e é detectado.

**Na cena, como rede de segurança.** Cada cutscene tem a opção *Pedir tela cheia a quem não
estiver*. Ligada, quem ainda está na janela do navegador vê um ⛶ discreto no preto antes do
filme. Clicar em qualquer lugar entra em tela cheia, e ela é desfeita no fim da cena. Quem já
estava em tela cheia não vê nada.

Na janela Cinema, o mestre vê um ⛶ verde ao lado de cada jogador que já está em tela cheia —
sabe antes de dar play quem vai ver a cena no monitor inteiro.

## O que o mestre vê

Uma **janela móvel** com a cena, com som — sem perder HUD nem canvas. Passando o mouse, aparece
o botão para encerrar a cena para todos. Na janela Cinema, a faixa *No ar* mostra o tempo da
cena e cada jogador: assistindo, saiu, 🔇 som bloqueado, 🌡 perdendo quadros.

## Como a sincronia funciona

O mestre não manda "toca agora": manda "toca no instante `T`", medido em `game.time.serverTime`
(o relógio que o Foundry sincroniza entre todos). Cada cliente espera o próprio atraso local.

Na largada o cliente ancora o relógio e depois confia no próprio relógio monotônico. Só intervém
quando algo deu errado de verdade — buffer secou, alt-tab, reconexão — e aí dá **um** pulo para o
ponto certo. Nunca mexe na velocidade do vídeo (isso liga processamento de áudio em CPU e produz
estalos). Quem cair e voltar entra sincronizado.

## Prepare o vídeo

**H.264 em `.mp4`, 1080p, 30 fps.** 4K é quatro vezes o peso para baixar e decodificar em cada
jogador, para um vídeo visto numa janela de navegador.

```bash
ffmpeg -i entrada.mp4 -c:v libx264 -preset slow -crf 20 -vf "scale=-2:1080" -r 30 \
       -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart cutscene.mp4
```

Um 4K de 80 s e 194 MB vira algo perto de 40 MB.

## Configuração

| Opção | Escopo | Padrão |
|---|---|---|
| Volume das cutscenes | por computador | 0.8 |
| Tela cheia (convidar · sozinho no primeiro clique · nunca) | por computador | convidar |
| O mestre assiste numa janela | mundo | sim |
| Silenciar a música durante a cutscene | mundo | sim |
| Fechar ao terminar | mundo | sim |

## API

```js
game.cinema.abrir();                     // janela Cinema
game.cinema.exibir(id);                  // exibe um item da biblioteca (o que a macro faz)
game.cinema.exibir(id, [userId, ...]);   // só para esses jogadores
game.cinema.parar();                     // encerra para todos
game.cinema.limparCache();               // apaga os vídeos guardados neste computador
```

## Requisitos

Foundry **v13+** (verificado na v14). Sem dependências. O cache em disco exige `https`
(o Forge é); num Foundry local em `http`, o vídeo fica em memória.

## Desenvolvimento

```bash
npm test     # sincronia, audiência, cache, macro + integridade (ações, i18n, caminhos)
```
