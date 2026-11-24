import type { Game, InstallState } from "./types";
import type { EpicGame, EpicInstalled, EpicInstallState } from "./epic";
import type { InstalledApp, OwnedGame } from "./steam";

// Bits de StateFlags dos manifestos da Steam.
const FULLY_INSTALLED = 4;
const UPDATE_REQUIRED = 2;
const UPDATE_RUNNING = 256;
const UPDATE_STARTED = 512;
const DOWNLOADING = 1_048_576;
const BUSY = UPDATE_REQUIRED | UPDATE_RUNNING | UPDATE_STARTED | DOWNLOADING;

export interface UserOverlay {
  favorites: Record<string, true>;
  lastPlayedAt: Record<string, number>;
  extraPlaytimeMin: Record<string, number>;
}

/** Quanto tempo (ms) um "Instalar" pedido ao launcher conta como em andamento enquanto a Steam ainda não criou o manifesto. */
export const PENDING_INSTALL_MS = 120_000;

/** Estado e progresso (0..1) do jogo a partir do manifesto da Steam. */
export function installState(app: InstalledApp): { state: InstallState; progress?: number; update?: "pending" | "running" } {
  const flags = app.stateFlags;
  const downloading = (flags & BUSY) !== 0 && app.bytesToDownload > 0 && app.bytesDownloaded < app.bytesToDownload;
  // Já instalado e só "precisa atualizar" (a Steam ainda não começou): jogável, com a atualização anotada.
  if (flags & FULLY_INSTALLED && !downloading) return { state: "installed", update: flags & UPDATE_REQUIRED ? "pending" : undefined };
  if (downloading || (flags & BUSY) !== 0) {
    const progress = app.bytesToDownload > 0 ? Math.min(1, app.bytesDownloaded / app.bytesToDownload) : undefined;
    // Com o bit "instalado" ligado, não é uma instalação nova: é uma atualização.
    return { state: "installing", progress, update: flags & FULLY_INSTALLED ? "running" : undefined };
  }
  return { state: "not_installed" };
}

/** Matiz estável (0-360) a partir do id, para a capa provisória. */
export function hueOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/**
 * Junta o que a Steam sabe (jogos da conta + instalados) com os dados do launcher.
 * `pendingInstall` guarda quando o jogador pediu "Instalar", para mostrar "Baixando…" até o manifesto aparecer.
 */
export function mergeSteam(
  owned: OwnedGame[],
  installed: InstalledApp[],
  user: UserOverlay,
  pendingInstall: Record<string, number>,
  now: number,
  /** Progresso ao vivo (0..1) medido pelo contador de escrita; vale no lugar do manifesto, que só atualiza no fim. */
  live: Record<string, number> = {},
): Game[] {
  const ownedById = new Map(owned.map((g) => [g.appId, g]));
  const installedById = new Map(installed.map((a) => [a.appId, a]));
  const ids = new Set([...ownedById.keys(), ...installedById.keys()]);

  const games: Game[] = [];
  for (const id of ids) {
    const o = ownedById.get(id);
    const inst = installedById.get(id);

    let state: InstallState = "not_installed";
    let progress: number | undefined;
    let update: Game["update"];
    if (inst) ({ state, progress, update } = installState(inst));
    else if (pendingInstall[id] && now - pendingInstall[id] < PENDING_INSTALL_MS) state = "installing";
    if (state === "installing" && live[id] !== undefined) progress = live[id];

    const lastPlayedAt = Math.max((o?.lastPlayed ?? 0) * 1000, user.lastPlayedAt[id] ?? 0) || undefined;

    games.push({
      id,
      appId: id,
      source: "steam",
      title: o?.name || inst?.name || `App ${id}`,
      state,
      progress,
      update,
      // Base 1024, a mesma da lista de armazenamento (formatBytes) e da própria Steam: o mesmo jogo mostra o mesmo número em todo lugar.
      sizeGB: inst ? Math.round((inst.sizeOnDisk / 1024 ** 3) * 100) / 100 : 0,
      playtimeMin: (o?.playtimeMin ?? 0) + (user.extraPlaytimeMin[id] ?? 0),
      lastPlayedAt,
      favorite: !!user.favorites[id],
      hue: hueOf(id),
      description: "",
    });
  }
  return games.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}

/** Junta a biblioteca da Epic (conta + instalados) com os dados do launcher. O id é "epic:<nome interno>". */
export function mergeEpic(library: EpicGame[], installed: EpicInstalled[], user: UserOverlay, installs: Record<string, EpicInstallState> = {}): Game[] {
  const installedByName = new Map(installed.map((g) => [g.appName, g]));
  const ownedByName = new Map(library.map((g) => [g.appName, g]));
  const names = new Set([...ownedByName.keys(), ...installedByName.keys()]);

  const games: Game[] = [];
  for (const name of names) {
    const o = ownedByName.get(name);
    const inst = installedByName.get(name);
    const id = `epic:${name}`;
    const job = installs[name];
    const active = job && (job.status === "preparing" || job.status === "running") ? job : undefined;
    const art = o?.imageTall || o?.imageWide ? { tall: o.imageTall, wide: o.imageWide } : undefined;
    games.push({
      id,
      appId: id,
      source: "epic",
      epic: { appName: name, namespace: o?.namespace ?? inst?.namespace ?? "", catalogItemId: o?.catalogItemId ?? inst?.catalogItemId ?? "" },
      title: o?.title || inst?.title || name,
      state: inst ? (inst.incomplete ? "installing" : "installed") : active ? "installing" : "not_installed",
      progress: !inst && active ? Math.min(1, (active.percent ?? 0) / 100) : undefined,
      sizeGB: inst ? Math.round((inst.sizeBytes / 1024 ** 3) * 100) / 100 : 0,
      // A Epic não informa o tempo de jogo: só vale o que o próprio launcher mediu.
      playtimeMin: user.extraPlaytimeMin[id] ?? 0,
      lastPlayedAt: user.lastPlayedAt[id] || undefined,
      favorite: !!user.favorites[id],
      hue: hueOf(id),
      description: o?.description ?? "",
      developer: o?.developer || undefined,
      art,
    });
  }
  return games;
}
