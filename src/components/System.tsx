import { useEffect, type ReactNode } from "react";
import { BluetoothPanel, WifiPanel } from "./SystemWireless";
import { playSound } from "../audio/sounds";
import { useModal } from "../hooks/useModal";
import { formatNumber, locale, t } from "../i18n";
import { onAction } from "../input/actions";
import type { PadBattery, SystemNetwork, SystemStatus } from "../lib/api";
import { batteryText, useSystem, useSystemPolling } from "../store/system";
import { useTopIcons } from "../store/topIcons";
import { Clock, Hints } from "./Chrome";
import { FocusGroup, Focusable } from "./Focusable";
import { useInPreview } from "./preview/context";

// ───────── Ícones (desenhados com a cor do texto) ─────────

function Svg({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>;
}

function VolumeIcon({ percent, muted }: { percent: number; muted: boolean }) {
  return (
    <Svg>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      {muted || percent === 0 ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : (
        <>
          <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
          {percent > 50 && <path d="M18 7a7 7 0 0 1 0 10" />}
        </>
      )}
    </Svg>
  );
}

export function NetworkIcon({ network }: { network: SystemNetwork }) {
  if (network.kind === "wired") {
    // Como o ícone de rede por cabo do Windows: computador à esquerda e, ao lado, o plugue com o cabo descendo.
    return <Svg><path d="M13.5 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8" /><path d="M8.5 16v3.5M5.5 19.5h8" /><rect x="15.5" y="4" width="5" height="6.5" rx="1" /><path d="M18 10.5V20" /></Svg>;
  }
  const bars = network.kind === "none" ? 0 : Math.max(1, Math.ceil(network.signal / 34));
  return (
    <Svg>
      <path d="M2.5 9a14 14 0 0 1 19 0" opacity={bars >= 3 ? 1 : 0.3} />
      <path d="M5.5 12.5a9.5 9.5 0 0 1 13 0" opacity={bars >= 2 ? 1 : 0.3} />
      <path d="M8.7 16a5 5 0 0 1 6.6 0" opacity={bars >= 1 ? 1 : 0.3} />
      <circle cx="12" cy="19.2" r="1.1" fill="currentColor" />
      {network.kind === "none" && <path d="M4 4l16 16" />}
    </Svg>
  );
}

function BluetoothIcon() {
  return <Svg><path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9" /></Svg>;
}

/** Controle de videogame (a bateria aparece pela cor e pelo texto, não pelo desenho). */
function PadIcon() {
  return (
    <Svg>
      <path d="M6.5 8h11a4 4 0 0 1 3.9 4.9l-.8 3.6a2.2 2.2 0 0 1-3.9.7L15 15.5H9l-1.7 1.7a2.2 2.2 0 0 1-3.9-.7l-.8-3.6A4 4 0 0 1 6.5 8z" />
      <path d="M8 10.5v3M6.5 12h3M15.5 11.2h.01M17.6 12.8h.01" />
    </Svg>
  );
}

// ───────── Textos ─────────

function networkText(network: SystemNetwork): string {
  const base = network.kind === "wifi" ? t("Wi-Fi: {name}", { name: network.name }) : network.kind === "wired" ? t("Cabo de rede") : t("Sem conexão com a rede");
  return network.kind !== "none" && !network.internet ? t("{network} · sem internet", { network: base }) : base;
}

/** O controle sem fio com a bateria mais fraca (os com fio não têm o que avisar). */
function weakestPad(status: SystemStatus) {
  const order: PadBattery[] = ["empty", "low", "medium", "unknown", "full"];
  return status.pads.filter((p) => p.battery !== "wired").sort((a, b) => order.indexOf(a.battery) - order.indexOf(b.battery))[0];
}

// ───────── Indicadores ao lado do relógio ─────────

/**
 * Volume, rede e bateria do controle ao lado do relógio, com a engrenagem que abre o painel "Sistema". Sem a barra de
 * tarefas do Windows (modo console), é aqui que o jogador vê se está no mudo ou sem rede. Na prévia vira só desenho.
 */
export function SystemIndicators() {
  const preview = useInPreview();
  useSystemPolling(5000);
  const status = useSystem((s) => s.status);
  const openPanel = useSystem((s) => s.openPanel);
  const shown = useTopIcons((s) => s.shown);

  const volume = shown.volume ? status?.volume : undefined;
  const silent = !!volume && (volume.muted || volume.percent === 0);
  const pad = status && shown.controller ? weakestPad(status) : undefined;
  const padWarn = pad?.battery === "empty" || pad?.battery === "low";
  const content = (
    <>
      {volume && (
        <span className={`sys-ind ${silent ? "warn" : ""}`}>
          <VolumeIcon percent={volume.percent} muted={volume.muted} />
          {silent ? t("Mudo") : `${volume.percent}%`}
        </span>
      )}
      {status && shown.network && (
        <span className={`sys-ind ${status.network.kind === "none" || !status.network.internet ? "warn" : ""}`}>
          <NetworkIcon network={status.network} />
        </span>
      )}
      {status?.bluetooth.adapter && shown.bluetooth && (
        <span className={`sys-ind ${status.bluetooth.connected > 0 ? "" : "sys-dim"}`}>
          <BluetoothIcon />
          {status.bluetooth.connected > 0 && status.bluetooth.connected}
        </span>
      )}
      {pad && <span className={`sys-ind ${padWarn ? "warn" : ""}`}><PadIcon /></span>}
    </>
  );

  // Nenhum ícone escolhido (ou nada para mostrar ainda): fica só a entrada "Sistema", para o painel não depender do menu Guia.
  if (!volume && !pad && !(status && shown.network) && !(status?.bluetooth.adapter && shown.bluetooth)) {
    if (preview) return null;
    return (
      <Focusable focusKey="topbar-system" className="sys-indicators" scroll={false} label={t("Abrir Sistema")} onPress={() => { openPanel(); }}>
        <span className="sys-ind">{t("Sistema")}</span>
      </Focusable>
    );
  }
  if (preview) return <div className="sys-indicators">{content}</div>;
  return (
    <Focusable focusKey="topbar-system" className="sys-indicators" scroll={false} onPress={() => { openPanel(); }}>
      {content}
    </Focusable>
  );
}

// ───────── Controles (painel e menu Guia) ─────────

function VolumeBar({ percent, muted }: { percent: number; muted: boolean }) {
  return <span className={`sys-bar ${muted ? "muted" : ""}`} aria-hidden><i style={{ width: `${muted ? 0 : percent}%` }} /></span>;
}

/**
 * As linhas de controle: volume (← → ajustam, A silencia), saída de áudio (← → ou A trocam) e, só para ler, rede e
 * bateria do controle. Serve ao painel do launcher e ao menu Guia (`prefix` mantém as chaves de foco separadas).
 */
export function SystemControls({ prefix, compact, onFocusRow }: { prefix: string; compact?: boolean; onFocusRow?: (key: string) => void }) {
  const status = useSystem((s) => s.status);
  const { stepVolume, toggleMute, stepOutput, openSubpanel } = useSystem.getState();

  if (!status) return <p className="sys-info" role="status">{t("Carregando…")}</p>;
  const { volume, outputs, network, bluetooth, pads } = status;
  const current = outputs.find((o) => o.current);

  return (
    <>
      {volume ? (
        <Focusable focusKey={`${prefix}-volume`} className="sys-row" scroll={false} onFocus={() => onFocusRow?.(`${prefix}-volume`)} onAdjust={(d) => stepVolume(d)} onPress={toggleMute}>
          <span className="sys-label">
            {t("Volume")}
            <small>{t("Esquerda e direita ajustam · A silencia")}</small>
          </span>
          <span className={`sys-value ${volume.muted || volume.percent === 0 ? "warn" : ""}`}>
            <VolumeBar percent={volume.percent} muted={volume.muted} />
            {volume.muted ? t("Mudo") : `${formatNumber(volume.percent)}%`}
          </span>
        </Focusable>
      ) : (
        <p className="sys-info warn" role="status">{t("Nenhuma saída de áudio disponível.")}</p>
      )}

      {outputs.length > 0 && (
        <Focusable focusKey={`${prefix}-output`} className="sys-row" scroll={false} onFocus={() => onFocusRow?.(`${prefix}-output`)} onAdjust={stepOutput} onPress={() => stepOutput(1)}>
          <span className="sys-label">
            {t("Saída de áudio")}
            {outputs.length > 1 && <small>{t("Esquerda e direita (ou A) trocam")}</small>}
          </span>
          <span className="sys-value sys-device">{current?.name ?? "—"}</span>
        </Focusable>
      )}

      {!compact && (
        <>
          {network.wifiAdapter && (
            <Focusable focusKey={`${prefix}-wifi`} className="sys-row" scroll={false} onPress={() => openSubpanel("wifi")}>
              <span className="sys-label">
                {t("Wi-Fi")}
                <small>{t("Conectar a uma rede sem fio")}</small>
              </span>
              <span className="sys-value">{network.kind === "wifi" ? network.name : ""} ›</span>
            </Focusable>
          )}
          {bluetooth.adapter && (
            <Focusable focusKey={`${prefix}-bluetooth`} className="sys-row" scroll={false} onPress={() => openSubpanel("bluetooth")}>
              <span className="sys-label">
                {t("Bluetooth")}
                <small>{t("Fones, controles e outros dispositivos")}</small>
              </span>
              <span className="sys-value">{bluetooth.connected > 0 ? `${t("Conectado")} · ${bluetooth.connected}` : ""} ›</span>
            </Focusable>
          )}
          <p className={`sys-info ${network.kind === "none" || !network.internet ? "warn" : ""}`}>
            <span className="sys-ind"><NetworkIcon network={network} /></span>
            {networkText(network)}
            {network.kind === "wifi" && ` · ${formatNumber(network.signal)}%`}
          </p>
          {pads.map((pad) => (
            <p key={pad.number} className={`sys-info ${pad.battery === "empty" || pad.battery === "low" ? "warn" : ""}`}>
              <span className="sys-ind"><PadIcon /></span>
              {t("Controle {number}: {battery}", { number: pad.number, battery: batteryText(pad.battery) })}
            </p>
          ))}
        </>
      )}
    </>
  );
}

/** Painel "Sistema" e as telas de Wi-Fi e Bluetooth que abrem de dentro dele. */
export function SystemPanels() {
  const subpanel = useSystem((s) => s.subpanel);
  if (subpanel === "wifi") return <WifiPanel />;
  if (subpanel === "bluetooth") return <BluetoothPanel />;
  return <SystemPanel />;
}

/** Painel "Sistema" da janela principal: abre pelo conjunto de ícones ao lado do relógio. B fecha. */
function SystemPanel() {
  const close = useSystem((s) => s.closePanel);
  const returnFocus = useSystem((s) => s.returnFocus);
  useSystemPolling(2000);
  useModal(returnFocus ?? "sys-volume");
  useEffect(() => onAction((a) => {
    if (a !== "back") return;
    playSound("back");
    close();
  }), [close]);

  return (
    <div className="overlay">
      <FocusGroup focusKey="sys" className="menu sys-menu" boundary preferredChildFocusKey="sys-volume">
        <div className="menu-head">
          <div>
            <h2>{t("Sistema")}</h2>
            <p>
              {new Date().toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })} · <Clock />
            </p>
          </div>
        </div>
        <SystemControls prefix="sys" />
      </FocusGroup>
      <Hints modal items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Fechar" }]} />
    </div>
  );
}
