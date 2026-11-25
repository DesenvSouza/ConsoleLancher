# ConsoleLancher

**Console Launcher** is a Windows 11 game launcher operated entirely with a game controller, made for a PC connected to a TV. It
shows your installed and owned games from Steam and Epic Games, opens and installs them, and offers a side menu over the running
game, an FPS overlay and an optional console mode.

## Download

Installers are on the [releases page](https://github.com/DesenvSouza/ConsoleLancher/releases). They are not code signed yet: an
application to the SignPath Foundation is being prepared, see the [Code signing policy](docs/CODE_SIGNING.md).

[Code signing policy](docs/CODE_SIGNING.md) ·
[Privacy](docs/PRIVACY.md) · [Media and third-party material](docs/ASSETS.md) · Uninstall: Windows Settings › Apps › Console Launcher

Licensed under the [GNU General Public License, version 3](LICENSE).

## Em português

Launcher de jogos para PC ligado na TV, controlado **100% por joystick**, feito para substituir o
Steam Big Picture (e, no fim, a área de trabalho do Windows 11).

**Stack:** Tauri 2 (Rust) + React 19 + TypeScript + Vite + Zustand.
Interface sem mouse: toda navegação é espacial (D-pad/analógico) e o cursor fica escondido.

## Estado atual (M1 pronto, M2 em validação)

- **No app desktop** a biblioteca é a **real da Steam** (instalados, progresso de download, jogo em execução, capas).
  A lista completa da conta (inclusive não instalados) é sincronizada em **Select › Sincronizar biblioteca da Steam**.
- **No navegador** (`npm run dev`) continua a biblioteca de mentira, para desenvolver a interface.
- **Select** abre as Configurações e **Start** abre o menu de opções do jogo em foco.
- **X** na Home abre a **Biblioteca completa** (todos os jogos da conta): LB/RB trocam de aba, **Y** a ordem, **X** a busca, **B** limpa a busca.
- **Configurações › Biblioteca**: escolher quais abas existem (criar, renomear com o teclado na tela, esconder, mover, excluir),
  os filtros de cada aba (instalação, favoritos, jogados, tempo, tamanho, **coleções da Steam**, nome), mostrar/esconder os jogos
  ocultos na Steam, tamanho dos cards, contagem nas abas e selo "Instalar".

## Marco M1 — esqueleto

- Home com herói + fileiras (Continuar jogando, Favoritos, Instalados, Não instalados).
- Tela do jogo: Jogar / Instalar / Desinstalar (com confirmação) / Favoritar.
- Configurações: tema, cor de destaque, tamanho da interface, cantos e brilho — tudo persistido.
- 5 temas (escuro por padrão) e variáveis CSS para customizar qualquer coisa.
- Entrada unificada: controle (Gamepad API) e teclado geram as mesmas ações.
- Biblioteca **de mentira** (`src/lib/mock.ts`). O scanner real da Steam é o marco M2.

## Como rodar

Instale o Node.js 22.12 ou superior e use o `package-lock.json` para instalar as dependências:

```powershell
npm ci
```

Só a interface, no navegador (não precisa de Rust):

```powershell
npm run dev        # http://localhost:1420
```

Teclado para testar sem controle: setas, `Enter` = A, `Esc` = B, `X`, `C` = Y, `Q`/`E` = LB/RB, `Tab` = Start.

No app desktop, `F11` alterna a tela cheia. Em tela cheia, o launcher fica por cima de tudo e **nenhuma janela da Steam** (botão Guia, ofertas, avisos, login) vem para a frente: elas são minimizadas assim que aparecem. Se a Steam estiver fechada ao jogar ou instalar, o launcher a abre em silêncio e espera ficar pronta. Nada é alterado nas configurações da Steam. Ao sair da tela cheia ou fechar o launcher, a janela principal da Steam que ele minimizou volta ao normal.

App desktop completo (precisa do Rust + Visual Studio Build Tools, veja abaixo):

```powershell
npm run tauri dev
npm run tauri build   # gera o instalador NSIS em src-tauri/target/release/bundle
```

### Pré-requisitos do app desktop
1. **Rust** (`rustup`, toolchain `stable-x86_64-pc-windows-msvc`).
2. **Visual Studio Build Tools 2022** com a carga "Desenvolvimento para desktop com C++".
3. **WebView2** (já vem no Windows 11).

## Validação

Execute na raiz do projeto:

```powershell
npm run typecheck
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Os testes Rust cobrem o parser VDF, o scanner e os dados da conta. Os testes que interagem com a Steam local ficam ignorados na execução padrão.

## Atualizações automáticas

O launcher instalado procura versões novas nas publicações deste repositório e instala quando o jogador confirma. Como
criar a chave de assinatura e publicar uma versão: [docs/PUBLICAR.md](docs/PUBLICAR.md).

## Estrutura

```
src/
  components/   Focusable (item/grupo navegável), GameCard, ConfirmDialog, Chrome (topo/legendas)
  input/        actions.ts (barramento de ações + teclado), gamepad.ts (polling do controle)
  screens/      Home, GameDetail, Settings
  store/        library (jogos), ui (navegação)
  theme/        themes.ts (paletas), themeStore.ts (ajustes do usuário → variáveis CSS)
  lib/          api.ts (ponte com o Rust), types.ts, mock.ts
src-tauri/      backend Rust: comandos steam_run / steam_install / steam_uninstall / exit_to_desktop
docs/PLANO.md   plano completo, integração com a Steam e marcos
```

## Segurança ao usar como shell do Windows

Só faça isso no marco M6, e **sempre** com uma segunda conta de administrador mantendo o Explorer.
Veja `docs/PLANO.md` (seção "Modo shell") para o passo a passo e o script de recuperação.
