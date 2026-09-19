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
| ⚙ | nome, quem assiste por padrão, pré-carregar ao entrar, tela cheia ao clicar, volume, remover |

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

Nada aparece na tela a pedir tela cheia. Como num player de vídeo, **mexer o rato** mostra o
cursor e um botão ⛶ no canto; dois segundos parado, somem. A cena vai para o ecrã inteiro quando o
jogador:

- **clica no ⛶** (ou em qualquer lugar da cena), ou
- **tinha acabado de clicar quando ela começou** (moveu um token, abriu uma ficha): entra sozinho,
  sem mostrar nada.

O mesmo botão tira da tela cheia.

A tela cheia é só da cena e é desfeita no fim — o alt-tab depois fica intocado. Quem não clicar vê
a cena a encher a janela do navegador.

Por que não dá para mandar todos para tela cheia quando o mestre carrega no ▶: o navegador tem
dois tipos de "o jogador já clicou". *Clicou alguma vez na sessão* vale a sessão inteira e é o que
libera o som. *Clicou há poucos segundos* expira depressa e é o que a tela cheia exige — porque um
site em tela cheia consegue desenhar um ecrã falso (um login, um banco) sem a barra do navegador
para denunciar. Nenhum módulo contorna isto.

**Para quem quer o ecrã inteiro sempre, sem clicar:** abrir o Foundry como app. No Chrome, menu ⋮ →
*Transmitir, guardar e partilhar* → *Instalar página como app* (no Edge: ⋯ → *Apps* → *Instalar
este site como app*). Fica uma janela sem abas nem barra de endereço, que se comporta como qualquer
programa no alt-tab — e a cutscene enche essa janela inteira.

No ⚙ de cada cutscene, *Tela cheia quando o jogador clica na cena* permite desligar a tela cheia
naquela cena. Na janela Cinema, o mestre vê um ⛶ verde em quem já está a ver no ecrã inteiro.

## O que o mestre vê

Uma **janela móvel** com a cena, com som — sem perder HUD nem canvas. Fecha sozinha no fim e liberta o vídeo. Passando o mouse, aparece
o botão para encerrar a cena para todos. Na janela Cinema, a faixa *No ar* mostra o tempo da
cena e cada jogador: assistindo, saiu, 🔇 som bloqueado, 🌡 perdendo quadros.

## Desempenho

- **Nos jogadores, durante a cena:** o canvas do Foundry desce para 1 fps e fica invisível, e nada do
  que está tapado pelo preto é pintado — chat, sidebar, hotbar, fichas abertas. Só visibilidade:
  nada é fechado e tudo volta no fim, redesenhado *por baixo* do fade, para a mesa já lá estar quando
  o preto some.
- **Nas janelas do módulo:** sem o `backdrop-filter: blur` que o Foundry v13+ põe em toda janela. Ele
  desfoca o canvas por trás a cada frame; como as nossas janelas são opacas, o desfoque nem se via.
- **Mestre, opcional:** *Aliviar o canvas do mestre durante a cena* baixa o teu canvas para 30 fps
  enquanto vês o monitor, e devolve no fim.

Para medir no teu mundo: `canvas.activateFPSMeter()` na consola (F12) mostra os fps do canvas.

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
| O mestre assiste numa janela | mundo | sim |
| Silenciar a música durante a cutscene | mundo | sim |
| Aliviar o canvas do mestre durante a cena | por computador | não |
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
