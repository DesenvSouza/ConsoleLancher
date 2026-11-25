# Privacy / Privacidade

## English

Console Launcher has **no telemetry, analytics, advertising or accounts of its own**. The author receives no data. The program only
talks to the services below, from your PC, to provide the feature named.

| Service | When | What is sent |
|---|---|---|
| Steam (`api.steampowered.com`, `store.steampowered.com`, `steamcommunity.com`, `login.steampowered.com`, `s.team`) | when you connect a Steam account, list your library or open a game page | your sign-in (QR code) or Web API key, your SteamID, game IDs, language |
| Steam store search | for Epic games, when a library tab filters by controller support | game names |
| Steam image server (`cdn.cloudflare.steamstatic.com`) | when covers and backgrounds are shown | game IDs |
| Epic Games | when you connect an Epic account | your sign-in (on Epic's own page), library and catalog requests; covers are loaded from Epic |
| HowLongToBeat (`howlongtobeat.com`) | on a game page, while **"Show the length"** is on (on by default; turn it off in the setup wizard or in Settings) | the game name |
| GitHub | update checks (turn off in Settings › System and power) and the optional download of Legendary, only when you ask | a normal web request (your IP address and the program's identification) |

Stored only on your PC, in your Windows profile: settings; Steam and Epic sessions, encrypted by Windows (DPAPI); an optional Steam
Web API key, in a plain text settings file. Signing out removes the session. Uninstalling removes the program; your settings folder
(`%APPDATA%\app.launcher.desktop`) can be deleted by hand.

## Português

O Console Launcher **não tem telemetria, estatísticas, publicidade nem contas próprias**. O autor não recebe dado nenhum. O programa
só fala com os serviços abaixo, a partir do seu PC, para fazer o que está indicado.

| Serviço | Quando | O que vai |
|---|---|---|
| Steam | ao conectar a conta, listar a biblioteca ou abrir a página de um jogo | o seu login (QR code) ou chave da Web API, o SteamID, números dos jogos, idioma |
| Busca da loja da Steam | para jogos da Epic, quando uma aba filtra por suporte a controle | nomes de jogos |
| Servidor de imagens da Steam | ao mostrar capas e fundos | números dos jogos |
| Epic Games | ao conectar a conta | o login (na página da própria Epic) e consultas de biblioteca e catálogo; as capas vêm da Epic |
| HowLongToBeat | na página do jogo, com **"Mostrar a duração"** ligado (vem ligado; desligue no assistente ou nas Configurações) | o nome do jogo |
| GitHub | procura de atualizações (desligue em Configurações › Sistema e energia) e o download opcional do Legendary, só quando você pede | um pedido comum da internet (endereço IP e identificação do programa) |

Ficam só no seu PC, no seu perfil do Windows: as configurações; as sessões da Steam e da Epic, cifradas pelo Windows (DPAPI); uma
chave da Web API da Steam, se você informar, em um arquivo de configuração em texto comum. Sair da conta apaga a sessão.
Desinstalar remove o programa; a pasta de configurações (`%APPDATA%\app.launcher.desktop`) pode ser apagada à mão.
