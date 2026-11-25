import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { playSound } from "../audio/sounds";
import { ButtonGlyph, Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup, Focusable } from "../components/Focusable";
import { PerfCard, stageAlignment, usePerfSnapshot } from "../components/PerfCard";
import { ActionRow, Setting } from "../components/Setting";
import { t, te } from "../i18n";
import { onAction } from "../input/actions";
import {
  PERF_BACKGROUNDS,
  PERF_BACKGROUND_PALETTE,
  PERF_FPS_GOOD,
  PERF_FPS_WARN,
  PERF_LAYOUTS,
  PERF_NAMES,
  PERF_OPACITIES,
  PERF_PALETTE,
  PERF_POSITIONS,
  PERF_PRESETS,
  PERF_SCALES,
  PERF_TEMP_HOT,
  PERF_TEMP_WARN,
  currentPreset,
  demoSnapshot,
  perf,
  type PerfColors,
  type PerfItems,
  type PerfSnapshot,
} from "../lib/perf";
import { cycle, indexOf } from "../lib/util";
import { usePerf } from "../store/perf";
import { useUI } from "../store/ui";

/** As páginas desta tela (a lista é longa: dividida, cada página cabe na tela sem rolar muito). LB/RB trocam. */
const PAGES = [
  { id: "general", label: "Geral" },
  { id: "items", label: "Itens" },
  { id: "colors", label: "Cores e faixas" },
] as const;
type PageId = (typeof PAGES)[number]["id"];
let lastPage: PageId = "general";

/** Itens do contador, agrupados como aparecem na tela. */
const ITEM_GROUPS: { title: string; note?: string; items: { key: keyof PerfItems; label: string; hint?: string }[] }[] = [
  {
    title: "Desempenho",
    items: [
      { key: "fps", label: "FPS" },
      { key: "average", label: "Média de FPS", hint: "FPS médio do último minuto" },
      { key: "low1", label: "1% low", hint: "FPS dos 1% piores quadros: mostra os engasgos" },
      { key: "low01", label: "0,1% low", hint: "FPS dos 0,1% piores quadros" },
      { key: "frametime", label: "Frametime", hint: "Tempo de cada quadro, em milissegundos" },
      { key: "graph", label: "Gráfico de frametime", hint: "Uma barra por quadro: as altas são os engasgos" },
      { key: "game", label: "Nome do jogo" },
    ],
  },
  {
    title: "Processador",
    note: "A temperatura do processador não aparece: o Windows só a informa com um driver de kernel, e o launcher não instala um.",
    items: [
      { key: "cpuName", label: "Nome do processador" },
      { key: "cpuUsage", label: "Uso do processador" },
    ],
  },
  {
    title: "Placa de vídeo",
    items: [
      { key: "gpuName", label: "Nome da placa de vídeo" },
      { key: "gpuUsage", label: "Uso da placa de vídeo" },
      { key: "gpuTemp", label: "Temperatura da placa de vídeo" },
      { key: "gpuPower", label: "Consumo de energia", hint: "Em porcentagem do limite de energia da placa" },
      { key: "vram", label: "Memória de vídeo" },
    ],
  },
  { title: "Memória", items: [{ key: "ram", label: "Memória RAM" }] },
];

function colorName(hex: string, palette: { hex: string; name: string }[]): string {
  if (hex === "auto") return t("Automática (pelas faixas de FPS)");
  const found = palette.find((entry) => entry.hex.toLowerCase() === hex.toLowerCase());
  return found ? t(found.name) : hex.toUpperCase();
}

/** A prévia: um "jogo" 16:9 com o contador no canto escolhido, no tamanho proporcional ao do monitor. */
export function PerfPreview({ snapshot }: { snapshot: PerfSnapshot | null }) {
  const config = usePerf((s) => s.config);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Movimento nos dados de exemplo.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, []);

  const shown = useMemo<PerfSnapshot>(() => {
    const demo = demoSnapshot(config);
    if (!snapshot) return demo;
    // Sem jogo sendo medido, a prévia usa os quadros de exemplo, mas o hardware é o deste PC.
    return snapshot.game ? { ...snapshot, config } : { ...demo, hw: snapshot.hw };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, config, tick]);

  return (
    <div ref={frame} className="perf-preview" aria-hidden="true">
      <div className="perf-stage" style={{ ...stageAlignment(config.position), fontSize: `${(width / 120) * config.scale}px` }}>
        <PerfCard config={config} snapshot={shown} />
      </div>
      <span className="perf-preview-tag">{snapshot?.game ? t("Ao vivo") : t("Prévia com dados de exemplo")}</span>
    </div>
  );
}

/** Estado da medição de FPS, em palavras. */
function describeCapture(snapshot: PerfSnapshot | null, enabled: boolean): { text: string; warn: boolean } {
  if (!snapshot) return { text: t("Verificando…"), warn: false };
  const state = snapshot.capture.state;
  if (state === "denied") {
    return {
      text: snapshot.member
        ? t("Permissão concedida. Para valer, saia da sua conta do Windows e entre de novo (ou reinicie o PC).")
        : t("Falta permissão do Windows para medir o FPS. Use “Liberar a medição de FPS”: o Windows pede uma confirmação de administrador, uma única vez."),
      warn: true,
    };
  }
  if (snapshot.capture.state === "failed") return { text: te(snapshot.capture.message), warn: true };
  if (!enabled) return { text: t("Contador desligado."), warn: false };
  if (state === "running") return { text: snapshot.game ? t("Medindo {game}.", { game: snapshot.game.process.replace(/\.exe$/i, "") }) : t("Pronto: aguardando um jogo (DirectX 9, 10, 11 ou 12)."), warn: false };
  return { text: t("Iniciando a medição…"), warn: false };
}

/** Configurações › Sistema › Contador de FPS. */
export function PerfSettings() {
  const config = usePerf((s) => s.config);
  const set = usePerf((s) => s.set);
  const back = useUI((s) => s.back);
  const snapshot = usePerfSnapshot(1000);
  const [confirmReset, setConfirmReset] = useState(false);
  const [page, setPageState] = useState<PageId>(lastPage);
  const setPage = (next: PageId) => {
    lastPage = next;
    setPageState(next);
  };
  const preset = currentPreset(config);
  const presetIds = [...PERF_PRESETS.map((p) => p.id), "custom" as const];
  const capture = describeCapture(snapshot, config.enabled);

  useEffect(() => {
    void usePerf.getState().load();
    setFocus("set-perf-enabled");
  }, []);

  // LB/RB passam de página (a menos que um diálogo esteja aberto).
  useEffect(
    () =>
      onAction((a) => {
        if (a !== "lb" && a !== "rb") return;
        if (useUI.getState().modalOpen) return;
        setPageState((current) => {
          const next = cycle([...PAGES], indexOf(PAGES.map((p) => p.id), current), a === "lb" ? -1 : 1).id;
          if (next !== current) playSound("move");
          lastPage = next;
          return next;
        });
      }),
    [],
  );

  // Ao trocar de página o foco vai para a primeira linha dela (a antiga some e o foco ficaria perdido).
  const firstRow = useRef(true);
  useEffect(() => {
    if (firstRow.current) {
      firstRow.current = false;
      return;
    }
    const id = page === "general" ? "set-perf-enabled" : page === "items" ? `set-perf-item-${ITEM_GROUPS[0].items[0].key}` : "set-perf-color-fps";
    requestAnimationFrame(() => setFocus(id));
  }, [page]);

  const colorRow = (key: keyof PerfColors, label: string, hint: string, palette: { hex: string; name: string }[], auto = false) => {
    const list = [...(auto ? ["auto"] : []), ...palette.map((entry) => entry.hex)];
    const index = Math.max(0, list.findIndex((hex) => hex.toLowerCase() === config.colors[key].toLowerCase()));
    return (
      <Setting
        cycle
        id={`perf-color-${key}`}
        label={label}
        hint={hint}
        value={colorName(config.colors[key], palette)}
        onStep={(d) => set({ colors: { [key]: cycle(list, index, d) } as Partial<PerfColors> })}
      />
    );
  };

  const grant = async () => {
    try {
      await perf.grantPermission();
      useUI.getState().showToast(t("Confirme a janela do Windows. Depois, saia da sua conta e entre de novo para a permissão valer."));
    } catch (e) {
      useUI.getState().showToast(te(e), "warning");
    }
  };

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Contador de FPS")} />
      <FocusGroup focusKey="perfset-tabs" className="tabs settings-tabs">
        <ButtonGlyph btn="LB" />
        {PAGES.map((p) => (
          <Focusable
            key={p.id}
            focusKey={`perfset-tab-${p.id}`}
            className={`tab ${p.id === page ? "is-active" : ""}`}
            scroll={false}
            onPress={() => {
              if (p.id === page) return;
              playSound("move");
              setPage(p.id);
            }}
          >
            {t(p.label)}
          </Focusable>
        ))}
        <ButtonGlyph btn="RB" />
      </FocusGroup>
      <div className="settings-split">
        <FocusGroup focusKey="perfset-list" className="settings-list settings-page" preferredChildFocusKey="set-perf-enabled">
          {page === "general" && (
            <>
          <h3 className="settings-title">{t("Contador")}</h3>
          <Setting
            cycle
            id="perf-enabled"
            label={t("Contador de FPS")}
            hint={t("Mostra o desempenho por cima do jogo. Também liga e desliga pelo menu Guia")}
            value={config.enabled ? t("Ligado") : t("Desligado")}
            onStep={() => set({ enabled: !config.enabled })}
          />
          <Setting
            cycle
            id="perf-only-game"
            label={t("Só com um jogo aberto")}
            hint={t("Esconde o contador quando nenhum jogo está sendo medido")}
            value={config.onlyInGame ? t("Sim") : t("Não")}
            onStep={() => set({ onlyInGame: !config.onlyInGame })}
          />
          <Setting
            cycle
            id="perf-preset"
            label={t("Modelo")}
            hint={t("Um ponto de partida: escolha um e ajuste o resto como quiser")}
            value={preset === "custom" ? t("Personalizado") : t(PERF_PRESETS.find((p) => p.id === preset)?.name ?? "")}
            onStep={(d) => {
              const next = cycle(presetIds, indexOf(presetIds, preset), d);
              const chosen = PERF_PRESETS.find((p) => p.id === next);
              if (chosen) set({ layout: chosen.layout, items: Object.fromEntries((Object.keys(config.items) as (keyof PerfItems)[]).map((key) => [key, chosen.items[key] ?? false])) as unknown as PerfItems });
            }}
          />

          <h3 className="settings-title">{t("Aparência")}</h3>
          <Setting
            cycle
            id="perf-position"
            label={t("Posição")}
            value={t(PERF_POSITIONS.find((p) => p.id === config.position)?.name ?? "")}
            onStep={(d) => set({ position: cycle(PERF_POSITIONS, indexOf(PERF_POSITIONS.map((p) => p.id), config.position), d).id })}
          />
          <Setting
            id="perf-scale"
            label={t("Tamanho")}
            hint={t("Em relação à tela: 100% é o padrão")}
            value={`${Math.round(config.scale * 100)}%`}
            onStep={(d) => set({ scale: cycle(PERF_SCALES, Math.max(0, indexOf(PERF_SCALES, config.scale)), d) })}
          />
          <Setting
            cycle
            id="perf-layout"
            label={t("Disposição")}
            value={t(PERF_LAYOUTS.find((l) => l.id === config.layout)?.name ?? "")}
            onStep={(d) => set({ layout: cycle(PERF_LAYOUTS, indexOf(PERF_LAYOUTS.map((l) => l.id), config.layout), d).id })}
          />
          <Setting
            cycle
            id="perf-background"
            label={t("Fundo")}
            value={t(PERF_BACKGROUNDS.find((b) => b.id === config.background)?.name ?? "")}
            onStep={(d) => set({ background: cycle(PERF_BACKGROUNDS, indexOf(PERF_BACKGROUNDS.map((b) => b.id), config.background), d).id })}
          />
          {config.background === "glass" && (
            <Setting
              id="perf-opacity"
              label={t("Transparência do fundo")}
              hint={t("Quanto do fundo aparece: 100% é sólido")}
              value={`${Math.round(config.opacity * 100)}%`}
              onStep={(d) => set({ opacity: cycle(PERF_OPACITIES, Math.max(0, indexOf(PERF_OPACITIES, config.opacity)), d) })}
            />
          )}
          <Setting
            cycle
            id="perf-names"
            label={t("Nome do hardware")}
            value={t(PERF_NAMES.find((n) => n.id === config.names)?.name ?? "")}
            onStep={(d) => set({ names: cycle(PERF_NAMES, indexOf(PERF_NAMES.map((n) => n.id), config.names), d).id })}
          />

          <h3 className="settings-title">{t("Medição")}</h3>
          {snapshot?.capture.state === "denied" && !snapshot.member && (
            <ActionRow id="perf-grant" label={t("Liberar a medição de FPS")} hint={t("Pede a confirmação de administrador uma única vez")} onPress={() => void grant()} />
          )}
          <ActionRow danger id="perf-reset" label={t("Restaurar padrões")} hint={t("Volta tudo ao que veio de fábrica, sem ligar nem desligar o contador")} onPress={() => setConfirmReset(true)} />
            </>
          )}

          {page === "items" && ITEM_GROUPS.map((group) => (
            <div key={group.title} className="perf-group">
              <h3 className="settings-title">{t(group.title)}</h3>
              {group.items.map((item) => (
                <Setting
                  key={item.key}
                  cycle
                  id={`perf-item-${item.key}`}
                  label={t(item.label)}
                  hint={item.hint ? t(item.hint) : undefined}
                  value={config.items[item.key] ? t("Mostrar") : t("Ocultar")}
                  onStep={() => set({ items: { [item.key]: !config.items[item.key] } })}
                />
              ))}
              {group.note && <p className="account-note perf-note-line">{t(group.note)}</p>}
            </div>
          ))}

          {page === "colors" && (
            <>
          <h3 className="settings-title">{t("Cores")}</h3>
          {colorRow("fps", t("Número do FPS"), t("Automática: verde, amarelo ou vermelho conforme as faixas abaixo"), PERF_PALETTE, true)}
          {colorRow("text", t("Texto e números"), t("Cor dos valores"), PERF_PALETTE)}
          {colorRow("label", t("Rótulos"), t("Cor das legendas pequenas e dos nomes"), PERF_PALETTE)}
          {colorRow("accent", t("Destaque"), t("Cor de “FPS”, das etiquetas CPU e GPU e da linha do gráfico"), PERF_PALETTE)}
          {config.background !== "none" && colorRow("background", t("Cor do fundo"), t("Combina com a transparência"), PERF_BACKGROUND_PALETTE)}
          {colorRow("good", t("Cor de “bom”"), t("FPS e quadros dentro da meta"), PERF_PALETTE)}
          {colorRow("warn", t("Cor de “atenção”"), t("FPS e quadros abaixo da meta, e temperatura alta"), PERF_PALETTE)}
          {colorRow("bad", t("Cor de “ruim”"), t("FPS e quadros muito baixos, e temperatura crítica"), PERF_PALETTE)}

          <h3 className="settings-title">{t("Faixas")}</h3>
          <Setting
            id="perf-fps-good"
            label={t("FPS bom a partir de")}
            hint={t("Acima disso o número fica na cor de “bom”")}
            value={`${config.fpsGood} FPS`}
            onStep={(d) => set({ fpsGood: cycle(PERF_FPS_GOOD, Math.max(0, indexOf(PERF_FPS_GOOD, config.fpsGood)), d) })}
          />
          <Setting
            id="perf-fps-warn"
            label={t("FPS aceitável a partir de")}
            hint={t("Abaixo disso o número fica na cor de “ruim”")}
            value={`${config.fpsWarn} FPS`}
            onStep={(d) => set({ fpsWarn: cycle(PERF_FPS_WARN, Math.max(0, indexOf(PERF_FPS_WARN, config.fpsWarn)), d) })}
          />
          <Setting
            id="perf-temp-warn"
            label={t("Temperatura de atenção")}
            value={`${config.tempWarn} °C`}
            onStep={(d) => set({ tempWarn: cycle(PERF_TEMP_WARN, Math.max(0, indexOf(PERF_TEMP_WARN, config.tempWarn)), d) })}
          />
          <Setting
            id="perf-temp-hot"
            label={t("Temperatura crítica")}
            value={`${config.tempHot} °C`}
            onStep={(d) => set({ tempHot: cycle(PERF_TEMP_HOT, Math.max(0, indexOf(PERF_TEMP_HOT, config.tempHot)), d) })}
          />
            </>
          )}

          <ActionRow id="perf-back" onPress={back}>{t("Voltar")}</ActionRow>
        </FocusGroup>

        <aside className="settings-preview" aria-label={t("Prévia ao vivo")}>
          <PerfPreview snapshot={snapshot} />
          <section className="perf-status">
            <h2>{t("Medição")}</h2>
            <p className={capture.warn ? "account-warn" : "account-ok"}>{capture.text}</p>
            <p>{t("Mede jogos em DirectX 9, 10, 11 e 12. Jogos em Vulkan e OpenGL ainda não aparecem.")}</p>
            {snapshot && (
              <p>
                {snapshot.hw.cpu.shortName}
                {snapshot.hw.gpu.shortName ? ` · ${snapshot.hw.gpu.shortName}` : ""}
              </p>
            )}
          </section>
        </aside>
      </div>
      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "LR", label: "Ajustar" }, { btn: "LB", label: "Página anterior" }, { btn: "RB", label: "Próxima página" }, { btn: "B", label: "Voltar" }]} />

      {confirmReset && (
        <ConfirmDialog
          title={t("Restaurar o contador de FPS?")}
          message={t("Posição, itens, cores e faixas voltam ao padrão.")}
          confirmLabel={t("Restaurar")}
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            usePerf.getState().reset();
          }}
        />
      )}
    </div>
  );
}
