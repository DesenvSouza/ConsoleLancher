# Tradução do launcher (Português, English, Español)

O launcher tem três idiomas de interface, escolhidos em **Configurações › Controle e sistema › Idioma do launcher**. Essa escolha é independente do "idioma preferido dos jogos" (que só serve para avisar, na página do jogo, se ele tem o idioma que o jogador quer).

## Como funciona

O **texto em português do código é a chave** da tradução:

```tsx
import { t } from "../i18n";

<h2>{t("Nenhum jogo encontrado")}</h2>
<p>{t("Baixando… {pct}%", { pct: 40 })}</p>
```

- `t("texto")` devolve o texto no idioma atual. Em português devolve o próprio texto.
- Valores variáveis entram por `{nome}`: o inglês e o espanhol precisam ter os **mesmos** `{nome}`.
- Texto com negrito: `rich(t("Escolha <b>isto</b>."))` (`import { rich } from "../i18n/rich"`). A frase inteira é traduzida de uma vez.
- Erros que vêm do backend (Rust): `te(error)` em vez de `String(error)`. As mensagens conhecidas estão em `dict/errors.ts`; `{detail}` casa com a parte variável.
- Formatos acompanham o idioma: `locale()`, `formatNumber()`, `compareText()` (de `../i18n`). Não use `"pt-BR"` direto.
- Chamar `t()` **na hora de desenhar** (dentro do componente ou da função que o gera), nunca no topo do módulo: o topo roda uma vez só e ficaria preso no idioma da abertura.
- Listas de opções guardadas em constantes (`BLOCK_TITLES`, `STYLE_LABELS`...) ficam em português e são traduzidas no uso: `t(BLOCK_TITLES[kind])`. O texto da constante também precisa estar no dicionário.
- Trocar o idioma refaz a interface (`App.tsx` usa o idioma como `key`), então não é preciso reagir à mudança em cada componente.

## Dicionários

`src/i18n/dict/`, um arquivo por área, com o inglês e o espanhol lado a lado:

```ts
"Voltar": ["Back", "Volver"],
```

| Arquivo | O que tem |
|---|---|
| `common.ts` | botões e legendas usados em várias telas |
| `main.ts` | Início, Biblioteca, página do jogo, nomes de idiomas da Steam |
| `settings.ts` | Configurações e subtelas |
| `flows.ts` | Conta Steam, downloads, teclado, QR, abertura de jogo, menu Guia, avisos |
| `labels.ts` | nomes de temas, cores, estilos, seções |
| `errors.ts` | mensagens de erro do backend |
| `pending.ts` | textos novos aguardando tradução |

## Ao criar um texto novo (o passo a passo)

1. Escreva o texto no código **já dentro de `t("...")`**.
2. Rode `npm run i18n:add`. Cada texto novo vira uma linha vazia em `src/i18n/dict/pending.ts`.
3. Preencha o inglês e o espanhol dessas linhas (nenhum pode ficar vazio).
4. Rode `npm run i18n`: deve terminar com `Erros: 0 · textos soltos para revisar: 0`.

`npm run i18n` também roda antes do `npm run build`, então um texto sem tradução **impede o build**.

## O que o verificador (`scripts/check-i18n.mjs`) confere

1. Todo texto passado a `t("...")` existe no dicionário, nos dois idiomas, com os mesmos `{valores}`.
2. Procura textos em português soltos no código, fora de `t()`. É uma heurística (acentos e palavras comuns). Se marcar uma linha por engano (mensagem de console, por exemplo), termine-a com `// i18n-ignore`.
3. Informa entradas do dicionário que nenhum código usa diretamente (normal para constantes e mensagens do backend).

Em desenvolvimento, um texto sem tradução também aparece em português na tela e avisa no console (`[i18n] sem tradução (en): ...`).

## Idioma novo

1. Acrescente em `LANGUAGES` (`src/i18n/index.ts`): `id`, nome na própria língua e código de região.
2. O tipo `Lang` e os dicionários hoje têm duas colunas (`[inglês, espanhol]`): para um quarto idioma, troque para um objeto por idioma. É uma mudança mecânica, mas mexe em todos os arquivos de `dict/`.

## Cuidados

- A descrição e os gêneros do jogo vêm da loja da Steam **no idioma do launcher** (`steamLanguage()` em `src/i18n/index.ts`). Os nomes dos jogos não são traduzidos.
- Mensagens novas criadas no Rust e mostradas ao jogador precisam entrar em `dict/errors.ts`; senão aparecem em português.
