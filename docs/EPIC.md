# Biblioteca da Epic Games

A Epic não tem API oficial para o jogador ler a própria biblioteca. O launcher usa o mesmo caminho da Epic Games Launcher
(o de Legendary, Heroic e do plugin da Epic no Playnite). Código em `src-tauri/src/epic.rs`, `src/store/epic.ts` e
`src/screens/EpicAccount.tsx`.

## Como funciona

- **Login** (Configurações › Conta › Conta Epic Games › Entrar com a conta Epic): como o Playnite, a página de login da Epic
  abre numa janela do launcher (filha da janela principal, com pasta de dados própria, apagada ao fechar; o controle vira
  mouse nela e Start volta ao launcher). Quando a Epic mostra o texto com `authorizationCode`, o launcher desvia a página
  para um endereço que só ele entende (`epic-code.launcher.invalid`), intercepta, lê o código, troca-o pela sessão e fecha
  a janela. Alternativa: abrir a página no navegador e colar (ou digitar) o código. Senha e verificação em duas etapas
  nunca passam pelo launcher. A sessão (só o token de renovação) fica em `epic_session.bin`, cifrada com DPAPI, como a da Steam.
- Não se lê a sessão da Epic Games Launcher já logada: são credenciais de outro programa, e a versão nova só guarda um
  token de acesso de curta duração.
- **Biblioteca da conta**: `library-service` (registros) e `catalog-public-service` (nome, capa, categorias; uma consulta
  `GET .../namespace/<ns>/bulk/items?id=...` por namespace, 8 ao mesmo tempo, porque a Epic recusa o POST em lote). O que já
  foi consultado fica em `epic_catalog.json` (só títulos e capas públicas): a primeira sincronização leva ~30 s para
  ~600 itens, as seguintes só consultam o que é novo. Só entram itens
  com a categoria `games` e sem `addons`/`mainGameItem`. Fica guardada no navegador interno (zustand persist) e é relida de
  hora em hora, sem jogo aberto.
- **Instalados**: manifestos `.item` em `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests`.
- **Instalar, abrir e desinstalar sem a Epic Games Launcher** (`src-tauri/src/epic_install.rs`): o launcher executa o
  Legendary (`legendary.exe`, GPL-3.0) sem janela. Ele **não vai no instalador** nem no repositório: é baixado no PC do
  jogador quando ele pede (veja “Legendary sob demanda”). A sessão do Legendary é própria (`<config>\legendary\user.json`), criada de um
  código de troca gerado pela sessão do launcher: os dois não disputam o mesmo token. Instala em `defaultInstallDir` da
  Epic Games Launcher (ou `Epic Games` na pasta do usuário), com andamento lido da saída dele (`Progress: 12.3%`), e
  guarda a lista em `legendary\installed.json`. Jogos instalados assim não aparecem na Epic Games Launcher: o launcher os
  abre com `legendary launch`. Cancelar encerra o Legendary (o baixado fica para continuar depois).
- **Sem o `legendary.exe`**: ao instalar, o launcher pergunta se deve baixá-lo ou usar a Epic Games Launcher (protocolo
  `com.epicgames.launcher://apps/<ns>:<item>:<app>?action=install`, que abre a página do jogo nela). Desinstalar e
  cancelar o que ela instalou abrem a biblioteca dela.
- **Legendary sob demanda** (`src-tauri/src/legendary.rs`): versão fixa, baixada por HTTPS da publicação oficial do projeto
  (https://github.com/Heroic-Games-Launcher/legendary), conferida pelo SHA-256 e guardada em
  `<config>\legendary-bin\legendary.exe`. A janela de confirmação diz o que é, a licença, a origem e o tamanho; a conta
  da Epic tem a mesma opção. Para trocar de versão, atualize `VERSION`, `URL`, `SHA256` e `SIZE` juntos (e o script).
  `scripts/get-legendary.ps1` serve só para o desenvolvimento.
- **Licença**: o launcher não distribui o Legendary; o executa como um programa à parte e dá o crédito com o link na tela
  da conta. Se um dia ele passar a ir no instalador, valem as obrigações da GPL-3.0 (texto da licença, código-fonte da versão
  distribuída e nenhuma restrição extra).
- **Jogos já instalados pela Epic Games Launcher** abrem pelo protocolo `...?action=launch&silent=true`.
- **Em execução**: o launcher procura programas dentro da pasta de instalação do jogo (a cada 1,5 s) e conta o tempo
  jogado por conta própria (a Epic não informa). O menu Guia mostra o jogo e oferece "Fechar o jogo".
- Ids dos jogos: `epic:<appName>` (também usados em favoritos e tempo de jogo).

## Limites conhecidos

- API sem suporte: se a Epic mudar, a lista da conta pode falhar (os instalados continuam).
- Não há ainda: instalar, atualizar e desinstalar dentro do launcher, progresso de download da Epic, esconder a janela da
  Epic Games Launcher, tempo de jogo oficial, filtro por loja na Biblioteca.
- A nova Epic Games Launcher (v2, pasta `%LOCALAPPDATA%\com.epicgames.eglv2`) pode guardar os instalados em outro lugar
  que não os manifestos acima. Se um jogo instalado não aparecer como instalado, é aqui que se corrige.
