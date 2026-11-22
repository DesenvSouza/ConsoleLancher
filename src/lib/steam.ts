import { isTauri } from "./api";

/** Espelham as structs de src-tauri/src/steam.rs (camelCase). */
export interface SteamInfo {
  found: boolean;
  path?: string;
  loggedIn: boolean;
  runningAppId: number;
  steamId?: string;
  personaName?: string;
  accountName?: string;
}

export interface InstalledApp {
  appId: string;
  name: string;
  sizeOnDisk: number;
  stateFlags: number;
  bytesToDownload: number;
  bytesDownloaded: number;
  /** Total a gravar em disco: base do progresso em tempo real. */
  bytesToStage: number;
  bytesStaged: number;
  lastUpdated: number;
  libraryPath: string;
}

export interface OwnedGame {
  appId: string;
  name: string;
  playtimeMin: number;
  /** Unix, em segundos (0 = desconhecido). */
  lastPlayed: number;
}

/** Um grupo de filtro da Steam: opções escolhidas e se basta uma (união) ou todas. */
export interface FilterGroup {
  options: number[];
  acceptUnion: boolean;
}

/** Filtro de uma coleção dinâmica. Grupos: 0 tipo, 1 situação, 2 recursos, 3-4 tags, 5 assinatura, 6 amigos, 7 idiomas, 8 categorias. */
export interface FilterSpec {
  searchText: string;
  groups: FilterGroup[];
}

/** Coleção da Steam (Favoritos, Ocultos ou criada pelo jogador). As dinâmicas vêm com o filtro, sem a lista de jogos. */
export interface Collection {
  id: string;
  name: string;
  appIds: string[];
  dynamic: boolean;
  filter?: FilterSpec | null;
}

/** Dados de um jogo guardados pela Steam (appinfo): base para avaliar coleções dinâmicas. */
export interface AppMeta {
  appId: string;
  kind: string;
  /** 0 nenhum, 1 parcial, 2 completo. */
  controllerSupport: number;
  categories: number[];
  tags: number[];
  /** Steam Deck: 1 não suportado, 2 jogável, 3 verificado (0 = desconhecido). */
  deck: number;
}

export interface KeyStatus {
  configured: boolean;
  /** Últimos 4 caracteres da chave (a chave inteira nunca volta para a tela). */
  last4?: string;
  fromEnv: boolean;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Leitura da Steam no backend. Só existe dentro do app (no navegador, a biblioteca é a de mentira). */
export const steam = {
  available: isTauri,
  info: () => invoke<SteamInfo>("steam_info"),
  installed: () => invoke<InstalledApp[]>("steam_installed"),
  collections: (steamId: string) => invoke<Collection[]>("steam_collections", { steamId }),
  appMeta: () => invoke<AppMeta[]>("steam_app_meta"),
  runningApp: () => invoke<number>("steam_running_app"),
  owned: (steamId: string) => invoke<OwnedGame[]>("steam_fetch_owned", { steamId }),
  /**
   * Total que a Steam já gravou em disco (null se a Steam estiver fechada). Cresce de forma contínua durante
   * uma instalação, ao contrário do manifesto, e não abre nenhuma janela: é a base do progresso ao vivo.
   */
  bytesWritten: () => invoke<number | null>("steam_bytes_written"),
  /** Esconde (true) ou mostra as notificações da Steam no canto da tela. */
  setHideToasts: (hide: boolean) => invoke<void>("steam_set_hide_toasts", { hide }),
  setBlockGuide: (block: boolean) => invoke<void>("steam_set_block_guide", { block }),
  keyStatus: (steamId: string) => invoke<KeyStatus>("steam_key_status", { steamId }),
  /** Valida a chave buscando a biblioteca; só guarda se a Steam aceitar. Devolve os jogos da conta. */
  setupAccount: (steamId: string, apiKey: string) => invoke<OwnedGame[]>("steam_setup_account", { steamId, apiKey }),
  clearKey: (steamId: string) => invoke<void>("steam_clear_key", { steamId }),
  /** Abre a página de criação da chave no navegador da própria Steam (já logada). */
  openKeyPage: () => invoke<void>("steam_open_key_page"),
};
