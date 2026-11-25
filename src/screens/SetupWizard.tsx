import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MUSIC_CHOICES, TRACKS, useMusic, type MusicChoice } from "../audio/music";
import { playSound, useSoundSettings } from "../audio/sounds";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup, Focusable } from "../components/Focusable";
import { DetailPreview, HomePreview, LibraryPreview } from "../components/preview/Previews";
import { AccountsPreview, AudioPreview, ControllerPreview, StartupPreview } from "../components/preview/SetupPreviews";
import { ActionRow, Setting } from "../components/Setting";
import { useStoreAccounts } from "../hooks/useStoreAccounts";
import { LANGUAGES, t, te, useLanguage } from "../i18n";
import { onAction } from "../input/actions";
import { PAD_ICON_CHOICES, usePadKind } from "../input/padKind";
import { api, type StartupStatus } from "../lib/api";
import { PREFERRED_LANGUAGES, languageName } from "../lib/languages";
import { clamp, cycle, indexOf } from "../lib/util";
import { BACKGROUND_COLORS, BACKGROUND_STYLES, useHome } from "../store/home";
import { CARD_SIZES, CARD_SIZE_LABELS, useLibraryConfig } from "../store/libraryConfig";
import { useNotInstalled } from "../store/notInstalled";
import { usePerf } from "../store/perf";
import { useSetup } from "../store/setup";
import { useSystem, useSystemPolling } from "../store/system";
import { TOP_ICONS, useTopIcons } from "../store/topIcons";
import { useUI } from "../store/ui";
import { HLTB_STYLES, HLTB_TIMES, useUserData } from "../store/userData";
import { PerfPreview } from "./PerfSettings";
import { usePerfSnapshot } from "../components/PerfCard";
import { ACCENT_PRESETS, THEMES, getTheme } from "../theme/themes";
import { useTheme } from "../theme/themeStore";

/** As etapas do assistente, na ordem. `preview` diz o que aparece ao lado enquanto o jogador ajusta. */
const STEPS = [
  { id: "welcome", title: "Bem-vindo", subtitle: "Vamos deixar o launcher do seu jeito. Tudo pode ser mudado depois em Configurações.", preview: ["home"] },
  { id: "controls", title: "Controle e teclado", subtitle: "Escolha os ícones dos botões. Os botões funcionam do mesmo jeito em qualquer controle.", preview: ["controller"] },
  { id: "colors", title: "Cores", subtitle: "O tema e a cor de destaque valem para todo o launcher.", preview: ["home", "detail"] },
  { id: "background", title: "Plano de fundo", subtitle: "O fundo do Início e da página de cada jogo.", preview: ["home"] },
  { id: "size", title: "Tamanho e estilo", subtitle: "Ajuste o tamanho dos textos e botões para a distância da sua tela.", preview: ["home"] },
  { id: "topbar", title: "Ícones no topo", subtitle: "Quais indicadores aparecem no canto superior direito.", preview: ["home"] },
  { id: "home", title: "Tela inicial", subtitle: "O destaque do jogo e como as fileiras aparecem.", preview: ["home"] },
  { id: "covers", title: "Capas e biblioteca", subtitle: "Como as capas dos jogos aparecem no Início e na Biblioteca.", preview: ["library", "home"] },
  { id: "detail", title: "Página do jogo", subtitle: "Quanto tempo o jogo costuma levar para terminar.", preview: ["detail"] },
  { id: "accounts", title: "Contas", subtitle: "Conecte as lojas para ver toda a biblioteca, inclusive os jogos que ainda não estão instalados.", preview: ["accounts"] },
  { id: "audio", title: "Áudio", subtitle: "Sons do launcher e música de fundo.", preview: ["audio"] },
  { id: "startup", title: "Inicialização", subtitle: "Como o launcher abre quando o PC liga. Nada muda sem você escolher.", preview: ["startup"] },
  { id: "system", title: "Sistema", subtitle: "Tela cheia, contador de FPS e menu Guia.", preview: ["perf"] },
  { id: "done", title: "Tudo pronto", subtitle: "Confira o resumo e comece a jogar.", preview: ["home"] },
] as const;

/** Item em que o jogador estava: depois de trocar o idioma (que refaz a tela toda) ou de voltar de uma subtela, o foco volta a ele. */
let lastFocus: string | null = null;

const musicName = (choice: MusicChoice) => (choice === "off" ? t("Desligada") : choice === "all" ? t("Todas (embaralhadas)") : (TRACKS.find((track) => track.id === choice)?.name ?? choice));

/** Assistente de primeira configuração: uma etapa por vez, com a prévia ao vivo ao lado. Funciona com controle e com teclado. */
export function SetupWizard() {
  const step = useSetup((s) => s.step);
  const setStep = useSetup((s) => s.setStep);
  const completed = useSetup((s) => s.completed);
  const finish = useSetup((s) => s.finish);
  const { navigate } = useUI.getState();
  const [confirmSkip, setConfirmSkip] = useState(false);
  /** Primeira utilização: não há para onde voltar, e sair é pular o assistente. */
  const [firstRun] = useState(() => !completed);
  const index = clamp(step, 0, STEPS.length - 1);
  const current = STEPS[index];
  const last = index === STEPS.length - 1;

  const theme = useTheme();
  const home = useHome();
  const library = useLibraryConfig();
  const notInstalled = useNotInstalled();
  const topIcons = useTopIcons((icons) => icons.shown);
  const setTopIcon = useTopIcons((icons) => icons.setShown);
  const uiLang = useLanguage((l) => l.lang);
  const setUiLang = useLanguage((l) => l.setLang);
  const preferredLanguage = useUserData((u) => u.preferredLanguage);
  const setPreferredLanguage = useUserData((u) => u.setPreferredLanguage);
  const showHltb = useUserData((u) => u.showHltb);
  const setShowHltb = useUserData((u) => u.setShowHltb);
  const hltbStyle = useUserData((u) => u.hltbStyle);
  const setHltbStyle = useUserData((u) => u.setHltbStyle);
  const hltbTimes = useUserData((u) => u.hltbTimes);
  const setHltbTimes = useUserData((u) => u.setHltbTimes);
  const hideToasts = useUserData((u) => u.hideSteamToasts);
  const setHideToasts = useUserData((u) => u.setHideSteamToasts);
  const padIcons = usePadKind((p) => p.icons);
  const padDetected = usePadKind((p) => p.detected);
  const setPadIcons = usePadKind((p) => p.setIcons);
  const soundEnabled = useSoundSettings((s) => s.enabled);
  const music = useMusic();
  const perfConfig = usePerf((p) => p.config);
  const setPerf = usePerf((p) => p.set);
  const stores = useStoreAccounts();
  const connected = stores.filter((store) => store.connected);
  const snapshot = usePerfSnapshot(1000);
  // Saídas de áudio do Windows (caixas, TV, fone), para escolher por onde o som sai.
  useSystemPolling(3000);
  const outputs = useSystem((s) => s.status?.outputs) ?? [];
  const output = outputs.find((o) => o.current);
  const stepOutput = useSystem((s) => s.stepOutput);
  const [fullscreen, setFullscreen] = useState(true);
  // Inicialização com o Windows e modo console (registro do Windows).
  const [startup, setStartup] = useState<StartupStatus | null>(null);
  const [confirmConsole, setConfirmConsole] = useState(false);
  const savingStartup = useRef(false);
  const changeStartup = async (run: () => Promise<StartupStatus>) => {
    if (savingStartup.current) return;
    savingStartup.current = true;
    try {
      setStartup(await run());
    } catch (error) {
      useUI.getState().showToast(te(error), "warning");
    } finally {
      savingStartup.current = false;
    }
  };

  useEffect(() => {
    void usePerf.getState().load();
    void api.isFullscreen().then(setFullscreen);
    void api.startupStatus().then(setStartup).catch(() => setStartup(null));
  }, []);

  const go = (to: number) => {
    const next = clamp(to, 0, STEPS.length - 1);
    // Compara com a etapa de agora (e não com a do momento em que os botões foram ligados).
    if (next === useSetup.getState().step) return;
    playSound("move");
    lastFocus = null;
    setStep(next);
  };
  const leave = () => {
    finish();
    const ui = useUI.getState();
    if (firstRun || ui.history.length === 0) ui.goTo("home");
    else ui.back();
  };

  // Os botões do assistente: LB/RB trocam de etapa, B volta uma etapa (na primeira, sai ou pergunta se quer pular).
  const stateRef = useRef({ index, firstRun });
  stateRef.current = { index, firstRun };
  useEffect(
    () =>
      onAction((a) => {
        if (useUI.getState().modalOpen) return;
        const { index: at, firstRun: first } = stateRef.current;
        if (a === "lb") go(at - 1);
        else if (a === "rb") go(at + 1);
        else if (a === "back") {
          if (at > 0) go(at - 1);
          else if (first) {
            playSound("open");
            setConfirmSkip(true);
          } else leave();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Foco: o último item visitado (depois de trocar o idioma ou de voltar de uma subtela) ou o primeiro da etapa.
  useEffect(() => {
    // Na última etapa não há nada para ajustar: o foco vai direto para "Concluir".
    const target = lastFocus && document.querySelector(`[data-focus-key="${lastFocus}"]`) ? lastFocus : index === STEPS.length - 1 ? "setup-next" : document.querySelector(".setup-list [data-focus-key]")?.getAttribute("data-focus-key");
    if (target) setFocus(target);
  }, [index, current.id === "startup" && !!startup]);
  const remember = (key: string) => () => {
    lastFocus = key;
  };
  // Se o foco se perder (a linha focada sumiu, a janela voltou de outro programa), o próximo botão ou tecla o devolve à
  // etapa: sem isso o jogador ficaria sem como chegar às opções.
  useEffect(() => {
    const recover = () => {
      if (useUI.getState().modalOpen || document.querySelector('[data-focused="true"]')) return;
      const target = document.querySelector(".setup-column [data-focus-key]")?.getAttribute("data-focus-key");
      if (target) setFocus(target);
    };
    const stop = onAction(recover);
    window.addEventListener("keydown", recover);
    return () => {
      stop();
      window.removeEventListener("keydown", recover);
    };
  }, []);

  const themeIndex = indexOf(THEMES.map((th) => th.id), theme.themeId);
  const accentIndex = Math.max(0, ACCENT_PRESETS.findIndex((a) => a.value === theme.accent));
  const styleIndex = indexOf(BACKGROUND_STYLES.map((b) => b.id), home.background);
  const colorIndex = indexOf(BACKGROUND_COLORS.map((c) => c.id), home.backgroundColor);
  const uiLangIndex = indexOf(LANGUAGES.map((l) => l.id), uiLang);
  const padIconsIndex = indexOf(PAD_ICON_CHOICES.map((o) => o.id), padIcons);
  const hltbStyleIndex = indexOf(HLTB_STYLES.map((o) => o.id), hltbStyle);
  const hltbTimesIndex = indexOf(HLTB_TIMES.map((o) => o.id), hltbTimes);
  const sizeIndex = Math.max(0, CARD_SIZES.indexOf(library.cardSize));

  const refreshFullscreen = () => window.setTimeout(() => void api.isFullscreen().then(setFullscreen), 250);

  /** Linhas de cada etapa. */
  const rows = (): ReactNode => {
    switch (current.id) {
      case "welcome":
        return (
          <>
            <Setting
              cycle
              id="ui-language"
              label={t("Idioma do launcher")}
              hint={t("Idioma dos menus e textos do launcher (não muda o idioma dos jogos)")}
              value={LANGUAGES[uiLangIndex].name}
              onFocus={remember("set-ui-language")}
              onStep={(d) => setUiLang(cycle(LANGUAGES, uiLangIndex, d).id)}
            />
            <Setting
              cycle
              id="language"
              label={t("Idioma preferido dos jogos")}
              hint={t("Em que idioma você quer jogar: a página do jogo avisa se ele tem este idioma")}
              value={languageName(preferredLanguage)}
              onFocus={remember("set-language")}
              onStep={(d) => setPreferredLanguage(cycle(PREFERRED_LANGUAGES, Math.max(0, PREFERRED_LANGUAGES.indexOf(preferredLanguage)), d))}
            />
          </>
        );
      case "controls":
        return (
          <>
            <Setting
              cycle
              id="pad-icons"
              label={t("Ícones dos botões")}
              hint={t("Mostra A B X Y (Xbox) ou ✕ ○ □ △ (PlayStation). Automático segue o controle que você estiver usando.")}
              value={padIcons === "auto" ? `${t("Automático")} · ${padDetected === "playstation" ? "PlayStation" : "Xbox"}` : PAD_ICON_CHOICES[padIconsIndex].name}
              onFocus={remember("set-pad-icons")}
              onStep={(d) => setPadIcons(cycle(PAD_ICON_CHOICES, padIconsIndex, d).id)}
            />
            <ActionRow arrow id="gamepad" label={t("Testar controle")} hint={t("Veja os botões e o mapeamento do seu controle")} onFocus={remember("set-gamepad")} onPress={() => navigate({ name: "gamepad-test" })} />
          </>
        );
      case "colors":
        return (
          <>
            <Setting cycle id="theme" label={t("Tema")} hint={t("Cores de fundo e das superfícies")} value={t(getTheme(theme.themeId).name)} onFocus={remember("set-theme")} onStep={(d) => theme.set({ themeId: cycle(THEMES, themeIndex, d).id })} />
            <Setting cycle id="accent" label={t("Cor de destaque")} hint={t("Cor do item selecionado e dos botões")} value={t(ACCENT_PRESETS[accentIndex].name)} onFocus={remember("set-accent")} onStep={(d) => theme.set({ accent: cycle(ACCENT_PRESETS, accentIndex, d).value })} />
          </>
        );
      case "background":
        return (
          <>
            <Setting cycle id="bg-style" label={t("Estilo do fundo")} hint={t(BACKGROUND_STYLES[styleIndex].hint)} value={t(BACKGROUND_STYLES[styleIndex].name)} onFocus={remember("set-bg-style")} onStep={(d) => home.setBackground({ background: cycle(BACKGROUND_STYLES, styleIndex, d).id })} />
            {home.background === "blur" && (
              <Setting id="bg-blur" label={t("Desfoque da capa")} hint={t("Quanto a capa é desfocada: menos mostra mais da imagem, mais deixa só as cores")} value={`${Math.round(home.backgroundBlur * 100)}%`} onFocus={remember("set-bg-blur")} onStep={(d) => home.setBackground({ backgroundBlur: clamp(+(home.backgroundBlur + d * 0.05).toFixed(2), 0.05, 1) })} />
            )}
            {home.background === "color" ? (
              <Setting cycle id="bg-color" label={t("Cor do fundo")} hint={t("Cor fixa atrás das fileiras e da página do jogo")} value={t(BACKGROUND_COLORS[colorIndex].name)} onFocus={remember("set-bg-color")} onStep={(d) => home.setBackground({ backgroundColor: cycle(BACKGROUND_COLORS, colorIndex, d).id })} />
            ) : (
              <Setting id="bg-strength" label={t("Intensidade do fundo")} hint={t("Quanto o plano de fundo aparece")} value={`${Math.round(home.backgroundStrength * 100)}%`} onFocus={remember("set-bg-strength")} onStep={(d) => home.setBackground({ backgroundStrength: clamp(+(home.backgroundStrength + d * 0.05).toFixed(2), 0.1, 1) })} />
            )}
          </>
        );
      case "size":
        return (
          <>
            <Setting id="scale" label={t("Tamanho da interface")} hint={t("Aumenta ou diminui textos e botões")} value={`${Math.round(theme.fontScale * 100)}%`} onFocus={remember("set-scale")} onStep={(d) => theme.set({ fontScale: clamp(+(theme.fontScale + d * 0.05).toFixed(2), 0.7, 1.5) })} />
            <Setting id="radius" label={t("Cantos arredondados")} hint={t("Quanto os cartões e botões são arredondados")} value={`${theme.radius}px`} onFocus={remember("set-radius")} onStep={(d) => theme.set({ radius: clamp(theme.radius + d * 2, 0, 28) })} />
            <Setting id="glow" label={t("Brilho do item focado")} hint={t("Intensidade do brilho ao redor do item selecionado")} value={`${Math.round(theme.glow * 100)}%`} onFocus={remember("set-glow")} onStep={(d) => theme.set({ glow: clamp(+(theme.glow + d * 0.1).toFixed(1), 0, 1) })} />
            <Setting cycle id="reduce-motion" label={t("Reduzir movimento")} hint={t("Sem zoom no item selecionado, sem transições e sem rolagem animada")} value={theme.reduceMotion ? t("Ligado") : t("Desligado")} onFocus={remember("set-reduce-motion")} onStep={() => theme.set({ reduceMotion: !theme.reduceMotion })} />
          </>
        );
      case "topbar":
        return (
          <>
            {TOP_ICONS.map(({ id, label, hint }) => (
              <Setting key={id} cycle id={`top-${id}`} label={t(label)} hint={t(hint)} value={topIcons[id] ? t("Exibir") : t("Ocultar")} onFocus={remember(`set-top-${id}`)} onStep={() => setTopIcon(id, !topIcons[id])} />
            ))}
            <p className="account-note">{t("O painel Sistema (volume, saída de áudio, Wi-Fi e Bluetooth) continua no menu do botão Guia.")}</p>
          </>
        );
      case "home":
        return (
          <>
            <Setting cycle id="hero" label={t("Destaque do jogo no topo")} hint={t("Título e descrição do jogo selecionado")} value={home.showHero ? t("Mostrar") : t("Ocultar")} onFocus={remember("set-hero")} onStep={() => home.setShowHero(!home.showHero)} />
            <Setting cycle id="rowmode" label={t("Fileiras na tela")} hint={t("Uma por vez mostra só a fileira selecionada; Todas deixa a tela rolar")} value={home.rowMode === "one" ? t("Uma por vez") : t("Todas")} onFocus={remember("set-rowmode")} onStep={() => home.setRowMode(home.rowMode === "one" ? "all" : "one")} />
            <ActionRow arrow id="home-layout" label={t("Escolher as fileiras")} hint={t("Quais fileiras aparecem, em que ordem e com que estilo")} onFocus={remember("set-home-layout")} onPress={() => navigate({ name: "home-layout" })} />
          </>
        );
      case "covers":
        return (
          <>
            <Setting cycle id="store-icons" label={t("Ícones das lojas")} hint={t("Mostra a loja de origem (Steam, Epic…) no canto de cada capa")} value={library.showStoreIcons ? t("Mostrar") : t("Ocultar")} onFocus={remember("set-store-icons")} onStep={() => library.setOptions({ showStoreIcons: !library.showStoreIcons })} />
            <Setting cycle id="card-size" label={t("Tamanho das capas na Biblioteca")} hint={t("Quantos jogos cabem na tela da Biblioteca")} value={t(CARD_SIZE_LABELS[library.cardSize])} onFocus={remember("set-card-size")} onStep={(d) => library.setOptions({ cardSize: cycle([...CARD_SIZES], sizeIndex, d) })} />
            <Setting cycle id="counts" label={t("Número de jogos nas abas")} hint={t("Mostra quantos jogos cada aba da Biblioteca tem")} value={library.showCounts ? t("Mostrar") : t("Ocultar")} onFocus={remember("set-counts")} onStep={() => library.setOptions({ showCounts: !library.showCounts })} />
            <Setting cycle id="installed-first" label={t("Instalados primeiro")} hint={t("Na Biblioteca, os jogos instalados vêm antes dos que ainda não foram instalados")} value={notInstalled.installedFirst ? t("Ligado") : t("Desligado")} onFocus={remember("set-installed-first")} onStep={() => notInstalled.set({ installedFirst: !notInstalled.installedFirst })} />
            <ActionRow arrow id="notinstalled" label={t("Jogos não instalados")} hint={t("Selo, capa apagada e ordem dos jogos que ainda não foram instalados")} onFocus={remember("set-notinstalled")} onPress={() => navigate({ name: "not-installed" })} />
          </>
        );
      case "detail":
        return (
          <>
            <Setting cycle id="hltb" label={t("Mostrar a duração")} hint={t("Na página do jogo: quanto ele costuma levar para terminar (consulta o site HowLongToBeat)")} value={showHltb ? t("Mostrar") : t("Ocultar")} onFocus={remember("set-hltb")} onStep={() => setShowHltb(!showHltb)} />
            {showHltb && (
              <>
                <Setting cycle id="hltb-style" label={t("Onde aparece")} hint={t(HLTB_STYLES[hltbStyleIndex].hint)} value={t(HLTB_STYLES[hltbStyleIndex].name)} onFocus={remember("set-hltb-style")} onStep={(d) => setHltbStyle(cycle(HLTB_STYLES, hltbStyleIndex, d).id)} />
                {hltbStyle !== "hint" && (
                  <Setting cycle id="hltb-times" label={t("Tempos exibidos")} hint={t("Principal é só a história; extras inclui missões paralelas; completista é fazer tudo")} value={t(HLTB_TIMES[hltbTimesIndex].name)} onFocus={remember("set-hltb-times")} onStep={(d) => setHltbTimes(cycle(HLTB_TIMES, hltbTimesIndex, d).id)} />
                )}
              </>
            )}
          </>
        );
      case "accounts":
        return (
          <>
            {stores.map((store) => (
              <ActionRow key={store.id} arrow id={`store-${store.id}`} label={t(store.name)} hint={t(store.hint)} value={store.summary} onFocus={remember(`set-store-${store.id}`)} onPress={() => navigate(store.screen)} />
            ))}
            <Setting cycle id="toasts" label={t("Notificações e overlay da Steam")} hint={t("Oculta os avisos da Steam (conquistas, mensagens) sobre o launcher e os jogos")} value={hideToasts ? t("Ocultar") : t("Mostrar")} onFocus={remember("set-toasts")} onStep={() => setHideToasts(!hideToasts)} />
            <p className="account-note">{t("Você pode pular esta etapa e conectar as contas depois, em Configurações › Contas.")}</p>
          </>
        );
      case "audio":
        return (
          <>
            {output && (
              <Setting cycle id="output" label={t("Saída de áudio")} hint={t("Por onde o som sai (caixas, TV ou fone). Vale para o Windows inteiro")} value={output.name} onFocus={remember("set-output")} onStep={(d) => stepOutput(d)} />
            )}
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
            {soundEnabled && <ActionRow id="test-sound" label={t("Testar o som")} hint={t("Toca um som do launcher na saída escolhida")} onFocus={remember("set-test-sound")} onPress={() => playSound("success")} />}
            <Setting cycle id="music" label={t("Música de fundo")} hint={t("Toca no launcher quando nenhum jogo está aberto e ele está em primeiro plano")} value={musicName(music.choice)} onFocus={remember("set-music")} onStep={(d) => music.setChoice(cycle(MUSIC_CHOICES, MUSIC_CHOICES.indexOf(music.choice), d))} />
            {music.choice !== "off" && (
              <Setting id="music-volume" label={t("Volume da música")} hint={t("Só da música de fundo; os efeitos sonoros e os jogos têm o volume deles")} value={`${music.volume}%`} onFocus={remember("set-music-volume")} onStep={(d) => music.setVolume(music.volume + d * 10)} />
            )}
          </>
        );
      case "startup":
        return startup ? (
          <>
            <Setting cycle id="startup-autostart" label={t("Abrir o launcher ao entrar no Windows")} hint={t("O launcher abre sozinho quando você entra no Windows. A área de trabalho continua existindo por baixo.")} value={startup.autostart ? t("Ligado") : t("Desligado")} onFocus={remember("set-startup-autostart")} onStep={() => void changeStartup(() => api.setAutostart(!startup.autostart))} />
            <Setting
              cycle
              id="startup-console"
              badge={t("Recomendado")}
              label={t("Modo console")}
              hint={t("O Windows entra direto no launcher, sem área de trabalho, barra de tarefas nem menu Iniciar")}
              value={startup.console ? t("Ativado") : t("Desativado")}
              onFocus={remember("set-startup-console")}
              onStep={() => (startup.console ? void changeStartup(() => api.setConsoleMode(false)) : setConfirmConsole(true))}
            />
            {/* Só quem desenvolve vê: no launcher instalado as opções estão sempre disponíveis. */}
            {import.meta.env.DEV && !startup.available && <p className="account-note startup-warn" role="status">{t("Disponível só no launcher instalado, não no modo de desenvolvimento.")}</p>}
            {startup.console && !startup.consoleActive && <p className="account-note" role="status">{t("Modo console ativado: vale a partir da próxima vez que você entrar no Windows.")}</p>}
            <p className="account-note">{t("Só uma das duas fica ligada: ligar uma desliga a outra. Leia os riscos ao lado antes de ativar o modo console.")}</p>
          </>
        ) : (
          <p className="account-note" role="status">{t("Carregando opções…")}</p>
        );
      case "system":
        return (
          <>
            <Setting cycle id="fullscreen" label={t("Tela cheia")} hint={t("Atalho no teclado: F11")} value={fullscreen ? t("Ativada") : t("Desativada")} onFocus={remember("set-fullscreen")} onStep={() => void api.toggleFullscreen().then(refreshFullscreen)} />
            <Setting cycle id="perf-enabled" label={t("Contador de FPS")} hint={t("Mostra o desempenho por cima do jogo. Também liga e desliga pelo menu Guia")} value={perfConfig.enabled ? t("Ligado") : t("Desligado")} onFocus={remember("set-perf-enabled")} onStep={() => setPerf({ enabled: !perfConfig.enabled })} />
            <ActionRow arrow id="perf" label={t("Personalizar o contador de FPS")} hint={t("Modelo, posição, itens, cores e faixas")} onFocus={remember("set-perf")} onPress={() => navigate({ name: "perf-settings" })} />
            <ActionRow arrow id="guide-power" label={t("Opções de energia do menu Guia")} hint={t("Escolha quais botões aparecem no menu lateral")} onFocus={remember("set-guide-power")} onPress={() => navigate({ name: "guide-power" })} />
          </>
        );
      default:
        return (
          <ul className="setup-summary">
            <li><span>{t("Idioma")}</span><b>{LANGUAGES[uiLangIndex].name}</b></li>
            <li><span>{t("Tema")}</span><b>{t(getTheme(theme.themeId).name)}</b></li>
            <li><span>{t("Cor de destaque")}</span><b>{t(ACCENT_PRESETS[accentIndex].name)}</b></li>
            <li><span>{t("Plano de fundo")}</span><b>{t(BACKGROUND_STYLES[styleIndex].name)}</b></li>
            <li><span>{t("Tamanho da interface")}</span><b>{Math.round(theme.fontScale * 100)}%</b></li>
            <li><span>{t("Contas conectadas")}</span><b>{connected.length > 0 ? connected.map((s) => t(s.name)).join(", ") : t("Nenhuma")}</b></li>
            <li><span>{t("Música de fundo")}</span><b>{musicName(music.choice)}</b></li>
            <li><span>{t("Inicialização")}</span><b>{startup?.console ? t("Modo console") : startup?.autostart ? t("Abre junto com o Windows") : t("Aberto por você")}</b></li>
            <li><span>{t("Contador de FPS")}</span><b>{perfConfig.enabled ? t("Ligado") : t("Desligado")}</b></li>
          </ul>
        );
    }
  };

  const previews = current.preview.map((kind) => {
    switch (kind) {
      case "home":
        return <HomePreview key={kind} />;
      case "detail":
        return <DetailPreview key={kind} />;
      case "library":
        return <LibraryPreview key={kind} />;
      case "controller":
        return <ControllerPreview key={kind} />;
      case "accounts":
        return <AccountsPreview key={kind} />;
      case "audio":
        return <AudioPreview key={kind} />;
      case "startup":
        return <StartupPreview key={kind} restoreScript={startup?.restoreScript} />;
      default:
        return <PerfPreview key={kind} snapshot={snapshot} />;
    }
  });

  return (
    <div className="screen settings setup">
      <TopBar title={t("Assistente de configuração")} />

      <div className="setup-progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1} aria-label={t("Etapa {n} de {total}", { n: index + 1, total: STEPS.length })}>
        <span className="setup-count">{t("Etapa {n} de {total}", { n: index + 1, total: STEPS.length })}</span>
        <ol className="setup-dots">
          {STEPS.map((s, i) => (
            <li key={s.id} className={i < index ? "is-done" : i === index ? "is-current" : ""} />
          ))}
        </ol>
      </div>

      <div className={previews.length > 1 ? "settings-split settings-split-two" : "settings-split"}>
        {/* O foco não sai do assistente (indo parar nos ícones do topo, de onde era difícil voltar às opções). */}
        <FocusGroup key={current.id} focusKey="setup-step" className="setup-column" boundary>
          {/* Só as linhas rolam; Voltar e Continuar ficam fora da área que rola, para nunca ficarem por cima do texto. */}
          {/* As linhas e os botões são dois grupos: a navegação compara a posição de um grupo com a do outro, e não a de uma
              linha já rolada (que "passava para baixo" dos botões e impedia de chegar até eles). A última etapa não tem
              linhas ajustáveis, e um grupo vazio não pode ser alvo do foco. */}
          <FocusGroup focusKey="setup-rows" className="settings-list settings-page setup-list" disabled={last}>
            <h3 className="settings-title">{t(current.title)}</h3>
            <p className="account-note setup-intro">{t(current.subtitle)}</p>
            {rows()}
          </FocusGroup>
          <FocusGroup focusKey="setup-nav" className="setup-nav" preferredChildFocusKey="setup-next">
            {index > 0 ? (
              <Focusable focusKey="setup-prev" className="btn" scroll={false} onPress={() => go(index - 1)}>
                ‹ {t("Voltar")}
              </Focusable>
            ) : (
              <Focusable focusKey="setup-skip" className="btn" scroll={false} onPress={() => (firstRun ? setConfirmSkip(true) : leave())}>
                {firstRun ? t("Configurar depois") : t("Sair do assistente")}
              </Focusable>
            )}
            {last ? (
              <Focusable focusKey="setup-next" className="btn btn-primary" scroll={false} onPress={() => { playSound("success"); leave(); }}>
                {t("Concluir")}
              </Focusable>
            ) : (
              <Focusable focusKey="setup-next" className="btn btn-primary" scroll={false} onPress={() => go(index + 1)}>
                {t("Continuar")} ›
              </Focusable>
            )}
          </FocusGroup>
        </FocusGroup>
        <aside className="settings-preview" aria-label={t("Prévia ao vivo")}>
          {previews}
        </aside>
      </div>

      {confirmConsole && (
        <ConfirmDialog
          title={t("Ativar o modo console?")}
          message={t("Na próxima vez que você entrar no Windows, o launcher ocupará o lugar da área de trabalho: sem barra de tarefas, menu Iniciar nem bandeja. Se o launcher fechar ou travar, ele reabre sozinho, e Sair para a área de trabalho sempre traz o Windows de volta. Vale só para este usuário.")}
          confirmLabel={t("Ativar modo console")}
          danger
          onCancel={() => setConfirmConsole(false)}
          onConfirm={() => {
            setConfirmConsole(false);
            void changeStartup(() => api.setConsoleMode(true));
          }}
        />
      )}

      {confirmSkip && (
        <ConfirmDialog
          title={t("Configurar depois?")}
          message={t("O launcher usa as opções padrão. Você pode abrir o assistente de novo em Configurações › Sistema e energia.")}
          confirmLabel={t("Configurar depois")}
          cancelLabel={t("Continuar a configuração")}
          onCancel={() => setConfirmSkip(false)}
          onConfirm={() => {
            setConfirmSkip(false);
            leave();
          }}
        />
      )}

      <Hints
        items={[
          { btn: "A", label: "Selecionar" },
          { btn: "LR", label: "Ajustar" },
          { btn: "LB", label: "Etapa anterior" },
          { btn: "RB", label: "Próxima etapa" },
          { btn: "B", label: index > 0 ? "Voltar" : firstRun ? "Configurar depois" : "Sair" },
        ]}
      />
    </div>
  );
}
