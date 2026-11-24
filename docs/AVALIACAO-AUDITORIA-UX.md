# Avaliação da auditoria de UX/UI do Codex (23/11/2026)

Fonte: `auditoria-ux-ui-console-launcher.md` (35 achados). Cada achado foi conferido no código e, quando possível, na interface. Legenda: **feito** = corrigido e testado; **parcial** = parte feita; **não feito** = válido ou discutível, mas fica para uma rodada própria; **não procede** = o código ou o teste não confirma; **sem como verificar** = exige hardware/pessoas.

## Feito

| Achado | Veredito | O que foi feito |
|---|---|---|
| UX-01 cancelar download | Válido | A parte das atualizações já tinha sido corrigida (cancelar uma atualização apagaria o jogo: botão removido, aviso na fila, barreira no `cancelInstall`). Faltava a confirmação no **detalhe** e no **menu de opções**: agora os dois pedem confirmação ("Cancelar o download de X?", foco em "Continuar baixando"). "Pausar atualização" não existe na integração com a Steam: não foi inventado. |
| UX-02 desligamento programado | Válido (confirmado no código) | O cancelamento descartava o erro do Windows e a tela dizia "cancelado" com o desligamento ainda valendo: agora a tela só muda se o Windows confirmou, senão mantém a contagem e avisa. A contagem final só aparece depois que o Windows aceita o agendamento (se recusar, o PC não desliga e avisa). Não agenda com jogo aberto (espera) e cancela se um jogo abrir durante a contagem. Aviso "Desliga ao concluir os downloads" no topo de qualquer tela. |
| UX-03 destinos principais | Válido | Segunda rodada: o cabeçalho ganhou botões **Início · Biblioteca · Downloads** (à esquerda) e **Configurações** (à direita), todos alcançáveis por direcional e A, com o destino atual destacado. Os atalhos X, Y e Select continuam. Funciona também com o mouse. O cabeçalho cresce menos que o resto acima de 125% para caber em PT e ES. As telas internas mantêm o título. |
| UX-31 conta Steam | Válido | Segunda rodada: com a conta conectada, o foco inicial é **Sincronizar biblioteca agora** (com a hora da última atualização); trocar de conta, sair e a chave da Web API ficam em **Opções avançadas** (recolhidas). Sair do login por QR agora pede confirmação. As instruções de primeiro acesso só aparecem sem login. |
| UX-28 Configurações | Válido | Terceira rodada: as 3 abas viraram **5 grupos** (LB/RB): **Aparência** (cores, fundo, tamanho/estilo, ícones do topo; com as duas prévias), **Jogos e biblioteca** (página inicial, Biblioteca, Downloads, não instalados, duração do jogo; com a prévia da página do jogo), **Conta Steam** (conta, sincronizar, notificações da Steam), **Controle e áudio** (idioma do launcher e dos jogos lado a lado, testar controle, efeitos e música) e **Sistema e energia** (tela cheia, Menu Guia, início com o Windows e modo console, sair). Na Biblioteca, **Select abre as Configurações já na linha da Biblioteca**. As abas ficam numa linha só nos 3 idiomas e de 70% a 150%. |
| UX-06 / UX-23 Biblioteca | Válido | Quarta rodada: na Biblioteca, as **abas, "Buscar" e "Ordem" viram botões** (direcional + A; LB/RB, X e Y continuam). "Ordem" abre um seletor com as 4 opções (a ativa marcada) e o agrupamento "Instalados primeiro". A contagem mostra o escopo ("7 de 12 jogos · Instalados") e há **"Ver todos os jogos"**, que ignora as abas. No estado vazio da busca: mensagem com o escopo e botões **"Buscar em todos os jogos"**, **"Editar busca"** e **"Limpar busca"**. |
| UX-07 / UX-22 / UX-25 desinstalar, fileiras, detalhe | Parcial → feito | Quinta rodada: (1) na página do jogo, **"Desinstalando {jogo}…"** e, se a desinstalação falhar ou a Steam não confirmar, o aviso **permanece na página** ("O jogo continua instalado") com o botão **"Tentar desinstalar de novo"** (antes só havia uma notificação que sumia); ao terminar, o foco vai para "Instalar". (2) No editor das fileiras do Início, a fileira oculta deixou de ficar apagada: o nome fica legível e o estado aparece em texto ("Fileira oculta"). (3) Na página do jogo, o estado e as **ações (Jogar/Instalar, Favoritar, Desinstalar, Voltar) ficam logo abaixo do título**, antes da descrição e das informações; a prévia da página do jogo acompanha. Conferido em PT, EN e ES de 70% a 150%: nada passa da legenda. |
| UX-09 "Última vez" | Válido | Antes era gravada ao clicar em Jogar, mesmo se a abertura falhasse. Agora só quando o jogo aparece em execução. |
| UX-11 dicas nas configurações | Válido | O rodapé das Configurações ganhou "◀ ▶ Ajustar" ao lado de "A Selecionar". |
| UX-13 contraste do botão de perigo | Parcial | Branco sobre #FF5470 dá 3,11:1: passa como texto grande em negrito (3:1), então OLED/Midnight/Brasa ficam como estão. O tema Aurora (2,74:1) falhava: agora usa texto escuro quando o branco ficaria abaixo de 3:1. |
| UX-15 sair para a área de trabalho | Válido | A saída pelas Configurações agora pede a mesma confirmação do Guia (foco em "Continuar no launcher"). |
| UX-16 tela cheia | Válido | A linha mostra o estado ("Tela cheia: Ativada/Desativada"), lido da janela, e acompanha o F11. |
| UX-17 teclado virtual | Válido | O foco inicial era "Colar" (A colaria um texto que a pessoa não vê). Agora começa numa tecla do meio. |
| UX-18 dicas dos diálogos | Válido | "A Confirmar" virou "A Selecionar" (o foco começa em Cancelar). |
| UX-20 movimento | Válido | Nova opção **Reduzir movimento** (Aparência): sem zoom no item selecionado, sem transições e sem rolagem animada; também vale a preferência do Windows. Sincronizada com o menu Guia. |
| UX-26 atalho de Downloads | Válido | O atalho do Início agora abre a fila, e não a última aba visitada. |
| UX-27 unidades | Válido | Os detalhes usavam base 1000 e a lista de armazenamento, 1024 (65,0 GB × 70 GB para o mesmo jogo). Agora todos usam 1024. |

## Parcial

| Achado | O que foi feito / o que ficou |
|---|---|
| UX-04 acessibilidade | Cartões de jogo agora têm nome e estado acessíveis ("Nome, Instalado") e os itens acionáveis têm papel de botão. Não feito: sincronizar o foco do Windows com o foco visual, Tab/Shift+Tab e testes com NVDA/Narrador (o produto é para controle em TV). |
| UX-06 busca | Concluído na quarta rodada (ver acima). |
| UX-24 capas | O estado de atualização entrou no selo do cartão e no nome acessível. Legenda persistente do item focado não foi feita. |
| UX-29 Guia | Se a leitura do menu falhar, aparece "Não foi possível carregar o menu" com "Tentar de novo" e "Fechar o Guia" (antes ficava em "Carregando…" para sempre). |
| UX-30 sistema | O rodapé do painel Sistema diz "A Selecionar" (A faz coisas diferentes por linha; cada linha já traz a sua instrução). |

## Não procede ou não reproduzido

- **UX-05 (voltar ao item de origem):** testei Configurações › Controle e sistema › Testar controle › voltar: o foco volta para "Testar controle". Não reproduzi o caso relatado (pode ter sido de outra versão); o editor de abas não foi retestado.
- **UX-14 (A na lista de instalados abre desinstalação):** abre uma confirmação cujo foco inicial é "Cancelar"; nunca desinstala direto. Mantido.
- **UX-21 (Continuar jogando mistura instalados e não):** já existe a opção "esconder não instalados" nas configurações da Página inicial; é decisão do jogador.

## Não feito (válido ou discutível; rodada própria)

UX-08 (tamanho e destino antes de instalar: a Steam não informa o tamanho de jogos não instalados), UX-12 (escala: o zoom inverso é uma decisão para caber na tela), UX-19, UX-32, UX-33 (volume separado dos efeitos), UX-34, UX-35.

## Sem como verificar aqui

- **UX-10 (piscar o monitor com o Guia):** exige o botão físico, o monitor e gravação da tela.
- Teste com outras pessoas, leitores de tela e hardware de TV.

## Observação

O achado de segurança mais importante (UX-02) estava certo e era mais grave do que "mensagem divergente": cancelar falhava em silêncio e o PC podia desligar com a tela dizendo o contrário. O achado UX-01 já estava parcialmente resolvido pela rodada de atualizações de jogos.


# Segunda rodada (Codex, commit bd4f78c)

Fonte: `auditoria-ux-ui-console-launcher-rodada-2.md` (21 achados R2-01 a R2-21). Conferidos no código e, quando possível, no navegador. As correções ficaram no commit seguinte.

## Feito

| Achado | Veredito | O que foi feito |
|---|---|---|
| R2-01 desligar ao cancelar o último download | Válido (P0) | A fila vazia não prova que deu certo. Agora o desligamento é ligado à fila do momento (**só programa com downloads na fila**, com confirmação) e guarda **todos os jogos acompanhados**: só desliga se cada um terminou **instalado e sem atualização pendente**; cancelado, removido, baixando ou não confirmado desarma e avisa o motivo. O "armado" deixou de ser guardado entre aberturas. Na fila vazia o foco inicial é "Abrir a Biblioteca" (nunca o desligamento). |
| R2-02 diálogos simultâneos | Válido | Os diálogos de confirmação formam uma **pilha**: só o de cima recebe o B, e cada um tem as próprias chaves de foco (a contagem do desligamento usa `shutdown-dialog-*`). Testado: com "Desinstalar" aberto e a contagem por cima, o B fecha só a contagem. |
| R2-03 contagem x Windows | Válido | Um agendamento que chega atrasado depois de desarmar/cancelar é **desfeito** (o Windows é mandado cancelar); se "Desligar agora" falhar depois de cancelar o anterior, a contagem some e o erro aparece; um jogo **abrindo** também impede o agendamento. Não feito: reconhecer um agendamento prévio (código 1190) como estado à parte e recuperar a contagem ao reabrir o launcher (o "armado" não é mais guardado, então não há contagem para recuperar). |
| R2-04 diálogo de cancelar na fila | Válido | Se o item sai da fila com o diálogo aberto, ele fecha com um aviso (sem título vazio); cancelar uma instalação limpa só o progresso do próprio jogo. Não feito: "Cancelando…" até a Steam confirmar. |
| R2-05 Start com foco fora dos cartões | Válido | O Start só abre as opções se o foco está num cartão (testado: com o foco em "Buscar", nada abre). |
| R2-06 Y x botão Ordem | Válido | Y e o botão abrem o mesmo seletor; a grade só muda depois de escolher. |
| R2-07 ampliar a busca | Válido | O escopo "todos os jogos" pedido a partir de uma busca sem resultado é desfeito ao limpar a busca (volta à aba de antes; testado com Favoritos). |
| R2-08 voltar dos editores | Válido | Voltar do editor de uma aba (e de uma fileira) devolve o foco à linha de origem. |
| R2-09 categorias das Configurações e do Downloads | Válido | Viraram botões (direcional + A + clique; LB/RB continuam); o foco fica na aba escolhida. A dica "◀ ▶ Ajustar" só aparece nas linhas ajustáveis. |
| R2-10 "Nenhum controle detectado" x Sistema | Válido | A tela Testar controle agora mostra "Controle detectado pelo Windows" (XInput) e explica que a lista do navegador interno pode estar vazia. |
| R2-11 Fechar x Voltar ao jogo | Válido | Com o jogo em execução, a ação principal é **"Voltar ao jogo"** (detalhe e menu de opções); "Fechar o jogo" é secundária e continua pedindo confirmação. |
| R2-13 contraste a 70% | Válido | Abaixo de 90% de escala o texto do botão de perigo passa a exigir 4,5:1 (texto escuro nos temas em que o branco não chega). |
| R2-15 Instalados abre remoção | Válido | **A abre o jogo**; **Start desinstala** (com confirmação). Tamanhos abaixo de 1 GB em MB nos detalhes, com precisão de 0,01 GB. |
| R2-17 Sistema sem ícones | Válido | Sem nenhum ícone escolhido, fica a entrada "Sistema" (nome acessível "Abrir Sistema"). |
| R2-21 "Menos jogados primeiro" | Válido | Renomeado para "Há mais tempo sem jogar" (é a ordem pela última sessão). |

## Não feito (com motivo)

- **R2-12 (foco DOM, Tab, leitor de tela):** o produto é para controle; mexer na captura de Tab/Start e testar NVDA/Narrador é uma frente própria.
- **R2-14 (escala e leitura longa):** decisão de design (o zoom inverso mantém o layout).
- **R2-16 (Guia no monitor):** exige hardware e gravação da tela.
- **R2-18 (acervo da conta x Biblioteca):** o texto já distingue; poderia ganhar explicação, sem urgência.
- **R2-19 (prévia da Biblioteca):** a prévia é um exemplo visual; o rodapé dela ainda mostra os atalhos antigos.
- **R2-20 (nome e estado do jogo em foco na Biblioteca):** faixa de legenda é um redesenho; "Continuar jogando" já pode esconder os não instalados.
