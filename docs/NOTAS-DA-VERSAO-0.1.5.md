# Console Launcher 0.1.5 — notas da versão

Publicada em 25/11/2026. O texto curto que o jogador lê no aviso de atualização está em
[NOVIDADES.md](NOVIDADES.md).

## O que muda para quem joga

### Jogo que não fecha

- Se o jogo perder a janela e continuar rodando depois de **Fechar o jogo** (aconteceu com o The Witcher 3), o launcher vem
  para a frente e oferece **Esperar** ou **Forçar o fechamento**.
- No menu do Guia, a opção vira **Forçar o fechamento** quando o jogo está sem janela ou 10 segundos depois do pedido.
- O menu do jogo, a tela dele e a tentativa de abrir outro jogo oferecem a mesma saída.
- Sempre há confirmação. São encerrados só os processos do jogo, nunca a Steam, o Windows ou o próprio launcher.

### Atualização e reinício

- Depois de uma atualização, o launcher **sugere reiniciar o PC** (botões **Depois** e **Reiniciar agora**, com o foco em
  **Depois**). O aviso espera a abertura em vídeo terminar e aparece no Início, sem jogo aberto. Se o modo console estiver
  ligado e fora de uso, o aviso diz que ele só volta depois de reiniciar.
- A contagem para reiniciar caiu de **15 para 5 segundos**, também no modo console.

### Menu do Guia

- Voltar ao jogo ou ao launcher não fica mais esperando para sempre um botão ser solto: o limite é de 1,5 segundo, e os
  analógicos não entram nessa espera.
- Se a página do menu parar de responder, o botão **B** fecha o menu, e depois de 5 segundos ele fecha sozinho, retomando o jogo.
- Perguntas sem resposta têm prazo: o menu mostra **Tentar de novo** em vez de ficar em "Carregando…".
- O foco nunca começa numa ação que encerra o jogo. Sem janela para voltar, começa em **Início**.
- Com o jogo parado, o menu diz **Pausado enquanto o menu está aberto**.
- Abrir ou fechar o menu cancela as tentativas anteriores de trazer uma janela para a frente.

### Fechar, abrir e sair

- Fechar a janela principal (Alt+F4) encerra o launcher inteiro. Antes ele podia continuar rodando sem tela. No modo console,
  o vigia o abre de novo.
- Abrir o launcher com ele já aberto traz a janela existente para a frente, sem criar uma segunda cópia.
- **Sair para a área de trabalho** minimiza só o jogo. As outras janelas ficam como estavam.

### Outras correções

- O contador de FPS se esconde enquanto o Guia está aberto, se estiver do lado esquerdo (onde o menu aparece).
- F11 recebido pelo menu do Guia não altera mais o tamanho do painel.
- Alternar tela cheia com um jogo aberto não faz o launcher esquecer o jogo.
- "Tela cheia" no assistente e nas Configurações se atualiza também depois do F11.
- Interface a 150%: o jogo em foco na Biblioteca cabe inteiro na tela.
- Abertura em vídeo: se o vídeo parar de avançar, o launcher aparece depois de 1,5 segundo.
- Abertura de jogo parada na mesma etapa por 5 minutos passa a oferecer **Parar de aguardar**.

## Resposta à auditoria de foco, Guia e transições

Base: relatório `AUDITORIA-FOCO-GUIA-E-TRANSICOES-2026-11-25.md`, feito sobre a 0.1.4.

**Resultado dos 19 achados:** 8 aplicados, 7 aplicados em parte, 4 não aplicados.

Como ler a última coluna: **App real** = executado no launcher de desenvolvimento neste PC; **Navegador** = tela com dados
simulados; **Teste** = teste automatizado; **Compilação** = só compilou, o comportamento não foi exercitado.

| Id | Veredito | O que mudou e o que ficou de fora | Conferido |
|---|---|---|---|
| UX-01 · fechar deixa processo vivo | **Aplicado** | Um só encerramento para fechar a janela e sair; libera o jogo, o contador e a Steam; se travar, o processo sai em 3 s. Sem os 20 ciclos pedidos. | App real: 2 fechamentos, processo encerrado em menos de 0,1 s. |
| UX-02 · duas instâncias | **Aplicado** | A segunda abertura pede à primeira que apareça e sai. Sem resposta em 12 s (travada ou fechando), a nova assume. O início automático continua saindo em silêncio. | Teste; app real: segunda abertura saiu em 0,6 s. |
| UX-03 · espera sem prazo | **Em parte** | Espera limitada a 1,5 s e sem os analógicos. Não filtra por controle. A recuperação se o launcher cair depende de o Windows soltar o congelamento, não testada. | Compilação. |
| UX-04 · jogo parado e transição | **Não aplicado** | Pede um coordenador de transições. Entrou só o aviso de jogo pausado. O intervalo entre o painel sair e o launcher aparecer continua. | Navegador (aviso). |
| UX-05 · foco de ação antiga | **Em parte** | Cada abertura e fechamento do Guia cancela as insistências anteriores. Sem identificador único para ordem de janelas e Steam; o recurso do Alt continua. | Compilação. |
| UX-06 · fim do jogo | **Em parte** | Coberto o jogo vivo sem janela (fechamento forçado) e o F11. Sem a máquina de estados proposta. | Teste com um jogo falso travado; teste do F11. |
| UX-07 · menu sem resposta | **Aplicado** | Prazos de 1 s (controle) e 4 s (menu), uma leitura por vez e saída direta pelo controle. A visibilidade continua por consulta, não por evento. | Navegador; app real: menu travado fechado em 5 s, e menu saudável não foi fechado. |
| UX-08 · comandos vazando | **Não aplicado** | Precisa de controles físicos e de um jogo que leia em segundo plano. | — |
| UX-09 · Steam no arranque | **Não aplicado** | Encerrar o overlay da Steam foi um pedido anterior; mudar a política exige captura de tela. | — |
| UX-10 · composição e apagões | **Não aplicado** | Hipótese não comprovada; pede medição com câmera no monitor. | — |
| UX-11 · alvo do retorno | **Em parte** | Guia, menu do jogo e ficha usam a mesma consulta de situação do jogo; campo ausente não esconde "Voltar ao jogo". Sem o contrato único. | Navegador. |
| UX-12 · F11 na janela errada | **Aplicado** | Só a janela principal troca de modo; o jogo aberto continua conhecido. | App real (F11 pelo Guia ignorado); teste. |
| UX-13 · abertura em vídeo | **Em parte** | Detecta vídeo parado. Sem marca estática antes do primeiro quadro; F11 durante a abertura continua passando. | Compilação. |
| UX-14 · foco no Guia | **Em parte** | Foco inicial nunca em ação destrutiva. Cabeçalho e rodapé fixos e painel em modo janela não mudaram. | Navegador. |
| UX-15 · abertura pendente | **Em parte** | "Parar de aguardar" após 5 minutos sem mudar de etapa. Sem a separação entre a tarefa da loja e a intenção de abrir. | Compilação. |
| UX-16 · sair para o desktop | **Aplicado** | Retoma e minimiza só o jogo. | Compilação. Modo console não testado. |
| UX-17 · escala grande | **Aplicado** | Teto de altura para os cards com a interface ampliada; em 100% nada muda. Downloads e Guia não foram remedidos. | Navegador a 720p, 100% e 150%. |
| UX-18 · FPS sobre o Guia | **Aplicado** | Escondido enquanto o Guia está aberto, só quando cairia sobre o painel. | Teste. Sem jogo real. |
| UX-19 · indicador de tela cheia | **Aplicado** | Assistente e Configurações releem o estado após qualquer troca. | Compilação. |

A matriz de regressão da auditoria (seção 6) **não** foi executada.

## Verificações

- `npm run build` (traduções com 0 erros, TypeScript e empacotamento): passou.
- `cargo test --lib`: 137 aprovados, 29 ignorados. Teste do jogo falso travado (rodado à parte): passou.
- `cargo build --release`: passou com o código final.
- Launcher de desenvolvimento: abertura duplicada, F11 pelo Guia, menu travado e fechamento da janela.

## Falta conferir no PC console

1. Fechar o The Witcher 3 pelo Guia e, se ficar preso, usar **Forçar o fechamento**.
2. Abrir o Guia sobre um jogo, voltar ao jogo e ir à Biblioteca, com o controle físico.
3. **Sair para a área de trabalho** no modo console.
4. Contador de FPS do lado esquerdo com o Guia aberto sobre um jogo.
5. A sugestão de reinício depois de atualizar para a 0.1.5 e o retorno do modo console após reiniciar.
6. O Windows Defender: a versão nova não é assinada, e a 0.1.2 foi removida por ele.
