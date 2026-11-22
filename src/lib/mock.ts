import type { AppMeta, Collection } from "./steam";
import type { Game } from "./types";

const group = (options: number[], acceptUnion = false) => ({ options, acceptUnion });

/** Coleções de mentira (como as da Steam) para testar as abas no navegador. */
export const MOCK_COLLECTIONS: Collection[] = [
  { id: "favorite", name: "Favoritos", appIds: [], dynamic: false, filter: null },
  { id: "hidden", name: "Ocultos", appIds: ["620"], dynamic: false, filter: null },
  { id: "uc-indie", name: "Indies", appIds: ["1145360", "367520", "504230", "413150", "268910", "588650"], dynamic: false, filter: null },
  { id: "uc-rpg", name: "RPG", appIds: ["1245620", "1086940", "1091500"], dynamic: false, filter: null },
  // Igual à sua coleção "Console" da Steam: filtro por suporte a controle (grupo 2, opção 2), sem lista de jogos.
  {
    id: "uc-console",
    name: "Console",
    appIds: [],
    dynamic: true,
    filter: { searchText: "", groups: [group([], true), group([]), group([2]), group([]), group([]), group([]), group([]), group([]), group([])] },
  },
];

/** Dados de jogo de mentira (como os do appinfo da Steam): quase todos têm suporte a controle; o Stardew não. */
const meta = (appId: string, controllerSupport: number, categories: number[] = []): [string, AppMeta] => [
  appId,
  { appId, kind: "game", controllerSupport, categories, tags: [], deck: 0 },
];
export const MOCK_META: Record<string, AppMeta> = Object.fromEntries([
  meta("1245620", 2, [28, 2]), meta("1086940", 1, [18]), meta("1145360", 2, [28]), meta("367520", 1, [18]),
  meta("504230", 2, [28]), meta("413150", 0, [2]), meta("1091500", 2, [28]), meta("1174180", 2, [28]),
  meta("782330", 2, [28]), meta("620", 2, [28]), meta("268910", 2, [28]), meta("588650", 0, [2]),
]);

const d = (daysAgo: number) => Date.now() - daysAgo * 86_400_000;

/** Biblioteca de mentira para desenvolver a interface. Será trocada pelo scanner da Steam (M2). */
export const MOCK_GAMES: Game[] = [
  { id: "1245620", appId: "1245620", title: "Elden Ring", source: "steam", state: "installed", sizeGB: 60, playtimeMin: 5400, lastPlayedAt: d(0), favorite: true, hue: 38, description: "Explore as Terras Intermédias em um RPG de ação em mundo aberto." },
  { id: "1086940", appId: "1086940", title: "Baldur's Gate 3", source: "steam", state: "installed", sizeGB: 122, playtimeMin: 9800, lastPlayedAt: d(1), favorite: true, hue: 8, description: "Reúna seu grupo e volte aos Reinos Esquecidos numa aventura épica." },
  { id: "1145360", appId: "1145360", title: "Hades", source: "steam", state: "installed", sizeGB: 15, playtimeMin: 2100, lastPlayedAt: d(3), favorite: false, hue: 350, description: "Desafie o deus dos mortos neste roguelike de ação." },
  { id: "367520", appId: "367520", title: "Hollow Knight", source: "steam", state: "installed", sizeGB: 9, playtimeMin: 1500, lastPlayedAt: d(9), favorite: true, hue: 215, description: "Uma aventura de ação em um vasto reino de insetos e heróis." },
  { id: "504230", appId: "504230", title: "Celeste", source: "steam", state: "installed", sizeGB: 2, playtimeMin: 640, lastPlayedAt: d(20), favorite: false, hue: 300, description: "Ajude Madeline a escalar a montanha Celeste." },
  { id: "413150", appId: "413150", title: "Stardew Valley", source: "steam", state: "installed", sizeGB: 1, playtimeMin: 3300, lastPlayedAt: d(5), favorite: false, hue: 120, description: "Herde a fazenda do seu avô e comece uma nova vida." },
  { id: "1091500", appId: "1091500", title: "Cyberpunk 2077", source: "steam", state: "not_installed", sizeGB: 70, playtimeMin: 1800, favorite: false, hue: 55, description: "Um RPG de ação e aventura em Night City." },
  { id: "1174180", appId: "1174180", title: "Red Dead Redemption 2", source: "steam", state: "not_installed", sizeGB: 120, playtimeMin: 0, favorite: false, hue: 25, description: "A história épica de Arthur Morgan e da gangue Van der Linde." },
  { id: "782330", appId: "782330", title: "DOOM Eternal", source: "steam", state: "not_installed", sizeGB: 80, playtimeMin: 420, favorite: false, hue: 0, description: "Rasgue e dilacere os exércitos do inferno." },
  { id: "620", appId: "620", title: "Portal 2", source: "steam", state: "installed", sizeGB: 12, playtimeMin: 900, lastPlayedAt: d(60), favorite: false, hue: 190, description: "Quebra-cabeças com portais e o humor ácido da GLaDOS." },
  { id: "268910", appId: "268910", title: "Cuphead", source: "steam", state: "not_installed", sizeGB: 4, playtimeMin: 300, favorite: false, hue: 45, description: "Run and gun com visual de desenho animado dos anos 1930." },
  { id: "588650", appId: "588650", title: "Dead Cells", source: "steam", state: "not_installed", sizeGB: 3, playtimeMin: 0, favorite: false, hue: 280, description: "Um roguelite de ação com um castelo em constante mudança." },
];
