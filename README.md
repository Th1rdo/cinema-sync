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
| ⚙ | nome, quem assiste, pré-carregar ao entrar, botão de tela cheia, volume, versões, remover |

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

Só pelo botão. Como num player de vídeo, **mexer o rato** mostra o cursor e um ⛶ no canto inferior
direito; dois segundos parado, somem. O mesmo botão tira da tela cheia. Nada entra em tela cheia
sozinho, e clicar na cena não faz nada além de ligar o som (se o navegador o tinha bloqueado).

No ⚙ de cada cutscene dá para desligar o botão naquela cena.

Para quem quer o ecrã inteiro sempre: abrir o Foundry como app no Chrome (⋮ → *Transmitir, guardar
e partilhar* → *Instalar página como app*) ou no Edge (⋯ → *Apps* → *Instalar este site como app*).
Janela sem abas nem barra de endereço, que se comporta como qualquer programa no alt-tab.

## Versões — cada jogador recebe o que o computador dele aguenta

Como na Netflix, cada cutscene pode ter uma **escada de versões**: o original (por exemplo 4K), 1080p,
720p e 480p. Nunca se perde qualidade visível — cada computador sobe até ao que o ecrã mostra e só
desce o necessário para tocar com fluidez.

**No arranque**, o computador de cada jogador calcula sozinho a versão certa — ninguém escolhe nada:

- nunca acima do que o **ecrã** mostra (num ecrã de 1080p, o 4K seria peso invisível);
- nada acima do que esse computador **já mostrou não aguentar** numa cena anterior;
- **acima de 1080p, só com o navegador a confirmar** que toca com fluidez e por hardware
  (`mediaCapabilities`); sem confirmação, fica em 1080p.

O card mostra em que degrau cada jogador vai começar, antes de carregares no ▶.

**A meio da cena**, se um computador perder mais de 20% dos quadros durante 3 segundos seguidos, desce
um degrau: a versão de baixo é preparada por baixo, invisível, já no ponto certo, e as duas cruzam em
300 ms. O áudio de todas as versões é o mesmo (copiado, não recodificado), então a troca não se ouve.
Só desce, nunca sobe, e o degrau de baixo é descarregado em segundo plano para a troca ser instantânea.

### Gerar as versões

Com o ffmpeg instalado (`brew install ffmpeg`):

```bash
bash ferramentas/versoes.sh "caminho/Cena.mp4"
```

Cria `Cena-1080p.mp4`, `Cena-720p.mp4` e `Cena-480p.mp4` numa pasta ao lado. **Carregue-as para a mesma
pasta do original no Forge** — o módulo encontra-as sozinho pelo nome, ao adicionar a cutscene ou,
se as carregares depois, na próxima vez que abrires a janela Cinema. Um 4K de 80 s e 194 MB fica com 31 MB em 1080p, 16 MB em 720p
e 9 MB em 480p.

## Quando a máquina ou a rede não aguentam

- **Download aos bocados de 8 MB**, cada um com novas tentativas: uma quebra de ligação custa um bocado,
  não o vídeo inteiro. Se o servidor não aceitar bocados, volta ao pedido único.
- **Quem falha o download não atrasa a mesa**: vê a cena pela rede, e o card mostra ⚠ com o nome e o
  erro — também fora de uma exibição.
- **Quem encrava repetidamente passa a priorizar fluidez**: depois de dois saltos de sincronia em 20 s,
  deixa de ser forçado a saltar, vê a cena contínua, um pouco atrasado, e desce um degrau. No degrau
  novo a sincronia volta a ser tentada.
- **Durante a cena os downloads param** entre bocados: quem começou a ver antes de acabar de baixar fica
  com a banda toda. Retomam quando o vídeo acaba. O mesmo ficheiro nunca é baixado duas vezes em paralelo.
- **Pausa que não foi do módulo é desfeita**: o Chrome pausa sozinho vídeos mudos em abas ocultas;
  quando o jogador volta do alt-tab, a cena retoma no ponto onde a mesa está.

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
npm test     # sincronia, download com quedas de ligação, escolha de versão, audiência + integridade
```
