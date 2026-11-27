# Console Launcher 0.1.8 — notas da versão

Publicada em 26/11/2026. O texto curto que o jogador lê no aviso de atualização está em
[NOVIDADES.md](NOVIDADES.md).

## Pedido de reinício repetido depois de atualizar

**Sintoma:** depois de atualizar e reiniciar o PC, o launcher pedia o reinício outra vez.

**Causa:** o que o launcher guardava sobre a sugestão ficava no armazenamento da janela (localStorage). Nas medições no PC de
desenvolvimento ele levou de **26 a 59 segundos** para ir ao disco, e o reinício acontece 5 segundos depois do pedido. A
resposta ao aviso (e, num reinício rápido, o próprio registro da atualização) se perdia, e o aviso voltava.

**Correção:**

- A versão que rodou e a sugestão pendente passaram para `update-restart.json`, na pasta de configurações, gravado na hora
  (`src-tauri/src/restart_note.rs`).
- Se o Windows iniciou depois de a sugestão surgir, o PC já reiniciou: o aviso não aparece, mesmo que ninguém o tenha
  respondido.
- Vale já na atualização da 0.1.7 para a 0.1.8.

## Menu do Guia piscando fora de jogo

Em TVs com taxa de atualização variável, as animações e a rolagem suave do menu faziam o Windows alternar a forma de
desenhar a janela, e a tela piscava ao abrir o menu e navegar. A janela do Guia agora não anima nada. Nas medições na TV, a
alternância caiu de 5 em cerca de 15 segundos para nenhuma.

## Testes

- `npm run build` sem erros; `cargo test --lib` com os testes novos do aviso de reinício.
- No launcher de desenvolvimento: atualização encerrada logo em seguida, reabertura sem reiniciar (o aviso aparece), início do
  Windows depois da sugestão, simulado pelo arquivo (não aparece) e resposta **Agora não** seguida de encerramento em 1 segundo (não volta).
- O reinício de verdade, com a versão instalada, ainda não foi testado.

## Limite conhecido

Outras escolhas guardadas pela janela (ajustes, favoritos, conclusão do assistente inicial) também levam esse tempo para ir
ao disco e podem se perder se o PC reiniciar ou desligar logo em seguida. Fica para uma próxima versão.
