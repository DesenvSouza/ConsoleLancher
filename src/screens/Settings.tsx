import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useState } from "react";
import { ButtonGlyph, Hints, TopBar } from "../components/Chrome";
import { FocusGroup } from "../components/Focusable";
import { ActionRow, Setting } from "../components/Setting";
import { onAction } from "../input/actions";
import { api } from "../lib/api";
import { PREFERRED_LANGUAGES, languageName } from "../lib/languages";
import { clamp, cycle, indexOf } from "../lib/util";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
import { useUserData } from "../store/userData";
import { ACCENT_PRESETS, THEMES, getTheme } from "../theme/themes";
import { useTheme } from "../theme/themeStore";

/** Páginas das configurações (LB/RB trocam). Cada uma tem a chave do primeiro item, onde o foco começa. */
const PAGES = [
  { id: "look", name: "Aparência", first: "set-theme" },
  { id: "games", name: "Jogos e conta", first: "set-account" },
  { id: "system", name: "Controle e sistema", first: "set-gamepad" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

// A página e o item em que o jogador estava: ao voltar de uma subtela (Conta Steam, Biblioteca...) ele continua ali.
let lastPage: PageId = "look";
let lastFocus: string | null = null;

export function Settings() {
  const s = useTheme();
  const { navigate } = useUI.getState();
  const { mode, steam, keyStatus } = useLibrary();
  const ownedCount = useUserData((u) => u.owned.length);
  const preferredLanguage = useUserData((u) => u.preferredLanguage);
  const setPreferredLanguage = useUserData((u) => u.setPreferredLanguage);
  const [page, setPage] = useState<PageId>(lastPage);
  const remember = (key: string) => () => {
    lastFocus = key;
  };

  // LB/RB passam pelas páginas.
  useEffect(
    () =>
      onAction((a) => {
        if (useUI.getState().modalOpen || (a !== "lb" && a !== "rb")) return;
        setPage((current) => {
          const next = cycle(PAGES, indexOf(PAGES.map((p) => p.id), current), a === "lb" ? -1 : 1).id;
          lastPage = next;
          lastFocus = null;
          return next;
        });
      }),
    [],
  );

  // Foco: o último item visitado (ao voltar de uma subtela) ou o primeiro da página.
  useEffect(() => {
    const first = PAGES.find((p) => p.id === page)!.first;
    setFocus(lastFocus && document.querySelector(`[data-focus-key="${lastFocus}"]`) ? lastFocus : first);
  }, [page]);

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
  const first = PAGES.find((p) => p.id === page)!.first;

  return (
    <div className="screen settings">
      <TopBar title="Configurações" />

      <nav className="tabs settings-tabs" aria-label="Seções das configurações">
        <ButtonGlyph btn="LB" />
        {PAGES.map((p) => (
          <span key={p.id} className={`tab ${p.id === page ? "is-active" : ""}`}>
            {p.name}
          </span>
        ))}
        <ButtonGlyph btn="RB" />
      </nav>

      <FocusGroup key={page} focusKey="settings-list" className="settings-list settings-page" preferredChildFocusKey={first}>
        {page === "look" && (
          <>
            <h3 className="settings-title">Cores</h3>
            <Setting cycle id="theme" label="Tema" hint="Cores de fundo e das superfícies" value={getTheme(s.themeId).name} onFocus={remember("set-theme")} onStep={(d) => s.set({ themeId: cycle(THEMES, themeIndex, d).id })} />
            <Setting cycle id="accent" label="Cor de destaque" hint="Cor do item selecionado e dos botões" value={ACCENT_PRESETS[accentIndex].name} onFocus={remember("set-accent")} onStep={(d) => s.set({ accent: cycle(ACCENT_PRESETS, accentIndex, d).value })} />

            <h3 className="settings-title">Tamanho e estilo</h3>
            <Setting id="scale" label="Tamanho da interface" hint="Aumenta ou diminui textos e botões" value={`${Math.round(s.fontScale * 100)}%`} onFocus={remember("set-scale")} onStep={(d) => s.set({ fontScale: clamp(+(s.fontScale + d * 0.05).toFixed(2), 0.7, 1.5) })} />
            <Setting id="radius" label="Cantos arredondados" hint="Quanto os cartões e botões são arredondados" value={`${s.radius}px`} onFocus={remember("set-radius")} onStep={(d) => s.set({ radius: clamp(s.radius + d * 2, 0, 28) })} />
            <Setting id="glow" label="Brilho do item focado" hint="Intensidade do brilho ao redor do item selecionado" value={`${Math.round(s.glow * 100)}%`} onFocus={remember("set-glow")} onStep={(d) => s.set({ glow: clamp(+(s.glow + d * 0.1).toFixed(1), 0, 1) })} />
          </>
        )}

        {page === "games" && (
          <>
            <h3 className="settings-title">Conta</h3>
            <ActionRow arrow id="account" label="Conta Steam" hint="Conta logada e a chave que lista toda a biblioteca" value={accountStatus} onFocus={remember("set-account")} onPress={() => navigate({ name: "account" })} />

            <h3 className="settings-title">Jogos</h3>
            <Setting
              cycle
              id="language"
              label="Idioma preferido"
              hint="A página do jogo avisa se ele tem este idioma"
              value={languageName(preferredLanguage)}
              onFocus={remember("set-language")}
              onStep={(d) => setPreferredLanguage(cycle(PREFERRED_LANGUAGES, Math.max(0, PREFERRED_LANGUAGES.indexOf(preferredLanguage)), d))}
            />
            <ActionRow arrow id="library" label="Biblioteca" hint="Abas, filtros e coleções da Steam" onFocus={remember("set-library")} onPress={() => navigate({ name: "library-settings" })} />
            <ActionRow arrow id="notinstalled" label="Jogos não instalados" hint="Selo, capa apagada e ordem dos jogos sem instalar" onFocus={remember("set-notinstalled")} onPress={() => navigate({ name: "not-installed" })} />
            <ActionRow arrow id="home" label="Página inicial" hint="Escolha e ordene as fileiras da tela inicial" onFocus={remember("set-home")} onPress={() => navigate({ name: "home-layout" })} />
          </>
        )}

        {page === "system" && (
          <>
            <h3 className="settings-title">Controle</h3>
            <ActionRow arrow id="gamepad" label="Testar controle" hint="Veja os botões e o mapeamento do seu controle" onFocus={remember("set-gamepad")} onPress={() => navigate({ name: "gamepad-test" })} />

            <h3 className="settings-title">Janela</h3>
            <ActionRow id="fullscreen" label="Alternar tela cheia" hint="Atalho no teclado: F11" onFocus={remember("set-fullscreen")} onPress={() => void api.toggleFullscreen()} />

            <h3 className="settings-title">Sair</h3>
            <ActionRow danger id="desktop" label="Sair para a área de trabalho" hint="Fecha o launcher e abre o Explorer do Windows" onFocus={remember("set-desktop")} onPress={() => void api.exitToDesktop()} />
          </>
        )}
      </FocusGroup>

      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "LB", label: "Seção anterior" }, { btn: "RB", label: "Próxima seção" }, { btn: "B", label: "Voltar" }, { btn: "Select", label: "Fechar" }]} />
    </div>
  );
}
