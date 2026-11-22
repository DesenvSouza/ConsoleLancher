import { create } from "zustand";
import { api, isTauri } from "../lib/api";
import { mergeSteam } from "../lib/merge";
import { MOCK_COLLECTIONS, MOCK_GAMES, MOCK_META } from "../lib/mock";
import { steam, type AppMeta, type Collection, type InstalledApp, type KeyStatus, type SteamInfo } from "../lib/steam";
import type { Game } from "../lib/types";
import { useUI } from "./ui";
import { useUserData } from "./userData";

interface LibraryStore {
  games: Game[];
  /** "steam": biblioteca real (dentro do app). "mock": jogos de mentira (navegador, para desenvolver a interface). */
  mode: "mock" | "steam";
  steam: SteamInfo | null;
  installed: InstalledApp[];
  /** AppID do jogo que a Steam diz estar em execução. */
  runningAppId: string | null;
  syncing: boolean;
  /** Jogos em que o jogador pediu "Instalar" e a Steam ainda não criou o manifesto (id → quando). */
  pendingInstall: Record<string, number>;
  /** Progresso ao vivo (0..1) da instalação em andamento, medido pelo contador de escrita da Steam. */
  liveProgress: Record<string, number>;

  /** A conta tem chave da Web API guardada? (null = ainda não consultado) */
  keyStatus: KeyStatus | null;
  /** Coleções da Steam (Favoritos, Ocultos e as do jogador): base das abas "por coleção". */
  collections: Collection[];
  refreshCollections: () => Promise<void>;
  /** Dados de cada jogo guardados pela Steam (appinfo), por AppID: avaliam as coleções dinâmicas. */
  appMeta: Record<string, AppMeta>;
  refreshAppMeta: () => Promise<void>;

  init: () => Promise<void>;
  rebuild: () => void;
  /** Atualiza o progresso ao vivo da instalação em andamento (chamado a cada 0,5 s enquanto houver uma). */
  pollProgress: () => Promise<void>;
  refreshKeyStatus: () => Promise<void>;
  /** Valida a chave na Steam, guarda e sincroniza a biblioteca. Devolve true se deu certo. */
  setupAccount: (key: string) => Promise<boolean>;
  clearKey: () => Promise<void>;
  refreshInstalled: () => Promise<void>;
  pollRunning: () => Promise<void>;
  syncOwned: () => Promise<void>;
  toggleFavorite: (id: string) => void;
  play: (id: string) => void;
  install: (id: string) => void;
  uninstall: (id: string) => void;
  /** Cancela um download em andamento (a Steam apaga o que já baixou). */
  cancelInstall: (id: string) => void;
}

// Quando o jogo em execução começou (para contar o tempo jogado por aqui).
let runningSince = 0;
// Na primeira leitura sempre monta a biblioteca (mesmo vazia), para o cache da conta aparecer.
let firstLoad = true;
// Quanto a Steam já tinha gravado em disco quando cada instalação começou (id → bytes).
let writeBase: Record<string, number> = {};

export const useLibrary = create<LibraryStore>((set, get) => {
  const find = (id: string) => get().games.find((g) => g.id === id);
  const patch = (id: string, p: Partial<Game>) => set({ games: get().games.map((g) => (g.id === id ? { ...g, ...p } : g)) });
  const steamMode = () => get().mode === "steam";

  return {
    games: isTauri ? [] : MOCK_GAMES,
    mode: isTauri ? "steam" : "mock",
    steam: null,
    installed: [],
    runningAppId: null,
    syncing: false,
    pendingInstall: {},
    liveProgress: {},
    keyStatus: null,
    collections: isTauri ? [] : MOCK_COLLECTIONS,
    appMeta: isTauri ? {} : MOCK_META,

    // ───────── Steam ─────────

    refreshAppMeta: async () => {
      if (!steamMode()) return;
      try {
        const list = await steam.appMeta();
        // Só jogos e apps que o jogador pode ter: o arquivo traz também DLCs, ferramentas e demos.
        set({ appMeta: Object.fromEntries(list.map((m) => [m.appId, m])) });
      } catch (e) {
        console.error("steam_app_meta falhou", e);
      }
    },

    refreshCollections: async () => {
      if (!steamMode()) return;
      const steamId = get().steam?.steamId ?? useUserData.getState().steamId;
      if (!steamId) return;
      try {
        const list = await steam.collections(steamId);
        if (JSON.stringify(list) !== JSON.stringify(get().collections)) set({ collections: list });
      } catch (e) {
        console.error("steam_collections falhou", e);
      }
    },

    init: async () => {
      if (!steamMode()) return;
      try {
        set({ steam: await steam.info() });
      } catch (e) {
        console.error("steam_info falhou", e);
      }
      await get().refreshKeyStatus();
      await get().refreshCollections();
      await get().refreshAppMeta();
      await get().refreshInstalled();
      await get().pollRunning();
    },

    refreshKeyStatus: async () => {
      const steamId = get().steam?.steamId;
      if (!steamMode() || !steamId) return;
      try {
        set({ keyStatus: await steam.keyStatus(steamId) });
      } catch (e) {
        console.error("steam_key_status falhou", e);
      }
    },

    setupAccount: async (key) => {
      const ui = useUI.getState();
      if (!steamMode()) {
        // Navegador: só simula, para testar a tela sem a Steam.
        set({ keyStatus: { configured: true, last4: key.slice(-4), fromEnv: false } });
        ui.showToast("(navegador) Conta simulada: no app a chave é validada na Steam.");
        return true;
      }
      const steamId = get().steam?.steamId;
      if (!steamId) {
        ui.showToast("Abra a Steam e entre na sua conta para configurá-la aqui.");
        return false;
      }
      set({ syncing: true });
      ui.showToast("Validando a chave na Steam…");
      try {
        const owned = await steam.setupAccount(steamId, key);
        useUserData.getState().setOwned(owned, steamId);
        get().rebuild();
        await get().refreshKeyStatus();
        useUI.getState().showToast(`Conta configurada! ${owned.length} jogos na sua biblioteca.`);
        return true;
      } catch (e) {
        useUI.getState().showToast(String(e));
        return false;
      } finally {
        set({ syncing: false });
      }
    },

    clearKey: async () => {
      const ui = useUI.getState();
      if (!steamMode()) {
        set({ keyStatus: { configured: false, fromEnv: false } });
        return ui.showToast("(navegador) Chave removida.");
      }
      const steamId = get().steam?.steamId;
      if (!steamId) return;
      try {
        await steam.clearKey(steamId);
        // Sem a chave não há mais a lista da conta: a biblioteca volta a mostrar só o que está instalado.
        useUserData.getState().clearOwned();
        get().rebuild();
        await get().refreshKeyStatus();
        ui.showToast("Chave removida. A biblioteca mostra apenas os jogos instalados.");
      } catch (e) {
        ui.showToast(String(e));
      }
    },

    rebuild: () => {
      if (!steamMode()) return;
      const user = useUserData.getState();
      set({ games: mergeSteam(user.owned, get().installed, user, get().pendingInstall, Date.now(), get().liveProgress) });
    },

    pollProgress: async () => {
      if (!steamMode()) return;
      const installing = get().games.filter((g) => g.state === "installing");

      // Sem instalação, ou com mais de uma ao mesmo tempo (o contador é global): usa só o manifesto.
      if (installing.length !== 1) {
        if (installing.length === 0) writeBase = {};
        if (Object.keys(get().liveProgress).length > 0) {
          set({ liveProgress: {} });
          get().rebuild();
        }
        return;
      }

      const id = installing[0].id;
      const written = await steam.bytesWritten().catch(() => null);
      if (written === null) return;
      // Instalação iniciada fora do launcher: o ponto de partida é o primeiro instante em que a vimos.
      if (writeBase[id] === undefined) writeBase[id] = written;

      const app = get().installed.find((a) => a.appId === id);
      const total = app ? app.bytesToStage || app.bytesToDownload : 0;
      if (!total) return; // a Steam ainda não informou o tamanho: segue em "Preparando…"

      const fraction = Math.min(0.99, Math.max(0, (written - writeBase[id]) / total));
      const previous = get().liveProgress[id] ?? 0;
      // Só sobe (nunca volta) e só reconstrói a lista quando muda de forma visível.
      if (fraction - previous >= 0.005) {
        set({ liveProgress: { [id]: fraction } });
        get().rebuild();
      }
    },

    refreshInstalled: async () => {
      if (!steamMode()) return;
      try {
        const list = await steam.installed();
        // Pedidos de instalação já atendidos (manifesto apareceu) ou vencidos saem da lista de pendentes.
        const now = Date.now();
        const pending = Object.fromEntries(
          Object.entries(get().pendingInstall).filter(([id, at]) => now - at < 120_000 && !list.some((a) => a.appId === id)),
        );
        const changed = JSON.stringify(list) !== JSON.stringify(get().installed);
        const pendingChanged = Object.keys(pending).length !== Object.keys(get().pendingInstall).length;
        if (changed || pendingChanged || Object.keys(pending).length > 0 || firstLoad) {
          firstLoad = false;
          set({ installed: list, pendingInstall: pending });
          get().rebuild();
        }
      } catch (e) {
        console.error("steam_installed falhou", e);
      }
    },

    pollRunning: async () => {
      if (!steamMode()) return;
      try {
        const raw = await steam.runningApp();
        const now = get().runningAppId;
        const next = raw > 0 ? String(raw) : null;
        if (next === now) return;
        set({ runningAppId: next });

        if (next && !now) runningSince = Date.now();
        if (now && !next) {
          // O jogo fechou: soma o tempo jogado e traz o launcher de volta para a frente.
          const minutes = Math.round((Date.now() - runningSince) / 60_000);
          useUserData.getState().recordSession(now, minutes, Date.now());
          void api.bringToFront();
        }
      } catch (e) {
        console.error("steam_running_app falhou", e);
      }
    },

    syncOwned: async () => {
      const ui = useUI.getState();
      if (!steamMode()) return ui.showToast("A sincronização com a Steam só funciona no app (não no navegador).");
      if (get().syncing) return;
      const steamId = get().steam?.steamId ?? useUserData.getState().steamId;
      if (!steamId) return ui.showToast("Não encontrei uma conta Steam. Abra a Steam e faça login.");
      if (get().keyStatus && !get().keyStatus?.configured) return ui.showToast("Configure a chave da conta primeiro (Conta Steam › Adicionar chave).");

      set({ syncing: true });
      ui.showToast("Sincronizando a biblioteca da Steam…");
      try {
        const owned = await steam.owned(steamId);
        useUserData.getState().setOwned(owned, steamId);
        get().rebuild();
        useUI.getState().showToast(`Biblioteca sincronizada: ${owned.length} jogos.`);
      } catch (e) {
        useUI.getState().showToast(String(e));
      } finally {
        set({ syncing: false });
      }
    },

    // ───────── Ações do jogador ─────────

    toggleFavorite: (id) => {
      const g = find(id);
      if (!g) return;
      if (steamMode()) useUserData.getState().setFavorite(id, !g.favorite);
      else patch(id, { favorite: !g.favorite });
    },

    play: (id) => {
      const g = find(id);
      if (!g || g.state !== "installed") return;
      if (steamMode()) useUserData.getState().markPlayed(id, Date.now());
      else patch(id, { lastPlayedAt: Date.now() });
      void api.launchGame(g);
    },

    install: (id) => {
      const g = find(id);
      if (!g || g.state !== "not_installed") return;
      if (steamMode()) {
        // Até o manifesto aparecer, mostramos "Preparando…". O ponto de partida do contador de escrita é
        // lido ANTES de mandar o comando, para não perder o começo do download.
        set({ pendingInstall: { ...get().pendingInstall, [id]: Date.now() } });
        get().rebuild();
        void (async () => {
          const written = await steam.bytesWritten().catch(() => null);
          if (written !== null) writeBase[id] = written;
          await api.installGame(g);
        })();
        return;
      }
      void api.installGame(g);
      // Navegador: simula o download.
      patch(id, { state: "installing", progress: 0 });
      const timer = setInterval(() => {
        const cur = find(id);
        if (!cur || cur.state !== "installing") return clearInterval(timer);
        const next = Math.min(1, (cur.progress ?? 0) + 0.04);
        patch(id, next >= 1 ? { state: "installed", progress: undefined } : { progress: next });
        if (next >= 1) clearInterval(timer);
      }, 300);
    },

    uninstall: (id) => {
      const g = find(id);
      if (!g || g.state !== "installed") return;
      void api.uninstallGame(g);
      // A confirmação é do launcher e a Steam remove em silêncio; o estado muda quando o manifesto some.
      if (steamMode()) setTimeout(() => void get().refreshInstalled(), 1500);
      else patch(id, { state: "not_installed" });
    },

    cancelInstall: (id) => {
      const g = find(id);
      if (!g || g.state !== "installing") return;
      void api.cancelInstall(g);
      if (steamMode()) {
        // Esquece o pedido de instalação, senão o jogo ficaria "Baixando…" até vencer o prazo.
        const { [id]: _removed, ...rest } = get().pendingInstall;
        delete writeBase[id];
        set({ pendingInstall: rest, liveProgress: {} });
        get().rebuild();
        setTimeout(() => void get().refreshInstalled(), 1500);
      } else {
        patch(id, { state: "not_installed", progress: undefined });
      }
    },
  };
});

// Favoritos, última vez jogado e cache da conta vivem em useUserData: ao mudar, remonta a biblioteca.
useUserData.subscribe(() => useLibrary.getState().rebuild());
