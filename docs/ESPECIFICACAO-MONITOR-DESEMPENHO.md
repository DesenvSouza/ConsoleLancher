# Especificação do monitor de desempenho do Console Launcher

**25/11/2026 · v0.1.3 · main em cada43e · Windows 11 · Proposta de implementação**

## Decisão

O problema começa na medição. O contador atual registra o começo de uma chamada de apresentação e trata esse evento como um quadro do jogo. Em uma carga Direct3D 11 controlada, duas superfícies independentes de 60 FPS no mesmo processo apareceram como **120–121 FPS**. Uma segunda superfície que faria somente consultas de teste também elevou a leitura para **120–121 FPS**. Durante uma pausa de 1,85 s o contador continuou exibindo 120 FPS. Na retomada, descartou do gráfico o intervalo de **1.866,7 ms** que a referência registrou.

A prioridade é **reconstruir a apresentação por jogo e por superfície, medir a idade do dado e preservar os picos do frametime**. Alterar a frequência da interface só faz sentido depois de garantir esses três pontos. A implementação recomendada usa um motor Windows com correlação de eventos validada contra Intel PresentMon, uma máquina de estados para captura e overlay, e amostradores independentes para os sensores de hardware. O overlay continua sendo uma janela externa que pode ser acionada pelo controle.

## 1. Escopo e nível de evidência

- **Observação no Windows.** Executei o parser, cálculo de quadros e seleção de processo do checkout revisado em uma ferramenta isolada. A cópia da captura usou um nome ETW próprio e registrou os timestamps de chegada dos eventos. Um programa de teste Direct3D 11 em janela executou fases com uma e duas swapchains, chamadas `DXGI_PRESENT_TEST`, pausa e limites de 30 e 4 FPS. O PresentMon CLI 2.6.0, com SHA-256 conferido com o release oficial, capturou o mesmo processo na mesma execução. A máquina tinha Core i7-8700, RTX 3060 Ti e Windows 11 Pro build 26300. [PresentMon 2.6.0](https://github.com/GameTechDev/PresentMon/releases/tag/v2.6.0)
- **Replay e interface.** Compilei `perf_stats.rs` sem mudanças e submeti sequências sintéticas, inclusive ordem invertida e congelamento. Em Chromium, renderizei o componente atual do overlay com respostas Tauri controladas e inspecionei picos, falha de IPC, indicadores ausentes e layout horizontal nos três idiomas. A janela reativa do navegador não mede os efeitos de composição da janela nativa.
- **Hardware e regressão.** Rodei nove amostras reais do amostrador Rust. Comparei a semântica da VRAM com uma leitura independente do driver NVIDIA. TypeScript passou, o i18n retornou zero erros e zero textos soltos, e `cargo test --lib` passou com 124 testes, 26 ignorados e zero falhas.
- **Limites.** A carga controlada exercita captura e apresentação, sem representar a carga gráfica de um jogo comercial. Os números de atraso são desta máquina e desta sessão. Esta rodada não mede o custo do WebView2 por cima de um jogo real, VRR, HDR, tela cheia exclusiva, o modo console após reinício, pipeline AMD/Intel, desempenho do MSI Afterburner em paralelo, nem compatibilidade com anticheat. A seção 12 transforma esses pontos em testes de aceite. O código e as preferências do launcher ficaram intactos.

### Medições principais

| Cenário | Observado no launcher | Referência e interpretação |
|---|---|---|
| Uma swapchain a 60 FPS | 60 FPS na região estável. | P50 do intervalo entre presents de 16,6667 ms. A referência também mostrou presents descartados e intervalos exibidos distintos. Boa captura de chamadas neste caso simples. |
| Duas swapchains a 60 FPS | 120–121 FPS e máximos do gráfico perto de 12,7 ms. | Duas cadeias separadas, ambas com P50 de aproximadamente 16,667 ms. O contador misturou os eventos das janelas com 4 ms de defasagem. |
| Uma swapchain a 60 FPS e mais 60 consultas por segundo | 120–121 FPS. 480 eventos ETW para 240 presents normais e 240 consultas. | PresentMon registrou 240 presents do fluxo normal e retirou a superfície usada só para consulta. `DXGI_PRESENT_TEST` consulta o estado de apresentação. [Flags DXGI](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/dxgi-present) |
| Pausa de 1,85 s e retomada a 30 FPS | 120 FPS durante a pausa, ainda exibidos cerca de 0,58 s depois de a carga retomar. Ao receber o retorno, o máximo da parte nova ficou perto de 33,4 ms. | A referência registrou um intervalo de 1.866,7 ms entre presents. O corte interno de 1,5 s apagou o intervalo e o histórico anterior. |
| Quatro FPS sob carga controlada | A leitura ficou presa em 5 FPS até depois do encerramento da carga. | A referência registrou 16 presents no trecho de 4 s, com P50 de 250,0002 ms. A seleção exige pelo menos 5 FPS e pode reapresentar a última leitura elegível. |
| Chegada ETW ao callback | **Mediana 914,7 ms, P95 1.711,3 ms e máximo 2.032,9 ms**, 1.336 eventos do processo. | A latência é do timestamp de origem ao callback. Ainda faltam processamento, snapshot, IPC e renderização. O polling de 250 ms só consulta o que já chegou. |
| Ligar e desligar de imediato | 12 de 12 tentativas voltaram a `Running` depois de `stop()`. | Ensaio direto da captura, com intervalo de 120 ms para observar a corrida. A thread que começa depois do pedido de parada ainda se encontra na mesma geração. O botão do launcher pode alterar a janela de ocorrência. |
| Picos de 100, 180 e 780 ms e falha de IPC | Os três picos viraram barras idênticas de altura 28. Depois de IPC rejeitado, o 60 continuou na tela sem aviso. Com uma chamada pendurada, a contagem de chamadas também parou. | Reproduzido no componente real com valores de teste. O teto visual é fixado em 100 ms e `busy` aguarda indefinidamente a resolução da chamada. |

**Experimento de latência.** Repeti a carga com um flush explícito da sessão ETW a cada 100 ms na ferramenta isolada. Houve 1.336 eventos relevantes em cada execução. A mediana caiu de 914,7 para 175,9 ms, e o P95 de 1.711,3 para 243,2 ms. As 260 chamadas de flush tiveram sucesso e o maior contador de perdas nas consultas foi zero nesta execução. O P95 da duração da chamada foi 0,166 ms. Medir essa chamada não mede o custo total da captura sobre o jogo. A opção merece uma prova no motor escolhido com carga, VRR e overlay, sem eliminar as correções de identidade, frescor e estatística.

## 2. O que aproveitar das ferramentas de referência

| Referência | Princípio para o Console Launcher | Evidência |
|---|---|---|
| NVIDIA App / FrameView | O usuário pode ver rapidamente as métricas centrais e aprofundar quando precisa. A referência de engenharia é FrameView para separar resultado de renderização, apresentação e exibição e para verificar o impacto do próprio overlay. | O FrameView atual documenta janela independente, contabilização de presents descartados ou sem exibição e limitações com MPO e Independent Flip. [NVIDIA App](https://www.nvidia.com/en-us/software/nvidia-app/) · [NVIDIA FrameView](https://www.nvidia.com/en-in/geforce/technologies/frameview/release-notes/) |
| MSI Afterburner + RTSS | Composição configurável de sensores e grupos coerentes, com OSD separado das configurações. Um nível compacto deve caber na TV e continuar legível em movimento. | A MSI documenta o RTSS como componente que mostra na tela os dados de monitoramento selecionados. Este trabalho usa os recursos como referência funcional, sem inferir os algoritmos internos de frametime. [Guia oficial MSI](https://www.msi.com/support/technical_details/VGA_MSI_Utility_AfterBurner) |
| SteamOS / Gamescope / MangoHud | Níveis de detalhe acionáveis rapidamente, orçamento em ms e gráfico que ajuda a ler o ritmo do jogo. | Gamescope é um compositor e tem integração com MangoApp. MangoHud documenta frametime e gráfico detalhado. Para semântica de geração de quadros, a Valve também documenta o monitor da Steam no PC. São referências distintas. [Gamescope](https://github.com/ValveSoftware/gamescope) · [MangoHud](https://github.com/flightlessmango/MangoHud/blob/master/README.md) · [Monitor da Steam](https://help.steampowered.com/en/faqs/view/3462-CD4C-36BD-5767) |
| Intel PresentMon | Reconstruir o ciclo do frame, identificar swapchain e resultado, usar timestamps monotônicos e discriminar métrica de app, de presents e de exibição. | As tabelas oficiais definem essas métricas separadamente. O CLI e suas capturas serão a referência principal de comparação no Windows, alinhando fonte e fórmula em cada teste. [PresentMon CLI](https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md) · [Mapeamento de métricas](https://github.com/GameTechDev/PresentMon/blob/main/IntelPresentMon/CommonUtilities/mc/FrameMetricsMemberMap.h) |

## 3. Achados e correções obrigatórias

| ID | Prioridade e evidência | Causa e efeito | Correção e aceite |
|---|---|---|---|
| FPS-01 | P0 · medido | `on_event` usa só `Present_Start` de DXGI/D3D9 e o PID. Ignora superfície, tipo, flags e resultado. | Correlacionar início/fim e resultado por superfície. Um segundo fluxo de 60 FPS ou uma sequência de `TEST` não altera o FPS de 60 da cadeia principal. Separar presents válidos, descartados e exibidos. [Captura](../src-tauri/src/perf_etw.rs#L111) |
| FPS-02 | P0 · medido | Buffer ETW chega muito mais devagar que a cadência de polling. O estado perde a noção de idade entre origem e tela. | Registrar e limitar a idade em cada estágio, separar relógio de captura e refresh e publicar degradação quando atrasar. Aplicar o orçamento da seção 12. [ETW](../src-tauri/src/perf_etw.rs#L173) · [Polling WebView](../src/components/PerfCard.tsx#L185) |
| FPS-03 | P0 · medido | A janela é ancorada no último evento recebido e continua “ao vivo” por 3 s. Uma leitura antiga elegível pode ser copiada mais 3 s por `last_game`. | Separar validade da amostra e permanência visual. Ao envelhecer, marcar atraso e substituir o número pelo estado. O cartão pode permanecer visível, com os campos de hardware que ainda estão válidos. O tempo de graça nunca renova a validade do FPS. [Estatística](../src-tauri/src/perf_stats.rs#L73) · [Seleção](../src-tauri/src/perf_etw.rs#L409) |
| FPS-04 | P0 · medido | Lacuna acima de 1.500 ms apaga a série. Congelamento real e inatividade deliberada são tratados da mesma forma. | Preservar stall com o alvo em execução e em primeiro plano. Suspensão, troca de alvo e perda de captura ganham marca no histórico com causa. Ver §6. [Entrada dos quadros](../src-tauri/src/perf_stats.rs#L50) |
| FPS-05 | P0 · medido | `stop()` não invalida a geração. O worker pode republicar `Running`, inclusive antes de confirmar que abriu a trilha. A callback não verifica geração. O erro de `ProcessTrace` é ignorado. | Worker único dono dos recursos, finalização idempotente, contexto de sessão e geração até na callback. Publicar pronto só após habilitar provedores e abrir o consumidor. Teste de 100 alternâncias e sessão residual sem interferência entre instâncias. [Ciclo ETW](../src-tauri/src/perf_etw.rs#L128) · [ProcessTrace](../src-tauri/src/perf_etw.rs#L198) |
| FPS-06 | P1 · medido e revisão | Regra de 5 FPS exclui justamente jogos em travamento ou rodando devagar. A heurística de pastas não usa o mesmo alvo que Guia/Steam/Epic e aceita qualquer app em primeiro plano ocupando a tela. PID sem hora de nascimento confunde reuso. Cache de caminho nunca expira e guarda falha vazia. | Usar primeiro o rastreador de jogo do launcher. Fixar o alvo por identidade de processo, janela e cadeia, com nova aquisição quando há evidência. O alvo permanece um jogo válido a 4 FPS. Usar resolução de caminho fora da callback, cache com TTL e retorno manual para jogos externos. [Seleção de alvo](../src-tauri/src/perf_etw.rs#L288) · [Rastreamento Steam](../src-tauri/src/steam.rs#L498) · [Rastreamento Epic](../src-tauri/src/epic.rs#L896) |
| FPS-07 | P1 · medido e revisão | Contagem de “últimos 1.000 ms” vira FPS sem considerar cobertura parcial. Um intervalo de 16,667 ms já produz 1 FPS, média 60 e 1% low 60. Fronteira de ponto flutuante também produziu 61 em série de 60. | Medir taxa por intervalo sobre cobertura válida, com aquecimento e amostra mínima. Lows indisponíveis antes da amostra mínima e apresentados com janela explícita. [Cálculo atual](../src-tauri/src/perf_stats.rs#L77) |
| FPS-08 | P1 · medido em replay | Um evento fora de ordem altera `last_at` mesmo descartado. Replay com 0, 16, 32, 24, 48, 48 e 64 ms fabricou 24 ms. O maior intervalo verdadeiro era 16 ms. | Ordenar até um watermark limitado. Eventos tardios ou duplicados não movem a âncora para trás. Invalidar janela se a perda ou o atraso impedir inferência. [Atualização da âncora](../src-tauri/src/perf_stats.rs#L52) |
| FPS-09 | P1 · medido no frontend | Eixo X é índice de quadro. 120 quadros cobrem cerca de 4 s a 30 FPS, 2 s a 60 FPS e 0,83 s a 144 FPS. Eixo Y muda com a série, satura a 100 ms e não informa a escala. | Eixo temporal contínuo, janela fixa, escala em ms, envelope com picos e marcador de saturação. As três barras de 100, 180 e 780 ms precisam ser distinguíveis em tempo e magnitude, inclusive se ultrapassarem o viewport. [Gráfico](../src/components/PerfCard.tsx#L36) |
| FPS-10 | P1 · medido no frontend | Rejeitar IPC mantém a última amostra. Um IPC pendente trava o loop inteiro pelo `busy`. A UI não tem sequência, timeout, deadline ou idade. | Assinatura orientada a eventos com sequência e último estado. Timer local para envelhecer. Fallback com timeout, descarte de resposta antiga e nova tentativa com backoff. [Hook](../src/components/PerfCard.tsx#L185) |
| FPS-11 | P1 · revisão | `current_game()` segura o mesmo mutex da callback enquanto resolve caminho, consulta janela, aloca séries e ordena as duas caudas por PID. Recalcula a cada leitor, inclusive para debug. O microbenchmark isolado de um PID variou de ~0,10 ms em 60 FPS a ~1,28 ms perto de 1.000 FPS. A contenção total em jogo ainda precisa ser medida. | Ingestão O(1) amortizado e processamento fora da callback. Cache imutável para leitores, janela incremental e cálculo das caudas a 1 Hz. Medir p95 do worker e drops sob múltiplos processos. [Mutex e seleção](../src-tauri/src/perf_etw.rs#L363) · [Ordenações](../src-tauri/src/perf_stats.rs#L85) |
| FPS-12 | P1 · revisão | Sempre escolhe o monitor primário. Janela e tamanho usam largura primária, escala do WebView e dimensão do monitor de forma indireta. A janela fica visível no sistema mesmo quando React devolve vazio e pode ser recolocada no topo a cada 2 s. | Medir monitor do HWND do alvo, ajustar DPI e esconder nativamente quando inaplicável. Separar coleta de atualizações de Z-order e obedecer a operação do Guia. [Posição](../src-tauri/src/perf.rs#L109) · [Z-order](../src-tauri/src/perf.rs#L221) |
| FPS-13 | P1 · revisão, hardware físico simples | A GPU selecionada é a de maior VRAM, não a que renderiza o jogo. Uso e memória são da placa, embora a UI mistura esses números com o nome do jogo. O amostrador não refaz adaptadores e contadores após mudança de topologia. | Mapear o adaptador ativo por LUID, identificar render e display em híbridos, sinalizar `GPU do sistema` quando não há vínculo. Distinguir métricas globais e por processo. Reinicializar no hotplug e após suspensão ou driver reset. [Seleção e amostragem](../src-tauri/src/perf_hw.rs#L256) |
| FPS-14 | P1 · revisão, hardware medido | O primeiro valor de GPU veio vazio nesta máquina. Uso, temperatura, energia e VRAM não têm origem, janela, timestamp, estado ou precisão. A leitura isolada da VRAM apresentou total de 8.024 MiB via WDDM e 8.192 MiB via driver NVIDIA. As leituras são de fontes diferentes e não foram simultâneas. A diferença é motivo para rotular escopo e semântica, sem atribuir erro a um dos valores. | Telemetria tipada por métrica e fonte. Exibir `—` nos campos indisponíveis, preservar zero válido e indicar a idade quando expirar. Potência em W de fonte que entrega W, percentual de limite com sua própria unidade. [HW Rust](../src-tauri/src/perf_hw.rs#L290) · [Renderização](../src/components/PerfCard.tsx#L147) |
| FPS-15 | P1 · revisão | A gravação de `perf.json` ignora falhas e não é atômica. Gravações após liberar o lock podem persistir fora de ordem. O comando pode responder sucesso antes de o worker existir ou mesmo sem janela. O rollback no TS depende de rejeição do comando. | Configuração tipada e versionada com gravação durável e publicação após sucesso. Expor separadamente estado solicitado, persistido e efetivamente aplicado. Uma revisão antiga não substitui a nova. [Gravação](../src-tauri/src/perf.rs#L80) · [Store](../src/store/perf.ts#L42) |
| FPS-16 | P1 · revisão e frontend simulado | “Ligado” pode significar sessão pendente, negada ou renderizador ausente. Com apenas 0,1% low habilitado, falha retorna um card vazio. A prévia mantém timer de 250 ms mesmo com snapshot real. | Estados explícitos de captura, alvo, dados e renderizador. Interface baseada em capacidades e prévia que só anima o exemplo quando visível. Configurações e Guia recebem o mesmo estado confirmado. [Card](../src/components/PerfCard.tsx#L139) · [Prévia](../src/screens/PerfSettings.tsx#L86) · [Guia](../src/guide/GuideApp.tsx#L124) |
| FPS-17 | P1 · medido no frontend | Linha de métricas com conteúdo acima da largura do overlay. Em viewport de 652 px, a borda da última linha foi a x=747 em PT/ES e x=759 em EN. A caixa parecia caber, mas o conteúdo saía da janela. | Medir composição, envolver em duas linhas ou voltar para coluna antes do corte. Adotar posições com área segura, DPI e tamanhos por monitor. [CSS](../src/styles/perf.css#L40) · [Janela](../src-tauri/src/perf.rs#L109) |
| FPS-18 | P2 · revisão | O estado da permissão verifica a associação de conta por nome e executa PowerShell. O retorno de `ShellExecuteW` só diz que o UAC abriu, e a interface antecipa instruções de saída. Relação entre grupo local e token corrente fica implícita. | Consultar SID e token efetivo por API. Distinguir UAC cancelado, erro ao aplicar, associação aguardando novo login e acesso efetivo. Abrir elevação só após ação explícita. Manter sensores sem privilégios. [Permissão](../src-tauri/src/perf_etw.rs#L435) |
| FPS-19 | P2 · revisão | “Frametime” no número é média de 500 ms, a dica diz “cada quadro”, a escala visual tem só uma linha e o limite usa cores genéricas de FPS. | Mostrar `Tempo de quadro · mediana 1 s` no compacto e rotular P95 e pico no detalhado. Régua usa orçamento da meta explícita e sinal visual adicional à cor. [Estatísticas](../src-tauri/src/perf_stats.rs#L16) · [Dicas](../src/screens/PerfSettings.tsx#L49) |

Os achados sobre falha de configuração, prévias e faixas partem do checkout atual. A tela já possui rollback quando a chamada rejeita e ordenação básica de faixas. As correções propostas estendem isso à falha real de escrita, a tipos e limites inválidos e às confirmações entre janelas.

## 4. Arquitetura proposta

### 4.1 Motor de captura

**Decisão proposta.** Avaliar integração com uma versão fixada do Intel PresentMon que exponha dados por frame de forma contínua. A primeira avaliação deve usar a distribuição oficial v2.6.0 já empregada na comparação. Preferir API/serviço oficial se instalação, licenciamento de redistribuição, assinatura, permissões e operação sem rede atenderem ao launcher. Se essa opção exigir um serviço incompatível com a experiência de instalação, avaliar portar ou integrar apenas a correlação do projeto upstream, com versão fixa e manutenção explícita. Usar o CLI como referência de teste e protótipo. Em produção, consumir dados diretamente da API de captura.

A integração precisa entregar os timestamps de origem e os campos de identidade. Usar a correlação de runtime, eventos do kernel de gráficos e composição para atribuir o resultado a um present. A API e o CLI podem ter diferenças de campos e de permissões. Antes de escolher, documentar o contrato real exposto em DX9, DX11/12, Vulkan e OpenGL, os fornecedores ETW necessários e a dependência para identificar um quadro gerado. Fixar versão, hash, licença, comportamento de instalação e política de atualização. Jogos com caminho de apresentação incompleto devem receber um conjunto menor de métricas, explicitamente rotulado. [Código e licença do PresentMon](https://github.com/GameTechDev/PresentMon) · [Arquitetura de captura e OSD](https://github.com/GameTechDev/PresentMon/blob/main/README-CaptureApplication.md)

```text
launcher/Guia + rastreador de jogos e janelas
                         │
                         ▼
 resolvedor de alvo ──────┼──────► controlador de overlay ──► janela não ativável
                         │                                  ▲
 ETW + correlação ─► fila limitada ─► agregador ─► snapshots ┤
                                          ▲                 │
 PDH/WDDM + sensores opcionais ────────────┘                 │
 configuração versionada ───────────────────────────────────┘
```

**Limites entre componentes.** Sugestão de módulos para a implementação: `perf_capture` mantém backend e sessão, `perf_target` resolve jogo/janela/cadeia, `perf_stats` calcula métricas, `perf_hw` lê sensores, `perf_transport` publica snapshots e `perf_overlay` só gerencia janela. Começar com fronteiras no Rust atual e extrair arquivos conforme o tamanho justificar. Reutilizar o cartão compartilhado para a prévia e o overlay. Persistência, atualização da janela e medição têm donos separados.

### 4.2 Ciclo de vida da captura

| Estado | Entrada | Saída e feedback |
|---|---|---|
| Desligado | Preferência inativa ou parada concluída. | Nenhuma sessão ETW, janela ativa, polling ou leitura de sensor contínua. Prévia de demonstração sob demanda. |
| Iniciando | Preferência ativa. Há um alvo elegível ou uma tentativa explícita de diagnóstico. | Abrir o consumidor e habilitar os provedores necessários. Limite proposto de 3 s para reportar uma causa ou passar a “Aguardando quadros”. |
| Aguardando jogo | Recurso armado no Guia, sem alvo elegível. | Sem enganoso “0 FPS”. Em modo só durante o jogo, não criar uma nova sessão gráfica contínua enquanto o PC está na área de trabalho. |
| Adquirindo fluxo | Jogo conhecido, cadeia ainda não decidida ou primeira amostra incompleta. | Mostrar “Medindo…” em linhas de frames. Preencher quando houver cobertura suficiente. |
| Medindo | Fonte alinhada, identidade válida, eventos recentes. | Atualizar as métricas suportadas. Estado de frescor é independente de exibição no Guia. |
| Atrasado / Falha de dados | Atraso do consumidor, perda de buffers, sequência faltando, timeout de IPC. | Marcar `Atrasado`, interromper extrapolação e criar intervalo desconhecido. Voltar quando a integridade e o frescor retornarem. |
| Sem novos quadros | Alvo reconhecido em primeiro plano, captura saudável e fluxo parou. | Mostrar o tempo sem quadros e um marcador enquanto a captura está íntegra. Medir o intervalo completo ao chegar o próximo quadro. |
| Pausado | Alt+Tab, bloqueio de tela, minimizar, outro desktop ou mudança de alvo. | Ocultar overlay. Encerrar o segmento, preservar o resumo anterior quando útil e iniciar um segmento novo no retorno. |
| Permissão / incompatível / erro | Acesso negado, backend sem capacidade ou erro real. | Informar a causa e próxima ação disponíveis. Manter hardware independente. Nenhuma tentativa herdada deve se reativar depois que o recurso foi desligado. |

Um supervisor serializa `enable/disable/restart` e possui os handles de provedor/consumidor, o cancelamento e a geração. O pedido de parar invalida a geração primeiro. A callback usa `UserContext` ou equivalente para identificar a instância. O worker fecha os próprios recursos, aguarda descanso do consumidor e publica o resultado apenas para a geração vigente. O retorno de `ProcessTrace`, a exceção do adaptador e o motivo de encerramento viram estado conhecido. Uma parada por fechamento normal tem prazo e diagnóstico, com limpeza no erro. Sessões ETW usam nome que identifica instância e usuário sem incluir nome de conta legível. Consultar e limpar resíduos somente quando houver evidência de propriedade e de que o dono anterior morreu.

**Permissões e dependências.** Preferir o token regular. Se a captura exigir `Performance Log Users`, validar o SID no token corrente e o resultado real de tentativa de captura. O fluxo de concessão deve distinguir clique, janela de UAC aberta, cancelamento, etapa concluída e necessidade de novo login. Evitar sondagem por PowerShell na leitura do overlay. Nenhuma elevação automática ao rodar jogo. Sem serviço privilegiado ou driver novo na primeira entrega. Quando o Windows ou um título limitar a aquisição, mostrar capacidade parcial e manter o restante do launcher utilizável.

### 4.3 Identidade do jogo e política de troca

1. Ao confirmar que um jogo abriu em primeiro plano, compartilhar o mesmo alvo conhecido pelo ciclo do launcher e pelo Guia. Preferência por identidade de loja, horário de criação do processo, PID e HWND. Resolver o PID gráfico quando um bootloader iniciar outro executável. Para Steam e Epic, usar a identificação já existente de processos e instalações, sem duplicar o rastreamento no consumidor ETW.
2. Identificar a cadeia pelo endereço/identificador reportado pela captura e associá-la à janela real sempre que a fonte puder. Considerar quantidade de presents válidos, presença no monitor do jogo, tamanho e continuidade. Uma janela auxiliar, navegador embutido ou overlay com taxa maior nunca substitui uma cadeia saudável do alvo. Para uma cadeia nova elegível, exigir estabilidade por 500 ms ou confirmação determinística da recriação da cadeia/janela. Se a associação for ambígua, mostrar “Identificando fluxo” e permitir seleção manual no diagnóstico.
3. Quando o jogo foi aberto fora do launcher, aceitar aplicativo em primeiro plano reconhecido como jogo. Instalações em qualquer pasta funcionam para alvos confirmados. Se a evidência só aponta um aplicativo que ocupa a tela, oferecer seleção manual com nome e janela. DWM, Explorer, o overlay, apps de monitoramento e launchers auxiliares não viram alvo por cadência.
4. Medir baixas taxas sem usar FPS como prova da identidade. Ao retomar o mesmo processo com nova swapchain, criar geração de fluxo e manter identificador do jogo. Nunca concatenar amostras entre gerações. Se o PID for reutilizado, a hora de criação e a janela invalidam o cache anterior. O histórico da sessão pode agregar segmentos válidos com lacunas rotuladas.
5. Separar pausa deliberada de falha. Alt+Tab, minimização, lock, suspensão e troca de alvo encerram o segmento. Abrir o Guia oculta o overlay. A política proposta mantém a coleta se o Guia preserva o alvo gráfico e tempo de jogo, com anotação da entrada. Se o Guia transferir foco de forma que o jogo pause, encerra o segmento e marca “Guia”. Ao sair, exigir o mesmo alvo ou nova aquisição.

## 5. Contrato dos dados e relógios

### 5.1 Registro antes do snapshot

| Campo | Tipo lógico | Obrigação |
|---|---|---|
| `captureGeneration`, `streamGeneration`, `eventSequence` | Inteiros crescentes | Impedir dados de sessão antiga. A sequência identifica perda. |
| `gameId`, `pid`, `processStartQpc`, `windowId`, `chainId` | Identificadores do alvo | Processos e cadeias diferentes ficam isolados. `chainId` e handles opacos no frontend. |
| `presentQpc`, `displayQpc`, `producerQpc` | Inteiros QPC ou ausentes | Manter QPC inteiro no Rust. Relativo à origem da sessão e convertido para milissegundos apenas na fronteira de apresentação. |
| `ingestedQpc`, `classifiedQpc` | Inteiros QPC | Quantificar atraso da origem à chegada, reordenação e processamento. Nunca calcular frametime por horário da chegada. |
| `outcome` | Exibido, descartado, desconhecido, teste, falha | Teste e falha não entram em frames válidos. Descartado pode contar como present válido e nunca como quadro exibido. |
| `frameKind` | App, gerado, repetido, desconhecido | Depende de informação real da fonte. Uma repetição do scanout do mesmo frame não é novo conteúdo exibido. |
| `api`, `presentMode`, `renderAdapterLuid`, `displayAdapterLuid`, `displayOutput` | Capacidades/opcionais | Usar quando confirmados pelo backend. Explicitar modo ou API desconhecidos. |
| `lossSegment` e `quality` | Motivo e qualidade | Extravio de fila/ETW, reordenação fora do horizonte, dados incompletos, fallback. Pontos afetados aparecem como lacuna. |

**Semântica.** FPS apresentado conta o fluxo de presents válidos da cadeia escolhida. FPS exibido conta mudanças observadas na saída, dentro da informação disponível. FPS do jogo/base só pode receber esse rótulo quando a fonte distingue quadros do aplicativo e gerados de forma confiável. Exibir um indicador de geração e estimativa ausente quando ela for indeterminada. VRR e scanout têm eventos próprios, e taxa de atualização do monitor pode ser apresentada separadamente em Hz. FPS apresentado, FPS exibido, tempo na API de present, tempo de GPU e latência de exibição são métricas distintas. O FPS de um tipo sempre usa a mesma origem dos ms e dos lows apresentados como daquele tipo. [Definições PresentMon](https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md) · [Frame generation no monitor Valve](https://help.steampowered.com/en/faqs/view/3462-CD4C-36BD-5767)

### 5.2 Transportes e atualização

- Callback faz validação barata e enfileira registro mínimo sem consultar processo, hardware, rede, JSON ou disco. A fila é limitada, tem contador de perdas e orçamento de flush. O worker correlaciona, reordena e publica. Usar 20 ms como horizonte inicial de reordenação onde a fonte exige, ajustar por dependência validada e registrar atraso introduzido. Eventos recebidos depois do watermark não voltam a âncora. Resultado de exibição que ainda não chegou continua desconhecido até finalização.
- O agregador publica um `PerfState` compacto para estado, `FrameBatch` para o gráfico e `HwSnapshot` em cadência própria. O IPC entrega o último estado na inscrição e eventos com `revision` e geração. Um atraso do React não provoca aquisição adicional. Reunir lote delta a cada 50–100 ms quando visível. Guardar a sequência no frontend e ressincronizar com snapshot limitado após perda. Descartar gerações e revisões antigas. Retirar inscrições ao esconder a janela ou sair das configurações.
- Medir cada frame. Publicar dados do gráfico a 20 Hz como alvo inicial. Desenhar a 30 Hz em TV por padrão e 60 Hz opcional, via RAF, movendo o eixo no tempo mesmo com eventos entregues em lotes. Atualizar o número de FPS 4–5 vezes por segundo. Atualizar média, lows e sensores padrão a 1 Hz. Hardware ocupa orçamento próprio, com uma opção detalhada de sensores rápidos a 2 Hz quando suportado. Taxa de publicação e taxa de captura não se substituem. Atualizar por demanda quando só a prévia de demonstração for visível.
- Registrar o tempo de origem via QPC. A idade exibida usa o timestamp de geração e um mapeamento do relógio monotônico do WebView para o do Rust, via amostras de ida e volta com incerteza conhecida. Nunca subtrair `performance.now()` bruto de QPC. Um fallback aceitável soma a idade informada pelo Rust ao tempo monotônico após o recebimento, com incerteza de transporte registrada. Para medição de aceite, posicionar um ACK do front no paint verificado e medir externamente se for necessário. Com IPC pendente, aplicar timeout lógico, nova tentativa com backoff e limite de pedidos por consumidor.
- Registrar idade da captura mesmo quando o número parece estável. Valores de referência iniciais: chegadas recentes normalmente abaixo de 250 ms, estado “Atrasado” acima de 500 ms ou se a janela de entrega deixou de ser confiável. Quando o pipeline está saudável e o alvo não emite frames, manter contador “Sem quadros há X ms” inicialmente após `max(500 ms, 2 × período esperado)`, ajustando a distinção entre ausência e atraso por sinais reais do coletor, sem deduzir saúde pela presença de dados de outro app. Fonte/desktop desconectado é erro independente.
- Consultar contadores ETW de perda, inclusive `EventsLost` e `RealTimeBuffersLost`, e distinguir da perda da fila local ou do cliente. Um watermark só avança sobre dados aceitos ou sobre intervalo marcado como desconhecido. Ajuste no `FlushTimer` não dá granularidade subsegundo pela configuração padrão. Testar parâmetros e buffers no motor escolhido. Condicionar o flush explícito periódico à medição de CPU, perdas, permissões e impacto no jogo. [Microsoft ETW](https://learn.microsoft.com/en-us/windows/win32/etw/event-trace-properties)

### 5.3 Interface de estado

Modelo para orientar IPC, independente da implementação final. Campos rotulados por capacidade devem carregar motivo e origem, sem sentinela numérica.

```text
Status { revision, enabledPreference, applied, captureState, targetState, overlayState,
         clock, activeStream?, capabilities, health }

Sample<T> { value: T | null, sampledAtMs, receivedAtMs, source, scope, unit,
            availability: valid | warming | stale | unsupported | denied | lost,
            windowMs?, reasonCode? }

FrameBatch { generation, stream, sequenceStart, sequenceEnd, intervalKind,
             samples: [{ atMs, dtMs | null, outcome, frameKind }], gaps[] }

Graphics { fpsCurrent, fpsAverage, low1, low01, frameTimeLast, frameTimeP50,
           frameTimeP95, frameTimeP99, frameTimeMax, displayedFrames, droppedPresents }

Health { ageMs, lastGoodAtMs, invalidRows, lostEtw, lostQueue, reordered,
         lateDropped, lastErrorCode, providerVersion, sampleQuality }
```

A ausência de campo legado é migrada na borda do backend. O frontend sempre trata `null` e estados válidos explicitamente. Zero é legítimo para uso de motor, energia ou contagem de descarte. Atraso, dispositivo ausente e permissão requerem códigos distintos. Não mandar ao frontend nomes de caminhos completos nem conteúdo do trace bruto por padrão.

## 6. Estatística e gráfico de frametime

### 6.1 Fórmulas normativas

Considere os timestamps de eventos consecutivos válidos, de fonte e segmento iguais. Para calcular o **tempo de quadro**, usar `dt[i] = (ticks[i] - ticks[i-1]) × 1000 / frequência_QPC`. O primeiro ponto é âncora. Nenhuma diferença atravessa troca de stream, perda de dados ou pausa conhecida. Correlação tardia ou duplicata nunca move `ticks[i-1]` para trás. Usar precisão dupla no cálculo e arredondar só na exibição.

| Métrica | Regra inicial |
|---|---|
| FPS atual | Janela móvel de 1 s, recalculada pelo tempo da última amostra válida com verificação independente de idade. Contar intervalos equivalentes e dividir pelo tempo coberto. Para um intervalo que cruza a borda, contar fração `sobreposição / duração`. A cobertura é a soma das sobreposições válidas. `FPS = 1000 × soma(frações) / cobertura_ms`. Antes de pelo menos dois intervalos completos e 250 ms de cobertura, mostrar “Medindo…”. Se a cobertura ficar interrompida por problema de fonte, marcar qualidade parcial. |
| Média de FPS | Usar a mesma definição de `N × 1.000 / soma dos dt` na parte válida da janela de 60 s. No aquecimento, identificar a duração observada, sem dividir por 60 s completos. Na sessão manual usar duração medida, recortes anotados e trechos válidos. |
| 1% low / 0,1% low | Ordenar intervalos da janela de 60 s em ordem decrescente. `k = ceil(N × fração)`. Aplicar `1.000 / média dos k maiores dt`. Mínimos iniciais de 300 e 3.000 amostras válidas, respectivamente. Em 30 FPS, 0,1% low pode só ficar disponível numa sessão manual mais longa. Exibir `—` com motivo “Amostra insuficiente”. |
| P95/P99 em ms | Percentis de intervalo com regra de interpolação linear por índice `(N−1) × p` documentada e testada. P95/P99 ficam rotulados como percentis, distintos da média de cauda dos lows. |
| Frametime numérico | Mediana móvel de 1 s no modo compacto. Modo detalhado acrescenta P95, pico exato e último quadro opcional com 0,1 ms. Tempo do último quadro e mediana têm rótulos distintos. |
| Engasgo | Depois de aquecer, marcar quando `dt > max(2 × mediana de 2 s, 1,5 × orçamento)` e o incremento sobre a mediana for maior que 8 ms. Calibrar limiar em 30/40/60/120 Hz antes de fixá-lo como opção padrão. Manter o pico no bruto, oferecer contagem por minuto e usar trilha de pausas para separar eventos deliberados. |
| Drop e geração | Só calcular taxa de descarte quando início e resultado do mesmo frame puderem ser vinculados. Dividir descartados por presents válidos com resultado conhecido e informar a cobertura. Quadros de teste e retornos com falha são telemetria interna, não fração do denominador. |

**Congelamento e lacuna.** Um jogo ativo pode parar por 80 ms, 780 ms ou vários segundos. Na ausência de evento e com coletor saudável, mostrar a duração aberta como região de “Sem quadros”. Ao receber o próximo evento elegível, registrar o intervalo real. Os números percentílicos não usam estimativa de uma duração ainda aberta. Lacunas confirmadas de captura ficam sem dado. À retomada, o pico não some quando a sessão continua ativa. Ao voltar de suspensão/Alt+Tab, criar segmento com razão de pausa. Um evento `unmatched` nunca é reclassificado como engasgo só pela duração.

**Custo.** Ring buffer com limite de tempo de 60 s e de amostras medido para perfil de 1.000 FPS, por exemplo 65.536 amostras por stream ativo. Evitar armazenar série por todos os processos. Agregado de FPS incremental no worker. Lows por seleção parcial ou histograma com erro medido e uma recomputação por segundo. Para exportação de benchmark, usar cálculo exato sobre o trecho solicitado. Se exceder a capacidade, sinalizar a perda e tratar as caudas como parciais.

### 6.2 Gráfico de TV

- Eixo X **por tempo**, com 6 s inicialmente e opções de 3 s e 12 s. Direita significa “agora”, com divisões de 1 ou 2 s na vista detalhada. Timestamps irregulares ocupam posições irregulares. Modo compacto mantém a mesma base temporal, ainda que tenha menos marcas.
- Eixo Y em **ms**, com orçamento de quadro da meta selecionada. Exemplos: 30 FPS → 33,33 ms, 40 → 25 ms, 60 → 16,67 ms, 90 → 11,11 ms, 120 → 8,33 ms, 144 → 6,94 ms. Usar metas automáticas somente quando a fonte for confiável e deixar visível qual meta está em uso. A meta pode ser diferente da frequência do monitor.
- Escala estável por padrão, por exemplo 0 até `max(2 × orçamento, 25 ms)`. Modo detalhado pode usar degraus 25/50/100/200/500 ms com histerese de descida de 4 s. Um pico acima da faixa ganha seta/contagem e rótulo com valor real. Não deixar um único pico encolher todo o restante sem explicação. O pico de 780 ms continua legível mesmo fora da altura.
- Renderizar pontos por timestamp ou combinar por coluna física. Cada coluna armazena mínimo, mediana e máximo de intervalos (ou mínimo/máximo e traço central, conforme o perfil). Usar envelope para proteger picos estreitos e interromper o traço sobre lacunas. Não interpolar dados faltantes. Separar “pausado”, “atrasado” e “sem novos quadros” por pequenos marcadores, com texto no painel de diagnóstico.
- Desenho do gráfico em Canvas 2D com geometria constante e resolução de dispositivo controlada, evitando refazer centenas de nós no React a cada tick. Mantê-lo recortado à área segura e silencioso em modo reduzido. Contorno do gráfico, rótulos e ícones de pico complementam cores. A vista maior abre pelo Guia para ler números e eixos. O jogador volta ao jogo com B sem trocar de alvo.

## 7. Monitoramento de recursos

### 7.1 Catálogo mínimo, unidades e escopo

| Item | Fonte recomendada e semântica | Exibição e cadência |
|---|---|---|
| CPU do sistema | Fonte Windows PDH ou API compatível com a topologia do processador. Documentar se é tempo não ocioso ou utilização relativa à capacidade nominal. Calcular deltas de tempo com relógio monotônico e não misturar os dois conceitos. | 1 Hz. Investigar máquinas com múltiplos grupos lógicos. Amostra inválida após reset/retomada volta a aquecer. |
| CPU do jogo | Tempos de processo com identidade confirmada. Normalizar pelo tempo decorrido e capacidade lógica definida. Ao agregar processo filho, incluir só subprocessos gráficos do mesmo jogo, com escopo documentado. | Opcional no detalhado com o rótulo “CPU do jogo”. Oferecer “núcleo mais ocupado” apenas se houver fonte própria e escopo claro. |
| RAM | RAM física usada/disponível no sistema, e conjunto residente ou memória privada do processo como métrica distinta. | 1 Hz. Exibir `GiB` se a escala for em base 1024 e `GB` apenas se for decimal. Nome de ambos deixa claro o escopo. |
| GPU (adaptador) | Associar a GPU de renderização pelo LUID. PDH de motores agregados com chave de LUID + adaptador físico + engine, usando a definição de motor mais ocupado quando configurada. Validar o método em sistemas híbridos e memória compartilhada. | 1 Hz por padrão. Rotular “GPU do sistema” sem associação comprovada. Renderização e saída podem ser GPUs diferentes. Uma chave ambígua não pode escolher silenciosamente o adaptador de maior VRAM. |
| GPU do jogo | Métricas por PID/engine com amostra validada, ou GPU Busy em ms por frame quando correlacionável. GPU Busy do jogo não é o mesmo indicador que utilização global da GPU. | Opcional. Mostrar fonte, unidade e janela. Só oferecer comparação de gargalo CPU/GPU quando as duas métricas de frame forem confiáveis. |
| Temperatura | D3DKMT principal, ou NVML / ADLX / IGCL conforme suporte. Distinguir temperatura de núcleo, hotspot e memória. CPU package apenas com fonte validada e disponível no usuário. | 1 Hz ou 0,5 Hz para sensores lentos. Ausência mantém alinhamento com `—`. Um sensor próximo de zero nunca vira leitura inventada. Limites podem variar por métrica. |
| Potência | W por API de fabricante que entrega potência com escopo, por exemplo NVML em mW, ADLX ou IGCL se suportado. D3DKMT fornece percentual. Usar “do limite” apenas se o denominador for comprovado no provedor. | 1 Hz. `W` e `%` são opções distintas. Não converter percentual em watts por TDP de catálogo. Registrar janela de média informada ou conhecida. |
| Ventoinha, clocks | RPM via D3DKMT ou vendor quando disponível. Percentual da ventoinha, clock efetivo e clock solicitado são métricas distintas. | Opcional na vista detalhada. Exibir `0 RPM` quando for zero válido e a fonte confirmar, `—` quando ausente. Evitar despertar eGPU/dGPU ociosa para uma métrica opcional. |
| VRAM | Uso dedicado do adaptador via WDDM e uso compartilhado com escopos distintos. Uso do jogo por fonte PID validada. Orçamento de processo via DXGI só é do processo que consulta. Capacidade física, memória disponível ao WDDM e orçamento não são intercambiáveis. | 1 Hz. Rotular “VRAM dedicada · placa”, “memória compartilhada” e “VRAM do jogo” conforme origem. iGPU sem VRAM dedicada deve ter estado adequado. |

Base sem driver novo. Provedores de fabricante opcionais, carregados de origens conhecidas e somente quando o dispositivo é compatível. Cada leitura tem alcance, TTL e erro próprio. Inicializar PDH com duas leituras onde exigido. Retentar contadores transitórios, refazer topologia em mudança de monitores/dispositivo, suspensão e retorno, reenumerar LUIDs com invalidação de cache. Em testes reais verificou-se um aquecimento de PDH sem número de carga no primeiro tick. Não mostrar buracos rearranjando toda a coluna. [Microsoft D3DKMT](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/d3dkmthk/ns-d3dkmthk-_d3dkmt_adapter_perfdata) · [Memória DXGI por processo](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/nf-dxgi1_4-idxgiadapter3-queryvideomemoryinfo) · [Microsoft WDDM](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/video-memory-management-and-gpu-scheduling) · [NVML](https://docs.nvidia.com/deploy/nvml-api/latest/api/group__nvmlDeviceQueries.html) · [AMD ADLX](https://gpuopen.com/adlx/) · [Intel IGCL](https://github.com/intel/drivers.gpu.control-library)

### 7.2 Custo e validação de sensor

- Separar amostradores do thread de coleta gráfica e dos locks usados pelo frame pipeline. Executar somente as famílias solicitadas pelo preset ou pelo painel. Mesclar sondas PDH compatíveis em um grupo para coleta coerente quando fizer sentido. Armazenar a janela e timestamp por sensor. Limitar reconexões de DLL/provedor e proteger captura do frame contra falha ou demora do hardware.
- Uma amostra que vence depois de 2–3 períodos normais ganha estado “Atrasado”. Falha de adaptação no meio do jogo deve tentar outro provedor comparável, registrar mudança e limpar a linha antes de mostrar a unidade nova. Não comparar amostras de janelas ou escopos diferentes como se fossem discrepância de precisão.
- Em validação, registrar amostras simultâneas e comparar pelo mesmo adaptador, fonte, janela e unidade. GPU global pode ser cotejada com Gerenciador de Tarefas ou ferramenta do fornecedor conforme semântica. Para energia, comparar apenas quando a fonte e a janela do sensor correspondem. Dados do jogo não devem ser exportados sobre outro PID por reutilização do identificador.

## 8. Overlay nativo, foco e compatibilidade

**Padrão visual.** Janela externa transparente, sem ativação, cliques, controles, Alt+Tab ou presença na barra de tarefas. Criar somente quando houver conteúdo visível ou manter uma instância reutilizável realmente oculta durante a sessão. Quando a captura está ligada e o display está no launcher, Guia ou outra janela normal, o HWND fica oculto nativamente. A alteração de aparência preserva a janela e o provedor em execução. Em fechamento normal do jogo, ocultar imediatamente para que o launcher volte com a tela limpa.

**Monitor e DPI.** Determinar a saída do jogo pelo HWND ou fonte gráfica. Usar retângulo físico e DPI do monitor no posicionamento. O CSS trabalha em pixels lógicos do WebView. Tratar mudança de monitor, `WM_DPICHANGED`, fullscreen, alta resolução, coordenadas negativas e layout de monitores com escalas diferentes. Em trilha inicial, permitir margem segura do tamanho da diagonal e posição padrão superior esquerda. Em TV ou 4K, a interface mostra tamanho de leitura, caixa dentro da área visível e ajuste com prévia. Sem calcular caixa apenas como proporção de largura primária.

**Z-order.** O OSD reclama topo só quando eventos de foco/monitor e a política de visibilidade pedem. Manter a precedência do Guia e preservar o foco do jogo e do launcher. Se houver outro topmost ou mudança repetida, suspender a tentativa e expor estado em diagnóstico. Redimensionamento deve acontecer no máximo após debounce de mudanças de janela e escala. Priorizar reduzir a área real da superfície transparente em presets mínimos. Preservar comportamento com cursor e gamepad.

**Composição e fullscreen.** Validar janela, sem bordas, optimizations, iFlip/MPO, VRR e HDR. Captura pode funcionar quando overlay externo não consegue desenhar. Em tela cheia exclusiva incompatível, coletar e exibir resumo no Guia/launcher quando possível e orientar modo sem bordas na tela de diagnóstico. Não alterar o modo de vídeo do jogo sem escolha. Não implementar injeção, driver próprio, contorno de restrições do anticheat nem prometer compatibilidade universal. Comparar OSD WebView2/Canvas com renderer nativo leve apenas se falhar em medições de latência ou composição. Um renderer nativo ainda enfrenta o compositor e modo de saída. [DXGI flip model](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/dxgi-flip-model) · [Limites do overlay FrameView](https://www.nvidia.com/en-in/geforce/technologies/frameview/release-notes/)

## 9. Experiência pelo controle

### 9.1 Níveis rápidos

| Nível | Definição | Como o jogador usa |
|---|---|---|
| Desligado | Captura e OSD fora de execução. | Seção Desempenho do Guia. Permanece escolha global. |
| Essencial | FPS da fonte escolhida, com rótulo curto quando for fallback. | Acompanhamento sem cobrir o HUD do jogo. |
| Jogabilidade | FPS + frametime mediano, faixa temporal de picos, GPU e CPU resumidas. | Padrão sugerido ao ativar pela primeira vez. Preserva ajustes dos usuários que já tinham o contador ativo. |
| Detalhado | Média/lows, origem do FPS, gráfico com eixos, CPU/GPU/RAM/VRAM/temperatura/potência conforme capacidades. | Visualização de diagnóstico que pode usar duas linhas ou coluna. Limitar densidade ao preset e ao monitor. |
| Personalizado | Campos, posição, escala e cores já existentes, mais origem, janela temporal e meta. | Configurações em Geral, Métricas, Apresentação e Diagnóstico. |

Manter `A` para abrir ou alternar a ação em foco, `←/→` para mudar valor, LB/RB para navegar nas abas e `B` para retornar ao acionador. O Guia informa “Desligado”, “Ligado · medindo”, “Verificando…”, “Atrasado” ou a causa resumida. Se o usuário alternar um nível pelo Guia, o painel confirma o aplicado e mantém o foco na linha. Nas telas longas, navegação pelo direcional sempre traz a primeira linha e o título de volta quando atinge o topo.

### 9.2 Afinar para TV

- Casas decimais estáveis, número tabular, hierarquia FPS → ms → sensores, leitura com contraste em fundo claro/escuro e HDR. Sem animação decorativa no card. Pisos de legibilidade devem passar em TV Full HD a distância de uso e em 4K. Testar fundo transparente em cena clara, borda e sombra quando necessárias e oferecer fundo sólido de alta legibilidade.
- A evolução do gráfico não altera o tamanho da caixa. A linha detalhada se reorganiza em duas ou mais quando o texto não couber. Não renderizar uma caixa vazia quando o usuário ocultar todos os itens. Ao salvar um preset com apenas métrica de captura indisponível, mostrar o estado daquela métrica. Motivo específico ganha frase curta em Configurações.
- A prévia sempre diz “Dados de exemplo” se há frames simulados. Hardware real em combinação com simulação recebe um rótulo separado. Mesma composição, mesma unidade e mesma lógica de escala do OSD. Congelar exemplo quando fora da tela, desligar a animação no modo de movimento reduzido e preservar a opção de inspecionar um pico.
- Usar `t()`, `te()` e formatação local do projeto. PT, EN e ES devem caber a 70/100/150% da interface. O tamanho do OSD também tem extremos próprios de 40–200%, testados separadamente. O padrão de layout segue cabeçalho, lista focável à esquerda, prévia e diagnóstico à direita, rodapé fixo. Iconografia sinaliza picos e status além da cor.

### 9.3 Painel de diagnóstico e medição de sessão

Ao abrir pelo Guia, mostrar jogo, fonte e tipo de frame, adaptador, modo de apresentação, idade da última amostra, último estado de erro e razão para um item oculto. Durante a coleta, opção “Iniciar sessão de medição”. A ação oposta é “Encerrar e ver resumo”. Resumo inclui duração, segmentos válidos e interrompidos, média, 1%, 0,1% low, mediana, P95, P99 em ms, contagem de exibição/drop quando disponível e lista de piores picos com timestamp. “Reiniciar histórico” exige ação do jogador, não aparece junto de controles destrutivos.

CSV local sob ação explícita, com código de versão, origem das métricas, relógio relativo, unidade, intervalos e flags de qualidade. Um segundo arquivo com amostras de hardware é opção, identificado pela mesma sessão. Exportação não entra no loop de captura e deve concluir de forma atômica. Rotina de diagnóstico não envia dados nem agrega outros processos, nomes de usuário ou caminhos completos. Um diagnóstico curto em memória facilita reproduzir travas. Reservar ETL detalhado para o modo de desenvolvedor acionado explicitamente.

## 10. Configuração e migração

- Definir esquema no Rust e gerar ou testar o contrato consumido pelo TS. Validar enumerações, posições, números finitos, limites da escala/opacidade, ordenação de faixas e cores com formatos conhecidos. Migração explícita de `perf.json` legado: preservar enabled, onlyInGame, layout, escala, posição e itens. Inicializar os novos campos com padrão, mantendo equivalente aos presets antigos. Dados inválidos têm fallback por campo e observação de erro visível em diagnóstico.
- Patch com `expectedRevision` ou comandos idempotentes e fila serial que resolve a ordem dos pedidos do Guia e Configurações. Calcular nova versão sem publicar, validar, gravar temp na mesma pasta, sincronizar, substituir atomicamente, publicar revisão confirmada e aplicar o estado. Se houver erro de escrita, retornar erro com a versão anterior. Estado de falha na criação da janela fica separado de “preferência salva”. O arquivo parcialmente ou totalmente ilegível preserva a última revisão válida quando possível.
- `enabled` é preferência, `captureState` é saúde operacional e `overlayState` é visibilidade efetiva. Esses estados podem divergir durante uma transição. Não esconder uma falha com debounce. Coalescer duplo clique como o estado final explícito na fila e permitir repetir após rollback. As janelas se atualizam pelo mesmo evento.
- Controlar o dono de eventos de diagnóstico e CSV. Evitar logs por quadro por padrão. Retenção limitada por tamanho e tempo com caminho local. Nunca abrir rede para obter contadores. Atualização do launcher é compatível com configuração existente e com rollback, com teste de ida e volta.

## 11. Sequência de implementação

| Fase | Escopo | Critério de saída |
|---|---|---|
| 0. Referência reproduzível | Colocar carga sintética e replay no ambiente de QA, snapshot do benchmark atual, trace alinhado pelo mesmo QPC e protocolo de medição. Documentar decisões sobre dependência e redistribuição. | Uma execução automatizada reproduz cadeia dupla, DXGI TEST, pausa longa, 4 FPS e a corrida de start/stop. É possível conferir a captura pelo PresentMon. |
| 1. Motor e identidade | Backend correlacionado, seleção de jogo e cadeia, cancelamento e sessão ETW supervisionada, integridade, sequência e estado de disponibilidade. Fonte principal inicialmente “FPS apresentado”. | FPS-01 a FPS-06 e FPS-08 fechados nos casos controlados. Captura real tem precisão e frescor de §12. O backend distingue resultado de present e cadeia sem habilitar overlay adicional ou elevar o launcher. |
| 2. Estatística e renderização | Métricas normativas, gráfico em segundos, processamento incremental, transporte com cache e diagnóstico de idade, Configurações e Guia sincronizados. | FPS-07, FPS-09 a FPS-11, FPS-16, FPS-17 e FPS-19 fechados. Validação em três idiomas, TV, IPC intermitente e gráfico com picos reais e faltas. |
| 3. Visibilidade e configuração | Posicionamento pela saída do jogo, foco e overlay nativo, migração e gravação atômica, tratamento da permissão. | FPS-12, FPS-15 e FPS-18 fechados. Cenários de desligamento, Guia, TV/exclusivo e recuperação do processo passam. |
| 4. Sensores e medições avançadas | LUID e fontes de CPU/GPU/RAM/VRAM, testes de provedores, captura “exibido” e distinção de geração quando a fonte oferecer. Adicionar captura manual/CSV. | FPS-13 e FPS-14 fechados. A origem de cada métrica é verificável. AMD/Intel/NVIDIA e sistemas híbridos testados por capacidade. |

Nas fases 1–3, manter a interface e o arquivo de configuração compatíveis. Durante desenvolvimento, oferecer comparação lado a lado no diagnóstico, com cada fonte identificada pelo rótulo da métrica. Se o novo motor estiver indisponível, manter hardware e informar FPS indisponível. Um eventual modo de comparação do capturador anterior deve identificar “Chamadas Present · diagnóstico” e ficar fora do padrão de uso.

## 12. Aceite técnico e roteiro de QA

Os números abaixo são **metas de liberação propostas**. Medir em build de release. Separar erro de contagem, latência de entrega, efeito visual e custo no jogo, com classificação por dispositivo e modo gráfico.

### 12.1 Metas mensuráveis

| Métrica | Meta proposta | Como aferir |
|---|---|---|
| Atribuição e contagem | Zero troca de alvo indevida nos testes determinísticos. Mesma cadeia e tipo de métrica da referência. Erro no FPS médio ≤ máx(0,5 FPS, 1%) com fontes alinhadas. | Comparar replay e captura paralela com PresentMon e QPC do fixture, na região estável. Fase dupla e DXGI TEST não alteram o mesmo alvo. Separar descartes em tabela. |
| Intervalos de quadro | Erro absoluto P95 ≤ 0,2 ms para streams alinhados no ensaio controlado. Picos de 80, 180, 780 e 1.800 ms mantêm ordem e magnitude, dentro de ±1 ms no replay e ±5 ms na carga controlada. | Comparar timestamps pareados antes de agregação. Em VRR, comparar apenas a semântica equivalente e documentar o modo. Verificar que lacunas ficam visíveis. |
| Média e lows | Na mesma janela e fórmula, erro ≤ máx(0,5 FPS, 1%) para a média e ≤ máx(1 FPS, 3%) nos lows. Testes unitários de cálculo determinístico com tolerância de ponto flutuante. | Calcular a fórmula interna sobre o CSV da referência. A comparação direta exige alinhamento de percentil e janela. |
| Atraso da captura | Origem → callback P95 ≤ 250 ms em carga-alvo, com objetivo de mediana ≤ 120 ms. Callback → amostra publicada P95 ≤ 50 ms em execução estável. | Medir QPC e publicar p50, p95, p99 e pior caso. Medir ETW sob baixa taxa de eventos e carga alta. Contar perdas de todos os estágios. |
| Frescor e pintura | Origem → gráfico atualizado P95 ≤ 350 ms em jogo de carga representativa. Quando não houver dado atual, estado degrada em até 500 ms mais um tick visual. Após degrau de FPS, número converge para a nova cadência em até 1,3 s, incluindo a janela de 1 s. | Correlacionar QPC do frame, recepção e ACK pelo overlay. Comprovar transição com captura externa se necessário. Latência do gráfico e estabilização do número são medidas separadas. |
| Efeito no jogo | FPS médio com overlay ligado perde ≤ 1% e P99 de tempo de quadro piora ≤ máx(0,5 ms, 3%) na matriz principal. Nenhuma mudança recorrente de modo de composição ou perda de VRR em modo suportado. | Três a cinco passadas alternadas nas mesmas condições por perfil. Reportar dispersão e aumentar repetições se ela superar a margem. Comparar desligado, captura oculta, OSD simples e detalhado. |
| Custo do próprio monitor | Orçamento inicial de ≤ 1 ponto percentual de CPU total em média, memória incremental ≤ 90 MiB no preset Jogabilidade, overlay em repouso sem polling e sem sessão. | PerfMon/WPA e métricas do processo. Isolar processos WebView adicionais e preparar transição de monitor. Medir nos perfis simples e detalhado. |
| Robustez | 100 ciclos de ligar/desligar com estado final correto, nenhum handle/sessão órfã após saída normal, 60 min de execução sem crescimento contínuo de memória e 20 trocas de foco sem misturar gerações. | Incluir encerramento forçado seguido de nova instância, reinício quente, suspensão, IPC lento e reconexão do driver. Checar código e razão de desligamento. |
| Presença visual e foco | Nenhuma ativação indevida, perda de comando para o jogo ou disputa com Guia. Conteúdo inteiro no monitor alvo, leitura conforme perfil de distância, sem piscada decorrente da subida de Z-order. | Verificar HWND e captura de monitor. A evidência externa é necessária para distinguir apagão físico de defeito somente na captura de tela. |

### 12.2 Automação recomendada

1. **Simulação matemática e metamórfica.** Séries estáveis a 4, 24, 30, 40, 59,94, 60, 90, 120, 144, 240 e 1.000 FPS. Intervalos alternados 6/14 ms, degrau 60→30→4, corrida de duas cadeias, duplicatas e mesmo timestamp, QPC fora de ordem, relógio fora da faixa, dados vazios, retomada e uma amostra. Alterar a forma dos lotes sem alterar os timestamps deve preservar os números válidos. Present de teste é neutro para o stream escolhido.
2. **Resultados de apresentação.** Exercitar `DXGI_PRESENT_TEST`, retorno de erro, janela inativa, descarte, oclusão, tearing, composição, recriação de swapchain e reinicialização do driver. No replay, amostrar aplicativo/exibido/gerado e injetar ausência de informação. Exibido exige confirmação da correlação.
3. **Falhas ETW e IPC.** Acesso negado, falha de provedor, sessão em início e fim, erro de ProcessTrace, perda de buffer, fila saturada, mensagem atrasada de sessão antiga, rejeição ou timeout do frontend. Confirmar que Guia e configurações invalidam amostras antigas e podem se recuperar. Testar reenvio com estado acumulado.
4. **Configuração.** `perf.json` antigo, registro inválido, arquivo truncado, acesso negado, duas gravações disputando, desligar no início da captura, atualização e restauração. Apertar A/←/→ rapidamente em duas janelas e verificar consistência entre pedido, persistência, captura e janela.
5. **HUD.** Imagem a cada pico esperado, gráfico vazio, somente low 0,1%, apenas hardware, layout horizontal estreito e dados ausentes, todas as posições, duas linhas no detalhado, texto PT/EN/ES, 70/100/150% da UI e extremos do OSD. Verificar geometria interna. Testar retorno de foco, modal do Guia e acessibilidade na tela de diagnóstico.

### 12.3 Matriz nativa antes de liberar

| Dimensão | Casos mínimos e critério |
|---|---|
| Hardware e versão de sistema | NVIDIA, AMD e Intel, incluindo iGPU e notebook híbrido com renderização e saída separadas. Windows 11 estável suportado além do build usado nesta auditoria. Na máquina atual repetir com o driver em uso e registrar a versão. |
| APIs e modos | DX9 legado, DX11, DX12, Vulkan, OpenGL e aplicativo DXVK/segunda cadeia. Janela, sem bordas, exclusivo e otimização de tela cheia. Registrar o que cada combinação reporta e a reação quando o OSD externo é incompatível. |
| Steam/Epic/jogo externo | Steam e Epic em caminho padrão e personalizado, mais um executável externo. Usar exemplos disponíveis do usuário quando apropriado, incluindo The Witcher 3 e Absolute Drift, confirmando primeiro a API efetiva. Checar launcher intermediário, jogo com vídeo/menu, múltiplos processos e fechamento com retorno à Home. |
| Melhorias de imagem e saída | 60/120/144 Hz quando disponíveis, VRR ligado/desligado, HDR, vsync e tearing quando elegível, saída secundária à esquerda e à direita com escalas diferentes. Geração de quadros em configuração compatível e verificação base/apresentado/exibido somente quando a fonte distingue os tipos. |
| Sobreposição e interferência | Jogo sem OSD, somente captura, OSD atual e novo. NVIDIA App, Steam e RTSS em corridas separadas. Outros overlays simultâneos somente no teste de conflito. Guia aberto durante 20 ciclos. Registrar fallback se um título ou anticheat impedir OSD ou métricas. |
| Robustez e recursos | 60 min em janela e sem bordas. Alt+Tab repetido, troca de monitor, sleep/resume, driver reset controlado em ambiente de teste, reinício do launcher com contador ligado, modo console, usuário sem permissão e recuperação após novo login. Sensores com zero, indisponível e timeout ficam visualmente distintos. |

**Protocolo de comparação.** Fixar versão de jogo, resolução, preset, VSync, limite, energia e estado de janela. Usar benchmark interno repetível ou cena automatizada. Iniciar a referência com processo e sessão ETW isolados. Exportar QPC e parear nome de jogo, PID, chain, modo, origem e recortes de tempo. Remover aquecimento explicitamente e publicar duração e dispersão. Para medir overhead, fazer também a sequência sem o coletor de referência e estimar por execução separada, pois duas capturas podem somar overhead. Se P95 bruto estiver acima do orçamento, medir método e carga do fornecedor antes de aumentar a cadência visual.

## 13. Evidências locais

Arquivos gerados na auditoria, guardados fora do repositório.

- Figura da medição Direct3D (`medicao-etw-d3d11.png`) · Medidas e série temporal (`resultados.json`) · Presents e timestamps de referência (`presentmon.csv`).
- Resultados do replay (`replay.jsonl`) · Ensaio de início/parada (`rapid.jsonl`) · Dados do amostrador real (`hardware.jsonl`).
- Ensaio com flush explícito (`flush.jsonl`) · Eventos da carga com flush (`etw-events.csv`).
- Provas do componente (`ui-results.json`) · Framegraph atual e falha de IPC (`ui-graph-ipc.png`) · Corte horizontal em espanhol (`ui-horizontal-es.png`).
- O código da carga e a ferramenta de auditoria estão no diretório de trabalho, fora do repositório. Carga Direct3D (`probe-render.rs`) · Observador e replay (`main.rs`).
