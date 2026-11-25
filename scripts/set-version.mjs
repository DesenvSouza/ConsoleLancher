// Define a versão do launcher em todos os lugares em que ela aparece: tauri.conf.json (a que as atualizações comparam),
// package.json, Cargo.toml e os dois arquivos de trava.
// Uso: npm run version:set -- 0.2.0
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Informe a versão no formato 1.2.3. Exemplo: npm run version:set -- 0.2.0");
  process.exit(1);
}

function save(file, text) {
  writeFileSync(join(root, file), text);
  console.log(`${file}: ${version}`);
}

/** Troca só o número da versão, sem mexer no resto do arquivo. Falha se o trecho não aparecer exatamente uma vez. */
function replace(file, pattern) {
  const text = readFileSync(join(root, file), "utf8");
  if ((text.match(pattern) ?? []).length !== 1) {
    console.error(`Não foi possível achar a versão em ${file}.`);
    process.exit(1);
  }
  save(file, text.replace(pattern, (_, before) => before + version + '"'));
}

replace("src-tauri/tauri.conf.json", /^(  "version": ")[^"]+"/gm);
replace("package.json", /^(  "version": ")[^"]+"/gm);
replace("src-tauri/Cargo.toml", /^(name = "launcher"\r?\nversion = ")[^"]+"/gm);
replace("src-tauri/Cargo.lock", /^(name = "launcher"\r?\nversion = ")[^"]+"/gm);

// O arquivo de trava do npm é JSON gerado por ele: pode ser lido e gravado inteiro, no mesmo formato.
const lockText = readFileSync(join(root, "package-lock.json"), "utf8");
const lock = JSON.parse(lockText);
lock.version = version;
lock.packages[""].version = version;
const newline = lockText.includes("\r\n") ? "\r\n" : "\n";
save("package-lock.json", (JSON.stringify(lock, null, 2) + "\n").replaceAll("\n", newline));
