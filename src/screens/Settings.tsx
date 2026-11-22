import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { FocusGroup, Focusable } from "../components/Focusable";
import { ActionRow, Setting } from "../components/Setting";
import { api } from "../lib/api";
import { clamp, cycle, indexOf } from "../lib/util";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
import { useUserData } from "../store/userData";
import { ACCENT_PRESETS, THEMES, getTheme } from "../theme/themes";
import { useTheme } from "../theme/themeStore";

export function Settings() {
  const s = useTheme();
  const { back, navigate } = useUI.getState();
  const { mode, steam, keyStatus } = useLibrary();
  const ownedCount = useUserData((u) => u.owned.length);

  useEffect(() => {
    setFocus("set-theme");
  }, []);

  // Resumo da conta na linha "Conta Steam".
  const accountStatus =
    mode === "mock"
      ? "demonstração"
      : !steam?.found
        ? "Steam não encontrada"
        : !steam.loggedIn
          ? "abra a Steam"
          : keyStatus?.configured
            ? `${steam.personaName || steam.accountName} · ${ownedCount} jogos`
            : `${steam.personaName || steam.accountName} · configurar`;

  const accentIndex = Math.max(0, ACCENT_PRESETS.findIndex((a) => a.value === s.accent));
  const themeIndex = indexOf(THEMES.map((t) => t.id), s.themeId);

  return (
    <div className="screen settings">
      <TopBar title="Configurações" />
      <FocusGroup focusKey="settings-list" className="settings-list" preferredChildFocusKey="set-theme">
        <Setting cycle id="theme" label="Tema" value={getTheme(s.themeId).name} onStep={(d) => s.set({ themeId: cycle(THEMES, themeIndex, d).id })} />
        <Setting cycle id="accent" label="Cor de destaque" value={ACCENT_PRESETS[accentIndex].name} onStep={(d) => s.set({ accent: cycle(ACCENT_PRESETS, accentIndex, d).value })} />
        <Setting id="scale" label="Tamanho da interface" value={`${Math.round(s.fontScale * 100)}%`} onStep={(d) => s.set({ fontScale: clamp(+(s.fontScale + d * 0.05).toFixed(2), 0.7, 1.5) })} />
        <Setting id="radius" label="Cantos arredondados" value={`${s.radius}px`} onStep={(d) => s.set({ radius: clamp(s.radius + d * 2, 0, 28) })} />
        <Setting id="glow" label="Brilho do item focado" value={`${Math.round(s.glow * 100)}%`} onStep={(d) => s.set({ glow: clamp(+(s.glow + d * 0.1).toFixed(1), 0, 1) })} />

        <div className="settings-sep" />
        <Focusable focusKey="set-account" className="setting" onPress={() => navigate({ name: "account" })}>
          <span>Conta Steam</span>
          <span className="setting-value">{accountStatus}  ›</span>
        </Focusable>
        <ActionRow arrow id="library" onPress={() => navigate({ name: "library-settings" })}>Biblioteca (abas e filtros)</ActionRow>
        <ActionRow arrow id="home" onPress={() => navigate({ name: "home-layout" })}>Personalizar página inicial</ActionRow>
        <ActionRow arrow id="gamepad" onPress={() => navigate({ name: "gamepad-test" })}>Testar controle</ActionRow>
        <ActionRow id="fullscreen" onPress={() => void api.toggleFullscreen()}>Alternar tela cheia (F11)</ActionRow>
        <ActionRow id="desktop" onPress={() => void api.exitToDesktop()}>Sair para a área de trabalho</ActionRow>
        <ActionRow id="back" onPress={back}>Voltar</ActionRow>
      </FocusGroup>
      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }, { btn: "Select", label: "Fechar" }]} />
    </div>
  );
}
