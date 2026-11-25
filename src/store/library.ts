import { create } from "zustand";
import { playSound } from "../audio/sounds";
import { steamLanguage, t, te } from "../i18n";
import { api, isTauri } from "../lib/api";
import { epic } from "../lib/epic";
import { LAUNCH_WAIT_MS } from "../lib/launch";
import { installState, mergeEpic, mergeSteam } from "../lib/merge";
import { MOCK_COLLECTIONS, MOCK_GAMES, MOCK_META } from "../lib/mock";
import { steam, type AppMeta, type Collection, type InstalledApp, type KeyStatus, type SteamInfo, type StoreDetails } from "../lib/steam";
import type { Game } from "../lib/types";
import { useEpic } from "./epic";
import { useLaunch } from "./launch";
import { useUI } from "./ui";
import { useUserData } from "./userData";

interface UninstallRequest {
  game: Game;
  manifests: InstalledApp[];
  accepted: boolean;
}

const UNINSTALL_TIMEOUT_MS = 60_000;
/** Intervalo da sincronização automática da lista de jogos da conta, e a espera depois de uma falha. */
const AUTO_SYNC_MS = 5 * 60_000;
const AUTO_SYNC_RETRY_MS = 15 * 60_000;
/** Última vez que os dados dos jogos (appinfo) foram relidos. */
let lastMetaTry = 0;
/** Instante antes do qual a sincronização automática não tenta de novo (depois de uma falha). */
let nextAutoSyncAt = 0;
/** Jogos instalados que já motivaram uma sincronização por não estarem na lista da conta (ver `refreshInstalled`). */
const askedAbout = new Set<string>();

interface LibraryStore {
  games: Game[];
  /** "steam": biblioteca real (dentro do app). "mock": jogos de mentira (navegador, para desenvolver a interface). */
  mode: "mock" | "steam";
  steam: SteamInfo | null;
  installed: InstalledApp[];
  /** AppID do jogo com abertura confirmada pelo Windows. */
  runningAppId: string | null;
  syncing: boolean;
  /** Jogos em que o jogador pediu "Instalar" e a Steam ainda não criou o manifesto (id → quando). */
  pendingInstall: Record<string, number>;
  pendingUninstall: Record<string, UninstallRequest>;
  /** Desinstalações que não deram certo (falha ou a Steam não confirmou): ficam visíveis na página do jogo, com "Tentar de novo". */
  uninstallIssues: Record<string, "failed" | "timeout">;
  /** Jogos que o jogador mandou abrir e ainda não apareceram como "em execução" (id → quando). Evita clique repetido. */
  launching: Record<string, number>;
  /** Progresso ao vivo (0..1) da instalação em andamento, medido pelo contador de escrita da Steam. */
  liveProgress: Record<string, number>;

  /** A conta tem chave da Web API guardada? (null = ainda não consultado) */
  keyStatus: KeyStatus | null;
  /** Coleções da Steam (Favoritos, Ocultos e as do jogador): base das abas "por coleção". */
  collections: Collection[];
  refreshCollections: () => Promise<void>;
  /** Dados de cada jogo guardados pela Steam (appinfo), por AppID: avaliam as coleções dinâmicas. */
  appMeta: Record<string, AppMeta>;
  /** Descrição e gêneros da loja, por "appId:idioma". "loading"/"error" enquanto busca ou se falhou. */
  storeDetails: Record<string, StoreDetails | "loading" | "error">;
  loadStoreDetails: (appId: string) => Promise<void>;
  /** Relê os dados dos jogos guardados pela Steam. `missingFor`: só se esse jogo ainda não tem dados (no máximo a cada 30 s). */
  refreshAppMeta: (options?: { missingFor?: string }) => Promise<void>;

  init: () => Promise<void>;
  rebuild: () => void;
  /** Atualiza o progresso ao vivo da instalação em andamento (chamado a cada 0,5 s enquanto houver uma). */
  pollProgress: () => Promise<void>;
  refreshKeyStatus: () => Promise<void>;
  /** Valida a chave na Steam, guarda e sincroniza a biblioteca. Devolve true se deu certo. */
  setupAccount: (key: string) => Promise<boolean>;
  clearKey: () => Promise<void>;
  /** O QR foi aprovado: confere o acesso e traz a biblioteca da conta. */
  qrSignedIn: (accountName: string, steamId: string) => Promise<void>;
  /** Sai do login por QR neste PC. */
  signOutQr: () => Promise<void>;
  refreshInstalled: () => Promise<void>;
  pollRunning: () => Promise<void>;
  /** Traz a lista de jogos da conta. `silent`: sem avisos de andamento nem de erro (só avisa quando entra jogo novo). */
  syncOwned: (options?: { silent?: boolean }) => Promise<void>;
  /**
   * Sincronização automática: só roda com a conta configurada, sem jogo aberto (nem abrindo), e se a lista tem mais de
   * `minGapMs` (padrão 5 min). Silenciosa; depois de uma falha espera 15 min.
   */
  autoSync: (options?: { minGapMs?: number }) => Promise<void>;
  toggleFavorite: (id: string) => void;
  play: (id: string) => void;
  install: (id: string) => void;
  uninstall: (id: string) => Promise<void>;
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
  let installedScan = 0;
  let checkingRunning = false;

  return {
    games: isTauri ? [] : MOCK_GAMES,
    mode: isTauri ? "steam" : "mock",
    steam: null,
    installed: [],
    runningAppId: null,
    syncing: false,
    pendingInstall: {},
    pendingUninstall: {},
    uninstallIssues: {},
    launching: {},
    liveProgress: {},
    keyStatus: null,
    collections: isTauri ? [] : MOCK_COLLECTIONS,
    appMeta: isTauri ? {} : MOCK_META,
    storeDetails: {},
    loadStoreDetails: async (appId) => {
      if (!steamMode()) return;
      // Descrição e gêneros vêm da loja no idioma do LAUNCHER (o idioma preferido dos jogos é outra coisa: só confere o jogo).
      const lang = steamLanguage();
      const key = `${appId}:${lang}`;
      const current = get().storeDetails[key];
      if (current === "loading" || (current && current !== "error")) return;
      set({ storeDetails: { ...get().storeDetails, [key]: "loading" } });
      try {
        const details = await steam.storeDetails(appId, lang);
        set({ storeDetails: { ...get().storeDetails, [key]: details } });
      } catch (e) {
        console.error("steam_store_details falhou", e);
        set({ storeDetails: { ...get().storeDetails, [key]: "error" } });
      }
    },

    // ───────── Steam ─────────

    refreshAppMeta: async (options) => {
      if (!steamMode()) return;
      const now = Date.now();
      if (options?.missingFor) {
        if (get().appMeta[options.missingFor] || now - lastMetaTry < 30_000) return;
      }
      lastMetaTry = now;
      try {
        const list = await steam.appMeta();
        // Uma leitura vazia é a Steam no meio de reescrever o arquivo: não apaga o que já se sabia (idiomas, controle,
        // avaliações). Uma leitura boa soma aos dados existentes.
        if (list.length === 0) return;
        set({ appMeta: { ...get().appMeta, ...Object.fromEntries(list.map((m) => [m.appId, m])) } });
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
        ui.showToast(t("(navegador) Conta simulada: no app a chave é validada na Steam."));
        return true;
      }
      const steamId = get().steam?.steamId;
      if (!steamId) {
        ui.showToast(t("Abra a Steam e entre na sua conta para configurá-la aqui."), "warning");
        return false;
      }
      set({ syncing: true });
      ui.showToast(t("Validando a chave na Steam…"));
      try {
        const owned = await steam.setupAccount(steamId, key);
        useUserData.getState().setOwned(owned, steamId);
        get().rebuild();
        await get().refreshKeyStatus();
        useUI.getState().showToast(t("Conta configurada! {n} jogos na sua biblioteca.", { n: owned.length }), "success");
        return true;
      } catch (e) {
        useUI.getState().showToast(te(e), "warning");
        return false;
      } finally {
        set({ syncing: false });
      }
    },

    qrSignedIn: async (accountName, steamId) => {
      const ui = useUI.getState();
      if (!steamMode()) {
        set({ keyStatus: { configured: true, fromEnv: false, session: { accountName, steamId } } });
        ui.showToast(t("(navegador) Login simulado: no app a conta entra pelo QR code."));
        return;
      }
      await get().refreshKeyStatus();
      const local = get().steam?.steamId;
      if (local && local !== steamId) {
        ui.showToast(t("Esta conta não é a que está logada na Steam deste PC. Entre com o QR da mesma conta."), "warning");
        return;
      }
      ui.showToast(t("Conta {name} conectada. Buscando a biblioteca…", { name: accountName }));
      await get().syncOwned();
    },

    signOutQr: async () => {
      const ui = useUI.getState();
      if (!steamMode()) {
        set({ keyStatus: { configured: false, fromEnv: false } });
        return ui.showToast(t("(navegador) Saiu do login."));
      }
      try {
        await steam.authLogout();
        await get().refreshKeyStatus();
        if (!get().keyStatus?.configured) {
          useUserData.getState().clearOwned();
          get().rebuild();
        }
        ui.showToast(t("Saiu do login por QR code neste PC."));
      } catch (e) {
        ui.showToast(te(e), "warning");
      }
    },

    clearKey: async () => {
      const ui = useUI.getState();
      if (!steamMode()) {
        set({ keyStatus: { configured: false, fromEnv: false } });
        return ui.showToast(t("(navegador) Chave removida."));
      }
      const steamId = get().steam?.steamId;
      if (!steamId) return;
      try {
        await steam.clearKey(steamId);
        await get().refreshKeyStatus();
        // Sem a chave nem o login por QR não há mais a lista da conta: a biblioteca volta a mostrar só o que está instalado.
        if (!get().keyStatus?.configured) {
          useUserData.getState().clearOwned();
          get().rebuild();
          ui.showToast(t("Chave removida. A biblioteca mostra apenas os jogos instalados."));
        } else {
          ui.showToast(t("Chave removida. A biblioteca continua pelo login com QR code."));
        }
      } catch (e) {
        ui.showToast(te(e), "warning");
      }
    },

    rebuild: () => {
      if (!steamMode()) return;
      const user = useUserData.getState();
      const steamGames = mergeSteam(user.owned, get().installed, user, get().pendingInstall, Date.now(), get().liveProgress);
      const epicState = useEpic.getState();
      const epicGames = epicState.library.length > 0 || epicState.installed.length > 0 ? mergeEpic(epicState.library, epicState.installed, user, epicState.installs) : [];
      set({ games: epicGames.length > 0 ? [...steamGames, ...epicGames].sort((a, b) => a.title.localeCompare(b.title, "pt-BR")) : steamGames });
    },

    pollProgress: async () => {
      if (!steamMode()) return;
      const installing = get().games.filter((g) => g.source === "steam" && g.state === "installing");

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
      void useEpic.getState().refreshInstalled();
      const scan = ++installedScan;
      const requests = Object.entries(get().pendingUninstall).filter(([, request]) => request.accepted);
      try {
        const list = await steam.installed();
        if (scan !== installedScan) return;
        const present = new Set(list.map((app) => app.appId));
        const completed = await Promise.all(requests.map(async ([id, request]) => {
          const appId = request.game.appId;
          if (!appId || present.has(appId)) return null;
          const libraries = request.manifests.map((app) => app.libraryPath);
          const removed = await steam.manifestsRemoved(appId, libraries).catch(() => false);
          return removed ? { id, request } : null;
        }));
        if (scan !== installedScan) return;

        const remaining = { ...get().pendingUninstall };
        const removedTitles: string[] = [];
        for (const result of completed) {
          if (result && remaining[result.id] === result.request) {
            delete remaining[result.id];
            removedTitles.push(result.request.game.title);
          }
        }
        const retained = Object.values(remaining).flatMap(({ game, manifests }) =>
          game.appId && !present.has(game.appId) ? manifests : [],
        );
        const installed = [...list, ...retained];

        // Pedidos de instalação já atendidos (manifesto apareceu) ou vencidos saem da lista de pendentes.
        const now = Date.now();
        const pending = Object.fromEntries(
          Object.entries(get().pendingInstall).filter(([id, at]) => now - at < 120_000 && !list.some((a) => a.appId === id)),
        );
        const changed = JSON.stringify(installed) !== JSON.stringify(get().installed);
        const pendingChanged = Object.keys(pending).length !== Object.keys(get().pendingInstall).length;
        if (changed || pendingChanged || Object.keys(pending).length > 0 || removedTitles.length > 0 || firstLoad) {
          const downloading = new Set(get().games.filter((game) => game.state === "installing").map((game) => game.id));
          firstLoad = false;
          set({ installed, pendingInstall: pending, pendingUninstall: remaining });
          get().rebuild();
          if (list.some((app) => downloading.has(app.appId) && installState(app).state === "installed")) {
            playSound("success");
          }
        }
        for (const title of removedTitles) useUI.getState().showToast(t("{title} foi desinstalado.", { title }), "success");

        // Um jogo instalado que a lista da conta não conhece: provavelmente acabou de ser comprado ou resgatado.
        // Sincroniza já, sem esperar os 5 minutos (uma vez por jogo: ferramentas da Steam, que nunca estão na lista, não repetem).
        const ownedIds = new Set(useUserData.getState().owned.map((g) => g.appId));
        if (ownedIds.size > 0) {
          const unknown = list.filter((app) => !ownedIds.has(app.appId) && !askedAbout.has(app.appId));
          if (unknown.length > 0) {
            unknown.forEach((app) => askedAbout.add(app.appId));
            void get().autoSync({ minGapMs: 30_000 });
          }
        }
      } catch (e) {
        console.error("steam_installed falhou", e);
      }
    },

    pollRunning: async () => {
      if (!steamMode() || checkingRunning) return;
      checkingRunning = true;
      try {
        const pending = get().launching;
        const raw = await steam.runningApp();
        const now = get().runningAppId;
        let next = raw > 0 ? String(raw) : null;
        // Sem jogo da Steam aberto, vê se há um da Epic (só se algum está instalado: senão não há o que procurar).
        if ((!next || now?.startsWith("epic:")) && useEpic.getState().installed.length > 0) {
          const running = await epic.running().catch(() => null);
          if (running) next = `epic:${running.appName}`;
        }
        const ids = Object.keys(pending);
        const foreground = ids.length > 0 ? await api.confirmLaunch(ids) : null;
        const current = get().launching;
        let launching = current;
        if (foreground && current[foreground] !== undefined && current[foreground] === pending[foreground]) {
          const { [foreground]: _confirmed, ...rest } = current;
          launching = rest;
          next = foreground;
        } else if (next && Object.keys(current).some((id) => find(id)?.appId === next)) {
          // A loja já enxerga o processo ou a janela, mas a abertura ainda aguarda o primeiro plano.
          next = now;
        }
        if (next === now && launching === current) return;
        set({ runningAppId: next, launching });

        if (next && !now) {
          runningSince = Date.now();
          useUserData.getState().markPlayed(next, runningSince);
        }
        if (now && !next) {
          // O jogo fechou: soma o tempo jogado e traz o launcher de volta para a frente.
          const minutes = Math.round((Date.now() - runningSince) / 60_000);
          useUserData.getState().recordSession(now, minutes, Date.now());
          await api.bringToFront();
          // Com o jogo fechado a rede volta a ser livre: atualiza a lista (tempo de jogo oficial, compras feitas enquanto jogava).
          setTimeout(() => void get().autoSync({ minGapMs: 60_000 }), 15_000);
        }
      } catch (e) {
        console.error("steam_running_app falhou", e);
      } finally {
        checkingRunning = false;
      }
    },

    syncOwned: async (options) => {
      const silent = !!options?.silent;
      const ui = useUI.getState();
      const warn = (text: string) => (silent ? undefined : ui.showToast(text));
      if (!steamMode()) return warn(t("A sincronização com a Steam só funciona no app (não no navegador)."));
      if (get().syncing) return;
      const steamId = get().steam?.steamId ?? useUserData.getState().steamId;
      if (!steamId) return warn(t("Nenhuma conta Steam encontrada. Abra a Steam e faça login."));
      if (get().keyStatus && !get().keyStatus?.configured) return warn(t("Entre pela Steam com o QR code (Configurações › Contas › Steam) ou configure a chave primeiro."));

      set({ syncing: true });
      if (!silent) {
        playSound("operation");
        ui.showToast(t("Sincronizando a biblioteca da Steam…"));
      }
      try {
        const before = useUserData.getState().owned;
        const owned = await steam.owned(steamId);
        const known = new Set(before.map((g) => g.appId));
        // Na primeira sincronização (lista vazia) nada é "novo".
        const added = before.length > 0 ? owned.filter((g) => !known.has(g.appId)) : [];
        if (JSON.stringify(owned) === JSON.stringify(before)) {
          // Nada mudou: só anota a hora (sem refazer a lista de jogos).
          useUserData.setState({ ownedFetchedAt: Date.now() });
        } else {
          useUserData.getState().setOwned(owned, steamId);
          get().rebuild();
        }
        nextAutoSyncAt = 0;
        const news = added.length === 0 ? "" : added.length === 1 ? t("Novo jogo na biblioteca: {name}", { name: added[0].name }) : t("{n} jogos novos na biblioteca: {names}", { n: added.length, names: added.slice(0, 2).map((g) => g.name).join(", ") + (added.length > 2 ? t(" e outros") : "") });
        if (!silent) useUI.getState().showToast(`${t("Biblioteca sincronizada: {n} jogos.", { n: owned.length })}${news ? ` ${news}.` : ""}`, "success");
        else if (news) useUI.getState().showToast(news, "success");
      } catch (e) {
        if (silent) {
          console.error("sincronização automática falhou", e); // i18n-ignore
          nextAutoSyncAt = Date.now() + AUTO_SYNC_RETRY_MS;
        } else {
          useUI.getState().showToast(te(e), "warning");
        }
      } finally {
        set({ syncing: false });
      }
    },

    autoSync: async (options) => {
      if (!steamMode() || get().syncing || !get().keyStatus?.configured) return;
      // Com um jogo aberto (ou abrindo) o launcher não faz nada extra: nem rede, nem avisos por cima do jogo.
      if (get().runningAppId !== null || Object.keys(get().launching).length > 0) return;
      const now = Date.now();
      if (now < nextAutoSyncAt || now - useUserData.getState().ownedFetchedAt < (options?.minGapMs ?? AUTO_SYNC_MS)) return;
      await get().syncOwned({ silent: true });
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
      if (!g || g.state !== "installed" || get().pendingUninstall[id] || get().launching[id]) return;
      const { runningAppId, launching } = get();
      if (runningAppId !== null) {
        if (runningAppId !== g.appId) useUI.getState().showToast(t("Feche o jogo em execução antes de abrir outro."), "warning");
        return;
      }
      if (Object.keys(launching).length > 0) {
        useUI.getState().showToast(t("Aguarde a abertura do jogo atual."), "warning");
        return;
      }
      // A Steam atualiza o jogo antes de abri-lo: avisa logo, para a espera não parecer travamento.
      if (g.update === "pending" && g.source === "steam") useUI.getState().showToast(t("Este jogo tem uma atualização: a Steam vai baixá-la antes de abrir."));
      playSound("launch");
      // Na Steam a data só é anotada quando o jogo aparece em execução (pollRunning): uma abertura que falha não deve
      // promover o jogo para o início da lista de recentes.
      if (!steamMode()) patch(id, { lastPlayedAt: Date.now() });
      // "Abrindo…" permanece até a janela assumir o primeiro plano ou até a abertura falhar.
      const requestedAt = Date.now();
      const stopLaunching = () => {
        if (get().launching[id] !== requestedAt) return false;
        const { [id]: _gone, ...rest } = get().launching;
        set({ launching: rest });
        return true;
      };
      set({ launching: { ...get().launching, [id]: requestedAt } });
      // Só avisa que a abertura "não foi confirmada" se a Steam não estiver fazendo nada por ela: com etapas em
      // andamento (componentes, nuvem, contrato à espera do jogador) a tela de abertura explica o que acontece.
      const check = () => {
        if (get().launching[id] !== requestedAt) return;
        const status = useLaunch.getState().status[id];
        // Atualizando antes de abrir: a Steam está ocupada baixando, e isso pode levar bem mais que 20 minutos.
        const updating = !!find(id)?.update;
        const working = (status?.found && !status.completed && !status.failed) || updating;
        if (working && Date.now() - requestedAt < (updating ? 3 * 60 * 60_000 : 20 * 60_000)) {
          setTimeout(check, 15_000);
          return;
        }
        if (steamMode() && !status?.failed) {
          useUI.getState().showToast(t("A abertura de {title} ainda não foi confirmada.", { title: g.title }), "warning");
        }
      };
      if (steamMode()) setTimeout(check, LAUNCH_WAIT_MS);
      else setTimeout(stopLaunching, LAUNCH_WAIT_MS);
      void (async () => {
        // O que a Steam escrever no log daqui em diante é desta abertura.
        if (steamMode() && g.source === "steam") useLaunch.getState().setMark(id, await steam.launchMark().catch(() => ({ console: 0, ui: 0 })));
        await api.launchGame(g);
        await get().pollRunning();
      })().catch((e) => {
        if (stopLaunching()) useUI.getState().showToast(te(e), "warning");
      });
    },

    install: (id) => {
      const g = find(id);
      if (!g || g.state !== "not_installed" || get().pendingUninstall[id]) return;
      playSound("operation");
      if (get().uninstallIssues[id]) {
        const { [id]: _gone, ...rest } = get().uninstallIssues;
        set({ uninstallIssues: rest });
      }
      if (g.source === "epic") {
        // Sem a janela da Epic: o launcher instala sozinho (Legendary); sem ele, abre a página do jogo na Epic Games Launcher.
        void useEpic.getState().install(g);
        return;
      }
      if (steamMode()) {
        // Até o manifesto aparecer, mostramos "Preparando…". O ponto de partida do contador de escrita é
        // lido ANTES de mandar o comando, para não perder o começo do download.
        const requestedAt = Date.now();
        set({ pendingInstall: { ...get().pendingInstall, [id]: requestedAt } });
        get().rebuild();
        void (async () => {
          const written = await steam.bytesWritten().catch(() => null);
          if (written !== null) writeBase[id] = written;
          await api.installGame(g);
        })().catch((error) => {
          if (get().pendingInstall[id] !== requestedAt) return;
          const { [id]: _removed, ...remaining } = get().pendingInstall;
          delete writeBase[id];
          set({ pendingInstall: remaining });
          get().rebuild();
          useUI.getState().showToast(te(error), "warning");
        });
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
        if (next >= 1) {
          clearInterval(timer);
          playSound("success");
        }
      }, 300);
    },

    uninstall: async (id) => {
      const g = find(id);
      if (!g || g.state !== "installed" || get().pendingUninstall[id]) return;
      const ui = useUI.getState();
      if (get().launching[id]) {
        ui.showToast(t("Aguarde a abertura de {title} antes de desinstalar.", { title: g.title }), "warning");
        return;
      }
      if (g.appId && get().runningAppId === g.appId) {
        ui.showToast(t("Feche {title} antes de desinstalar.", { title: g.title }), "warning");
        return;
      }

      if (g.source === "epic") {
        void useEpic.getState().uninstall(g);
        return;
      }
      playSound("operation");
      const game = { ...g };
      const manifests = get().installed.filter((app) => app.appId === g.appId);
      const removeRequest = (message: string, sound: "success" | "warning", issue?: "failed" | "timeout") => {
        const { [id]: current, ...remaining } = get().pendingUninstall;
        if (current?.game !== game) return;
        set({ pendingUninstall: remaining, uninstallIssues: issue ? { ...get().uninstallIssues, [id]: issue } : get().uninstallIssues });
        ui.showToast(message, sound);
      };
      // Uma nova tentativa apaga o problema da anterior.
      const { [id]: _oldIssue, ...issues } = get().uninstallIssues;
      set({ pendingUninstall: { ...get().pendingUninstall, [id]: { game, manifests, accepted: false } }, uninstallIssues: issues });
      const timeout = setTimeout(() => {
        removeRequest(t("A Steam ainda não confirmou a desinstalação de {title}.", { title: game.title }), "warning", "timeout");
      }, UNINSTALL_TIMEOUT_MS);

      try {
        await api.uninstallGame(game);
        if (get().pendingUninstall[id]?.game !== game) return;
        if (steamMode()) {
          set({ pendingUninstall: { ...get().pendingUninstall, [id]: { game, manifests, accepted: true } } });
          void get().refreshInstalled();
          return;
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 650));
        patch(id, { state: "not_installed", sizeGB: 0 });
        clearTimeout(timeout);
        removeRequest(t("{title} foi desinstalado.", { title: game.title }), "success");
      } catch (err) {
        clearTimeout(timeout);
        console.error("steam_uninstall falhou", err);
        removeRequest(t("Não foi possível desinstalar {title}.", { title: game.title }), "warning", "failed");
      }
    },

    cancelInstall: (id) => {
      const g = find(id);
      // Atualização de um jogo instalado: "cancelar" (que é remover) apagaria o jogo. Nunca chega aqui pela interface, e aqui
      // fica a última barreira.
      if (!g || g.state !== "installing" || g.update || get().pendingUninstall[id]) return;
      if (g.source === "epic") {
        void useEpic.getState().cancelInstall(g);
        return;
      }
      playSound("back");
      void api.cancelInstall(g).catch((error) => useUI.getState().showToast(te(error), "warning"));
      if (steamMode()) {
        // Esquece o pedido de instalação, senão o jogo ficaria "Baixando…" até vencer o prazo.
        const { [id]: _removed, ...rest } = get().pendingInstall;
        const { [id]: _live, ...liveRest } = get().liveProgress;
        delete writeBase[id];
        set({ pendingInstall: rest, liveProgress: liveRest });
        get().rebuild();
        setTimeout(() => void get().refreshInstalled(), 1500);
      } else {
        patch(id, { state: "not_installed", progress: undefined });
      }
    },
  };
});

// A biblioteca da Epic (conta e instalados) também entra na lista.
useEpic.subscribe((s, prev) => {
  if (s.library === prev.library && s.installed === prev.installed && s.installs === prev.installs) return;
  useLibrary.getState().rebuild();
});

// Favoritos, última vez jogado e cache da conta vivem em useUserData: ao mudar, remonta a biblioteca.
// Só o que entra na montagem da lista refaz a lista: anotar a hora da última sincronização não precisa.
useUserData.subscribe((s, prev) => {
  if (s.favorites === prev.favorites && s.lastPlayedAt === prev.lastPlayedAt && s.extraPlaytimeMin === prev.extraPlaytimeMin && s.owned === prev.owned && s.steamId === prev.steamId) return;
  useLibrary.getState().rebuild();
});
