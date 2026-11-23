import { useEffect, useRef, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { locale, t } from "../i18n";
import { onAction, type Action } from "../input/actions";
import { useUI } from "../store/ui";

// Nomes dos botões no mapeamento "standard" (Xbox/XInput), na ordem dos índices.
const NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Select", "Start", "L3", "R3", "↑", "↓", "←", "→", "Guia"];

interface PadInfo {
  index: number;
  id: string;
  mapping: string;
  pressed: number[];
  axes: number[];
}

/**
 * Diagnóstico do controle: mostra, ao vivo, o que o app recebe (botões apertados, mapeamento) e a ação que
 * cada aperto gera. Serve para descobrir por que um botão não responde (controle diferente, mapeamento
 * não padrão, janela sem foco, atalho global bloqueado por um menu aberto...).
 */
export function GamepadTest() {
  const [pads, setPads] = useState<PadInfo[]>([]);
  const [log, setLog] = useState<{ t: string; action: Action }[]>([]);
  const [modalOpen, setModalOpen] = useState(useUI.getState().modalOpen);
  const [focused, setFocused] = useState(document.hasFocus());
  const raf = useRef(0);

  useEffect(() => {
    const loop = () => {
      const list: PadInfo[] = [];
      for (const p of navigator.getGamepads()) {
        if (!p) continue;
        list.push({
          index: p.index,
          id: p.id,
          mapping: p.mapping || t("(não padrão)"),
          pressed: p.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0),
          axes: p.axes.map((a) => Math.round(a * 100) / 100),
        });
      }
      setPads(list);
      setModalOpen(useUI.getState().modalOpen);
      setFocused(document.hasFocus());
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  // Cada ação que o app gera a partir do controle ou do teclado.
  useEffect(
    () =>
      onAction((action) => {
        const t = new Date().toLocaleTimeString(locale(), { hour12: false });
        setLog((l) => [{ t, action }, ...l].slice(0, 10));
      }),
    [],
  );

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Testar controle")} />
      <div className="gp-wrap">
        <section className="gp-card">
          <h3>{t("Estado do app")}</h3>
          <p>{t("Janela com foco:")} <b className={focused ? "gp-ok" : "gp-bad"}>{focused ? t("sim") : t("NÃO (o controle não chega ao app)")}</b></p>
          <p>{t("Menu ou diálogo aberto:")} <b className={modalOpen ? "gp-bad" : "gp-ok"}>{modalOpen ? t("SIM (bloqueia X, Start, Select e B)") : t("não")}</b></p>
        </section>

        {pads.length === 0 ? (
          <section className="gp-card">
            <h3>{t("Nenhum controle detectado")}</h3>
            <p>{t("Aperte qualquer botão do controle. Se nada aparecer, o app não está vendo o controle.")}</p>
          </section>
        ) : (
          pads.map((p) => (
            <section className="gp-card" key={p.index}>
              <h3>{t("Controle {n}", { n: p.index + 1 })}</h3>
              <p className="gp-id">{p.id}</p>
              <p>{t("Mapeamento:")} <b className={p.mapping === "standard" ? "gp-ok" : "gp-bad"}>{p.mapping}</b></p>
              <div className="gp-buttons">
                {NAMES.map((n, i) => (
                  <span key={n} className={`gp-btn ${p.pressed.includes(i) ? "on" : ""}`}>{n}<small>{i}</small></span>
                ))}
              </div>
              <p className="gp-id">{t("Botões apertados (índices):")} {p.pressed.length ? p.pressed.join(", ") : "—"} · {t("Analógicos:")} {p.axes.slice(0, 4).join(" / ")}</p>
            </section>
          ))
        )}

        <section className="gp-card">
          <h3>{t("Ações geradas (mais recente primeiro)")}</h3>
          {log.length === 0 ? <p>{t("Aperte botões para ver as ações aparecerem aqui.")}</p> : <p className="gp-log">{log.map((l, i) => <span key={i}><i>{l.t}</i> {l.action}</span>)}</p>}
        </section>
      </div>
      <Hints items={[{ btn: "B", label: "Voltar" }]} />
    </div>
  );
}
