import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useState } from "react";
import { playSound, useSoundSettings } from "../audio/sounds";
import { ButtonGlyph, Hints, TopBar } from "../components/Chrome";
import { FocusGroup } from "../components/Focusable";
import { DetailPreview, HomePreview } from "../components/preview/Previews";
import { ActionRow, Setting } from "../components/Setting";
import { LANGUAGES, t, te, useLanguage } from "../i18n";
import { onAction } from "../input/actions";
import { api } from "../lib/api";
import { PREFERRED_LANGUAGES, languageName } from "../lib/languages";
import { clamp, cycle, indexOf } from "../lib/util";
import { BACKGROUND_COLORS, BACKGROUND_STYLES, useHome } from "../store/home";
import { useLibrary } from "../store/library";
import { TOP_ICONS, useTopIcons } from "../store/topIcons";
import { MUSIC_CHOICES, TRACKS, useMusic, type MusicChoice } from "../audio/music";
import { useUI } from "../store/ui";
import { HLTB_STYLES, HLTB_TIMES, useUserData } from "../store/userData";
import { ACCENT_PRESETS, THEMES, getTheme } from "../theme/themes";
import { useTheme } from "../theme/themeStore";

/** Páginas das configurações (LB/RB trocam). Cada uma tem a chave do primeiro item, onde o foco começa. */
const PAGES = [
  { id: "look", name: "Aparência", first: "set-theme" },
  { id: "games", name: "Jogos e conta", first: "set-account" },
  { id: "system", name: "Controle e sistema", first: "set-ui-language" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

// A página e o item em que o jogador estava: ao voltar de uma subtela (Conta Steam, Biblioteca...) ele continua ali.
let lastPage: PageId = "look";
let lastFocus: string | null = null;

/** Nome da escolha de música: as faixas são nomes próprios (não traduzidos). */
function musicName(choice: MusicChoice): string {
  if (choice === "off") return t("Desligada");
  if (choice === "all") return t("Todas (embaralhadas)");
  return TRACKS.find((track) => track.id === choice)?.name ?? choice;
}

export function Settings() {
  const s = useTheme();
  const { navigate } = useUI.getState();
  const { mode, steam, keyStatus } = useLibrary();
  const ownedCount = useUserData((u) => u.owned.length);
  const preferredLanguage = useUserData((u) => u.preferredLanguage);
  const setPreferredLanguage = useUserData((u) => u.setPreferredLanguage);
  const showHltb = useUserData((u) => u.showHltb);
  const setShowHltb = useUserData((u) => u.setShowHltb);
  const hltbStyle = useUserData((u) => u.hltbStyle);
  const setHltbStyle = useUserData((u) => u.setHltbStyle);
  const hltbTimes = useUserData((u) => u.hltbTimes);
  const setHltbTimes = useUserData((u) => u.setHltbTimes);
  const hltbStyleIndex = indexOf(HLTB_STYLES.map((o) => o.id), hltbStyle);
  const hltbTimesIndex = indexOf(HLTB_TIMES.map((o) => o.id), hltbTimes);
  const hideToasts = useUserData((u) => u.hideSteamToasts);
  const setHideToasts = useUserData((u) => u.setHideSteamToasts);
  const soundEnabled = useSoundSettings((audio) => audio.enabled);
  const music = useMusic();
  const topIcons = useTopIcons((icons) => icons.shown);
  const setTopIcon = useTopIcons((icons) => icons.setShown);
  const uiLang = useLanguage((l) => l.lang);
  const setUiLang = useLanguage((l) => l.setLang);
  const uiLangIndex = indexOf(LANGUAGES.map((l) => l.id), uiLang);
  const [page, setPage] = useState<PageId>(lastPage);
  const remember = (key: string) => () => {
    lastFocus = key;
  };

  // LB/RB passam pelas páginas.
  useEffect(
    () =>
      onAction((a) => {
        if (useUI.getState().modalOpen || (a !== "lb" && a !== "rb")) return;
        playSound("move");
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
      ? t("demonstração")
      : !steam?.found
        ? t("Steam não encontrada")
        : !steam.loggedIn
          ? t("abra a Steam")
          : keyStatus?.configured
            ? t("{name} · {n} jogos", { name: steam.personaName || steam.accountName || "", n: ownedCount })
            : t("{name} · configurar", { name: steam.personaName || steam.accountName || "" });

  // Plano de fundo das páginas Início e do jogo (as configurações em si não mostram o fundo do jogo).
  const { background, backgroundColor, backgroundStrength, backgroundBlur, setBackground } = useHome();
  const styleIndex = indexOf(BACKGROUND_STYLES.map((b) => b.id), background);
  const colorIndex = indexOf(BACKGROUND_COLORS.map((c) => c.id), backgroundColor);

  const accentIndex = Math.max(0, ACCENT_PRESETS.findIndex((a) => a.value === s.accent));
  const themeIndex = indexOf(THEMES.map((t) => t.id), s.themeId);
  const first = PAGES.find((p) => p.id === page)!.first;

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações")} />

      <nav className="tabs settings-tabs" aria-label={t("Seções das configurações")}>
        <ButtonGlyph btn="LB" />
        {PAGES.map((p) => (
          <span key={p.id} className={`tab ${p.id === page ? "is-active" : ""}`}>
            {t(p.name)}
          </span>
        ))}
        <ButtonGlyph btn="RB" />
      </nav>

      {/* Aparência e Jogos têm a prévia ao vivo ao lado da lista: cada ajuste aparece na hora no mini-launcher. */}
      <div className={page === "look" ? "settings-split settings-split-two" : page === "games" || page === "system" ? "settings-split" : "settings-solo"}>
      <FocusGroup key={page} focusKey="settings-list" className="settings-list settings-page" preferredChildFocusKey={first}>
        {page === "look" && (
          <>
            <h3 className="settings-title">{t("Cores")}</h3>
            <Setting cycle id="theme" label={t("Tema")} hint={t("Cores de fundo e das superfícies")} value={t(getTheme(s.themeId).name)} onFocus={remember("set-theme")} onStep={(d) => s.set({ themeId: cycle(THEMES, themeIndex, d).id })} />
            <Setting cycle id="accent" label={t("Cor de destaque")} hint={t("Cor do item selecionado e dos botões")} value={t(ACCENT_PRESETS[accentIndex].name)} onFocus={remember("set-accent")} onStep={(d) => s.set({ accent: cycle(ACCENT_PRESETS, accentIndex, d).value })} />

            <h3 className="settings-title">{t("Plano de fundo (Início e página do jogo)")}</h3>
            <Setting
              cycle
              id="bg-style"
              label={t("Estilo do fundo")}
              hint={t(BACKGROUND_STYLES[styleIndex].hint)}
              value={t(BACKGROUND_STYLES[styleIndex].name)}
              onFocus={remember("set-bg-style")}
              onStep={(d) => setBackground({ background: cycle(BACKGROUND_STYLES, styleIndex, d).id })}
            />
            {background === "blur" && (
              <Setting
                id="bg-blur"
                label={t("Desfoque da capa")}
                hint={t("Quanto a capa é desfocada: menos mostra mais da imagem, mais deixa só as cores")}
                value={`${Math.round(backgroundBlur * 100)}%`}
                onFocus={remember("set-bg-blur")}
                onStep={(d) => setBackground({ backgroundBlur: clamp(+(backgroundBlur + d * 0.05).toFixed(2), 0.05, 1) })}
              />
            )}
            {background === "color" ? (
              <Setting
                cycle
                id="bg-color"
                label={t("Cor do fundo")}
                hint={t("Cor fixa atrás das fileiras e da página do jogo")}
                value={t(BACKGROUND_COLORS[colorIndex].name)}
                onFocus={remember("set-bg-color")}
                onStep={(d) => setBackground({ backgroundColor: cycle(BACKGROUND_COLORS, colorIndex, d).id })}
              />
            ) : (
              <Setting
                id="bg-strength"
                label={t("Intensidade do fundo")}
                hint={t("Quanto o plano de fundo aparece")}
                value={`${Math.round(backgroundStrength * 100)}%`}
                onFocus={remember("set-bg-strength")}
                onStep={(d) => setBackground({ backgroundStrength: clamp(+(backgroundStrength + d * 0.05).toFixed(2), 0.1, 1) })}
              />
            )}

            <h3 className="settings-title">{t("Telas")}</h3>
            <ActionRow arrow id="home" label={t("Página inicial")} hint={t("Escolha e ordene as fileiras e o destaque da tela inicial")} onFocus={remember("set-home")} onPress={() => navigate({ name: "home-layout" })} />

            <h3 className="settings-title">{t("Tamanho e estilo")}</h3>
            <Setting id="scale" label={t("Tamanho da interface")} hint={t("Aumenta ou diminui textos e botões")} value={`${Math.round(s.fontScale * 100)}%`} onFocus={remember("set-scale")} onStep={(d) => s.set({ fontScale: clamp(+(s.fontScale + d * 0.05).toFixed(2), 0.7, 1.5) })} />
            <Setting id="radius" label={t("Cantos arredondados")} hint={t("Quanto os cartões e botões são arredondados")} value={`${s.radius}px`} onFocus={remember("set-radius")} onStep={(d) => s.set({ radius: clamp(s.radius + d * 2, 0, 28) })} />
            <Setting id="glow" label={t("Brilho do item focado")} hint={t("Intensidade do brilho ao redor do item selecionado")} value={`${Math.round(s.glow * 100)}%`} onFocus={remember("set-glow")} onStep={(d) => s.set({ glow: clamp(+(s.glow + d * 0.1).toFixed(1), 0, 1) })} />
          </>
        )}

        {page === "games" && (
          <>
            <h3 className="settings-title">{t("Conta")}</h3>
            <ActionRow arrow id="account" label={t("Conta Steam")} hint={t("Entrar com QR code (ou chave) para listar toda a biblioteca")} value={accountStatus} onFocus={remember("set-account")} onPress={() => navigate({ name: "account" })} />

            <h3 className="settings-title">{t("Jogos")}</h3>
            <Setting
              cycle
              id="language"
              label={t("Idioma preferido dos jogos")}
              hint={t("Em que idioma você quer jogar: a página do jogo avisa se ele tem este idioma")}
              value={languageName(preferredLanguage)}
              onFocus={remember("set-language")}
              onStep={(d) => setPreferredLanguage(cycle(PREFERRED_LANGUAGES, Math.max(0, PREFERRED_LANGUAGES.indexOf(preferredLanguage)), d))}
            />
            <ActionRow arrow id="library" label={t("Biblioteca")} hint={t("Abas, filtros e coleções da Steam")} onFocus={remember("set-library")} onPress={() => navigate({ name: "library-settings" })} />
            <ActionRow arrow id="downloads" label={t("Downloads e jogos instalados")} hint={t("Fila, velocidade, estimativa e espaço em disco")} onFocus={remember("set-downloads")} onPress={() => navigate({ name: "downloads" })} />
            <ActionRow arrow id="notinstalled" label={t("Jogos não instalados")} hint={t("Selo, capa apagada e ordem dos jogos sem instalar")} onFocus={remember("set-notinstalled")} onPress={() => navigate({ name: "not-installed" })} />

            <h3 className="settings-title">{t("Duração do jogo (HowLongToBeat)")}</h3>
            <Setting
              cycle
              id="hltb"
              label={t("Mostrar a duração")}
              hint={t("Na página do jogo: quanto ele costuma levar para terminar (consulta o site HowLongToBeat)")}
              value={showHltb ? t("Mostrar") : t("Ocultar")}
              onFocus={remember("set-hltb")}
              onStep={() => setShowHltb(!showHltb)}
            />
            {showHltb && (
              <>
                <Setting
                  cycle
                  id="hltb-style"
                  label={t("Onde aparece")}
                  hint={t(HLTB_STYLES[hltbStyleIndex].hint)}
                  value={t(HLTB_STYLES[hltbStyleIndex].name)}
                  onFocus={remember("set-hltb-style")}
                  onStep={(d) => setHltbStyle(cycle(HLTB_STYLES, hltbStyleIndex, d).id)}
                />
                {hltbStyle !== "hint" && (
                  <Setting
                    cycle
                    id="hltb-times"
                    label={t("Tempos exibidos")}
                    hint={t("Principal é só a história; extras inclui missões paralelas; completista é fazer tudo")}
                    value={t(HLTB_TIMES[hltbTimesIndex].name)}
                    onFocus={remember("set-hltb-times")}
                    onStep={(d) => setHltbTimes(cycle(HLTB_TIMES, hltbTimesIndex, d).id)}
                  />
                )}
              </>
            )}

            <h3 className="settings-title">Steam</h3>
            <Setting
              cycle
              id="toasts"
              label={t("Notificações e overlay da Steam")}
              hint={t("Oculta os avisos da Steam (conquistas, mensagens) sobre o launcher e os jogos")}
              value={hideToasts ? t("Ocultar") : t("Mostrar")}
              onFocus={remember("set-toasts")}
              onStep={() => setHideToasts(!hideToasts)}
            />
          </>
        )}

        {page === "system" && (
          <>
            <h3 className="settings-title">{t("Idioma")}</h3>
            <Setting
              cycle
              id="ui-language"
              label={t("Idioma do launcher")}
              hint={t("Idioma dos menus e textos do launcher (não muda o idioma dos jogos)")}
              value={LANGUAGES[uiLangIndex].name}
              onFocus={remember("set-ui-language")}
              onStep={(d) => setUiLang(cycle(LANGUAGES, uiLangIndex, d).id)}
            />

            <h3 className="settings-title">{t("Ícones no topo")}</h3>
            {TOP_ICONS.map(({ id, label, hint }) => (
              <Setting
                key={id}
                cycle
                id={`top-${id}`}
                label={t(label)}
                hint={t(hint)}
                value={topIcons[id] ? t("Exibir") : t("Ocultar")}
                onFocus={remember(`set-top-${id}`)}
                onStep={() => setTopIcon(id, !topIcons[id])}
              />
            ))}
            <p className="account-note">{t("O painel Sistema (volume, saída de áudio, Wi-Fi e Bluetooth) continua no menu do botão Guia.")}</p>

            <h3 className="settings-title">{t("Controle")}</h3>
            <ActionRow arrow id="gamepad" label={t("Testar controle")} hint={t("Veja os botões e o mapeamento do seu controle")} onFocus={remember("set-gamepad")} onPress={() => navigate({ name: "gamepad-test" })} />

            <h3 className="settings-title">{t("Áudio")}</h3>
            <Setting
              cycle
              id="sound-effects"
              label={t("Efeitos sonoros")}
              hint={t("Sons de navegação, do menu Guia e das operações do launcher")}
              value={soundEnabled ? t("Ativados") : t("Desativados")}
              onFocus={remember("set-sound-effects")}
              onStep={() => {
                const { enabled, setEnabled } = useSoundSettings.getState();
                setEnabled(!enabled);
                if (!enabled) playSound("select");
              }}
            />

            <Setting
              cycle
              id="music"
              label={t("Música de fundo")}
              hint={t("Toca no launcher quando nenhum jogo está aberto e ele está em primeiro plano")}
              value={musicName(music.choice)}
              onFocus={remember("set-music")}
              onStep={(d) => music.setChoice(cycle(MUSIC_CHOICES, MUSIC_CHOICES.indexOf(music.choice), d))}
            />
            {music.choice !== "off" && (
              <Setting
                id="music-volume"
                label={t("Volume da música")}
                hint={t("Só da música de fundo; os efeitos sonoros e os jogos têm o volume deles")}
                value={`${music.volume}%`}
                onFocus={remember("set-music-volume")}
                onStep={(d) => music.setVolume(music.volume + d * 10)}
              />
            )}

            <h3 className="settings-title">{t("Janela")}</h3>
            <ActionRow id="fullscreen" label={t("Alternar tela cheia")} hint={t("Atalho no teclado: F11")} onFocus={remember("set-fullscreen")} onPress={() => void api.toggleFullscreen()} />

            <h3 className="settings-title">{t("Menu Guia")}</h3>
            <ActionRow arrow id="guide-power" label={t("Opções de energia")} hint={t("Escolha quais botões aparecem no menu lateral")} onFocus={remember("set-guide-power")} onPress={() => navigate({ name: "guide-power" })} />

            <h3 className="settings-title">{t("Início")}</h3>
            <ActionRow arrow id="startup" label={t("Início com o Windows e modo console")} hint={t("Abrir o launcher ao ligar o PC e, se quiser, usá-lo no lugar da área de trabalho")} onFocus={remember("set-startup")} onPress={() => navigate({ name: "startup" })} />

            <h3 className="settings-title">{t("Sair")}</h3>
            <ActionRow danger id="desktop" label={t("Sair para a área de trabalho")} hint={t("Fecha o launcher e mostra a área de trabalho do Windows")} onFocus={remember("set-desktop")} onPress={() => void api.exitToDesktop().catch((error) => useUI.getState().showToast(te(error), "warning"))} />
          </>
        )}
      </FocusGroup>
      {page === "look" && (
        <aside className="settings-preview" aria-label={t("Prévia ao vivo")}>
          <HomePreview />
          <DetailPreview />
        </aside>
      )}
      {page === "system" && (
        <aside className="settings-preview" aria-label={t("Prévia ao vivo")}>
          <HomePreview />
        </aside>
      )}
      {page === "games" && (
        <aside className="settings-preview" aria-label={t("Prévia ao vivo")}>
          <DetailPreview />
        </aside>
      )}
      </div>

      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "LB", label: "Seção anterior" }, { btn: "RB", label: "Próxima seção" }, { btn: "B", label: "Voltar" }, { btn: "Select", label: "Fechar" }]} />
    </div>
  );
}
