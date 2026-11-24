# Auditoria do launcher — 23/11/2026

Relatório e changelog da auditoria completa das telas, textos, menus, cores, rolagem, atrasos e código.
Nada foi commitado: tudo está no diretório de trabalho (junto com o trabalho anterior ainda não commitado).

## Como foi feita

1. **Leitura de todas as telas e componentes** (Início, Biblioteca, Detalhes, Configurações e subtelas, Conta Steam, Downloads, teclado virtual, diálogos, tela de abertura de jogo, menu Guia) procurando textos, nomes, posições de menus e inconsistências.
2. **Varredura automática no navegador** (biblioteca de demonstração, 1920×1080), em todas as telas:
   - texto cortado, fonte menor que 15 px, barras de rolagem visíveis, contraste de texto abaixo de 4,5:1;
   - percurso de teclado por cada lista, conferindo se algum item ou título de seção fica cortado ao rolar;
   - foco inicial correto ao abrir cada tela.
3. **Testes de resolução e tamanho:** 1440×1080, 1920×1080 e 2560×1080, com "Tamanho da interface" em 70%, 100% e 150%.
4. **Contraste em todas as combinações:** 5 temas × 8 cores de destaque (240 verificações, incluindo texto sobre o botão primário) e as 9 telas principais em 4 combinações de tema.
5. **Lado Rust:** `cargo clippy` e `cargo test`.

## O que foi corrigido

### Textos e nomenclatura
| Onde | Antes | Agora |
|---|---|---|
| Tempo de jogo | "1 h jogadas", "45 min jogados"; na página do jogo ficava "Tempo de jogo: 12 h jogadas" | "45 min", "3 h 20 min", "120 h"; no destaque da Início, "120 h de jogo" |
| Tamanho do jogo | `12.345678 GB` quando o tamanho vinha quebrado | "12 GB" / "4,5 GB" |
| Contagem na Biblioteca | "1 jogos" | "1 jogo" |
| Títulos das telas | cada subtela de Configurações tinha um padrão: "Conta Steam", "Testar controle", "Personalizar página inicial", "Menu Guia › Opções de energia", "Aba: X", nome do bloco, "Steam" (página do jogo) | trilha única: "Configurações › Conta Steam", "Configurações › Testar controle", "Configurações › Página inicial", "Configurações › Menu Guia › Opções de energia", "Biblioteca › Aba: X", "Página inicial › Continuar jogando", "Detalhes do jogo" |
| Linha "Downloads e espaço" nas Configurações | nome diferente da tela que ela abre | "Downloads e jogos instalados" |
| Tela "Página inicial" | "Blocos", "Editar bloco" no rodapé | "Fileiras" e "Selecionar"; dicas curtas nas linhas |
| Biblioteca › Configurações | "Tamanho dos cards", "Mostrar a contagem nas abas: Sim/Não" | "Tamanho das capas", "Contagem nas abas: Mostrar/Ocultar", com dicas em todas as linhas |
| Edição de aba | "…filtros que ainda não consigo avaliar" (primeira pessoa, plural fixo) | "O launcher ainda não avalia…" com singular/plural corretos |
| Início vazia | "Ative-os em Personalizar página inicial" (nome que não existe mais) | "Ative-as em Configurações › Página inicial" |
| Mensagens soltas | "Não encontrei jogos instalados", "Não encontrei uma conta Steam" | "Nenhum jogo instalado foi encontrado", "Nenhuma conta Steam encontrada" |
| Rodapé dos Downloads | "LB Página" (RB também funciona) | "LB Seção anterior · RB Próxima seção", igual às Configurações |

### Menus no lugar errado
- **"Notificações e overlay da Steam"** ficava dentro da tela "Conta Steam", mas não tem relação com a conta. Foi para **Configurações › Jogos e conta › Steam**, com dica e valores "Ocultar/Mostrar" (como as demais opções).
- **"Página inicial"** (fileiras e destaque) estava em "Jogos e conta". Foi para **Aparência › Telas**, junto com o plano de fundo e as cores.
- **Biblioteca › Configurações, Edição de aba, Página inicial e Fileira** usavam um visual diferente do resto das Configurações (títulos cinza, lista estreita, sem dicas). Passaram a usar o mesmo estilo (títulos com barra de destaque, linhas com dica).
- Biblioteca ganhou **Select › Configurações** no rodapé (o botão já funcionava, mas não aparecia).

### Cores e legibilidade
- **Tema Claro (Daylight):** textos coloridos (valores das opções, títulos de seção, "Baixando", "Suporte completo", avisos) tinham contraste de 2,1 a 2,8:1 — quase ilegíveis, principalmente com destaque laranja. Agora a cor de destaque, de sucesso, de aviso e de perigo têm uma versão própria para texto, escurecida ou clareada até 4,5:1 (`--accent-fg`, `--success-fg`, `--warn-fg`, `--danger-fg`). Fundos e botões não mudam.
- **Botões do controle nas legendas:** o "Y" (branco sobre amarelo) tinha 2,4:1; "A" e "X" ficavam abaixo de 4,5:1. Cores ajustadas e letra escura no amarelo.
- **Texto secundário** (dicas das linhas, legendas) dos temas Meia-noite, OLED e Aurora estava em 4,3:1; clareado para ≥ 4,5:1.
- Resultado: nenhuma combinação de tema × cor de destaque abaixo de 4,5:1 (240 verificações).

### Rolagem e layout
- **Título da seção cortado** ao voltar ao topo de uma aba das Configurações ("CONTROLE" pela metade): a primeira linha de cada seção agora reserva o espaço do título ao rolar.
- **"Tamanho da interface" em 150%:**
  - Conta Steam: a lista ficava com 3,6 rem de altura (uma linha visível). Agora mantém o tamanho normal e mostra toda a lista.
  - Jogos não instalados: a prévia estourava a tela em 68 px.
  - Página do jogo: capa e texto estouravam a tela (86 px). A capa se ajusta à altura, o título limita a 2 linhas e a descrição a 2 linhas quando a interface está muito ampliada.
- **Teclado virtual:**
  - não digitava letras acentuadas (nome de aba "Ação" era impossível). Ganhou uma linha `á à â ã é ê í ó ô õ ú ç`;
  - para a linha extra caber, ficou mais compacto (85% da altura da tela em 16:9, em vez de 96%);
  - em tela ultrawide (2560×1080) ele passava da altura da tela (1219 px numa tela de 1080, já antes da linha extra). Agora se ajusta sozinho à altura (1016 px nessa tela).
- Nenhuma barra de rolagem visível e nenhum texto cortado nas telas auditadas (1440×1080, 1920×1080 e 2560×1080).

### Atrasos
- Entrada de tela: 0,35 s → 0,22 s.
- Troca do plano de fundo: 0,7 s → 0,45 s.
- Repetição dos direcionais ao segurar: primeira repetição 380 → 330 ms, seguintes 120 → 100 ms (launcher e menu Guia).

### Conta Steam
- A linha **"A Steam está fechada ou sem login"** aparecia mesmo com a Steam aberta e logada, porque o registro do Windows (`ActiveUser`) às vezes fica em 0. Agora uma Steam aberta há mais de 1 minuto conta como logada (o mesmo critério já usado ao abrir um jogo).

### Código (Rust)
- `cargo clippy`: 12 avisos → 3 (os 3 restantes são de `transmute` e de um literal de texto no carregamento do XInput; mexem em código `unsafe` e ficaram como estão).
  - funções usadas só em testes marcadas `#[cfg(test)]` (e o import correspondente);
  - `map_or(false, …)` → `is_some_and`, `.filter().last()` → `rfind`, `sort_by` → `sort_by_key`, indentação de comentário de documentação.
- 40 testes unitários passam (1 novo: leitura do jogo em execução pelo log de processos da Steam).

## Também feito hoje (fora da auditoria)

- **Login por QR code que "não logava"** (a mensagem "Entre pela Steam com o QR code… ou configure a chave primeiro" aparecia mesmo depois de aprovar no celular). Eram três problemas encadeados, todos corrigidos e testados com a sua sessão real (320 jogos listados):
  1. O app nunca era informado de que havia login por QR: o estado da conta só olhava a chave de API. Agora a sessão do QR conta como conta configurada.
  2. A troca do token do QR por token de acesso (`GenerateAccessTokenForApp`) era recusada pela Steam (resultado 15, acesso negado), porque o token do QR é do tipo "web". Passou a usar o caminho dos tokens web, o mesmo do site da Steam (cookies da comunidade).
  3. A lista de jogos (`GetOwnedGames`) só aceita GET; o app mandava POST. O token vai pela entrada do `curl`, nunca pela linha de comando.

- **REDlauncher do Witcher 3 abrindo atrás do launcher:** o launcher agora descobre o jogo em execução pelo log de processos da Steam (o registro `RunningAppID` fica em 0 nesses jogos) e traz cada janela nova do jogo para a frente. Confirmado por você no PC.
- **Plano de fundo da Início e da página do jogo** (Configurações › Aparência): degradê do jogo, arte do jogo, capa desfocada (com controle de desfoque) e cor sólida, com intensidade/cor.
- A tela de Configurações não mostra mais o fundo do jogo.

- **Atualização automática da biblioteca da Steam** (para uma compra nova aparecer sem ir às Configurações):
  - a cada 5 minutos, só com a conta configurada e **sem nenhum jogo aberto ou abrindo**, em silêncio (só avisa "Novo jogo na biblioteca: X" quando entra jogo novo);
  - também ao abrir o launcher, 15 s depois de fechar um jogo (tempo de jogo oficial) e quando aparece um jogo instalado que a lista não conhece (comprado e baixado pelo cliente da Steam), no máximo uma vez por jogo;
  - depois de uma falha de rede espera 15 minutos, sem avisos;
  - se nada mudou, não refaz a lista; os minutos jogados por aqui só são descartados quando a Steam já contou a sessão (antes, uma sincronização logo depois de jogar podia fazer o tempo de jogo voltar atrás).

- **Duração dos jogos (HowLongToBeat)** na página do jogo: linha "Duração" com Principal, Principal + extras e Completista.
  - O site não tem API oficial. O módulo `src-tauri/src/hltb.rs` usa os endereços da própria busca do site (`/api/search/site/init` e `/api/search/site`), identifica-se como "Launcher" e não tenta contornar nenhum bloqueio.
  - O jogo é casado pelo AppID da Steam (depois, por nome idêntico); sem certeza, não mostra nada.
  - Testado de verdade contra o site: The Witcher 3 = 51 h 40 min (principal), Hades = 23 h 36 min, jogo inexistente = nada.
  - Cache de 30 dias por jogo (7 dias quando o site não conhece o jogo); falhas são silenciosas, com nova tentativa só depois de 10 min e pausa de 30 min após 3 falhas seguidas.
  - **Configurável** em Configurações › Jogos e conta › "Duração do jogo (HowLongToBeat)":
    - *Mostrar a duração* (liga/desliga);
    - *Onde aparece*: **Junto dos números** (padrão: colunas ao lado de Tempo de jogo, Última vez e Tamanho), **Seção própria** (cartões + barra do quanto você já jogou, com a comparação "1,7× a história principal"), **Linha de texto** (a que existia antes) ou **Dica curta** ("a história leva ~51 h" ao lado do seu tempo de jogo);
    - *Tempos exibidos*: todos, só principal e extras, ou só a história principal.
  - A coluna de informações da página do jogo agora mantém o tamanho normal quando "Tamanho da interface" passa de 100% (em 150% ela passava da altura da tela).
  - A "Seção própria" foi compactada (cartões numa linha, barra mais fina) e a coluna de informações nunca passa do espaço entre a barra de cima e a legenda: com título e descrição longos (caso do Witcher 3) só a descrição é cortada; título, números e botões ficam sempre à vista. Conferido em 70%, 100% e 150%, com os quatro estilos e as três seleções de tempos.
  - Se o site mudar os endereços de novo, a linha deixa de aparecer; o conserto é só atualizar os dois caminhos em `hltb.rs`.

- **Tradução completa do launcher: Português (Brasil), English e Español.**
  - Nova opção **Configurações › Controle e sistema › Idioma do launcher**, separada do "idioma preferido dos jogos" (que foi renomeado para deixar isso claro e continua em Jogos e conta). Na primeira abertura o launcher usa o idioma do Windows se for inglês ou espanhol; senão, português.
  - Tudo que aparece na tela foi traduzido: telas, Configurações e subtelas, menus, legendas dos botões, diálogos, teclado na tela, login por QR, abertura de jogo (etapas da Steam), menu Guia, avisos e mensagens de erro do backend. Também acompanham o idioma: relógio, datas, separador decimal ("4,5 GB" / "4.5 GB"), ordem alfabética, nomes dos temas, cores e abas padrão.
  - Trocar o idioma refaz a interface na hora, mantendo a tela, a seção e o item selecionado; o menu Guia (outra janela) acompanha.
  - Como funciona: o texto em português do código é a chave (`t("Voltar")`); os dicionários ficam em `src/i18n/dict/` (um arquivo por área, com inglês e espanhol lado a lado). Um texto sem tradução aparece em português e avisa no console em desenvolvimento.
  - **Verificador:** `npm run i18n` confere que todo texto passado a `t()` existe nos dois idiomas, que os `{valores}` batem e procura textos em português soltos no código. Estado atual: 628 entradas, 0 erros.
  - Conferido no navegador nos dois idiomas: nenhuma tela mostra texto em português (comparação do que está na tela com o dicionário), nenhum aviso de tradução faltando, e a troca de idioma pela própria tela de configurações.
  - **Novos textos entram sozinhos nas traduções:** `npm run i18n:add` cria as linhas a preencher em `src/i18n/dict/pending.ts`; `npm run i18n` confere tudo; `npm run build` só passa com tudo traduzido. O passo a passo está em `docs/TRADUCAO.md` e as regras para assistentes (Codex, Claude) em `AGENTS.md` / `CLAUDE.md`.
  - **Tela preta na página do jogo (corrigido):** o servidor de desenvolvimento ficou com uma versão antiga em cache de `GameDuration.tsx` (faltava o import de `formatNumber`) e a página do jogo caía com a "Seção própria". O arquivo em disco estava certo; recompilei tudo e repeti um teste de estresse (300 combinações de dados da Steam, 3 idiomas, 4 estilos de duração) sem nenhuma falha. Além disso, cada tela agora tem uma proteção (`ErrorBoundary`): se uma tela falhar ao ser desenhada, aparece "Algo deu errado nesta tela" com o erro e o B volta, em vez da tela inteira preta.
  - **Descrição e gêneros no idioma do launcher:** antes vinham no "idioma preferido dos jogos" e ficavam em português mesmo com o launcher em inglês ou espanhol. Agora a loja é consultada no idioma do launcher (português, inglês ou espanhol); o idioma preferido dos jogos só serve para conferir se o jogo o tem.
  - **"Idiomas não informados" / controle e avaliações sumindo (corrigido):** os dados dos jogos vêm do arquivo local da Steam (`appinfo.vdf`), que ela reescreve de tempos em tempos. Uma leitura feita no meio da gravação vinha vazia e o launcher apagava os dados que já tinha (idiomas, suporte a controle, avaliações). Agora: a leitura é repetida até 4 vezes se vier vazia; uma leitura vazia nunca apaga o que já se sabia (os dados novos se somam aos antigos); e a página de um jogo sem dados relê o arquivo (no máximo a cada 30 s).
  - Fora do alcance: nomes de jogos (vêm da Steam e não são traduzidos) e erros novos do backend que ainda não estejam no dicionário (aparecem em português).

- **Prévia ao vivo nas configurações ("mini-launcher"):** as telas de aparência agora mostram, ao lado da lista, o launcher em miniatura e cada ajuste aparece nele na hora, antes de você sair da tela.
  - **Configurações › Aparência:** duas prévias, *Início* e *Página do jogo* (tema, cor de destaque, plano de fundo com estilo/cor/intensidade/desfoque, tamanho da interface, cantos, brilho).
  - **Configurações › Jogos e conta:** prévia da *Página do jogo* (onde aparece a duração e quais tempos; com a opção ligada e sem dado do site, mostra tempos de exemplo).
  - **Página inicial** (lista e cada fileira): prévia do *Início* (destaque, uma fileira por vez ou todas, estilo, tamanho e quantidade de jogos de cada fileira, jogos não instalados escondidos).
  - **Biblioteca › Configurações:** prévia da *Biblioteca* (tamanho das capas, contagem nas abas, abas visíveis, jogos ocultos, instalados primeiro). *Jogos não instalados* já tinha a sua.
  - **Como é feita:** é a tela de verdade (mesmos componentes, estilos e dados) desenhada no tamanho real da janela e reduzida, e não uma imitação; por isso o "Tamanho da interface" aparece de verdade (testado de 70% a 150%). A prévia não registra foco nem recebe cliques. As fileiras e os jogos da prévia vêm da mesma função da Início (`src/lib/homeRows.ts`), então os dois nunca divergem.
  - Com a interface ampliada, a lista e a prévia ficam no tamanho normal para caberem lado a lado, e a prévia encolhe junto; conferido de 70% a 150%.
  - Código: `src/components/preview/`.

- **Início com o Windows e modo console (Configurações › Controle e sistema › Início com o Windows e modo console).**
  - **Abrir o launcher ao entrar no Windows:** liga/desliga um valor em `HKCU\...\Run` (só deste usuário, sem administrador). A área de trabalho continua por baixo.
  - **Modo console:** coloca `launcher.exe --shell` em `HKCU\...\Winlogon\Shell` (só deste usuário; o valor do Windows para todos fica intocado). Na próxima entrada, o Windows abre direto o launcher, sem Explorer. Ativar pede confirmação (o foco já começa em "Cancelar") e a tela mostra o aviso de risco o tempo todo.
  - **Proteções:** (1) `--shell` é só um *vigia*, que abre o launcher de verdade e o **reabre se ele fechar ou travar**; (2) 3 quedas rápidas seguidas (< 20 s) ou erro ao abrir: o vigia **abre o Explorer** e sai; (3) se alguém abrir o Explorer por fora (Ctrl+Alt+Del › Executar nova tarefa › explorer), o vigia para de reabrir; (4) ao ativar, grava `Voltar-ao-Explorer.bat` na pasta de configuração (sem ele, o modo não ativa); (5) um shell personalizado que já existia é guardado e devolvido ao desligar; (6) se o launcher mudar de pasta, o registro é corrigido (só quando o caminho antigo não existe mais); (7) o início automático não abre uma segunda cópia.
  - **"Sair para a área de trabalho":** agora **primeiro abre o Explorer** (espera até 15 s a área de trabalho aparecer), depois minimiza as janelas e fecha o launcher; sob o vigia, sai com um código especial para ele entregar a área de trabalho.
  - **No modo de desenvolvimento (`tauri dev`) o recurso fica indisponível** (o executável de teste depende do servidor do Vite): a tela avisa e nada é gravado no registro.
  - Sem Explorer: sem barra de tarefas, menu Iniciar, relógio e bandeja; programas da inicialização do Windows (`Run`, pasta Inicializar) não abrem; o launcher abre a Steam sozinho. Detalhes e recuperação em `docs/MODO-CONSOLE.md`.
  - Código: `src-tauri/src/startup.rs` (8 testes, usam chaves de teste, não o registro real); tela `src/screens/StartupSettings.tsx`.
  - **Não testado de verdade:** o vigia rodando como shell do Windows (não dá para testar sem trocar o shell; a lógica de decisão tem teste de unidade). Faça o primeiro teste num usuário do Windows separado.

- **Painel do sistema (volume, saída de áudio, rede, bateria do controle), para o modo console.**
  - **Ao lado do relógio** (em todas as telas): volume (ou "Mudo", em vermelho), rede (Wi-Fi com sinal, cabo ou sem conexão; vermelho se não há internet), bateria do controle sem fio mais fraca (vermelho se baixa ou vazia) e uma engrenagem. Subindo o foco (direcional para cima) chega-se ao conjunto; **A** abre o painel **Sistema**.
  - **Painel Sistema:** *Volume* (esquerda/direita ajustam de 5 em 5, **A** silencia), *Saída de áudio* (esquerda/direita ou **A** trocam entre TV, fones etc. e valem para jogos, mídia e comunicação), e, só para ler, rede e bateria de cada controle. **B** fecha. Volume e rede/bateria atualizam a cada 2 s com o painel aberto e a cada 5 s fora dele.
  - **No menu Guia** (botão Guia, por cima do jogo): a mesma seção "Sistema", para mexer no volume e na saída de áudio sem sair do jogo.
  - **Como funciona:** `src-tauri/src/system.rs` usa as APIs de áudio do Windows (volume do dispositivo padrão e lista de saídas), o gerenciador de redes e a API Wlan (nome e sinal do Wi-Fi) e o XInput (bateria). A troca de saída usa a interface interna `IPolicyConfig` do Windows (a mesma que os programas de troca de áudio usam; não há API pública para isso). Cada parte falha sozinha e a tela mostra o que conseguiu ler.
  - **Conferido no PC real:** o launcher leu volume, saídas (TV, Realtek, headset), cabo de rede e controle com fio, nos dois lugares (topo e menu Guia); a escrita foi testada com os mesmos valores que já estavam em uso (volume e saída atuais), sem mudar nada. A troca real para *outra* saída e o Wi-Fi/bateria sem fio **não** foram exercitados (PC com cabo e controle com fio).
  - A prévia ao vivo das configurações mostra os indicadores como desenho (sem foco). Código: `src/components/System.tsx`, `src/store/system.ts`.

- **Wi-Fi e Bluetooth no painel Sistema (fase 2) + ajustes do topo e do menu Guia.**
  - **Topo:** o ícone de engrenagem (que parecia um sol e sugeria brilho) saiu; o conjunto de indicadores é o botão (ganha destaque com o foco). Ícones refeitos: cabo de rede (conector RJ45) e controle de videogame (a bateria aparece pela cor e pelo texto).
  - **Menu Guia:** a seção "Sistema" ficou só com *Volume* e *Saída de áudio* (sem as linhas soltas de rede e controle, que pareciam fora de lugar).
  - **Painel Sistema:** novas linhas *Wi-Fi* e *Bluetooth*, que abrem telas próprias (B volta ao painel, e o foco volta para a linha de onde veio).
  - **Wi-Fi:** lista as redes ao alcance (sinal, "Senha salva", "Aberta", "Protegida por senha"). **A** conecta: rede salva ou aberta conecta direto; rede nova pede a senha no teclado da tela (agora com modo senha: texto escondido, **RT** mostra, **Select** troca para símbolos, sem cortar espaços); rede conectada pergunta se quer desconectar. **X** procura de novo, **Y** esquece a rede salva (com confirmação). Se a conexão falha, o perfil recém-criado é apagado. Redes de empresa/escola (WPA-Enterprise) não são aceitas. A senha só passa pela memória (vira o perfil do Windows) e nunca vai para log.
  - **Bluetooth:** mostra os emparelhados (Conectado/Desconectado; o mesmo aparelho visto no Bluetooth clássico e no de baixo consumo aparece uma vez). **Procurar novos dispositivos** leva ~30 s (é o tempo da varredura do Windows) e lista o que achou; **A** em um deles emparelha (modo "sem código": serve a fones, caixas e a maioria dos controles). **A** em fone/caixa emparelhado conecta ou desconecta; controles e teclados conectam sozinhos ao serem ligados. **Y** esquece o dispositivo (com confirmação).
  - **Conferido no PC real:** Bluetooth listou os dois fones emparelhados (JBL Live 770NC e QCY Melobuds ANC) e a busca achou uma TV Samsung por perto; Wi-Fi respondeu corretamente "sem adaptador" (o PC está no cabo). Testes: 65 passam (perfis de Wi-Fi, segurança, mistura de listas do Bluetooth).
  - **Não testado de verdade:** conectar/desconectar um fone, emparelhar um dispositivo e qualquer conexão Wi-Fi (não há adaptador Wi-Fi neste PC; mexer nos fones trocaria o áudio do PC). Telas e fluxos foram testados no navegador com dados simulados.
  - Código: `src-tauri/src/wifi.rs`, `src-tauri/src/bluetooth.rs`, `src/components/SystemWireless.tsx`.

- **Ajustes seguintes do painel do sistema.** Ícone de **Bluetooth** ao lado do relógio (aparece só se o PC tem adaptador; fica apagado sem dispositivos conectados e mostra a quantidade quando há); as linhas **Wi-Fi** e **Bluetooth** do painel só aparecem se o PC tem o adaptador (o status do backend agora informa `wifiAdapter` e `bluetooth {adapter, connected}`); no menu Guia, **"Energia do PC" é sempre a última seção** (Launcher, Sistema, Energia). Conferido no launcher real: Bluetooth com 1 dispositivo conectado, sem adaptador Wi-Fi, ordem das seções do Guia correta. Os testes do registro (modo console) deixaram de disputar uma chave-mãe comum (falha intermitente corrigida).

- **Ícones do topo configuráveis (Configurações › Controle e sistema › Ícones no topo).** Quatro opções, cada uma *Exibir/Ocultar*: Volume, Rede, Bluetooth e Bateria do controle (o padrão é mostrar todos; a escolha fica salva). A prévia ao vivo (Início) aparece ao lado da lista e acompanha cada mudança. Com todos ocultos, o conjunto some do topo; o painel Sistema continua no menu do botão Guia (a tela avisa). Código: `src/store/topIcons.ts`.

- **Música de fundo (Configurações › Controle e sistema › Áudio).**
  - As 5 faixas do Codex entraram no projeto: os loops em `src/audio/music/*.ogg` (os que o launcher toca) e os MP3 originais em `assets/trilha-original/`, para versionar.
  - **Música de fundo:** *Desligada* (padrão), *Todas (embaralhadas)* ou uma faixa só (repete sem parar); **Volume da música** de 0 a 100% (de 10 em 10, padrão 40%; aparece com a música ligada).
  - **Quando toca:** só com o launcher em primeiro plano e **sem jogo aberto nem abrindo**. Quando um jogo abre, o launcher perde o foco ou a janela some, a música sai suavemente (0,7 s); ao voltar, entra suavemente. Trocar de faixa ou de volume vale na hora.
  - O WebView2 foi configurado para liberar o áudio sem exigir um clique (`--autoplay-policy=no-user-gesture-required`, em `tauri.conf.json` e `guide.rs`, que precisam ser iguais). Conferido no launcher real: tocou sem erro, com o volume pedido.
  - **Efeitos sonoros:** a opção de ligar e desligar já existia, na mesma seção (*Efeitos sonoros: Ativados/Desativados*); os 8 sons que o Codex criou (mover, selecionar, voltar, abrir, operação, abrir jogo, sucesso, aviso) já estavam no projeto (`src/audio/effects`).
  - **Menu Guia:** com o Guia aberto e sem jogo rodando, a música **continua** (o Rust avisa o launcher quando o menu abre e fecha; depois de fechar há 3,5 s de tolerância até o launcher recuperar o foco). Com jogo aberto, nada toca. Conferido no launcher real: com o Guia aberto (launcher sem foco) a música seguiu tocando.
  - **Repetição sem emenda:** a música agora usa o Web Audio (a faixa é decodificada uma vez e repetida pelo motor de áudio, amostra por amostra), e não o `<audio loop>`, que fazia uma pequena parada ao voltar ao início. No modo *Todas*, a faixa seguinte é agendada para o instante exato em que a atual termina (conferido: troca agendada e executada no tempo certo). As pontas dos loops também foram medidas: começo e fim se encaixam (diferença de amplitude desprezível).
  - Código: `src/audio/music.ts`; faixas em `src/audio/music/LEIAME.md`.

- **Legenda do rodapé invadindo as Configurações (corrigido).** Causa: nas telas com prévia (Aparência, Jogos e conta e, desde os ícones do topo, Controle e sistema) a lista tinha altura de 100% **mais** a margem de cima (1,2rem) e passava essa margem por baixo da legenda. Agora a altura desconta a margem. Também corrigidos: (1) em telas largas (ultrawide 2560×1080) as duas prévias da Aparência entravam 105 px na legenda; a largura delas agora respeita a altura que sobra; (2) com "Tamanho da interface" em 150% a legenda da Biblioteca (6 botões) saía pela esquerda da tela (40 px no espanhol); a legenda agora cresce menos que o resto acima de 125%, o espaço entre os botões diminui e, se ainda não couber, quebra em duas linhas. Conferido em 14 telas, 3 idiomas, "Tamanho da interface" 70%, 100%, 125% e 150%, e em 1920×1080 e 2560×1080: nenhuma legenda fora da tela nem sobre a lista ou a prévia.

- **Volume sincronizado entre o menu Guia e o launcher (corrigido).** O menu Guia é uma janela à parte e o indicador do topo só se atualizava na consulta periódica (5 s, e só com a janela visível). Agora, quem muda o volume, o mudo ou a saída de áudio faz o Rust avisar as duas janelas (`system-volume` e `system-status`), e cada uma atualiza o que mostra na hora (uma rajada local não é sobrescrita por um aviso mais antigo). Conferido no launcher real: um aviso de volume enviado pelo Guia mudou o indicador do topo na hora, e o aviso emitido pelo próprio comando do Rust também (sem alterar o volume real).

- **Menu Guia: a seleção saltava para "Sair para a área de trabalho" ao mexer no volume (corrigido).** Causa: o menu atualiza o estado a cada segundo e, a cada atualização, devolvia o foco ao último item da lista de cima que tinha sido selecionado; as linhas Volume e Saída de áudio não eram lembradas, então o foco "voltava" para o item de cima e as setas pareciam subir. Agora a linha do Sistema que está com o foco também é lembrada. Conferido no launcher real: da primeira linha até o Volume e 12 toques rápidos de esquerda/direita, sem nenhum salto de foco (antes, ocorria na atualização seguinte).

- **O menu Guia ignorava o tema e o idioma do launcher (corrigido).** Causa: o menu é uma janela à parte e, de propósito, tem a **própria pasta de dados** (`data_directory` em `guide.rs`), com o próprio `localStorage`, vazio. Ele sempre abria com o tema padrão (cor de destaque, cantos, brilho e tamanho) e em português, e a sincronização de idioma por evento de `localStorage` que existia nunca chegava a ele (não compartilham o armazenamento). Agora o launcher publica o tema e o idioma no Rust (`sync_settings`), que os guarda e os repassa ao menu (`get_synced_settings` ao abrir e o evento `settings-sync` a cada mudança). Conferido no launcher real: o Guia abriu com a cor de destaque, os cantos e o brilho do launcher (antes: roxo padrão), acompanhou uma mudança de cor ao vivo e a troca de idioma (en e pt). Código: `src/lib/settingsSync.ts`.

- **Atualizações de jogos (nova distinção entre "atualizar" e "instalar").**
  - **Atualização disponível:** jogo instalado cujo manifesto da Steam marca "precisa atualizar" sem baixar ainda: continua jogável, ganha o selo **Atualização** no cartão (base à esquerda, na cor de destaque), a nota "Há uma atualização para este jogo. A Steam vai baixá-la antes de abrir." na página do jogo, "Atualização disponível" no subtítulo e "Instalado · atualização disponível" no menu de opções.
  - **Atualizando:** jogo que já estava instalado (bit "instalado" ligado) e está baixando ou na fila passa a mostrar **"Atualizando… X%"** (cartão/subtítulo, página do jogo, menu de opções) no lugar de "Baixando…"; na tela Downloads o item ganha a etiqueta *Atualização*.
  - **Correção de risco:** antes, "Cancelar download" (que é remover o jogo na Steam) aparecia também para um jogo **já instalado** que estava atualizando, e apagaria o jogo inteiro. Agora o botão some na página do jogo e no menu de opções, na tela Downloads aparece um aviso ("Atualizações são feitas pela Steam e não podem ser canceladas aqui."), e a própria ação de cancelar recusa jogos em atualização.
  - **Ao abrir um jogo com atualização:** aviso imediato ("Este jogo tem uma atualização: a Steam vai baixá-la antes de abrir."), a tela de abertura explica que a espera é a atualização (com o percentual quando a Steam já está baixando), e o aviso de "abertura não confirmada" fica adiado enquanto a atualização andar (até 3 h, em vez de 20 min).
  - **Conferido:** tabela de manifestos (instalado, atualização pendente, em andamento, instalação nova, completo, vazio) e a interface com dados simulados no navegador. **Não conferido com uma atualização real da Steam:** os manifestos desta máquina (4 jogos) não tinham nenhuma atualização pendente; a regra segue o significado documentado dos bits de `StateFlags`.
  - Código: `src/lib/merge.ts` (`installState`), `src/lib/downloads.ts`, `src/store/library.ts`.

- **Redesenho, fases 1 e 4 (auditoria de UX do Codex; ver `docs/AVALIACAO-AUDITORIA-UX.md`).** Cabeçalho com botões de navegação focáveis (Início, Biblioteca, Downloads, Configurações; o destino atual fica destacado e o "voltar" leva ao Início); tela de Conta com a rotina primeiro (sincronizar, hora da última atualização, opções avançadas recolhidas, confirmação ao sair do login). Conferido no navegador: foco subindo do conteúdo até o cabeçalho, indo de um botão a outro e abrindo cada destino; espaço do cabeçalho em 3 idiomas e 70% a 150% (a 150% o cabeçalho cresce menos para caber).

- **Redesenho, fase 2: Configurações em 5 grupos.** Aparência · Jogos e biblioteca · Conta Steam · Controle e áudio · Sistema e energia (ver `docs/AVALIACAO-AUDITORIA-UX.md`, UX-28). A linha de sincronizar a biblioteca também aparece em Conta Steam, e o Select na Biblioteca abre as Configurações já na linha da Biblioteca. Conferido no navegador: conteúdo, foco inicial e prévias de cada aba, sem sobreposição com a legenda, e as abas numa linha só em PT, EN e ES de 70% a 150% (acima de 118% elas crescem menos que o resto).

- **Redesenho, fase 3: Biblioteca com busca e ordem focáveis (UX-06, UX-23).** Abas, "Buscar" e "Ordem" são botões; seletor de ordem com a opção ativa e "Instalados primeiro"; contagem com escopo e "Ver todos os jogos" (escopo que ignora as abas); estado vazio da busca com "Buscar em todos os jogos", "Editar busca" e "Limpar busca". Conferido no navegador: trocar de aba, ordenar, ampliar o escopo, buscar sem resultado (com e sem aba restritiva), voltar de um jogo (o foco volta ao mesmo cartão) e subir/descer entre grade, barra e cabeçalho; a barra cabe em PT, EN e ES a 100% e 150%.

- **Biblioteca: acabamento da fase 3.** Os botões "Buscar" e "Ordem" ficaram só texto (sem as bolinhas X e Y dentro do botão) e o rodapé deixou de repetir "X Buscar" e "Y Ordenar" (os atalhos continuam). "Todos os jogos" deixou de ser uma aba escondida e salva: é um estado da tela, com uma etiqueta "Todos os jogos" na barra de abas, que não é guardado (a Biblioteca sempre reabre numa aba). Antes, com uma só aba configurada, o escopo "todos" deixava a barra sem nenhuma aba destacada.

- **Redesenho, fase 5.** Problema de desinstalação persistente na página do jogo com "Tentar desinstalar de novo"; fileiras ocultas do Início legíveis ("Fileira oculta"); ações do jogo logo abaixo do título (e na prévia). Conferido no navegador: falha, demora da Steam, desinstalando (foco em Voltar até terminar) e o layout em 18 combinações de idioma, escala e jogo.

- **Segunda auditoria de UX (Codex, rodada 2).** Desligamento programado ligado à fila e só com conclusão confirmada, diálogos empilhados, Start só com foco num cartão, Y e Ordem com o mesmo seletor, escopo "todos" desfeito ao limpar a busca, categorias focáveis, "Voltar ao jogo" como ação principal, A em Instalados abre o jogo (Start desinstala) e outros ajustes. Veredito de cada achado em `docs/AVALIACAO-AUDITORIA-UX.md` (segunda rodada).

## O que NÃO foi feito / limites

- **Inspeção visual de pixel:** o painel de prévia do navegador tem resolução muito baixa. A auditoria visual foi feita por medição (DOM, contraste, rolagem, tamanhos) e leitura de código, não por captura de tela em alta resolução. Vale uma olhada sua nas telas Configurações › Aparência, Biblioteca › Configurações e no teclado virtual.
- **Launcher real:** as mudanças de interface foram testadas no navegador (biblioteca de demonstração). O launcher real recarregou com elas, mas fluxos que dependem da Steam (abrir jogo, contrato, menu Guia, login por QR) não foram exercitados de novo.
- **Login por QR:** continua sem teste real com o app da Steam no celular.
- **Pausar/retomar downloads:** não implementado (a Steam só permite pausar de verdade pelo cliente dela).
- **Código morto mantido:** o caminho "contrato dentro do launcher" (`CONTRACT_IN_LAUNCHER = false` em `LaunchOverlay.tsx` e o código Rust ligado a ele). Foi mantido por ser a única forma de ler o contrato no launcher caso a janela da Steam volte a dar problema; pode ser removido quando você decidir.
- **Ferramentas de desenvolvimento** (`guide.trigger`, `guide.key`, `guide.eval*`): continuam no código, mas só existem em build de desenvolvimento (`debug_assertions`), nunca no instalador final.
- **Proporções muito largas** (ultrawide, 2560×1080): todas as telas auditadas cabem; o teclado virtual era o único que não cabia e foi corrigido.
- **Nada commitado.** A branch `feat/wishlist-prices` tem junto o trabalho anterior (Downloads, Guia, QR, etc.) e o do Codex.

## Arquivos principais alterados na auditoria

`src/styles/global.css`, `src/theme/themeStore.ts`, `src/theme/themes.ts`, `src/components/Chrome.tsx`, `src/components/OnScreenKeyboard.tsx`, `src/screens/` (Account, GameDetail, GamepadTest, GuidePowerSettings, Home, HomeBlockEdit, HomeLayout, Library, LibrarySettings, LibraryTabEdit, Settings, Downloads), `src/input/gamepad.ts`, `src/guide/xinputBridge.ts`, `src/store/library.ts`, `src-tauri/src/steam.rs`, `guide.rs`, `launch.rs`, `pointer.rs`.
