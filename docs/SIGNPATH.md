# Pedido ao SignPath Foundation

Formulário: [signpath.org/apply](https://signpath.org/apply) · [condições](https://signpath.org/terms). Conferido em 2026-11-25.

## Antes de enviar

- [x] **Licença** aprovada pela OSI no repositório: [GPL-3.0](../LICENSE).
- [ ] **Reputação**: o formulário exige links ou números que mostrem que o projeto é usado ou confiável. Um projeto recém-publicado,
      sem usuários, tem chance alta de recusa.
- [ ] Autenticação em dois fatores ligada na conta do GitHub.
- [x] Nome do produto no instalador e no executável: `Console Launcher`. O endereço do repositório continua `ConsoleLancher`.
- [x] Documentos publicados: [CODE_SIGNING.md](CODE_SIGNING.md), [PRIVACY.md](PRIVACY.md), [ASSETS.md](ASSETS.md) e o resumo no README.
- [x] Aviso de privacidade na instalação, com o modo de desligar (`src-tauri/installer-notice.txt`).
- [ ] Uma versão publicada já com o nome e o aviso novos (a 0.1.2 publicada ainda se chama `Launcher`).
- [ ] Pontos que a análise pode questionar: o identificador do aplicativo oficial da Epic em `epic.rs`, o fechamento do overlay da
      Steam e o clique automático no botão "Aceitar" do contrato de um jogo (só quando o jogador aceita no launcher).

## Respostas sugeridas

| Campo | Texto |
|---|---|
| Project Name | Console Launcher |
| Repository URL / Homepage URL | https://github.com/DesenvSouza/ConsoleLancher |
| Download URL | https://github.com/DesenvSouza/ConsoleLancher#download |
| Privacy Policy URL | https://github.com/DesenvSouza/ConsoleLancher/blob/main/docs/PRIVACY.md |
| Tagline | A controller-only game launcher that turns a Windows PC connected to a TV into a console. |
| License | GPL-3.0 |
| Description | Console Launcher is a Windows 11 game launcher operated entirely with a game controller. It shows the installed and owned games from Steam and Epic Games, opens and installs them, and offers a side menu over the running game, an FPS overlay and an optional console mode. |
| Reputation | New project, first published in November 2026. No adoption metrics yet: public source code, public build workflow and releases at github.com/DesenvSouza/ConsoleLancher. (Acrescente dados reais quando houver; não invente.) |
| Build System | GitHub Actions |

Nome, e-mail, verificação reCAPTCHA e os aceites são seus.

## Depois da aprovação

O SignPath informa os identificadores da organização, do projeto e da política. Com eles a publicação
([release.yml](../.github/workflows/release.yml)) passa a: compilar, enviar o executável para assinatura, montar o instalador com
ele, enviar o instalador, assinar o pacote de atualização e criar o rascunho. Cada versão exige a sua aprovação manual no SignPath.
