# Console Launcher 0.1.7 — notas da versão

Publicada em 26/11/2026. O texto curto que o jogador lê no aviso de atualização está em
[NOVIDADES.md](NOVIDADES.md).

Base: auditoria de interface e uso da 0.1.6 (itens 01 a 18; veja o que ficou de fora no fim).

## O que muda para quem joga

### Menu do Guia

- O nome do jogo e o estado ficam **sempre à vista**; só a lista rola, com o aviso **Mais opções abaixo** quando há mais.
- Em tela cheia exclusiva, **Controle compartilhado** fica fixo junto dos atalhos, inclusive nas confirmações.
- **B fecha o menu mesmo com uma ação sem resposta.** Se um comando demorar, o menu mostra o andamento e, depois de
  7 segundos, libera as opções com um aviso. Um pedido que chegar depois de o menu ser reaberto é ignorado.
- Enquanto o menu carrega, o rodapé oferece só **B Fechar o Guia**.
- Jogo sem janela: o menu diz **Sem janela no momento** e explica o motivo possível.
- As confirmações dizem o nome do jogo.
- **Volume e saída de áudio** vêm antes do contador de FPS. Com o foco, a saída mostra o nome inteiro e avisa que vale para
  o Windows todo.
- Blocos renomeados: **Navegação** (Início e Biblioteca) e, no fim, **Sessão e energia**. A saída agora se chama
  **Fechar o launcher e ir à área de trabalho**.
- Antes de reiniciar ou desligar, a confirmação avisa sobre o jogo aberto e sobre uma instalação em andamento.
- Contador de FPS sem permissão ou com falha ganha **Ver o problema do contador**, que abre a tela dele.

### Opções do menu Guia (Configurações)

- A **pausa do jogo** vem primeiro, com a explicação do que ela faz, dos riscos e do padrão (desligada).
- As opções de energia ficam em uma seção própria.
- Se a leitura falhar, aparece **Tentar de novo**; ao gravar, a linha mostra **Salvando…** e mantém o valor anterior se falhar.

### Reinício do PC

- Depois de uma atualização, a contagem pode ser **cancelada com B**. O aviso pede para salvar antes de confirmar, e o botão
  inicial passou a se chamar **Agora não**.
- No modo console o reinício continua obrigatório, sem cancelar.
- Se o PC continuar ligado 30 segundos depois da contagem, o aviso deixa de prender o controle.

### No launcher

- Com um jogo aberto, o cabeçalho mostra **Voltar para [jogo]** em todas as telas.
- Nova aba **Ajuda** nas Configurações, com atalhos para tela piscando, controle, jogo ausente, lojas, contador de FPS e
  início direto no launcher.
- Atualizações: versão instalada, **Verificar agora**, data da última verificação, motivo da falha, versão disponível com o
  que impede instalar e atalho para reiniciar quando o modo console está esperando.
- Downloads: com a fila vazia, só a mensagem; cada item diz o que dá para fazer; aviso quando os números são parciais.
- Biblioteca: mostra a loja filtrada e quando a Steam foi sincronizada. Sem tempo registrado e sem fonte para saber, o
  launcher diz **Sem histórico neste perfil** em vez de "Nunca jogado". O menu do jogo avisa quando o suporte a controle é
  desconhecido.

### Interface ampliada

- Página do jogo, Configurações com prévia, conta Steam, teste de controle e jogos não instalados agora crescem junto com o
  tamanho da interface (antes ficavam do tamanho de 100%).
- Corrigido um defeito anterior: com a tela ampliada, a rolagem errava a conta e o item em foco podia ficar fora da vista.

### Cores

- O texto sobre a cor de destaque agora tem contraste de leitura em todas as cores: escuro em Turquesa, Azul e Rosa (antes
  branco, com contraste de 1,95 a 2,94). O Violeta ficou um pouco mais escuro para o texto branco.
- O botão em foco não clareia mais o fundo; continua marcado por contorno, brilho e tamanho.

## Verificações

| O que | Como |
|---|---|
| Compilação, traduções (0 erros) e `cargo test --lib` (139 aprovados, 29 ignorados) | Automático |
| Guia: rolagem a 100% e 150%, ação sem resposta, **B**, jogo sem janela, carregamento, confirmações e novos blocos | Navegador com dados simulados |
| Reinício após atualizar cancelado; no modo console, não cancelável; aviso depois do prazo | Navegador (nenhum PC é reiniciado) |
| Foco à vista a 150% em 10 telas e no assistente, mais o teste de controle por imagem (1280×720); a 125% em 4 telas | Navegador |
| Voltar ao jogo, Ajuda, estados de atualização e fila vazia | Navegador |
| Contraste em 5 temas e 7 cores (35 combinações, mínimo 4,59) | Navegador |
| Pedido antigo do menu ignorado, fechar, cancelar reinício e abrir a tela do contador pelo Guia | Launcher de desenvolvimento neste PC |

**Não testado:** PC console, controle físico, jogo real, TV, downloads reais e o cancelamento de um reinício de verdade.

## Ficou de fora

- **03:** preparar a tela antes de recolher o Guia (a troca de vídeo em tela cheia exclusiva continua). Precisa de medição na TV.
- **10:** conferência automática do pacote na publicação e teste de atualização a partir de uma versão antiga em modo console.
- **11:** cancelar enquanto o Windows abre a área de trabalho.
- **13:** o teclado na tela continua no tamanho fixo.
- **14:** separar no assistente o essencial dos ajustes finos e destacar pendências no resumo.
- **15:** escolher a loja de um jogo repetido na própria ficha.
- **17:** distinguir no Guia "aguardando quadros" de "ligado".
- **18:** redesenhar a aparência de cada tipo de controle (foi unificado só o rodapé das opções do Guia).
- Isolar o controle em tela cheia exclusiva: não há como fazer sem pausar o jogo.
