# Auditoria de usabilidade (UI/UX) e changelog

Auditoria feita sobre o launcher inteiro (Início, Biblioteca, Página do jogo, Downloads, Configurações e subtelas, Guia, Contador de FPS), com varredura automática do DOM e capturas em 1920×1080 e com a interface a 150%.

## Mudanças pedidas

| # | Antes | Depois |
|---|---|---|
| 1 | O painel de filtros abria como gaveta lateral direita: único menu do sistema fora do padrão (Ordenar, menu do jogo etc. abrem popup no centro). | Filtros agora é um **popup centralizado**, igual ao Ordenar: linhas Loja, Escopo (“Jogos de”), Limpar filtros, Fechar. A: alterar, ◀▶: ajustar, B/RT: fechar. |
| 2 | “Só jogos com suporte a controle” era um filtro de tela, que o jogador ligava e desligava. | Virou **regra de aba** (`TabRule.controller`): marcada no editor de abas (“Suporte a controle”) cria uma aba só com jogos com suporte parcial ou completo (Steam e Epic, incluindo a busca pelo nome e as correções manuais). Quem usa a aba não consegue “remover o filtro” na tela: para mudar, edita ou apaga a aba. O filtro global e seu código foram removidos. |

## Problemas encontrados e corrigidos

| Id | Onde | Problema | Correção |
|---|---|---|---|
| F1 | Biblioteca | Botão **Filtros** e a dica RT apareciam mesmo com uma só loja e nada para filtrar: o painel abria só com “Fechar”. | O botão, a dica e o atalho RT só existem quando há o que filtrar (mais de uma loja ou um filtro ativo). |
| F2 | Configurações / Início | O mesmo conceito tinha três nomes: “Página inicial”, “Tela inicial” e “Início”; e “Início com o Windows” confundia com a tela Início. | A tela se chama **Início** em todo lugar; o que acontece ao ligar o PC é **Inicialização**. “Tela inicial” virou “Destaque”. Textos revisados em Configurações, Início, bloco do Início, “Não instalados” e a mensagem de Início vazio. Traduções en/es acompanham. |
| F3 | Página do jogo | “Controle: Com suporte a controle” repetia a palavra. | O valor agora é **“✓ Com suporte”**. |
| F4 | Contador de FPS (Configurações) | Uma lista única de ~40 linhas, longa demais para o controle. | Três páginas com abas e LB/RB: **Geral** (contador, aparência, medição e restaurar), **Itens** e **Cores e faixas**. Lembra a última página; o foco vai para a primeira linha ao trocar. Dicas “Página anterior / Próxima página” na barra de botões. |
| F5 | Início (modo “uma fileira por vez”) | As outras fileiras ficam invisíveis e nada indicava que existiam. | Uma dica discreta no pé: “▾ Favoritos” (a próxima fileira) ou “▴ …” na última. |
| F6 | Prévia (modo navegador) | Caminho do script de restauração aparecia sem as barras invertidas. | Corrigido no dado de exemplo. |
| F8 | Biblioteca | Com muitas abas ou a interface ampliada, a faixa de abas quebrava em duas linhas e empurrava a grade. | A faixa tem uma linha só e **rola na horizontal**; a aba ativa fica centralizada (LB/RB e navegação). LB e RB ficam fixos nas pontas. |

## Ajuste posterior: a aba é uma definição, não um filtro

- **Contagem:** a Biblioteca mostra só o total da aba (“508 jogos”), sem “508 de 690 · Todos”. A busca também não muda esse texto.
- **Filtros:** a linha “Jogos de” (Só desta aba / Todos os jogos) foi removida; o painel tem só a **Loja**. O botão Filtros só aparece com jogos de mais de uma loja.
- **Escopo “todos os jogos”:** removido por inteiro (botões “Ver todos os jogos” / “Buscar em todos os jogos” do estado vazio, etiqueta “Todos os jogos” na faixa de abas e campos `scopeAll`/`widenedBySearch` do estado). Aba vazia agora diz “Nenhum jogo nesta aba. Troque de aba ou ajuste a aba em Configurações › Biblioteca.”

## Validação

- `npx tsc --noEmit`: sem erros.
- `npm run i18n`: 0 erros, 0 textos soltos (1099 entradas).
- `cargo test --lib`: 113 passaram.
- Conferido no navegador (1920×1080): Início com a dica da próxima fileira, Biblioteca com chip Filtros e abas, Contador de FPS com as três páginas.

## Não verificado

- A medição real de FPS ainda depende de sair e entrar de novo no Windows (grupo Performance Log Users) e abrir um jogo DirectX.
- Nenhuma alteração foi commitada.
