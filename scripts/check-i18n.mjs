// Verificador de tradução. Uso: `node scripts/check-i18n.mjs` (ou `npm run i18n`).
//
// 1. Todo texto passado a `t("…")` precisa existir no dicionário (inglês e espanhol) e ter os mesmos {valores}.
// 2. Procura textos em português que ficaram no código SEM passar por `t()` (heurística: letras acentuadas ou palavras
//    comuns do português em textos de tela) e que também não são chave do dicionário.
// 3. Avisa de entradas do dicionário que nenhum código usa.
//
// Opções:
//   --add   acrescenta em src/i18n/dict/pending.ts uma linha vazia para cada texto novo sem tradução (é só preencher
//           o inglês e o espanhol e rodar de novo).
// Para ignorar uma linha que o item 2 marcou por engano (mensagem de console, por exemplo), termine-a com `// i18n-ignore`.
// Sai com erro (código 1) se houver texto sem tradução, tradução vazia, {valor} diferente ou texto solto.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const src = join(root, "src");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const unescape = (s) => s.replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");

// ── Dicionário ──
const dict = new Map();
for (const file of walk(join(src, "i18n", "dict")).filter((f) => !/index\.ts$/.test(f))) {
  const text = readFileSync(file, "utf8");
  const entry = /^\s*"((?:[^"\\]|\\.)*)":\s*\[\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)",?\s*\],?\s*$/gm;
  let m;
  while ((m = entry.exec(text))) dict.set(unescape(m[1]), [unescape(m[2]), unescape(m[3])]);
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

// ── Uso de t("…") ──
const used = new Map(); // texto → arquivos
const files = walk(src).filter((f) => !f.includes(join("src", "i18n", "dict")));
for (const file of files) {
  const code = readFileSync(file, "utf8");
  const call = /\bt\(\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g;
  let m;
  while ((m = call.exec(code))) {
    const key = unescape(m[1].slice(1, -1));
    if (!used.has(key)) used.set(key, new Set());
    used.get(key).add(relative(root, file));
  }
}

let errors = 0;
const missing = [];
for (const [key, where] of used) {
  const entry = dict.get(key);
  if (!entry) {
    errors++;
    missing.push(key);
    console.log(`SEM TRADUÇÃO: ${JSON.stringify(key)}  (${[...where].join(", ")})`);
    continue;
  }
  entry.forEach((translation, i) => {
    if (!translation.trim()) {
      errors++;
      console.log(`TRADUÇÃO VAZIA (${i === 0 ? "en" : "es"}): ${JSON.stringify(key)}`);
    } else if (placeholders(translation) !== placeholders(key)) {
      errors++;
      console.log(`{VALORES} DIFERENTES (${i === 0 ? "en" : "es"}): ${JSON.stringify(key)} → ${JSON.stringify(translation)}`);
    }
  });
}

// ── Textos em português soltos (sem t) ──
const PT = /[áàâãéêíóôõúçÁÉÍÓÚÇ]|\b(não|jogo|jogos|para|você|sua|seu|uma|com|do|da|de|em|ao|os|as|abrir|voltar|configurar)\b/i;
const IGNORE_FILE = /(i18n[\\/]|mock\.ts|Chrome\.tsx$)/;
let loose = 0;
for (const file of files.filter((f) => !IGNORE_FILE.test(f))) {
  const original = readFileSync(file, "utf8").split("\n");
  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/^(\s*)\/\/.*$/gm, "$1")
    .replace(/(\s)\/\/ .*$/gm, "$1");
  const lines = code.split("\n");
  const found = new Set();
  const strings = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|>([^<>{}\n][^<>{}]*)</g;
  lines.forEach((line, i) => {
    if (original[i]?.includes("i18n-ignore")) return;
    let m;
    while ((m = strings.exec(line))) {
      const raw = unescape(m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (raw.length < 3 || !PT.test(raw) || !/[A-Za-zÀ-ú]{3,}/.test(raw)) continue;
      if (/^(import|use|http|data:|\.\.?\/)/.test(raw) || /className|=>|[=;]\s*$/.test(raw)) continue;
      if (dict.has(raw)) continue;
      // dentro de t("…") não conta (já tratado acima)
      const before = line.slice(0, m.index);
      if (/\bt\(\s*$/.test(before) || /\bte\(\s*$/.test(before)) continue;
      const key = `${i + 1}:${raw}`;
      if (!found.has(key)) {
        found.add(key);
        console.log(`SOLTO ${relative(root, file)}:${i + 1}: ${JSON.stringify(raw.slice(0, 90))}`);
        loose++;
      }
    }
  });
}

// ── --add: textos novos viram linhas a preencher ──
if (process.argv.includes("--add") && missing.length > 0) {
  const pendingFile = join(src, "i18n", "dict", "pending.ts");
  let text = readFileSync(pendingFile, "utf8");
  const quote = (k) => JSON.stringify(k);
  const lines = missing.map((k) => `  ${quote(k)}: ["", ""],`).join("\n");
  text = text.replace(/\n\};\s*$/, `\n${lines}\n};\n`);
  writeFileSync(pendingFile, text);
  console.log(`\n${missing.length} texto(s) novo(s) acrescentado(s) em src/i18n/dict/pending.ts: preencha o inglês e o espanhol e rode de novo.`);
}

// ── Entradas sem uso ──
const unused = [...dict.keys()].filter((k) => !used.has(k));
console.log(`\nDicionário: ${dict.size} entradas · usadas em t(): ${used.size} · sem uso direto: ${unused.length}`);
console.log(`Erros: ${errors} · textos soltos para revisar: ${loose}`);
process.exit(errors > 0 || loose > 0 ? 1 : 0);
