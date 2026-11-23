# Instruções para assistentes (Codex, Claude Code etc.)

Projeto: launcher de jogos para TV (Windows 11, só controle), feito em Tauri 2 (Rust) + React + TypeScript. A Steam é só o motor. Idioma de trabalho: português do Brasil.

## Regras que valem sempre

1. **Todo texto visível ao jogador passa por `t()`** (`import { t } from "../i18n"`). Nada de texto solto na interface, nos avisos, nos diálogos, nas dicas dos botões ou nas mensagens de erro. O launcher tem três idiomas (português, inglês, espanhol).
2. Ao criar ou mudar um texto: rode `npm run i18n:add`, preencha o inglês e o espanhol em `src/i18n/dict/pending.ts` e rode `npm run i18n` (precisa terminar com `Erros: 0 · textos soltos para revisar: 0`). O `npm run build` roda essa conferência.
3. Erros do backend mostrados na tela: `te(error)`, não `String(error)`. Mensagens novas do Rust entram em `src/i18n/dict/errors.ts`.
4. Datas, horas, números e ordem alfabética: `locale()`, `formatNumber()`, `compareText()`; nunca `"pt-BR"` fixo.
5. Detalhes e exemplos: `docs/TRADUCAO.md`.
6. **Toda opção de aparência nova** (cor, fundo, tamanho, layout, o que aparece em Início, Biblioteca ou página do jogo) precisa aparecer na **prévia ao vivo** das configurações (`src/components/preview/`: `HomePreview`, `DetailPreview`, `LibraryPreview`), e a prévia deve usar os mesmos componentes e a mesma lógica da tela real.

## Outros cuidados

- Mexa pouco e de forma aditiva em arquivos que outra ferramenta também edita (o repositório é compartilhado).
- Antes de dar uma tarefa por pronta: `npx tsc --noEmit`, `npm run i18n` e `cargo test --lib` (em `src-tauri`).
- Nada é commitado sem o jogador pedir.
- Ao mexer em uma tela, confira com "Tamanho da interface" em 70%, 100% e 150% e nos três idiomas (textos longos em espanhol e inglês).
