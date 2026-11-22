import type { Game, InstallState } from "./types";
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
export function installState(app: InstalledApp): { state: InstallState; progress?: number } {
  const flags = app.stateFlags;
  const downloading = (flags & BUSY) !== 0 && app.bytesToDownload > 0 && app.bytesDownloaded < app.bytesToDownload;
  if (flags & FULLY_INSTALLED && !downloading) return { state: "installed" };
  if (downloading || (flags & BUSY) !== 0) {
    const progress = app.bytesToDownload > 0 ? Math.min(1, app.bytesDownloaded / app.bytesToDownload) : undefined;
    return { state: "installing", progress };
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
    if (inst) ({ state, progress } = installState(inst));
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
      sizeGB: inst ? Math.round((inst.sizeOnDisk / 1e9) * 10) / 10 : 0,
      playtimeMin: (o?.playtimeMin ?? 0) + (user.extraPlaytimeMin[id] ?? 0),
      lastPlayedAt,
      favorite: !!user.favorites[id],
      hue: hueOf(id),
      description: "",
    });
  }
  return games.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}
