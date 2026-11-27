# Console Launcher 0.1.6 — tela preta e piscadas no menu do Guia

26/11/2026. Investigação feita no PC console, ligado a uma TV 4K a 120 Hz (placa AMD), com o **The Witcher 3** em tela cheia.
Foram gravados os quadros apresentados na tela (PresentMon), as janelas do Windows a cada 30 ms, fotos da tela e o
registro do Windows.

## O problema

Ao apertar o Guia com um jogo aberto, a tela piscava ou ficava preta por alguns segundos, o menu às vezes aparecia cortado
e a navegação falhava.

## O que causava

### 1. O launcher pausava o processo do jogo

Para o controle não mexer no jogo, o processo dele era congelado enquanto o menu estava aberto.

- Um jogo congelado para de entregar imagem e não responde ao Windows, que o marcou como **"Não respondendo"** e chegou a
  trazê-lo para a frente da Biblioteca, parado.
- Em uma das aberturas, atualizações enviadas pelo menu deixaram de ser exibidas e, cerca de 30 segundos depois de ele
  abrir, o Windows registrou a **TV como desconectada**; ela voltou em 4K a **30 Hz** e com outra escala. A relação com a
  pausa é provável, mas não foi reproduzida de propósito.

### 2. O jogo em tela cheia exclusiva se minimizava

Sem a pausa, apareceu a segunda causa:

- se o menu **pegava o foco**, o jogo se minimizava em 0,1 s, mostrando o launcher no lugar dele;
- mesmo **sem tirar o foco**, o jogo se minimizava cerca de **1 s depois** de qualquer janela comum cobrir parte dele.

Testando janelas diferentes por cima do jogo, só uma **que deixa o clique passar** (como a do contador de FPS) não o fez sair
da tela cheia. Cada minimização e volta troca o modo de vídeo: **1 a 2,5 segundos** sem imagem do jogo.

### 3. O menu não se ajustava à tela

Quando a resolução ou a escala mudavam com o launcher aberto, o painel ficava maior que a tela e cortado embaixo.

## O que foi feito

| Correção | Efeito |
|---|---|
| A pausa do jogo vem **desligada**. Continua disponível em **Configurações › Menu Guia › Pausar o jogo com o Guia aberto** | O jogo segue entregando imagem; fim do "Não respondendo" |
| Sobre um jogo, o painel **deixa o clique passar** | O jogo não se minimiza mais |
| Em tela cheia exclusiva, o **foco fica com o jogo**; em janela sem bordas, o menu pega o foco | Sem troca de modo de vídeo ao abrir e fechar |
| Um jogo que se minimizar ao perder o foco passa a ser lembrado enquanto o launcher estiver aberto | Da segunda vez o foco fica com ele |
| O painel confere a própria posição e tamanho duas vezes por segundo | Volta ao lugar se a TV mudar de resolução ou escala |
| Menu mais compacto | Todas as opções cabem numa TV 16:9, sem rolar |
| Correção: **Forçar o fechamento** aparecia para um jogo fechado e aberto de novo | Vale só para o jogo que recebeu o pedido |
| Registro em `%LOCALAPPDATA%\app.launcher.desktop\logs\launcher.log` | Um problema futuro pode ser investigado depois de acontecer |

## Resultado medido

| Situação | Antes | Depois |
|---|---|---|
| Quadros do jogo com o menu aberto (0.1.5, com a pausa) | nenhum | **cerca de 76 por segundo** |
| Maior intervalo sem quadro do jogo ao abrir ou fechar, com o menu tirando o foco | 1.000 a 2.500 ms | **no máximo 53 ms** |
| Jogo minimizado ao abrir o menu, sem a pausa | em todas as aberturas | **nenhuma vez** |
| TV desconectada com o menu aberto | 1 vez (0.1.5) | **nenhuma** |

Roteiro repetido na versão corrigida: abrir e fechar várias vezes, percorrer o menu inteiro nos dois sentidos, apertos
seguidos no Guia, ir à Biblioteca e navegar nela, abrir o Guia sobre o launcher, voltar ao jogo e abrir com o contador de
FPS ligado.

## Limites que continuam

- **Tela cheia exclusiva: o jogo também recebe o controle.** Com o menu aberto, os botões chegam aos dois, e o menu avisa
  isso. Para evitar, escolha **janela sem bordas** nas opções de vídeo do jogo (no The Witcher 3: Opções › Vídeo › Modo de
  tela).
- **Ir à Biblioteca ou ao Início** com um jogo em tela cheia exclusiva ainda troca o modo de vídeo na ida e na volta: é o
  jogo saindo e voltando à tela cheia (cerca de 1 a 2 segundos em cada sentido).
- A TV também foi registrada como desconectada uma vez **sem o menu aberto**, enquanto o jogo carregava. Isso não vem do
  launcher; se voltar a acontecer, confira o cabo HDMI (de 48 Gbps para 4K a 120 Hz) e as opções de modo de jogo da TV.

## Como foi conferido

- Os testes foram automáticos, por gatilhos de uma versão de diagnóstico que não é publicada. Os apertos foram simulados:
  falta conferir com o controle físico.
- Só um jogo foi testado, em tela cheia exclusiva. **Jogo em janela sem bordas e jogos da Epic não foram testados.**
- Também não foram exercitados na versão corrigida: o reajuste do painel numa troca de resolução, a opção de pausar ligada,
  a lembrança de um jogo que se minimiza e a correção do fechamento forçado (esta tem teste automatizado).
- A medição vê o que o Windows entrega à tela; um apagão da própria TV só aparece quando o Windows registra a desconexão.
