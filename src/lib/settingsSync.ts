import { useLanguage } from "../i18n";
import { useTheme } from "../theme/themeStore";

/**
 * O menu do botão Guia é outra janela e, de propósito, tem a própria pasta de dados (o próprio localStorage, vazio): ele
 * nunca vê o tema nem o idioma que o jogador escolheu. O launcher publica essas escolhas no Rust (que as guarda e as
 * repassa ao menu), e o menu as lê ao abrir e a cada mudança.
 */
interface SyncedSettings {
  theme?: { themeId: string; accent: string | null; radius: number; fontScale: number; glow: number; reduceMotion: boolean };
  lang?: "pt" | "en" | "es";
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function current(): SyncedSettings {
  const { themeId, accent, radius, fontScale, glow, reduceMotion } = useTheme.getState();
  return { theme: { themeId, accent, radius, fontScale, glow, reduceMotion }, lang: useLanguage.getState().lang };
}

/** Só no launcher: publica o tema e o idioma agora e sempre que mudarem. */
export function startSettingsPublisher() {
  const push = () => void call("sync_settings", { settings: current() }).catch(() => undefined);
  push();
  useTheme.subscribe(push);
  useLanguage.subscribe(push);
}

function apply(settings: SyncedSettings | null | undefined) {
  if (!settings) return;
  if (settings.theme) useTheme.setState(settings.theme);
  if (settings.lang && settings.lang !== useLanguage.getState().lang) useLanguage.getState().setLang(settings.lang);
}

/** Lê o que o launcher publicou (chamado também a cada abertura do menu, por garantia). */
export function pullSyncedSettings() {
  void call<SyncedSettings | null>("get_synced_settings").then(apply).catch(() => undefined);
}

/** Só no menu Guia: aplica o que o launcher publicou e acompanha as mudanças. */
export function startSettingsReceiver() {
  pullSyncedSettings();
  void import("@tauri-apps/api/event").then(({ listen }) => listen<SyncedSettings>("settings-sync", (event) => apply(event.payload)));
}
