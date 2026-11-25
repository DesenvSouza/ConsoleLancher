import { t } from "../i18n";
import type { AppMeta } from "./steam";
import type { Game } from "./types";

/**
 * Biblioteca fictícia das prévias de configuração. Numa instalação nova o jogador ainda não tem jogos, e é justamente nessa
 * hora que ele escolhe capas, fileiras, selos e fundo: as prévias usam estes jogos para ter o que mostrar. Nada daqui entra na
 * biblioteca de verdade. Os números (tempo jogado, tamanho, instalado ou não) são inventados; as imagens vêm da Steam pelo
 * número de cada jogo.
 */

/** O primeiro da lista: destaque, fundo e página do jogo das prévias. */
export const SAMPLE_FEATURED_APP_ID = "292030";

interface Row {
  appId: string;
  title: string;
  /** Há quantos dias foi jogado (sem valor = nunca). */
  played?: number;
  hours?: number;
  size: number;
  installed?: boolean;
  favorite?: boolean;
  update?: boolean;
  hue: number;
}

const ROWS: Row[] = [
  { appId: SAMPLE_FEATURED_APP_ID, title: "The Witcher 3: Wild Hunt", played: 0, hours: 87, size: 50, installed: true, favorite: true, hue: 35 },
  { appId: "1245620", title: "Elden Ring", played: 1, hours: 124, size: 60, installed: true, favorite: true, hue: 38 },
  { appId: "1091500", title: "Cyberpunk 2077", played: 2, hours: 46, size: 70, installed: true, hue: 55 },
  { appId: "1086940", title: "Baldur's Gate 3", played: 3, hours: 163, size: 122, installed: true, favorite: true, update: true, hue: 8 },
  { appId: "1145360", title: "Hades", played: 4, hours: 35, size: 15, installed: true, hue: 350 },
  { appId: "1593500", title: "God of War", played: 6, hours: 28, size: 70, installed: true, hue: 210 },
  { appId: "367520", title: "Hollow Knight", played: 8, hours: 25, size: 9, installed: true, favorite: true, hue: 215 },
  { appId: "1174180", title: "Red Dead Redemption 2", played: 11, hours: 61, size: 120, installed: true, hue: 25 },
  { appId: "413150", title: "Stardew Valley", played: 13, hours: 55, size: 1, installed: true, hue: 120 },
  { appId: "814380", title: "Sekiro: Shadows Die Twice", played: 19, hours: 18, size: 25, installed: true, hue: 15 },
  { appId: "1817070", title: "Marvel's Spider-Man Remastered", played: 23, hours: 22, size: 75, installed: true, hue: 0 },
  { appId: "504230", title: "Celeste", played: 30, hours: 11, size: 2, installed: true, hue: 300 },
  { appId: "620", title: "Portal 2", played: 60, hours: 15, size: 12, installed: true, hue: 190 },
  { appId: "1551360", title: "Forza Horizon 5", played: 74, hours: 9, size: 110, installed: true, hue: 330 },
  { appId: "2050650", title: "Resident Evil 4", size: 68, hue: 20 },
  { appId: "990080", title: "Hogwarts Legacy", size: 85, favorite: true, hue: 260 },
  { appId: "782330", title: "DOOM Eternal", played: 120, hours: 7, size: 80, hue: 0 },
  { appId: "1151640", title: "Horizon Zero Dawn", size: 75, hue: 30 },
  { appId: "268910", title: "Cuphead", played: 150, hours: 5, size: 4, hue: 45 },
  { appId: "588650", title: "Dead Cells", size: 3, hue: 280 },
  { appId: "870780", title: "Control", size: 50, hue: 350 },
  { appId: "582010", title: "Monster Hunter: World", played: 210, hours: 42, size: 90, hue: 100 },
  { appId: "374320", title: "Dark Souls III", size: 25, hue: 40 },
  { appId: "601150", title: "Devil May Cry 5", size: 43, hue: 0 },
  { appId: "489830", title: "The Elder Scrolls V: Skyrim", played: 300, hours: 96, size: 12, hue: 205 },
  { appId: "1328670", title: "Mass Effect Legendary Edition", size: 120, hue: 220 },
  { appId: "1332010", title: "Stray", size: 10, hue: 32 },
  { appId: "753640", title: "Outer Wilds", size: 8, hue: 235 },
  { appId: "1426210", title: "It Takes Two", size: 50, hue: 50 },
  { appId: "632360", title: "Risk of Rain 2", size: 4, hue: 170 },
  { appId: "548430", title: "Deep Rock Galactic", size: 3, hue: 28 },
  { appId: "105600", title: "Terraria", size: 1, hue: 130 },
];

/** Idiomas, controle e avaliações (inventados) do jogo em destaque, para a prévia da página do jogo ficar completa. */
export const SAMPLE_FEATURED_META: AppMeta = {
  appId: SAMPLE_FEATURED_APP_ID,
  kind: "game",
  controllerSupport: 2,
  categories: [28],
  tags: [],
  deck: 3,
  languages: [
    { code: "english", audio: true, subtitles: true },
    { code: "brazilian", audio: true, subtitles: true },
    { code: "spanish", audio: false, subtitles: true },
  ],
  genres: [],
  developer: "CD PROJEKT RED",
  publisher: "CD PROJEKT RED",
  releaseDate: 1431907200,
  metacritic: 92,
  reviewPercent: 96,
};

/** Os jogos fictícios, com as datas contadas a partir de agora. */
export function sampleLibrary(now = Date.now()): Game[] {
  return ROWS.map((row) => ({
    id: `sample:${row.appId}`,
    appId: row.appId,
    title: row.title,
    source: "steam",
    state: row.installed ? "installed" : "not_installed",
    ...(row.update ? { update: "pending" as const } : {}),
    sizeGB: row.size,
    playtimeMin: Math.round((row.hours ?? 0) * 60),
    lastPlayedAt: row.played === undefined ? undefined : now - row.played * 86_400_000,
    favorite: !!row.favorite,
    hue: row.hue,
    description: row.appId === SAMPLE_FEATURED_APP_ID ? t("Cace monstros e decida o destino de reinos como Geralt de Rívia, em um vasto mundo aberto.") : "",
  }));
}
