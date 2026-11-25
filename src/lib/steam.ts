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

/** Ponto dos logs da Steam no momento do "Jogar". */
export interface LaunchMark {
  console: number;
  ui: number;
}

export interface LaunchStatus {
  found: boolean;
  /** Nome interno da etapa da Steam (ShowEula, RunningInstallScript, CreatingProcess...). */
  task: string;
  /** A Steam espera uma resposta do jogador numa janela dela. */
  waitingUser: boolean;
  completed: boolean;
  failed: string | null;
  /** O jogador aceitou o contrato do jogo na janela da Steam. */
  eulaAccepted: boolean;
  /** Contrato que a Steam pede (por exemplo "292030_eula_0"). */
  eula: string | null;
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
  /** Idiomas suportados, com áudio e legendas quando a Steam informa. */
  languages: LangSupport[];
  /** Ids dos gêneros da loja. */
  genres: number[];
  developer: string;
  publisher: string;
  /** Lançamento (segundos desde 1970); 0 se desconhecido. */
  releaseDate: number;
  /** Nota do Metacritic (0 = sem nota). */
  metacritic: number;
  /** Porcentagem de avaliações positivas (0 = sem dado). */
  reviewPercent: number;
}

export interface LangSupport {
  /** Código da Steam: "english", "brazilian", "latam"... */
  code: string;
  audio: boolean;
  subtitles: boolean;
}

/** Descrição e gêneros vindos da loja da Steam, no idioma preferido. */
export interface StoreDetails {
  shortDescription: string;
  genres: string[];
  releaseDate: string;
  fetchedAt: number;
}

/** Espaço de um disco (o da pasta de uma biblioteca). */
export interface DiskInfo {
  path: string;
  /** Espaço livre, em bytes. */
  free: number;
  /** Tamanho total, em bytes. */
  total: number;
}

export interface KeyStatus {
  configured: boolean;
  /** Últimos 4 caracteres da chave (a chave inteira nunca volta para a tela). */
  last4?: string;
  fromEnv: boolean;
  /** Quem está logado pelo QR code neste PC (vale como acesso à biblioteca, mesmo sem chave). */
  session?: { accountName: string; steamId: string } | null;
}

/** Desafio de login por QR code. */
export interface QrChallenge {
  clientId: string;
  requestId: string;
  /** Endereço que vai dentro do QR. */
  challengeUrl: string;
  /** Segundos entre uma pergunta e outra. */
  interval: number;
}

export interface QrPoll {
  newClientId?: string | null;
  newChallengeUrl?: string | null;
  approved: boolean;
  accountName?: string | null;
  steamId?: string | null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Leitura da Steam no backend. Só existe dentro do app (no navegador, a biblioteca é a de mentira). */
/** Resultado da consulta à loja da Steam por nome: suporte a controle do jogo, ou "nomatch" se a Steam não tem um jogo com esse nome. */
export type StoreControllerLookup = "full" | "partial" | "none" | "nomatch";

export const steam = {
  available: isTauri,
  /** Suporte a controle pelo nome do jogo, na loja da Steam (até 12 títulos por chamada; os que falharam não voltam). */
  controllerLookup: (titles: string[]) => invoke<Record<string, StoreControllerLookup>>("steam_controller_lookup", { titles }),
  info: () => invoke<SteamInfo>("steam_info"),
  installed: () => invoke<InstalledApp[]>("steam_installed"),
  /** Espaço livre e total do disco de cada pasta informada. */
  diskUsage: (paths: string[]) => invoke<DiskInfo[]>("disk_usage", { paths }),
  /** Programa o desligamento do Windows para daqui a `seconds` segundos (0 = agora). */
  powerSchedule: (seconds: number) => invoke<void>("power_schedule", { seconds }),
  /** Cancela o desligamento programado. */
  powerCancel: () => invoke<void>("power_cancel"),
  manifestsRemoved: (appId: string, libraryPaths: string[]) => invoke<boolean>("steam_manifests_removed", { appId, libraryPaths }),
  collections: (steamId: string) => invoke<Collection[]>("steam_collections", { steamId }),
  storeDetails: (appId: string, lang: string) => invoke<StoreDetails>("steam_store_details", { appId, lang }),
  appMeta: () => invoke<AppMeta[]>("steam_app_meta"),
  runningApp: () => invoke<number>("steam_running_app"),
  /** Ponto do log da Steam de agora: a abertura de um jogo só olha o que vier depois. */
  launchMark: () => invoke<LaunchMark>("steam_launch_mark"),
  /** Etapa da abertura do jogo (lida do log da Steam). */
  launchStatus: (appId: string, from: LaunchMark) => invoke<LaunchStatus>("steam_launch_status", { appId, from }),
  /** Traz para a frente a janela da Steam que espera uma resposta (contrato do jogo, por exemplo). */
  showPrompt: (appId: string) => invoke<void>("steam_show_prompt", { appId }),
  /** Texto do contrato que a Steam pede, no idioma pedido (página pública da loja). */
  eulaText: (eulaId: string, lang: string) => invoke<string>("steam_eula_text", { eulaId, lang }),
  /** O jogador aceitou o contrato no launcher: clica em "Aceitar" na Steam por um instante e a esconde de novo. */
  acceptEula: () => invoke<void>("steam_accept_eula"),
  /** A Steam recebeu a resposta que pedia: devolve o controle ao launcher, esconde a Steam e traz o jogo/launcher à frente. */
  promptDone: () => invoke<void>("steam_prompt_done"),
  owned: (steamId: string) => invoke<OwnedGame[]>("steam_fetch_owned", { steamId }),
  /**
   * Total que a Steam já gravou em disco (null se a Steam estiver fechada). Cresce de forma contínua durante
   * uma instalação, ao contrário do manifesto, e não abre nenhuma janela: é a base do progresso ao vivo.
   */
  bytesWritten: () => invoke<number | null>("steam_bytes_written"),
  /** Esconde (true) ou mostra as notificações da Steam no canto da tela. */
  setHideToasts: (hide: boolean) => invoke<void>("steam_set_hide_toasts", { hide }),
  /** Pede um QR de login (o jogador o lê com o app da Steam no celular). */
  authBegin: () => invoke<QrChallenge>("steam_auth_begin"),
  /** O QR já foi aprovado? Se sim, a sessão fica guardada (cifrada) neste PC. */
  authPoll: (clientId: string, requestId: string) => invoke<QrPoll>("steam_auth_poll", { clientId, requestId }),
  /** Esquece o login por QR neste PC. */
  authLogout: () => invoke<void>("steam_auth_logout"),
  keyStatus: (steamId: string) => invoke<KeyStatus>("steam_key_status", { steamId }),
  /** Valida a chave buscando a biblioteca; só guarda se a Steam aceitar. Devolve os jogos da conta. */
  setupAccount: (steamId: string, apiKey: string) => invoke<OwnedGame[]>("steam_setup_account", { steamId, apiKey }),
  clearKey: (steamId: string) => invoke<void>("steam_clear_key", { steamId }),
  /** Abre a página de criação da chave no navegador da própria Steam (já logada). */
  openKeyPage: () => invoke<void>("steam_open_key_page"),
};
