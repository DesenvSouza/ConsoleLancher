import { isTauri } from "./api";

/** Atualização do launcher: a ponte com src-tauri/src/update.rs (e a simulação para o navegador). */

export interface UpdateStatus {
  /** A versão instalada. */
  current: string;
  /** "dev": modo de desenvolvimento (procura, mas não instala). "unconfigured": sem a chave pública das atualizações. */
  support: "ok" | "dev" | "unconfigured";
  /** Versão já baixada e conferida, pronta para instalar. */
  ready: string | null;
  downloading: boolean;
  received: number;
  total: number;
  /** Versão recém-instalada para a qual ainda vale sugerir o reinício do PC. */
  restartSuggestion: string | null;
}

export interface AvailableUpdate {
  version: string;
  /** O texto da publicação (o que mudou). */
  notes: string | null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

// No navegador (sem o Tauri) nada é baixado: para ver os avisos, guarde em localStorage "mock-update" o número de uma versão
// (e, para ver um erro, "mock-update-error" com a mensagem). "mock-restart" simula a sugestão de reiniciar o PC.
let mock: UpdateStatus = { current: "0.1.0", support: "ok", ready: null, downloading: false, received: 0, total: 0, restartSuggestion: null };
const mockError = () => {
  const message = localStorage.getItem("mock-update-error");
  if (message) throw new Error(message);
};

export const updater = {
  /** `previous`: a versão que a janela viu da última vez (só serve a quem vem da 0.1.7 ou anterior). */
  status: async (previous: string | null): Promise<UpdateStatus> =>
    isTauri ? invoke<UpdateStatus>("update_status", { previous }) : { ...mock, restartSuggestion: localStorage.getItem("mock-restart") },
  /** O jogador respondeu à sugestão de reiniciar o PC. */
  answerRestart: async (): Promise<void> => {
    if (isTauri) return invoke<void>("update_answer_restart");
    localStorage.removeItem("mock-restart");
  },
  check: async (): Promise<AvailableUpdate | null> => {
    if (isTauri) return invoke<AvailableUpdate | null>("update_check");
    mockError();
    const version = localStorage.getItem("mock-update");
    return version ? { version, notes: "• Atualização de exemplo\n• Correções no contador de FPS\n• Novas músicas" } : null; // i18n-ignore
  },
  /** Baixa e confere a assinatura; devolve a versão que ficou pronta. */
  download: async (): Promise<string> => {
    if (isTauri) return invoke<string>("update_download");
    mockError();
    const version = localStorage.getItem("mock-update") ?? mock.current;
    const total = 8_400_000;
    mock = { ...mock, downloading: true, received: 0, total };
    for (let step = 1; step <= 10; step++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      mock = { ...mock, received: Math.round((total * step) / 10) };
    }
    mock = { ...mock, downloading: false, ready: version };
    return version;
  },
  /** Instala o que foi baixado. No app não volta: o launcher fecha e o instalador o reabre. */
  apply: async (): Promise<void> => {
    if (isTauri) return invoke<void>("update_apply");
    mockError();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    localStorage.removeItem("mock-update");
    mock = { ...mock, ready: null };
    location.reload();
  },
};
