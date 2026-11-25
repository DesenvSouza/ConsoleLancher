# Contador de desempenho (FPS)

FPS, média, 1% low, 0,1% low, frametime (com gráfico), nome e uso do processador, nome, uso, temperatura, consumo e memória da
placa de vídeo, e memória RAM, por cima do jogo. Liga e desliga pelo menu Guia (**Desempenho › Contador de FPS**); tudo se
personaliza em **Configurações › Sistema e energia › Contador de FPS**, com prévia ao vivo.

## Como funciona

| Peça | Arquivo | O que faz |
|---|---|---|
| Captura de quadros | `src-tauri/src/perf_etw.rs` | Sessão ETW (a mesma técnica do PresentMon e do Xbox Game Bar): conta os avisos de "quadro apresentado" do DXGI (DirectX 10/11/12) e do D3D9, por programa. Não injeta nada no jogo. |
| Contas (FPS, lows) | `src-tauri/src/perf_stats.rs` | Janela móvel de 60 s: FPS do último segundo, média, 1% low e 0,1% low (média dos piores quadros), frametime e os últimos 120 tempos de quadro. Testes com séries sintéticas. |
| Hardware | `src-tauri/src/perf_hw.rs` | Nomes (registro e adaptador WDDM), temperatura/consumo/ventoinha da placa pelo mesmo dado do Gerenciador de Tarefas (D3DKMT), uso e memória da placa (contadores PDH), RAM e uso do processador. Sem driver, sem administrador. |
| Janela e configuração | `src-tauri/src/perf.rs` | Janela transparente, sem foco e sem cliques, sempre por cima, no canto escolhido; configuração em `perf.json` (a fonte da verdade é o Rust: o Guia e as Configurações usam os mesmos comandos `perf_*`). |
| Desenho | `src/components/PerfCard.tsx`, `src/styles/perf.css` | O mesmo cartão aparece sobre o jogo e na prévia. Só mostra o que está ligado e o que o Windows informou. |
| Configurações | `src/screens/PerfSettings.tsx`, `src/lib/perf.ts`, `src/store/perf.ts` | Modelos (Completo, Compacto, Mínimo), posição (8), tamanho, disposição (coluna/linha), fundo e transparência, nome curto/completo do hardware, 15 itens liga/desliga, 8 cores, faixas de FPS e de temperatura. |

## Permissão (uma vez)

Criar uma sessão ETW exige administrador ou ser membro do grupo **Performance Log Users**. Sem isso o contador mostra
"falta permissão" e as Configurações oferecem **Liberar a medição de FPS**: o Windows pede a confirmação de administrador uma
única vez e o usuário entra no grupo (por identificador, que não muda com o idioma do Windows). A associação só vale numa
**sessão nova do Windows**: sair da conta e entrar de novo, ou reiniciar. No modo console (launcher como shell) é só reiniciar.

## Limites conhecidos

- **Vulkan e OpenGL** não passam pelos avisos DXGI/D3D9: esses jogos ainda não aparecem (as demais informações aparecem).
- **Temperatura do processador**: o Windows não a informa sem um driver de kernel (as zonas térmicas ACPI são da placa-mãe, não
  do processador, e mostram um valor que engana). O launcher não instala driver; o item não existe em vez de mostrar um número errado.
- **Consumo da placa** vem em % do limite de energia (é o que o Windows informa); em watts só com a ferramenta de cada fabricante.
- **Tela cheia exclusiva** antiga: o Windows esconde qualquer janela por cima. Jogos em janela e em tela cheia sem bordas
  (o padrão no Windows 11) funcionam.
- **O que conta como jogo:** programas instalados nas pastas das lojas (Steam, Epic, Xbox, GOG, EA, Ubisoft, Riot, Rockstar) ou,
  fora delas, a janela da frente cobrindo o monitor inteiro. Um jogo em janela instalado em outra pasta não é medido.
- A captura só roda com o contador ligado.
