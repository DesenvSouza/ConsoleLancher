# Auditoria de UI, UX e QA do Console Launcher

**24/11/2026 · Windows 11 · branch fix/steam-fullscreen · revisão e2fe36d**

## Resultado

O assistente chegou à Home em **11 percursos completos pelas 14 etapas**. O fluxo preservou a etapa ao reabrir durante a primeira configuração e manteve separado o idioma preferido dos jogos. Na Biblioteca, as abas, a busca, a ordenação e o filtro de loja funcionaram em uma coleção mista. Em Downloads › Instalados, consegui voltar da última linha ao cabeçalho e recuperar a rolagem no topo.

Encontrei **25 achados, cinco deles P1**. A ampliação a 150% corta controles de várias telas e parte do card selecionado no Início. O diagnóstico de controle tem informação fora da área visível sem caminho para alcançá-la pelo controle. A atualização removeu o ajuste global de compatibilidade com controle, inclusive para perfis que já o tinham ativado. Uma abertura de jogo com atualização sem progresso pode prender o launcher em “Abrindo…”, sem saída para liberar a próxima tentativa.

A segunda prioridade é tornar explícito o estado das operações. Há situações em que o wizard promete aplicar padrões mas mantém mudanças, o FPS aparece ligado quando a gravação falhou e a tela de inicialização fica carregando depois de já ter recebido um erro.

## Escopo e evidência

- **Janela nativa**. Observei a etapa 1 no WebView do launcher que estava aberto no Windows, com leitor da árvore de acessibilidade. A automação nativa adicional perdeu a sessão durante a tentativa de avançar. O restante do assistente e as ações da interface foram avaliados em execução isolada. O relatório distingue onde isso importa.
- **Interface isolada**. Executei a aplicação local com um perfil de navegador limpo e dados de demonstração ou controlados. Usei entradas publicadas pela Gamepad API para D-pad, A/B, LB/RB, RT e outros botões, além do teclado equivalente e cliques em alvos específicos. A entrada simulada exercita a lógica da interface do launcher. Ficam pendentes os testes de dispositivos físicos e da ponte de entrada do Windows.
- **Matrizes**. Percorri o wizard em português, inglês e espanhol, a 70%, 100% e 150%, em 1280 × 720. Fiz duas passagens adicionais em 1024 × 576 e 1920 × 1080. Em um passo de uma das passagens, usei o atalho de teclado após a entrada simulada não ser registrada. Examinei 22 estados de tela e abas em cinco combinações de idioma, resolução e escala, totalizando 110 observações nessa matriz.
- **Integrações**. Injetei respostas de sucesso, pendência e falha na fronteira Tauri em cenários selecionados. Testei cancelamentos e confirmações, com os comandos de instalação, remoção, energia e inicialização do Windows simulados. A validação de armazenamento foi feita nos perfis de teste.
- **Verificações do projeto**. TypeScript e build passaram. O verificador de traduções retornou zero erros e zero textos soltos. A suíte Rust terminou com 117 testes aprovados e 25 ignorados. O build emitiu o aviso de tamanho do pacote JavaScript, cerca de 727 kB minificado. O aviso é um ponto de medição, sem conclusão de desempenho percebido.
- **Critérios**. Julguei navegação e foco pelo uso em TV com controle, a identificação da ação e do estado pela leitura visual, e a consistência pelo padrão do próprio produto. Usei WCAG 2.2 e as Xbox Accessibility Guidelines como referências de foco, adaptação do texto, navegação e recuperação de erros. O trabalho não constitui certificação de acessibilidade. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Diretrizes Xbox](https://learn.microsoft.com/en-us/xbox/accessibility/guidelines) · [Navegação](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/112) · [Foco](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/113)

### Como ler os achados

| Prioridade | Critério |
|---|---|
| P1 | Bloqueio ou regressão em um fluxo central, risco importante de perder acesso a uma operação ou preferência que deixou de valer. |
| P2 | Resultado incorreto, estado contraditório, recuperação deficiente ou atrito recorrente em um fluxo conhecido. |
| P3 | Inconsistência de layout, nomenclatura ou comunicação, com o fluxo ainda possível. |

**Reproduzido** indica comportamento observado na interface. **Reproduzido com simulação** indica que isolei o estado do sistema ou da loja e observei a resposta do launcher. **Revisão de código** identifica a condição implementada, com o risco ou a integração física ainda por confirmar. Os passos abaixo distinguem essas evidências.

## Achados prioritários

### QA-01 · P1 · Escala de 150% corta campos e valores de configurações

**Reproduzido.** Em 1280 × 720 e espanhol, ajuste a interface a 150% e abra Contas, Controle e áudio, Sistema e energia, o editor de uma aba da Biblioteca, Opções de energia ou Inicialização. A coluna excede o limite da janela. Em Sistema e energia e nas subtelas de coluna única, a lista chegou a x = 1320 em uma janela de 1280 px. Em Downloads, a lista chegou a x = 1560. Em 1024 × 576, o corte é mais aparente. As setas e os valores à direita deixam de caber, mesmo quando o rótulo ainda está visível.

**Sugestão.** Limitar a largura de cada container à área disponível, permitir quebra nos textos e mover valores ou controles para uma segunda linha quando a largura cair. Manter a rolagem vertical no corpo e conservar o contorno do item em foco inteiro. Aplicar o mesmo tratamento a arquivos, linha de jogo e barra de ordem em Downloads.

**Aceite.** A 150%, as funções podem ser lidas e alteradas a 1280 × 720. Em janela reduzida, o layout troca de composição e continua navegável com D-pad. Nenhum valor ou foco pode terminar fora da janela. [CSS das listas](../src/styles/global.css) · Captura de Sistema a 150% (arquivo local, fora do repositório)

### QA-02 · P1 · O Início corta o card em foco quando a interface cresce

**Reproduzido.** Em espanhol, 1280 × 720, 150% e com o destaque ativado, abra o Início. O primeiro cartaz selecionado começou em y ≈ 461 e terminou em y ≈ 839. A área das fileiras terminava em y = 641. Também reproduzi o corte com card panorâmico grande e grade. O jogador consegue identificar o contorno no topo, mas perde o rodapé da capa e o título exibido quando a arte falha.

**Sugestão.** Reservar altura mínima para uma fileira completa e limitar, reduzir ou recolher a descrição do destaque quando a altura útil for insuficiente. Derivar a altura dos cards da área restante, com prioridade ao card em foco. Usar a mesma regra na prévia do Início.

**Aceite.** O card selecionado e seus rótulos cabem em perfil de TV e janela compacta, nos três estilos, com e sem descrição longa. [Home](../src/screens/Home.tsx) · Captura do card cortado (arquivo local, fora do repositório)

### QA-03 · P1 · O teste de controle esconde justamente o que o jogador precisa conferir

**Reproduzido.** No wizard, abra Testar controle a 150% em 1024 × 576. O painel tinha 420 px de área visível e passou a ter 751 px de conteúdo após gerar ações. Acionei o D-pad para baixo nove vezes. O registro recebeu ações, mas a rolagem ficou em zero. O registro de ações estava em y ≈ 758, abaixo da janela, assim como parte da representação dos botões. O comportamento coincide com o container de diagnóstico recortado e com a ausência de foco navegável na área dos resultados.

**Sugestão.** Reservar um painel fixo para a leitura em tempo real e oferecer áreas roláveis com foco explícito, ou abas como Botões, Analógicos e Registro. O D-pad deve poder navegar sem misturar o comando de inspeção do painel com o evento a diagnosticar.

**Aceite.** Um jogador com apenas controle consegue ver a última ação, os botões e eixos e voltar à origem, inclusive com múltiplos controles e a 150%. [Diagnóstico](../src/screens/GamepadTest.tsx) · [CSS do diagnóstico](../src/styles/global.css) · Captura (arquivo local, fora do repositório)

### QA-04 · P1 · O filtro global de controle desapareceu na atualização

**Reproduzido com perfil legado.** Carreguei a configuração anterior com controllerOnly ativo. A Biblioteca exibiu os 14 jogos da amostra, inclusive o jogo marcado no cenário como sem suporte. Na revisão atual, o filtro é uma regra de aba. Criei uma aba e confirmei que ela exibiu 12 jogos compatíveis de Steam e Epic. A aba “Todos” continuou exibindo a lista sem esse critério. O menu RT oferece filtro por loja. O papel da opção mudou em relação ao fluxo que já havia sido solicitado para o launcher.

**Sugestão.** Restaurar a opção global em Jogos e biblioteca e manter a regra por aba para coleções especializadas. Migrar o valor antigo salvo, aplicar o filtro antes das contagens e buscas e indicar na tela quando estiver ativo. O caminho para ajustar a compatibilidade de um jogo deve ficar disponível mesmo quando seu card foi ocultado.

**Aceite.** Um perfil que já usava o filtro continua filtrado após atualização. O controle parcial ou completo vale para as duas lojas, em qualquer aba. A desativação recupera a lista sem apagar as regras de aba. [Configuração](../src/store/libraryConfig.ts) · [Regras](../src/lib/libraryRules.ts) · [Edição de abas](../src/screens/LibraryTabEdit.tsx)

### QA-05 · P1 · Uma atualização parada pode bloquear a abertura de qualquer outro jogo

**Reproduzido com simulação.** Inicie um jogo com atualização pendente e simule uma espera sem janela em primeiro plano e sem progresso novo. Avancei o relógio do estado de abertura para quatro horas. O diálogo ainda oferecia somente “Continuar no launcher”. Fechar o diálogo preservou a entrada pendente e o botão do jogo permaneceu “Abrindo…”. O comando de iniciar outro jogo é bloqueado enquanto há uma entrada anterior em abertura. A opção de parar de aguardar exige que o jogo esteja sem atualização.

**Sugestão.** Diferenciar a transação de download da tentativa de abertura. Permitir desistir da tentativa mesmo com atualização pendente, mantendo a atualização sob controle da loja. Liberar o bloqueio somente depois de o backend confirmar a limpeza do pedido ou depois de verificar que nenhum processo de jogo existe. Preservar a regra de confirmar primeiro plano e a proteção contra dois jogos simultâneos.

**Aceite.** Com atualização progredindo, a espera continua e mostra progresso. Com atualização estagnada ou loja fechada, existe recuperação explícita. Depois de desistir e confirmar que nenhum jogo está aberto, outro título pode ser iniciado. [Diálogo de abertura](../src/components/LaunchOverlay.tsx) · [Estado da biblioteca](../src/store/library.ts)

## Assistente de primeira utilização

### QA-06 · P2 · “Configurar depois” promete padrões e mantém as escolhas já aplicadas

**Reproduzido.** Na etapa Cores, troquei Meia-noite por OLED preto, recarreguei o launcher de teste e retomei na etapa 3. Voltei à etapa inicial e confirmei “Configurar depois”. O diálogo dizia “O launcher usa as opções padrão”. O Início continuou em OLED preto e essa escolha permaneceu salva.

**Sugestão.** Usar “Sair do assistente” e explicar que as alterações feitas até ali ficam salvas, ou separar mudanças em rascunho com uma escolha explícita entre manter e descartar. Ações do Windows precisam ter indicação própria do momento em que produzem efeito.

**Aceite.** Depois de mudar tema, áudio ou modo de inicialização, o texto do diálogo corresponde ao estado que o jogador encontrará. A retomada preserva apenas o que foi explicitamente salvo. [Fluxo de saída](../src/screens/SetupWizard.tsx) · Captura do diálogo (arquivo local, fora do repositório)

### QA-07 · P2 · A etapa Inicialização carrega indefinidamente se a leitura falhar

**Reproduzido com simulação.** Fiz a consulta de status do modo de inicialização falhar e entrei na etapa 12. A tela permaneceu em “Carregando opções…”. Voltar e Continuar permaneceram utilizáveis. Os ajustes da etapa e uma ação de tentar novamente ficaram indisponíveis.

**Sugestão.** Modelar carregamento, indisponibilidade e erro como estados distintos. Mostrar “Tentar de novo” e “Continuar sem configurar”, com indicação de que nenhuma alteração foi aplicada. Manter o último estado conhecido após uma falha transitória, quando houver.

**Aceite.** Rejeição, demora prolongada e retorno incompleto têm mensagem e saída acessíveis por controle. Um retorno saudável recupera os dois ajustes sem reiniciar o wizard. [Leitura e renderização de inicialização](../src/screens/SetupWizard.tsx)

### QA-08 · P2 · O selo “Recomendado” do Modo console é mais forte que sua condição de uso

**Revisão de código e interface.** A linha recebe o selo “Recomendado” inclusive em um perfil genérico. A condição “para um PC usado como console” está na coluna de apoio. O executável pode substituir a área de trabalho no próximo login. O texto principal da etapa diz que as mudanças só acontecem quando o jogador escolhe, mas o assistente aplica a opção assim que confirma o diálogo.

**Sugestão.** Qualificar o rótulo da própria linha com “Para PC dedicado a jogos”. Antes de confirmar, manter juntos o efeito no próximo login, o impacto nos programas de inicialização e o caminho de recuperação. Deixar o modo comum como escolha claramente indicada para PC compartilhado, e mostrar a reversão no resumo quando o modo console estiver ativo.

**Aceite.** Um jogador que leia apenas a coluna de ação entende o impacto e sabe como voltar. Confirmar a opção continua exigindo consentimento explícito nessa tela. [Assistente](../src/screens/SetupWizard.tsx) · [Painel de orientação](../src/components/preview/SetupPreviews.tsx)

### QA-09 · P2 · F11 altera a janela e deixa “Tela cheia” desatualizado no assistente

**Reproduzido com simulação.** Na etapa Sistema, comecei com tela cheia ativa. O atalho F11 invocou o comando de alternância e a janela simulada mudou para modo janela. O campo continuou “Ativada”. Ao sair para as opções de FPS e voltar, a leitura na nova montagem mostrou “Desativada”.

**Sugestão.** Ler tela cheia de uma fonte compartilhada e reagir à mudança da janela, inclusive quando o comando veio de F11 ou do backend. Reusar a estratégia entre Configurações e wizard, sem depender de um temporizador após clicar na linha.

**Aceite.** F11, A na linha e alterações externas atualizam o valor na mesma tela. O erro de alternância preserva o último estado confirmado e tem feedback. [Leitura no wizard](../src/screens/SetupWizard.tsx) · [Atalho de janela](../src/input/actions.ts)

### QA-10 · P3 · A ação Continuar muda de altura entre etapas

**Reproduzido.** Na sequência em português a 100% e 1280 × 720, o bloco Voltar/Continuar começou em y ≈ 373 nas etapas Cores e Plano de fundo, e em y ≈ 592 nas etapas Ícones no topo e Capas e biblioteca. A diferença de cerca de 219 px exige reaprender onde olhar para confirmar. A navegação por A e direcional funcionou na passagem principal. Ao avançar com A já em Continuar, o foco permaneceu nesse botão nas etapas seguintes. Ao avançar com RB, a primeira opção da próxima etapa normalmente recebeu foco.

**Sugestão.** Ancorar a barra de ações no mesmo ponto acima das dicas e reservar um corpo rolável. Escolher uma política explícita de foco de entrada. Se o objetivo for revisar cada etapa, selecionar a primeira opção. Se o objetivo for avançar rápido, permitir isso pelo RB e indicar essa ação.

**Aceite.** A distância visual e a transição de foco são previsíveis em todas as 14 etapas. A barra mantém sua posição ao aparecer uma opção condicional. [Layout do assistente](../src/styles/setup.css) · [Composição](../src/screens/SetupWizard.tsx)

### QA-11 · P3 · Dicas e foco de retorno precisam refletir as ações disponíveis

**Reproduzido em parte.** A primeira etapa mostra “LB Etapa anterior” e a última mostra “RB Próxima etapa”. Ambos chegam ao limite sem ação. O resumo apresenta “Ajustar” mesmo quando contém apenas dados estáticos. Voltando das subtelas abertas com o D-pad e A, mantive o foco de origem em Fileiras, Capas, Steam e FPS. Quando abri algumas delas por clique sem passar o foco pelo item, o retorno caiu na primeira linha da etapa, por exemplo Tela cheia em vez de FPS. Essa variação é verificável por modo de entrada.

**Sugestão.** Derivar as dicas da ação realmente disponível e registrar o acionador antes de navegar. Aplicar a mesma política a clique, controle e teclado. Na etapa Controle e teclado, usar na prévia os mesmos rótulos que valem naquele momento ou apresentar os atalhos como referência para o uso após o wizard.

**Aceite.** Nenhuma borda do assistente anuncia um botão sem efeito. B volta para a linha que abriu a subtela. [Composição e retorno](../src/screens/SetupWizard.tsx) · [Prévia de controle](../src/components/preview/SetupPreviews.tsx)

### QA-12 · P3 · O resumo final oferece pouca revisão antes de concluir

**Reproduzido.** A última tela lista nove escolhas, com foco direto em Concluir. Inclui idioma, tema, destaque, fundo, escala, contas, música, inicialização e FPS. Não mostra as escolhas de efeito sonoro, janela, ícones de loja ou botões do Guia. Para revisar um valor, é preciso voltar pelas etapas. É um atrito maior para inicialização e FPS, que têm efeitos fora da página de configuração.

**Sugestão.** Exibir primeiro as mudanças que afetam Windows, áudio, contas e FPS. Oferecer “Revisar” por grupo, com retorno ao resumo. Para contas desconectadas, mostrar o resultado esperado no Início e um caminho curto para configurar depois.

**Aceite.** É possível corrigir uma escolha importante a partir do resumo sem percorrer o assistente inteiro de novo. [Resumo](../src/screens/SetupWizard.tsx)

## Biblioteca, jogos e downloads

### QA-13 · P2 · A primeira tela sem jogos começa sem foco e sem ação direta

**Reproduzido com biblioteca vazia.** Após concluir o wizard sem conta, o Início exibiu “Nenhum jogo por aqui ainda”, com uma instrução para abrir Configurações. Não havia item selecionado. D-pad para baixo e direita, seguidos de A, não abriram a configuração. Foi possível recuperar o foco indo até o cabeçalho com cima, ou usar Select para entrar em Configurações. A Biblioteca vazia concentrou a instrução na Steam, embora o sistema também aceite Epic.

**Sugestão.** Mostrar um botão focável “Conectar uma loja”, com foco inicial, e um caminho curto para Steam ou Epic. Distinguir biblioteca realmente vazia de sincronização em andamento, de falha de leitura e de fileiras ocultas no Início.

**Aceite.** Perfil novo, conta conectada sem jogos e perfil com todas as fileiras ocultas recebem a ação adequada. O jogador consegue executá-la com A. [Estado vazio do Início](../src/screens/Home.tsx) · [Estado vazio da Biblioteca](../src/screens/Library.tsx)

### QA-14 · P2 · Suporte a controle inferido pela Steam pode parecer confirmado para uma cópia da Epic

**Revisão de código.** O fallback usa correspondência entre títulos normalizados e elimina termos de edição. Quando encontra suporte completo ou parcial na Steam, o resultado pode voltar com esse nível para a edição Epic. O caminho compara nomes, sem conferir editora, edição ou a forma de suporte daquela cópia. Não encontrei um falso positivo real na conta do usuário. Uma correspondência por nome é útil para cobrir lacunas, mas a certeza apresentada precisa corresponder à fonte.

**Sugestão.** Guardar a origem da classificação e sinalizar “Inferido pela versão Steam”. Evitar atribuir suporte completo a uma edição diferente sem evidência suficiente. Quando disponíveis, cruzar identificadores, editora e edição. Preservar a correção manual. Usar a mesma normalização no TypeScript e no Rust e cobrir homônimos, remasterizações e títulos com caracteres não latinos.

**Aceite.** A ficha indica se o suporte veio da loja atual, de outra edição ou de confirmação do usuário. O filtro deixa claro quais graus de evidência aceita. [Classificação](../src/lib/controllerSupport.ts) · [Busca na Steam](../src-tauri/src/steam_lookup.rs) · [Contexto das regras](../src/hooks/useRuleContext.ts)

### QA-15 · P2 · Uma aba de jogos com controle esconde a diferença entre verificação e ausência de suporte

**Revisão de código e interface.** Dados incompletos da Epic e jogos ainda sem metadados da Steam deixam de passar na regra da aba. O catálogo e o fallback podem confirmar títulos depois. O estado vazio usa o texto geral de filtro, sem explicar se ainda há jogos a verificar. É fácil entender a ausência temporária como incompatibilidade ou desaparecimento do jogo. A rota manual existe no menu Start, desde que o jogador localize o título em outra aba.

**Sugestão.** Expor a quantidade em verificação ou sem confirmação, e oferecer “Ver jogos ainda não verificados” ou uma lista temporária para revisão. Atualizar a contagem com anúncio discreto. Manter uma rota por controle para corrigir o suporte.

**Aceite.** Com Epic lenta ou offline, o jogador entende por que a aba ainda está reduzida, encontra o título e pode voltar ao filtro após corrigi-lo. [Biblioteca](../src/screens/Library.tsx) · [Sincronização](../src/hooks/useSteamSync.ts)

### QA-16 · P3 · Busca sem resultado informa a aba e omite o filtro de loja

**Reproduzido.** Na aba Todos, escolhi Epic Games pelo RT e busquei “Stardew”, presente na Steam na amostra. A tela informou “Nenhum jogo de Todos combina com ‘Stardew’”, com “Editar busca” e “Limpar busca”. Limpar removeu a busca e manteve Epic Games; para encontrar o jogo foi necessário voltar a RT e limpar o filtro de loja.

**Sugestão.** Indicar o escopo combinado na frase, por exemplo “Nenhum resultado em Epic Games · Todos”. Oferecer “Buscar em todas as lojas” sem apagar o texto digitado.

**Aceite.** O termo permanece ao ampliar escopo. B continua a limpar a busca no comportamento esperado, e a troca de loja fica explícita. [Implementação](../src/screens/Library.tsx) · Captura (arquivo local, fora do repositório)

### QA-17 · P2 · O armazenamento mistura tamanho desconhecido com 0 B

**Reproduzido com manifesto controlado.** Em Downloads › Instalados, usei um jogo Epic instalado cujo tamanho era desconhecido. A linha mostrou “—”. O resumo do disco exibiu “Jogos da Epic Games: 0 B”. Isso pode fazer o jogador acreditar que o jogo não usa armazenamento. Se o disco exibe “Outros arquivos”, os bytes daquele jogo também podem acabar interpretados como parte desse grupo.

**Sugestão.** Representar desconhecido explicitamente no modelo. Mostrar “Tamanho indisponível” por jogo e “Total parcial” na loja quando houver lacunas. No disco, distinguir “outros arquivos e tamanhos não identificados” quando não houver base para separar as duas partes.

**Aceite.** Um jogo instalado de tamanho desconhecido entra na contagem, nunca aparece como ocupação de 0 B e não distorce os percentuais. Quando o tamanho passa a estar disponível, a linha e o resumo são atualizados juntos. [Downloads](../src/screens/Downloads.tsx) · [Manifestos da Epic](../src-tauri/src/epic.rs)

### QA-18 · P3 · A fila mista perde informação útil quando só um item tem tamanho desconhecido

**Reproduzido com simulação.** Em uma fila com Steam ativa e Epic Legendary a 42% sem total de bytes, os quatro indicadores superiores ficaram como “—”. A linha Steam ainda mostrou progresso em MB e estimativa individual. A interface também respondeu corretamente que a atualização Steam não pode ser cancelada e abriu confirmação de cancelamento para a instalação Epic.

**Sugestão.** Manter a velocidade e o tempo conhecidos como estimativas parciais, com loja associada e unidade clara. Usar “Estimativa total indisponível” para o conjunto sem dados. Reter a porcentagem da Epic quando a loja não expõe total.

**Aceite.** Uma fila com Steam e Epic permite distinguir o que tem progresso, total ou estimativa, sem transformar a ausência de uma métrica em ausência de toda a informação. [Fila e indicadores](../src/screens/Downloads.tsx)

## FPS, Guia e efeitos no Windows

### QA-19 · P2 · O contador de FPS pode mostrar “Ligado” após falha de gravação

**Reproduzido com simulação.** Com o FPS desligado, forcei falha em perf_set_config e ativei no menu. A linha mostrou “Ligado” e não houve aviso visível. O console registrou a falha. Ao reabrir a configuração, o estado do backend voltou como “Desligado”.

**Sugestão.** Usar “Aplicando…” enquanto a confirmação está pendente. Em rejeição, desfazer o estado provisório e informar a falha na mesma tela. Proteger contra respostas fora de ordem quando ajustes diferentes são enviados em sequência. Fazer o Guia e Configurações refletirem o mesmo estado confirmado.

**Aceite.** Uma gravação bem-sucedida permanece após reabrir. Uma falha visível não deixa o botão em um estado falso, e é possível repetir a ação. [Store de FPS](../src/store/perf.ts) · [Configurações de desempenho](../src/screens/PerfSettings.tsx)

### QA-20 · P2 · É possível configurar limites de FPS e temperatura fora de ordem

**Reproduzido.** Em Cores e faixas, consegui selecionar “FPS bom a partir de 60” e “FPS aceitável a partir de 90”. Também configurei atenção em 80 °C e crítica em 75 °C. A tela aceitou ambos. O cálculo usa as condições em ordem, de forma que a faixa intermediária fica vazia em casos desse tipo. A prévia não explica a inconsistência.

**Sugestão.** Validar os pares no frontend e no backend, aplicando FPS aceitável < FPS bom e temperatura de atenção < temperatura crítica. Restringir as opções ou ajustar o limite vizinho com mensagem explícita. Na leitura de preferências antigas, normalizar valores inválidos de forma previsível.

**Aceite.** Nenhum ajuste, preset, arquivo local ou alteração rápida salva faixas invertidas. A prévia mostra transições distintas e usa os mesmos limites da janela sobre o jogo. [Controles de faixa](../src/screens/PerfSettings.tsx) · [Interpretação dos limites](../src/components/PerfCard.tsx) · Captura (arquivo local, fora do repositório)

### QA-21 · P2 · Uma preferência de notificações também governa o overlay da Steam

**Revisão de código.** O rótulo reúne “Notificações e overlay da Steam”; a descrição visível fala em conquistas e mensagens. Em tela cheia, o estado também controla a supressão do overlay no jogo. O jogador que queira ajustar apenas avisos pode alterar um comportamento distinto.

**Sugestão.** Explicar os dois efeitos de forma explícita ou desmembrar as preferências, mantendo o padrão atual de proteção contra a Steam e o Big Picture interferirem. Clarificar em qual modo a configuração vale e avisar que a pontuação de suporte a controle e o botão Guia são assuntos separados.

**Aceite.** A escolha tem efeito previsível com e sem jogo aberto, em tela cheia e em janela. Testar avisos, sobreposição e abertura do Big Picture como casos independentes. [Rótulo do wizard](../src/screens/SetupWizard.tsx) · [Controle no Windows](../src-tauri/src/hide.rs)

### QA-22 · P2 · Confirmações do Guia têm menos semântica do que as do launcher

**Reproduzido com simulação e revisão.** Em Fechar o jogo e Reiniciar, o Guia abriu a confirmação e focou Cancelar. Voltar dispensou o diálogo sem executar a ação. O Guia monta seu próprio diálogo com classes do visual compartilhado, mas sem a marcação de diálogo de alerta, título e descrição presente em ConfirmDialog. Isso gera uma diferença na semântica exposta às tecnologias assistivas. O teste de navegação por uma ferramenta de leitura do Windows ainda é necessário.

**Sugestão.** Usar a mesma estrutura semântica do diálogo principal e manter o bloqueio de foco adequado para a janela do Guia. Unificar o significado de B, o foco inicial e os textos de fechamento. Incluir estados de espera e falha da ação sem deslocar o foco para um elemento oculto.

**Aceite.** Fechar jogo, reiniciar, desligar e voltar à área de trabalho são anunciados como diálogos, com nome da operação e consequência, e focam Cancelar. B volta à linha de origem. [Guia](../src/guide/GuideApp.tsx) · [Diálogo compartilhado](../src/components/ConfirmDialog.tsx)

## Consistência e acessibilidade transversal

### QA-23 · P2 · O foco visual não acompanha o foco da plataforma web

**Reproduzido no Chromium e revisado no código.** Após o launcher selecionar visualmente um card e receber D-pad, o elemento ativo do documento continuou BODY. Os controles customizados usam atributos de foco e papel de botão, sem encaminhar o foco DOM ao item. O Tab tem o significado de Start no modo teclado. Na inspeção nativa inicial, o alvo apresentado como foco também era o documento do WebView. Isso demonstra a diferença de estado; o impacto sobre cada leitor de tela requer validação com a tecnologia real.

**Sugestão.** Adotar elementos semânticos e sincronizar foco DOM com o estado da navegação espacial, ou usar um padrão de componente composto que exponha o item ativo de forma suportada. Descrever a seleção das abas, estados binários e valores de ajuste. Manter um perfil de teclado que permita explorar a interface por Tab sem acionar Start involuntariamente.

**Aceite.** O elemento em foco é anunciado ao navegar com controle e teclado. A confirmação prende e restaura o foco e teclas globais não interceptam edição de texto. Validar com Narrador no Windows. [Componente focável](../src/components/Focusable.tsx) · [Atalhos](../src/input/actions.ts)

### QA-24 · P3 · A prévia de biblioteca ou Início pode parecer a coleção real

**Revisão de código e interface.** No wizard, a prévia sempre usa títulos de exemplo. Nas Configurações, uma biblioteca pequena também é substituída pela amostra. Mesmo em uma prévia baseada na coleção do usuário, o seletor insere o Witcher 3 de demonstração se não encontrar o AppID de destaque. O título da moldura continua sendo o nome da tela. Ao criar ou alternar uma aba de controle, a prévia da Biblioteca costuma continuar na primeira aba.

**Sugestão.** Rotular claramente “Dados de exemplo” quando a prévia contém itens fictícios e usar um jogo existente para o destaque de uma prévia pessoal. Acompanhar a aba em edição na prévia da Biblioteca. Quando o produto só precisa demonstrar layout, manter a amostra visualmente separada dos estados reais de conta, posse e instalação.

**Aceite.** Um perfil sem jogos distingue a demonstração da biblioteca real. Em um perfil com jogos, a prévia identificada como pessoal não mostra títulos fictícios. Alterar regras de uma aba mostra o efeito na aba correspondente. [Seleção dos dados da prévia](../src/hooks/usePreviewGames.ts) · [Prévias](../src/components/preview/Previews.tsx)

### QA-25 · P3 · A hierarquia de títulos e ações muda dentro da mesma área

**Avaliação de layout.** As telas principais já compartilham cabeçalho, rodapé e padrão visual de foco. Dentro das configurações, porém, aparecem três lógicas recorrentes. Em algumas subtelas há caminho completo no cabeçalho; em outras, apenas a tela ou o nome da aba. A configuração da Biblioteca e as contas usam colunas com função diferente. Jogos não instalados põe a demonstração à esquerda, enquanto Início, Biblioteca, FPS e wizard usam apoio à direita. Há telas de ajuste com apenas “Selecionar/Voltar”, apesar de aceitarem setas, e “Abrir”, “Selecionar”, “Alterar” e “Ajustar” variam entre fluxos próximos.

**Sugestão.** Definir um contrato por família. Usar título e caminho previsíveis, navegação ou estado de etapa logo abaixo, coluna principal à esquerda, prévia ou orientação à direita e ações de controle no mesmo rodapé. Onde o espaço for curto, reduzir a prévia antes da região interativa ou torná-la uma aba. Padronizar verbos e derivar as dicas do controle focado.

**Aceite.** Conta, edição de aba, diagnóstico, FPS e wizard têm hierarquia reconhecível sem decorar a posição de cada comando. O layout especial do Guia continua apropriado à sobreposição. [Cabeçalho e rodapé](../src/components/Chrome.tsx) · [Jogos não instalados](../src/screens/NotInstalledSettings.tsx) · Referência visual das telas (arquivo local, fora do repositório)

## Wizard etapa por etapa

A matriz valida o avanço em todos os passos. Os testes adicionais abaixo cobrem ajustes, desvios e estados de falha. Nas etapas com integração, as respostas do Windows e das lojas foram controladas.

| Etapa | O que exercitei | Resultado |
|---|---|---|
| 1. Bem-vindo | Alternei entre português, inglês e espanhol. Voltei com B. Comparei a preferência de idioma dos jogos antes e depois. | O texto do launcher mudou, a escolha dos jogos foi preservada e o foco permaneceu no idioma da interface. Ao configurar depois, o texto promete um estado diferente do salvo. QA-06 |
| 2. Controle e teclado | Passei pela tela com glifos de Xbox, PlayStation e controle genérico simulado. Abri o diagnóstico, acionei X e D-pad e voltei. | O diagnóstico recebeu ações. O registro e parte dos botões ficaram fora de alcance em janela compacta. Ao voltar pelo caminho iniciado com clique, o foco voltou à primeira linha. QA-03, QA-11. |
| 3. Cores | Alterei tema e destaque e comparei a prévia. Fechei e reabri o perfil durante a etapa. | Tema e destaque foram salvos. O percurso retomou nesta etapa após recarregar. A altura de Continuar muda ao avançar. QA-06, QA-10. |
| 4. Plano de fundo | Ciclo de estilos, desfoque, fundo de cor fixa e seletor condicional. | Os ajustes específicos apareceram no modo correspondente. A amostra visual usa dados de demonstração. QA-24. |
| 5. Tamanho e estilo | Ampliei até o limite de 150%, alterei a redução de movimento e comparei 70%, 100% e 150%. | O limite e o ajuste persistiram. O controle permanece operável nesta etapa. O tamanho escolhido corta elementos em outras áreas do produto. QA-01, QA-02. |
| 6. Ícones no topo | Desativei o indicador de volume. Comparei o topo da prévia antes e depois e li a preferência salva. | O volume de 60% sumiu e os demais indicadores permaneceram. |
| 7. Tela inicial | Alternância do destaque, uma ou todas as fileiras e abertura do editor. No editor, alterei visibilidade, estilo, tamanho, quantidade e posição da fileira. | Os ajustes mudaram e foram salvos. Voltando pelo caminho iniciado com clique, o foco caiu no ajuste do destaque. O card inicial pode ficar cortado com destaque e 150%. QA-02, QA-11. |
| 8. Capas e biblioteca | Ícones de loja, tamanho, contagem, prioridade para instalados e entrada em Jogos não instalados. | Desabilitar ícones removeu os emblemas da Steam e da Epic das duas prévias. O retorno pelo caminho iniciado com clique focou o início da lista. QA-11. |
| 9. Página do jogo | Alternei a exibição de tempo estimado. Verifiquei a remoção dos ajustes dependentes. | Ao desativar, os controles de estilo deixaram de aparecer. As durações de exemplo serviram para conferir a composição da tela. |
| 10. Contas | Abri as telas Steam e Epic. Rodei o QR e a entrada Epic com falhas simuladas e tentei voltar. Alternei a configuração de notificações. | Falhas de entrada apareceram em texto localizado e o QR ofereceu nova tentativa. A explicação de notificações também precisa representar o efeito sobre o overlay. QA-11, QA-21. |
| 11. Áudio | Troquei TV por fones na lista simulada, acionei o teste de som, desliguei os efeitos e habilitei música. Verifiquei o estado sem saída disponível. | Ao desligar efeitos, a ação de teste sumiu. O ajuste de música apareceu. A audição real e a troca física de dispositivo ficam pendentes. |
| 12. Inicialização | Cancelei e confirmei a alteração de modo console em simulação. Alternei o início automático. Forcei erro na leitura. | A confirmação começou em Cancelar. Na simulação, início normal e modo console se desativaram mutuamente. A leitura com erro ficou carregando. QA-07, QA-08. |
| 13. Sistema | Tela cheia pela linha e por F11 simulado, entrada em FPS e Opções de energia e retorno. | O atalho alterou a janela simulada sem atualizar a linha até reentrar. O FPS recebeu estados de falha e as opções de energia ficaram acessíveis. QA-09, QA-11, QA-19. |
| 14. Tudo pronto | Inspecionei o resumo, concluí, recarreguei e reabri pelas Configurações. Passei pelo cenário sem jogos. | A conclusão persistiu. Reabrir pelas Configurações começa na primeira etapa. O resumo tem poucos pontos de revisão e a Home vazia ficou sem foco inicial. QA-12, QA-13. |

## Cobertura funcional após o wizard

| Área | Ações e estados verificados | Resultado e limite |
|---|---|---|
| Início | Cartaz, panorâmico e grade. Destaque, fileiras e edição. Ícones de loja e favoritos. Menu Start e abertura de detalhes. Coleção vazia. | Favoritei e abri detalhe e voltei ao card no cenário ensaiado. A fileira guardou estilo, tamanho, limite, visibilidade e ordem. QA-02, QA-13, QA-24. |
| Biblioteca | Coleção Steam/Epic, filtro de loja, combinações com busca, ordenação, aba por suporte parcial ou completo, carregamento de configuração anterior. Criação, nome, visibilidade, reordenação e exclusão de aba. | A contagem passou de 14 para 12 na aba criada com suporte a controle. Renomeei, ocultei, movi, cancelei a exclusão e confirmei na segunda abertura. A remoção da preferência global, a comunicação de compatibilidade e o escopo da busca precisam de ajuste. QA-04, QA-14 a QA-16, QA-24. |
| Detalhe do jogo | Favoritar, abrir e voltar. Instalação, atualização pendente e confirmação de desinstalação. Estado de jogo aberto e primeira janela em foco. | Em simulação, processo existente manteve “Abrindo…” até o sinal de primeiro plano. Cancelei a desinstalação e verifiquei a troca para “Baixando…” após solicitar a instalação. QA-05. |
| Downloads | Fila vazia, Steam e Epic na mesma fila, atualização em curso e cancelamento Epic. Agendamento e cancelamento de desligamento. | O menu evitou oferecer desinstalação de um jogo em atualização. Desligamento simulado iniciou a contagem e B desarmou. A fila perde estimativas úteis quando falta tamanho. QA-18. |
| Downloads › Instalados | Entrada com RB, mudança de ordem, última linha, retorno ao topo com D-pad, tamanhos mistos. | O retorno ao topo funciona na revisão testada. A rolagem voltou a zero e o foco chegou à aba Downloads. O tamanho desconhecido da Epic foi apresentado de forma diferente na linha e no disco. QA-17. |
| Configurações | Aparência, Jogos e biblioteca, Contas, Controle e áudio, Sistema e energia. Subtelas de fileiras, Biblioteca, exemplos, diagnóstico, inicialização, configurações de FPS e Guia. | Comparei cabeçalhos, estrutura, rodapés e foco nas cinco combinações da matriz. O corte a 150% aparece também fora do wizard. QA-01, QA-03, QA-23 a QA-25. |
| Steam e Epic | Contas abertas pelo wizard e configurações, caminhos de QR e entrada, retorno, loja offline e estados controlados de biblioteca e downloads. | Erro inicial de conexão e nova tentativa foram cobertos na interface. Login real, persistência de sessão, sincronização de bibliotecas e downloads reais continuam no roteiro nativo. |
| Guia e painel de sistema | Guia sobre cenário de jogo, voltar/fechar, reiniciar, ir à área de trabalho, volume, saída, Bluetooth, Wi-Fi, erro e nova tentativa. | Vi menus e confirmações com foco inicial em Cancelar. Exercitei cancelar, escaneamento simulado e comandos simulados de áudio. Sobreposição real, exclusividade dos comandos e comportamento do monitor precisam de ensaio nativo. QA-21, QA-22. |
| FPS | Geral, Itens, Cores e alertas. Estado ligado/desligado, erro de gravação e limites cruzados. Entrada pelo Guia. | A falha deixou a tela em estado incorreto e os limites invertidos ficaram gravados. Hook de captura, injeção e compatibilidade com jogos não foram verificados em processo real. QA-19, QA-20. |
| Inicialização e energia | Habilitação e cancelamento no wizard, contraste entre tipos de inicialização, preferência de botões no Guia, falhas simuladas. | A mudança de “Reiniciar o PC” para “Ocultar” persistiu ao reabrir as preferências isoladas. O comportamento depois de reiniciar o Windows permanece para o teste nativo. QA-07, QA-08, QA-22. |

## Padrão de layout recomendado

Início, Biblioteca e Downloads já compartilham a mesma lógica de navegação principal e o mesmo contorno de foco. O Guia tem um motivo funcional para ser uma coluna. A maior variação evitável está entre ajustes principais e subtelas, onde a mudança de título, apoio visual ou posição dos comandos obriga o jogador a reaprender o fluxo.

| Família | Estrutura visual a preservar ou aplicar | Comportamento esperado |
|---|---|---|
| Início, Biblioteca e Downloads | Cabeçalho global com destino ativo, corpo com margem comum, navegação local na primeira linha e rodapé fixo. Grid, fileiras e listas usam a mesma margem útil a uma escala equivalente. | Subir do primeiro item revela o topo; descer até o fim mantém o foco abaixo do cabeçalho e acima do rodapé. O estado vazio contém uma ação focável no corpo, com atalho equivalente no rodapé. |
| Detalhe do jogo | Título e estado, ação principal, ações secundárias e metadados, com ordem visual estável. Fundo e arte podem variar por título. | “Jogar”, “Abrindo…” e “Voltar ao jogo” ocupam a mesma posição. Texto de erro ou instalação cabe ao lado da ação ou abaixo dela. Origem de loja e ação destrutiva são reconhecíveis sem depender só de cor. |
| Configurações e subtelas | Cabeçalho com seção e nome da tela, lista interativa à esquerda e demonstração à direita. Configurações sem demonstração usam lista única com a mesma margem e largura limitada pela janela. | Rótulos e valores longos quebram para duas linhas. Dicas e valores continuam legíveis a 150%. Na composição compacta, a lista ocupa a primeira coluna inteira e a prévia passa abaixo ou para uma aba. B devolve o foco à linha de origem. |
| Wizard | Progresso no mesmo ponto, título e introdução com altura controlada, ajustes roláveis e Continuar e Voltar na base. Prévia claramente identificada como exemplo. | As duas ações mantêm posição e ordem entre as 14 etapas. A seleção inicial e o foco de retorno seguem a mesma regra, pela barra, clique ou controle. Dicas de LB e RB aparecem apenas quando há uma etapa correspondente. |
| Contas, diagnóstico e FPS | Título, texto de estado, área principal e feedback na região de interação. Cartões de estados e abas seguem espaçamento, tipografia e foco das configurações. | O diagnóstico deixa dados atuais e registro ao alcance. As contas exibem progresso, falha e nova tentativa na mesma região. O FPS distingue prévia, efeito aplicado e falha de salvamento. |
| Painel Guia | Cabeçalho com jogo e estado, grupos Jogo, Launcher, Sistema e Energia, área rolável e legenda fixa na base da coluna. | D-pad mantém o contorno visível ao cruzar grupos; subir até a primeira opção também revela o cabeçalho. Ordem, retorno e confirmações seguem o restante do launcher. Ao ocultar todas as opções de energia, o grupo perde o título vazio. |
| Teclado virtual, notificações e confirmações | Ação e consequência no título e texto. Cancelar na posição e no foco iniciais para ações destrutivas. Estado de espera e mensagem de falha na mesma caixa. | A corresponde ao controle em foco, B retorna e o foco é restaurado. No teclado virtual, os atalhos de edição pertencem ao teclado enquanto ele estiver aberto. Uma notificação não deve cobrir o controle focado. |

Usar as mesmas medidas de margem, altura mínima, espaço entre linhas, alinhamento de valores e contorno em todas as telas da mesma família. Definir os verbos pelo efeito do controle. “Abrir” entra em uma tela, “Alternar” muda uma opção binária, “Ajustar” muda um valor e “Voltar” retorna ao ponto anterior. Testar rótulos PT, EN e ES e validar que texto, estado e foco mantêm contraste nos temas e cores de destaque disponíveis. A auditoria identificou problemas de foco e adaptação, sem medir todas as combinações de contraste.

## Sequência de correção e critérios de regressão

1. **Eliminar bloqueios.** Resolver QA-01 a QA-05. Rodar o wizard nos três idiomas, repetir 1280 × 720 e 1024 × 576 a 150%, percorrer submenus por D-pad e repetir abertura estagnada com outro jogo selecionado. Carregar uma configuração anterior com o filtro de controle ativo e verificar a seleção resultante nas duas lojas.
2. **Fechar o ciclo de cada operação.** Priorizar erro e nova tentativa em configuração inicial, gravação do FPS, feedback de download e primeiro uso sem jogos. Para cada operação, cobrir espera, sucesso, erro, cancelamento, ação repetida e retorno de foco.
3. **Unificar os padrões de tela.** Consolidar cabeçalhos, corpo rolável, semântica de foco e confirmação, rodapés e prévias. Repetir os fluxos por controle, teclado e clique, e conferir traduções e contraste.

### Verificações nativas ainda pendentes

- **Entrada e vídeo com jogo aberto.** Usar um Xbox via XInput, um DualSense via USB e Bluetooth e um genérico. Em um jogo Steam e um jogo Epic, repetir com janela sem bordas e tela cheia exclusiva. Verificar que o Guia se sobrepõe, A/B e D-pad ficam restritos ao painel, Big Picture não abre e o launcher acompanha o fim do jogo. Gravar o monitor externamente para verificar o apagão ou a piscada. Repetir em monitor secundário, com escala do Windows e, se disponível, HDR.
- **Ciclo real de jogo e instalação.** Com conta de teste e títulos dedicados, validar instalação, atualização, cancelamento, retomada e desinstalação nas duas lojas, medindo foco, visibilidade da Steam/Epic, listas Downloads e Instalados e dados em disco. Abrir um título que demora e confirmar que o aviso só encerra com a janela válida em primeiro plano. Com um título aberto, tentar iniciar outro e conferir que o bloqueio libera após o fechamento.
- **Conta, áudio e sistema.** Concluir autenticação Steam e Epic com credenciais de teste, reconectar sem internet, trocar saída com áudio audível, testar dispositivos Bluetooth e redes Wi-Fi. Em uma sessão descartável do Windows, verificar inicialização, modo console, caminho de retorno ao Explorer e comandos de energia com reinicialização real.
- **FPS e acessibilidade.** Confirmar o contador em jogos reais com caminhos gráficos distintos e em tela cheia e janela. Validar foco, ordem, valores, alertas e diálogos com o Narrador e controle físico. Acompanhar quadros do monitor quando o Guia abre e fecha.

## Evidências da execução

- Capturas resumidas do wizard nas 14 etapas (arquivo local, fora do repositório) e das 22 telas e abas (arquivo local, fora do repositório). O perfil isolado bloqueou o carregamento externo de artes, por isso algumas capas mostram o tratamento de ausência de imagem.
- Matriz do wizard (arquivo local, fora do repositório) e resultados das ações e desvios (arquivo local, fora do repositório).
- Matriz de layout com medidas e alvos focáveis (arquivo local, fora do repositório).
- Fluxos funcionais (arquivo local, fora do repositório) e edição e personalização (arquivo local, fora do repositório).
- Cenários de regressão (arquivo local, fora do repositório), casos de borda (arquivo local, fora do repositório) e respostas simuladas do Windows e das lojas (arquivo local, fora do repositório).
- Downloads voltou ao topo (arquivo local, fora do repositório), busca com filtro Epic ativo (arquivo local, fora do repositório) e Guia com jogo em execução simulada (arquivo local, fora do repositório).
