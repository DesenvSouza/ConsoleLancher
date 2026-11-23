# Músicas de fundo do launcher

Cinco faixas instrumentais criadas pelo Codex, feitas para repetir sem emenda (formato OGG, usado pelo launcher):

| Arquivo | Nome na tela | Duração |
|---|---|---|
| `orbita-baixa.ogg` | Órbita Baixa | 1:31 |
| `luz-de-espera.ogg` | Luz de Espera | 1:25 |
| `horizonte-violeta.ogg` | Horizonte Violeta | 1:17 |
| `deriva-lunar.ogg` | Deriva Lunar | 1:41 |
| `sala-em-repouso.ogg` | Sala em Repouso | 1:29 |

As versões em MP3 (original de cada faixa) ficam em `assets/trilha-original/`. A lista usada pelo launcher está em `src/audio/music.ts` (`TRACKS`): para incluir uma faixa nova, coloque o `.ogg` aqui e acrescente uma linha lá (o nome na tela é um nome próprio e não é traduzido).
