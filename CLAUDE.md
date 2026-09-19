# cinema-sync

Módulo de Foundry VTT que passa cutscenes em vídeo, sincronizadas, para a mesa toda.

> [!important] Ambiente
> **The Forge, nunca Foundry local. Foundry v14.** Os vídeos vivem na Assets Library do Forge.
> Não propor `localhost`, instalação local nem caminhos de `Data/`.

## Wiki / segundo cérebro

Path: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/foundryModules`

Quando precisares de contexto que não está neste repositório:
1. Ler `wiki/hot.md` (contexto recente, ~500 palavras)
2. Se não chegar, `wiki/index.md` (catálogo)
3. Depois a página do componente em `wiki/components/`, a decisão em `wiki/decisions/` ou o fluxo em `wiki/flows/`

Não ler a wiki para dúvidas gerais de JavaScript, nem para o que já está neste repo ou na conversa.
Depois de mexer no módulo, atualizar `wiki/hot.md` e `wiki/log.md`.

## Trabalhar aqui

- `npm test` antes de publicar (48 testes + verificação de integridade).
- Publicação por tag: a versão do `module.json` é acertada pelo workflow. Nunca editar a versão à mão.
- Comentários explicam **porquê**, a partir do caso real que correu mal.
- O jogador nunca escolhe nada; o mestre resolve tudo num clique.
