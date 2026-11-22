# Plano do launcher

## 1. Integração com a Steam

**Princípio:** o cliente da Steam continua rodando em segundo plano (`steam.exe -silent`). Ele cuida de
downloads, DRM, nuvem de saves e conquistas. O launcher substitui apenas a **interface** do Big Picture.

| Função | Como |
|---|---|
| Listar jogos **instalados** | Ler `Steam\steamapps\libraryfolders.vdf` (todas as bibliotecas/discos) e cada `appmanifest_<id>.acf`. |
| Listar jogos **da conta, mesmo não instalados** | Steam Web API `IPlayerService/GetOwnedGames` (chave grátis em steamcommunity.com/dev/apikey + SteamID64 lido de `config\loginusers.vdf`). Exige "detalhes do jogo" visíveis no perfil, ao menos na primeira sincronização. Guardamos em cache no SQLite. |
| Jogar | `steam://rungameid/<id>` |
| Instalar | `steam://install/<id>` (a Steam abre a fila de download) |
| Desinstalar | `steam://uninstall/<id>` — a Steam mostra a **própria** confirmação; veja "Pontos de atenção". |
| Progresso de download | Acompanhar `appmanifest_<id>.acf` (`StateFlags`, `BytesDownloaded`, `BytesToDownload`) e a pasta `downloading`. |
| Tempo de jogo | `GetOwnedGames` (`playtime_forever`) + contagem própria por processo. |
| Capas / heroes / logos | CDN da Steam (`library_600x900.jpg`, `library_hero.jpg`, `logo.png`) com fallback no SteamGridDB. |
| Fila de downloads / pausar | Leitura dos manifestos; pausar/priorizar via `steam://` é limitado. |

### Pontos de atenção
- A confirmação de desinstalar/instalar (escolha de disco, espaço) é uma janela **da Steam**. Para ser 100%
  controlável sem mouse, vamos testar: (a) deixar o Steam Input cuidando do controle no desktop da Steam;
  (b) como alternativa, o launcher mostrar a sua própria confirmação e então automatizar a da Steam.
- O que **não** dá para replicar: loja integrada, comunidade/workshop e chat da Steam. Para esses casos
  abriremos a Steam (ou o navegador) sob demanda.
- Steam Input pode remapear o controle para um "gamepad virtual". Precisamos validar a navegação do
  launcher com a Steam aberta em segundo plano.

### Como a biblioteca real funciona (M2)
- **Ao abrir o app:** lê a Steam local (registro + `libraryfolders.vdf` + `appmanifest_*.acf`). A cada 3 s relê os manifestos
  (instalações, progresso, desinstalações) e a cada 2 s o `RunningAppID` (jogo em execução).
- **Jogos da conta (não instalados):** só quando o jogador pede. A Steam hoje devolve uma página de login para a lista
  pública, então o caminho confiável é a **chave gratuita da Web API** (`IPlayerService/GetOwnedGames`).
- **Configuração da conta (sem arquivos):** **Select › Conta Steam**. A tela mostra a conta logada na Steam, abre a página
  de criação da chave dentro da própria Steam (`steam://openurl/...`, já logada), e tem **teclado na tela** com botão
  **Colar** (também aceita o teclado físico). A chave é **validada na hora** buscando a biblioteca e só é salva se funcionar.
  Fica em `%APPDATA%\app.launcher.desktop\config.json`, **por conta Steam** (`accounts.<steamid64>.apiKey`); a tela só
  recebe os 4 últimos caracteres. `STEAM_API_KEY` no ambiente vale para qualquer conta (desenvolvimento). **Nunca versionar a chave.**
- **Rede:** feita pelo `curl.exe` do Windows (sem embutir pilha TLS). O front-end também carrega as capas do CDN da Steam.
- **Tempo de jogo:** o oficial vem da sincronização; as sessões jogadas pelo launcher são somadas até a próxima sincronização.

## 2. Marcos

| # | Entrega |
|---|---|
| M1 | **Feito:** esqueleto, navegação por controle, temas, biblioteca de mentira. |
| M2 | **Feito (a validar com jogos reais):** scanner da Steam (instalados em todas as bibliotecas + jogos da conta), estado/progresso de download pelos manifestos, jogo em execução (`RunningAppID`), tempo de jogo, capas do CDN da Steam. **Diferença do plano:** o cache fica no armazenamento do app (localStorage), não em SQLite — suficiente por ora. |
| M3 | Arte (CDN + SteamGridDB), busca com teclado na tela, coleções, ordenação e filtros. |
| M4 | Leitura de XInput no Rust (atalho global), menu rápido/overlay, volume, rede, bateria, energia. |
| M5 | Epic, GOG, Xbox/Game Pass, emuladores. |
| M6 | Início com o Windows (Agendador) e modo shell, instalador, script de recuperação. |
| M7 | Polimento: sons, editor de temas completo (importar/exportar JSON), desempenho. |

## 3. Modo shell (M6)

1. **Fase 1 (sem risco):** tarefa agendada no logon abre o launcher em tela cheia por cima do Explorer.
2. **Fase 2:** `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon` → `Shell` (REG_SZ) = caminho do exe.
   Vale só para o usuário atual; outra conta de administrador mantém a área de trabalho normal.
3. **Recuperação:** Ctrl+Alt+Del → Gerenciador de Tarefas → Executar nova tarefa → `explorer.exe`; ou, pela
   outra conta, remover o valor `Shell`. Teremos `scripts/desfazer-shell.ps1` pronto antes de ativar.

## 4. Princípios de interface

- Nada depende de mouse ou teclado (teclado existe só para desenvolvimento).
- Texto mínimo de ~24px em 1080p (1rem = 1/80 da largura), foco sempre visível, margens seguras para TV.
- Animações só com `transform`/`opacity`; sem blur pesado, para rodar em qualquer GPU.
- Tudo que for visual vem de variáveis CSS (`--accent`, `--radius`, ...), então temas são só dados.
