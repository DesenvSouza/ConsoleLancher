# Changelog — monitor de desempenho

Resposta à [ESPECIFICACAO-MONITOR-DESEMPENHO.md](ESPECIFICACAO-MONITOR-DESEMPENHO.md), seção 3 (19 correções). Cada item foi
conferido no código antes da mudança.

**Resultado:** 9 aplicados, 8 aplicados em parte, 2 não aplicados. A reconstrução proposta nas demais seções (motor PresentMon,
níveis rápidos, painel de diagnóstico, medição de sessão e CSV, sensores por fabricante) **não** foi feita.

## O que você vai notar

- O FPS aparece depois de um instante ("Medindo…"). O **1% low** aparece depois de 300 quadros e o **0,1% low** depois de 3.000
  no último minuto (cerca de 50 s a 60 FPS). Antes disso mostram "—".
- Sem quadros por mais de 1,2 s, o número some e entra "Sem quadros há N s".
- O gráfico mostra os últimos 6 segundos: travadas aparecem como barras altas (com o valor, se passarem da escala) e buracos.
- O frametime é a **mediana** do último segundo.
- Item ligado sem leitura mostra "—" em vez de sumir.

## Correções

| Id | Veredito | O que mudou | Como foi conferido |
|---|---|---|---|
| FPS-01 · superfícies e chamadas de teste | **Em parte** | Quadros separados por superfície; `DXGI_PRESENT_TEST` ignorado; a superfície principal não é trocada por uma auxiliar mais rápida. Não correlaciona o resultado (descartado, exibido). | Testes de leitura do aviso e da escolha; captura real leu a superfície e 30 FPS de um programa neste PC. Sem o cenário de duas superfícies num jogo. |
| FPS-02 · atraso da captura | **Em parte** | Entrega forçada a cada 100 ms; a idade do último quadro vai para a tela. Não mede cada estágio. | Idade de 186 ms numa leitura real. |
| FPS-03 · leitura velha como atual | **Aplicado** | O número "de agora" só vale com quadro recente; a permanência do cartão não renova o número. | Teste de idade; regra na tela sem teste automatizado. |
| FPS-04 · travadas apagadas | **Aplicado** | Travadas com o jogo na frente ficam no histórico. Intervalo com o jogo fora da frente é pausa. Acima de 20 s não conta. | Testes com 80, 180, 780 e 1.866,7 ms e com pausa. |
| FPS-05 · ligar e desligar | **Aplicado** | Desligar invalida a execução antes de tudo; avisos de sessão antiga são ignorados; "ligado" só depois de a leitura abrir; erro de leitura vira falha. | 100 ciclos reais, sem sessão sobrando. |
| FPS-06 · escolha do jogo | **Em parte** | Fim do mínimo de 5 FPS; o jogo que o launcher sabe estar aberto (Steam/Epic) tem prioridade; nome de programa não é guardado quando falha e é esquecido quando ele sai. Sem identidade por hora de criação e janela, nem escolha manual. | Compilação; 4 FPS coberto no teste das contas. |
| FPS-07 · FPS com amostra parcial | **Aplicado** | FPS calculado sobre o tempo coberto, com amostra mínima. | Testes de 4 a 1.000 FPS. |
| FPS-08 · aviso fora de ordem | **Aplicado** | Atrasado ou repetido é descartado sem mover a referência. | Teste com a sequência da especificação. |
| FPS-09 · gráfico | **Aplicado** | Eixo por tempo, escala fixa, marca de pico e valor. Continua em SVG. | Testes das colunas; imagem no navegador com dados de exemplo. |
| FPS-10 · respostas que falham | **Em parte** | Limite de 1,5 s por pedido, resposta atrasada descartada, "Leitura atrasada". Continua por consulta periódica. | Compilação. |
| FPS-11 · trabalho dentro da trava | **Em parte** | Consultas ao Windows saíram da trava; "lows" calculados 1 vez por segundo. As contas ainda são feitas com a trava. | Compilação; custo não medido. |
| FPS-12 · monitor e janela | **Em parte** | A janela vai para o monitor do jogo e é escondida de verdade quando não há o que mostrar. Troca de escala durante o jogo não tratada à parte. | Teste da regra; no launcher de desenvolvimento a janela ficou escondida com o launcher na frente e apareceu com outra janela na frente. |
| FPS-13 · placa usada pelo jogo | **Não aplicado** | Continua a placa com mais memória. Exige ligar cada jogo à sua placa. | — |
| FPS-14 · dado indisponível | **Em parte** | "—" nos itens sem leitura. Sem origem e idade por métrica; potência continua em % do limite. | Compilação. |
| FPS-15 · gravação | **Aplicado** | Gravação em arquivo temporário e troca de uma vez, um pedido por vez; se falhar, nada muda e a tela desfaz com aviso. | Teste de gravação e de erro. |
| FPS-16 · estados | **Em parte** | Guia mostra falha; cartão só com 0,1% low não fica vazio; a prévia só anima o exemplo sem jogo. | Compilação. |
| FPS-17 · faixa cortada | **Aplicado** | Em linha, o conteúdo quebra em vez de sair da janela. | Navegador a 652 px: nada fora da janela. |
| FPS-18 · permissão | **Não aplicado** | Continua a consulta atual; o fluxo de administrador não foi refeito. | — |
| FPS-19 · significado do frametime | **Aplicado** | Mediana de 1 s e descrições atualizadas. | Teste da mediana; traduções en/es. |

## Verificações

- `npm run build` (tradução com 0 erros, TypeScript e empacotamento): passou.
- `cargo test --lib`: 131 aprovados, 28 ignorados.
- Rodados à parte, com a captura de verdade: leitura de superfícies e 100 ciclos de ligar e desligar.

Publicado na versão 0.1.4.

## Continua pendente (precisa de jogo e hardware)

Comparação com o PresentMon, medição de atraso e de custo durante um jogo, tela cheia exclusiva, VRR, HDR, dois monitores,
placas AMD/Intel e a matriz de aceite da seção 12.
