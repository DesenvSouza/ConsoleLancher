import { create } from "zustand";
import { persist } from "zustand/middleware";
import { playSound } from "../audio/sounds";
import { t, te } from "../i18n";
import { isTauri } from "../lib/api";
import { epic, type EpicGame, type EpicInstalled, type EpicInstallState, type EpicStatus } from "../lib/epic";
import type { Game } from "../lib/types";
import { useUI } from "./ui";

/** A lista da conta é relida, sozinha, se a última leitura tem mais que isto (a Epic raramente muda). */
const AUTO_SYNC_MS = 60 * 60_000;
/** Depois de uma falha, espera isto antes de tentar de novo sozinho. */
const RETRY_MS = 30 * 60_000;
let nextTryAt = 0;
/** O app em desenvolvimento monta a interface duas vezes: o ouvinte do login só pode ser ligado uma. */
let watching = false;

interface EpicStore {
  status: EpicStatus | null;
  /** Jogos da conta (guardados para a biblioteca aparecer mesmo sem rede). */
  library: EpicGame[];
  fetchedAt: number;
  installed: EpicInstalled[];
  /** Instalações feitas pelo launcher (nome interno → andamento). */
  installs: Record<string, EpicInstallState>;
  syncing: boolean;
  /** Há instalação em andamento (para o acompanhamento só rodar quando preciso). */
  hasActiveInstalls: () => boolean;
  refreshInstalls: () => Promise<void>;
  /** Instala sem a janela da Epic (Legendary); sem ele, abre a página do jogo na Epic Games Launcher. */
  install: (game: Game) => Promise<void>;
  cancelInstall: (game: Game) => Promise<void>;
  uninstall: (game: Game) => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshInstalled: () => Promise<void>;
  /** Entra com o código que o site da Epic mostra e traz a biblioteca. Devolve true se deu certo. */
  signIn: (code: string) => Promise<boolean>;
  /** Abre a janela de login da Epic dentro do launcher. */
  startLogin: () => Promise<void>;
  /** Passa a ouvir o resultado da janela de login (chamar uma vez ao abrir o app). */
  watchLogin: () => Promise<void>;
  signOut: () => Promise<void>;
  sync: (options?: { silent?: boolean }) => Promise<void>;
  autoSync: () => Promise<void>;
}

export const useEpic = create<EpicStore>()(
  persist(
    (set, get) => ({
      status: null,
      library: [],
      fetchedAt: 0,
      installed: [],
      installs: {},
      syncing: false,

      hasActiveInstalls: () => Object.values(get().installs).some((job) => job.status === "preparing" || job.status === "running"),

      refreshInstalls: async () => {
        if (!isTauri) return;
        try {
          const states = await epic.installStates();
          const before = get().installs;
          if (JSON.stringify(states) === JSON.stringify(before)) return;
          const ui = useUI.getState();
          const titleOf = (app: string) => get().library.find((g) => g.appName === app)?.title ?? app;
          for (const [app, job] of Object.entries(states)) {
            const previous = before[app]?.status;
            if (previous === job.status) continue;
            if (job.status === "done") {
              playSound("success");
              ui.showToast(t("{title} foi instalado.", { title: titleOf(app) }), "success");
              void epic.installForget(app);
              await get().refreshInstalled();
            } else if (job.status === "failed") {
              ui.showToast(t("Não foi possível instalar {title}. {reason}", { title: titleOf(app), reason: job.message ? te(job.message) : "" }).trim(), "warning");
              void epic.installForget(app);
            } else if (job.status === "cancelled") {
              void epic.installForget(app);
            }
          }
          // O que já foi resolvido (e esquecido pelo backend) sai da lista.
          set({ installs: Object.fromEntries(Object.entries(states).filter(([, job]) => job.status === "preparing" || job.status === "running")) });
        } catch (e) {
          console.error("epic_install_states falhou", e); // i18n-ignore
        }
      },

      install: async (game) => {
        const ui = useUI.getState();
        const ref = game.epic;
        if (!ref) return;
        try {
          if (await epic.legendaryAvailable()) {
            playSound("operation");
            set({ installs: { ...get().installs, [ref.appName]: { status: "preparing", percent: 0 } } });
            await epic.installStart(ref.appName);
            ui.showToast(t("Instalando {title}…", { title: game.title }));
            return;
          }
          // Sem o Legendary: a Epic Games Launcher abre na página do jogo e o jogador confirma lá.
          await epic.install(ref.namespace, ref.catalogItemId, ref.appName);
          ui.showToast(t("A Epic Games Launcher abriu na página de {title}. Confirme a instalação nela.", { title: game.title }));
        } catch (e) {
          const { [ref.appName]: _gone, ...rest } = get().installs;
          set({ installs: rest });
          ui.showToast(te(e), "warning");
        }
      },

      cancelInstall: async (game) => {
        const ref = game.epic;
        if (!ref) return;
        const ui = useUI.getState();
        try {
          if (get().installs[ref.appName]) {
            playSound("back");
            await epic.installCancel(ref.appName);
            const { [ref.appName]: _gone, ...rest } = get().installs;
            set({ installs: rest });
            ui.showToast(t("Download de {title} cancelado.", { title: game.title }));
          } else {
            await epic.openLibrary();
            ui.showToast(t("Para cancelar o download de {title}, use a Epic Games Launcher (abri a biblioteca dela).", { title: game.title }));
          }
        } catch (e) {
          ui.showToast(te(e), "warning");
        }
      },

      uninstall: async (game) => {
        const ref = game.epic;
        if (!ref) return;
        const ui = useUI.getState();
        try {
          const mine = get().installed.find((g) => g.appName === ref.appName)?.managedBy === "legendary";
          if (mine) {
            playSound("operation");
            await epic.uninstall(ref.appName);
            await get().refreshInstalled();
            ui.showToast(t("{title} foi desinstalado.", { title: game.title }), "success");
          } else {
            await epic.openLibrary();
            ui.showToast(t("Para desinstalar {title}, use a Epic Games Launcher (abri a biblioteca dela).", { title: game.title }));
          }
        } catch (e) {
          ui.showToast(te(e), "warning");
        }
      },

      refreshStatus: async () => {
        if (!isTauri) return;
        try {
          const status = await epic.status();
          set({ status });
          if (!status.signedIn && get().library.length > 0) set({ library: [], fetchedAt: 0 });
        } catch (e) {
          console.error("epic_status falhou", e); // i18n-ignore
        }
      },

      refreshInstalled: async () => {
        if (!isTauri) return;
        try {
          const list = await epic.installed();
          if (JSON.stringify(list) !== JSON.stringify(get().installed)) set({ installed: list });
        } catch (e) {
          console.error("epic_installed falhou", e); // i18n-ignore
        }
      },

      signIn: async (code) => {
        const ui = useUI.getState();
        if (!isTauri) {
          ui.showToast(t("(navegador) A conta da Epic só entra no app."));
          return false;
        }
        try {
          const status = await epic.signIn(code);
          set({ status });
          ui.showToast(t("Conta da Epic conectada. Buscando a biblioteca…"));
          await get().sync();
          return true;
        } catch (e) {
          ui.showToast(te(e), "warning");
          return false;
        }
      },

      startLogin: async () => {
        try {
          await epic.openLoginWindow();
        } catch (e) {
          useUI.getState().showToast(te(e), "warning");
        }
      },

      watchLogin: async () => {
        if (watching) return;
        watching = true;
        await epic.onLogin((event) => {
          const ui = useUI.getState();
          if (event.state === "done" && event.status) {
            set({ status: event.status });
            ui.showToast(t("Conta da Epic conectada. Buscando a biblioteca…"));
            void get().sync();
          } else if (event.state === "error") {
            ui.showToast(te(event.error ?? t("Não foi possível entrar na Epic.")), "warning");
          }
        });
      },

      signOut: async () => {
        try {
          await epic.signOut();
          set({ status: { signedIn: false, launcherInstalled: get().status?.launcherInstalled ?? false }, library: [], fetchedAt: 0 });
          useUI.getState().showToast(t("Saiu da conta da Epic neste PC."));
        } catch (e) {
          useUI.getState().showToast(te(e), "warning");
        }
      },

      sync: async (options) => {
        const silent = !!options?.silent;
        const ui = useUI.getState();
        if (!isTauri || get().syncing || !get().status?.signedIn) return;
        set({ syncing: true });
        if (!silent) {
          playSound("operation");
          ui.showToast(t("Sincronizando a biblioteca da Epic…"));
        }
        try {
          const before = get().library;
          const library = await epic.library();
          nextTryAt = 0;
          const known = new Set(before.map((g) => g.catalogItemId));
          const added = before.length > 0 ? library.filter((g) => !known.has(g.catalogItemId)) : [];
          set({ library, fetchedAt: Date.now() });
          if (!silent) ui.showToast(t("Biblioteca da Epic sincronizada: {n} jogos.", { n: library.length }), "success");
          else if (added.length > 0) ui.showToast(t("Novo jogo na biblioteca: {name}", { name: added[0].title }), "success");
        } catch (e) {
          if (silent) {
            console.error("sincronização da Epic falhou", e); // i18n-ignore
            nextTryAt = Date.now() + RETRY_MS;
          } else {
            ui.showToast(te(e), "warning");
          }
        } finally {
          set({ syncing: false });
        }
      },

      autoSync: async () => {
        const { status, fetchedAt, syncing } = get();
        if (!status?.signedIn || syncing || Date.now() < nextTryAt || Date.now() - fetchedAt < AUTO_SYNC_MS) return;
        await get().sync({ silent: true });
      },
    }),
    { name: "launcher-epic", version: 1, partialize: (s) => ({ library: s.library, fetchedAt: s.fetchedAt }) },
  ),
);
