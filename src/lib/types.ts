export type GameSource = "steam" | "epic" | "gog" | "xbox" | "manual";
export type InstallState = "installed" | "not_installed" | "installing";

export interface Game {
  id: string;
  title: string;
  source: GameSource;
  /** AppID da Steam (ou id equivalente na outra loja). */
  appId?: string;
  state: InstallState;
  /** 0..1 — só faz sentido quando state === "installing". */
  progress?: number;
  /**
   * Atualização de um jogo que já estava instalado: "pending" = a Steam sabe que há uma e ainda não começou (o jogo continua
   * "installed" e jogável; ela atualiza ao abrir); "running" = baixando agora ou na fila (state === "installing").
   */
  update?: "pending" | "running";
  sizeGB: number;
  playtimeMin: number;
  lastPlayedAt?: number;
  favorite: boolean;
  /** Matiz (0-360) usado para gerar a capa provisória enquanto não há arte real. */
  hue: number;
  description: string;
  /** Jogo da Epic: identificadores para abrir e instalar pela Epic Games Launcher. */
  epic?: { appName: string; namespace: string; catalogItemId: string };
  /** Desenvolvedora (jogos que não são da Steam; na Steam vem do appinfo). */
  developer?: string;
  /** Arte própria (jogos que não são da Steam): cartaz e panorâmica. */
  art?: { tall?: string; wide?: string };
}

export type Screen =
  | { name: "home" }
  | { name: "detail"; gameId: string }
  | { name: "library" }
  | { name: "library-settings" }
  | { name: "not-installed" }
  | { name: "library-tab"; tabId: string }
  | { name: "settings" }
  | { name: "steam-account" }
  | { name: "epic-account" }
  | { name: "perf-settings" }
  | { name: "gamepad-test" }
  | { name: "guide-power" }
  | { name: "startup" }
  | { name: "downloads" }
  | { name: "home-layout" }
  | { name: "home-block"; blockId: string }
  | { name: "setup" };
