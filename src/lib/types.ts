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
  sizeGB: number;
  playtimeMin: number;
  lastPlayedAt?: number;
  favorite: boolean;
  /** Matiz (0-360) usado para gerar a capa provisória enquanto não há arte real. */
  hue: number;
  description: string;
}

export type Screen =
  | { name: "home" }
  | { name: "detail"; gameId: string }
  | { name: "library" }
  | { name: "library-settings" }
  | { name: "library-tab"; tabId: string }
  | { name: "settings" }
  | { name: "account" }
  | { name: "gamepad-test" }
  | { name: "home-layout" }
  | { name: "home-block"; blockId: string };
