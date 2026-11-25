# Changelog — correções da auditoria de UI, UX e QA

Resposta a [AUDITORIA-UI-UX-QA-2026-11-24.md](AUDITORIA-UI-UX-QA-2026-11-24.md) (25 achados). Cada achado foi conferido no código antes de
qualquer mudança.

**Resultado:** 19 aplicados, 5 aplicados em parte, 1 não aplicado.

## Prioridade 1

| Id | Veredito | O que mudou | Como foi conferido |
|---|---|---|---|
| QA-01 · 150% corta configurações | **Procede. Aplicado.** | Listas limitadas à largura da janela; valores longos quebram em vez de sair da tela; fila, discos e resumo de Downloads quebram linha. | 1280×720, espanhol, 150%: nenhuma tela medida passa da largura. |
| QA-02 · Início corta o card focado | **Procede. Aplicado.** | O cartaz encolhe para caber na área das fileiras (vale para a prévia também). Com a interface ampliada, o destaque fica mais baixo e sem a descrição. | Mesmo cenário: card dentro da área (365–545 px em 270–641). Não medi panorâmico nem grade. |
| QA-03 · Teste de controle esconde dados | **Procede. Aplicado.** | Duas colunas, sem crescer com a interface: tudo cabe sem rolar. | 150%, com um controle simulado e registro preenchido: nada cortado. Não testei com vários controles. |
| QA-04 · Filtro global de controle sumiu | **Não aplicado.** | — | A troca por regra de aba foi um pedido explícito do dono do produto ("não ser possível remover esse filtro"). O ajuste global `controllerOnly` não existe em nenhum commit, então não há perfil de usuário publicado para migrar. A ficha do jogo e o menu Start continuam permitindo corrigir o suporte. |
| QA-05 · Atualização parada bloqueia tudo | **Procede. Aplicado.** | Atualização sem avançar por 3 minutos libera "Parar de aguardar". Antes de liberar, o launcher confere se há jogo rodando; a atualização continua na loja. | Simulado no navegador: botão aparece e a próxima abertura fica livre. Não testei com a Steam real. |

## Assistente de primeira utilização

| Id | Veredito | O que mudou | Como foi conferido |
|---|---|---|---|
| QA-06 · "Configurar depois" prometia padrões | **Procede. Aplicado.** | O diálogo diz que o que já foi mudado continua salvo. | Texto; traduções en/es. |
| QA-07 · Inicialização carregando para sempre | **Procede. Aplicado.** | Erro, demora de 8 s ou resposta incompleta mostram "Nada foi alterado" e **Tentar de novo** (assistente e Configurações). | Falha simulada em Configurações: foco no botão e recuperação. |
| QA-08 · Selo "Recomendado" sem condição | **Em parte.** | A descrição da própria linha começa com "Para PC usado como console" e cita o próximo login; o resumo mostra como voltar quando o modo console está ativo. O selo foi mantido, por pedido do dono do produto. | Texto. |
| QA-09 · F11 não atualiza "Tela cheia" | **Procede. Aplicado.** | O assistente acompanha as mudanças da janela, como as Configurações. | **Não testado** com F11 real. |
| QA-10 · Continuar muda de altura | **Procede. Aplicado.** | Voltar e Continuar ficam fixos na base em todas as etapas. A política de foco não mudou. | Mesma posição nas 14 etapas; direcional chega aos botões e volta. |
| QA-11 · Dicas e foco de retorno | **Procede. Aplicado.** | LB só aparece havendo etapa anterior, RB havendo próxima, "Ajustar" só em linha ajustável. O foco volta à linha acionada, inclusive por clique. A prévia de controle avisa que são os atalhos de depois do assistente. | Resumo sem RB/Ajustar; retorno do FPS focou a linha. |
| QA-12 · Resumo sem revisão | **Procede. Aplicado.** | 12 itens em cartões focáveis; cada um abre a etapa e o botão principal vira **Voltar ao resumo**. Entraram efeitos sonoros, tela cheia e ícones das lojas. | Ida e volta; cabe sem rolar a 150%. |

## Biblioteca, jogos e downloads

| Id | Veredito | O que mudou | Como foi conferido |
|---|---|---|---|
| QA-13 · Sem jogos, sem foco nem ação | **Procede. Aplicado.** | Início e Biblioteca vazios têm botão focado (**Conectar uma loja** ou **Escolher as fileiras**), citam Steam e Epic e indicam sincronização em andamento. | Botão focado leva à conta na tela de Configurações. |
| QA-14 · Suporte inferido parece confirmado | **Procede. Aplicado em parte.** | A ficha informa "Informado pela versão da Steam". Corrigido um erro real: títulos em outros alfabetos viravam texto vazio e podiam combinar entre si. O nível (completo/parcial) não foi rebaixado e não há cruzamento por editora. | Compilação; **sem teste automatizado** da normalização. |
| QA-15 · Verificação confundida com ausência | **Procede. Aplicado em parte.** | A aba de controle mostra quantos jogos estão sem confirmação e, vazia, explica como marcar. Não há lista temporária desses jogos. | Contagem exibida com um jogo sem dados. |
| QA-16 · Busca omite o filtro de loja | **Procede. Aplicado.** | A mensagem cita loja e aba; **Buscar em todas as lojas** mantém o texto digitado. | "Stardew" com filtro Epic: um toque encontra o jogo. |
| QA-17 · Tamanho desconhecido vira 0 B | **Procede. Aplicado.** | "Tamanho não informado" na linha e no disco; "Outros arquivos e jogos sem tamanho". | Jogo Epic sem tamanho simulado. |
| QA-18 · Fila mista perde informação | **Procede. Aplicado.** | O que a Steam informa continua visível, marcado "(Steam)"; "Falta baixar (parcial)". | **Não testado** com fila mista (a amostra só tem Steam). |

## FPS, Guia e Windows

| Id | Veredito | O que mudou | Como foi conferido |
|---|---|---|---|
| QA-19 · FPS "Ligado" após falha | **Procede. Aplicado.** | Falha desfaz a mudança e avisa; respostas antigas não sobrescrevem a escolha mais nova. | Falha simulada: voltou a "Desligado" com aviso. |
| QA-20 · Faixas invertidas | **Procede. Aplicado.** | A faixa vizinha se ajusta, na interface e no Rust (inclusive arquivos antigos). | Teste Rust novo e verificação no navegador. |
| QA-21 · Notificações e overlay | **Procede. Aplicado.** | A descrição explica que, em tela cheia, a opção também bloqueia o overlay. Nenhuma mudança de comportamento. | Conferido com `hide.rs`. |
| QA-22 · Confirmações do Guia | **Procede. Aplicado.** | Diálogo marcado como alerta, com título e descrição. | Compilação; **sem leitor de tela**. |

## Consistência e acessibilidade

| Id | Veredito | O que mudou | Como foi conferido |
|---|---|---|---|
| QA-23 · Foco do documento não acompanha | **Procede. Aplicado em parte.** | O foco do documento segue o item selecionado. O Tab continua valendo Start no teclado. | Elemento ativo igual ao focado; **não validado com o Narrator**. |
| QA-24 · Prévia parece a coleção real | **Procede. Aplicado.** | Moldura indica "dados de exemplo"; a prévia pessoal nunca insere jogo fictício; a prévia da Biblioteca acompanha a aba focada. | Rótulo e aba conferidos. |
| QA-25 · Hierarquia varia entre telas | **Aplicado em parte.** | A demonstração de "Jogos não instalados" passou para a direita; corrigido um texto que citava o "escopo" removido. Padronizar cabeçalhos e verbos em todas as telas é um redesenho à parte e não foi feito. | Compilação. |

## Correção posterior

A mudança do QA-01 fez valores curtos quebrarem em duas linhas ("‹ Desligado ›"). Agora o valor fica inteiro e quem cede espaço é o
texto da esquerda; só valores muito longos quebram. Medidas 118 linhas em português e espanhol, a 100% e 150%: nenhuma quebrada.

## Verificações

- `npm run build` (tradução com 0 erros, TypeScript e empacotamento): passou.
- `cargo test --lib`: 118 aprovados, 25 ignorados.
- Fluxos simulados no navegador, a 1280×720, com interface a 100% e 150%.
- Launcher real: recarregado após as mudanças; assistente aberto com foco correto.

## Continua pendente (precisa de hardware ou conta real)

Controle físico (Xbox, DualSense, genérico), jogos reais em tela cheia e janela, abertura com atualização real, contador de FPS em jogo,
leitor de tela, modo console no launcher instalado e as janelas a 1024×576.

Nada foi commitado.
