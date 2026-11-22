import { useCallback, useEffect, useRef, useState } from "react";
import { useModal } from "../hooks/useModal";
import { onAction, setTextCapture } from "../input/actions";
import { api } from "../lib/api";
import { ButtonGlyph } from "./Chrome";
import { FocusGroup, Focusable } from "./Focusable";

interface Props {
  title: string;
  hint?: string;
  placeholder?: string;
  initial?: string;
  maxLength?: number;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

/**
 * Teclado na tela para o controle. A coloca o caractere, B cancela, X apaga, Y espaço,
 * LB alterna maiúsculas, RB cola o texto copiado no PC, LT limpa tudo, Start confirma.
 * O teclado físico também funciona (digitar, Backspace, Enter, Esc, Ctrl+V).
 */
export function OnScreenKeyboard({ title, hint, placeholder, initial = "", maxLength = 64, confirmLabel = "Confirmar", onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const [shift, setShift] = useState(false);

  const submitRef = useRef(onSubmit);
  const cancelRef = useRef(onCancel);
  const valueRef = useRef(value);
  submitRef.current = onSubmit;
  cancelRef.current = onCancel;
  valueRef.current = value;

  const add = useCallback((s: string) => setValue((v) => (v + s).slice(0, maxLength)), [maxLength]);
  const del = useCallback(() => setValue((v) => v.slice(0, -1)), []);
  const submit = useCallback(() => submitRef.current(valueRef.current.trim()), []);
  const paste = useCallback(async () => {
    const text = (await api.readClipboard()).trim();
    if (text) setValue(text.slice(0, maxLength)); // colar substitui o que já foi digitado
  }, [maxLength]);

  useModal("kb-paste");

  // Botões do controle.
  useEffect(
    () =>
      onAction((a) => {
        if (a === "back") cancelRef.current();
        else if (a === "x") del();
        else if (a === "y") add(" ");
        else if (a === "lb") setShift((s) => !s);
        else if (a === "rb") void paste();
        else if (a === "lt") setValue("");
        else if (a === "start") submit();
      }),
    [add, del, submit, paste],
  );

  // Teclado físico: enquanto o teclado virtual está aberto, os atalhos globais ficam desligados
  // (senão "x", Backspace etc. virariam botões do controle).
  useEffect(() => {
    setTextCapture(true);
    return () => setTextCapture(false);
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const stop = () => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      };
      if (ev.ctrlKey && ev.key.toLowerCase() === "v") return stop(), void paste();
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === "Backspace") return stop(), del();
      if (ev.key === "Enter") return stop(), submit();
      if (ev.key === "Escape") return stop(), cancelRef.current();
      if (ev.key.length === 1) return stop(), add(ev.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [add, del, submit, paste]);

  const show = (c: string) => (shift ? c.toUpperCase() : c);

  return (
    <div className="overlay">
      <FocusGroup focusKey="kb" className="kb" boundary preferredChildFocusKey="kb-paste">
        <h2>{title}</h2>
        {hint && <p className="kb-hint">{hint}</p>}

        <div className="kb-display" aria-live="polite">
          {value ? <span className="kb-value">{value}</span> : <span className="kb-placeholder">{placeholder ?? "Digite aqui"}</span>}
          <span className="kb-caret" />
          <span className="kb-count">{value.length}/{maxLength}</span>
        </div>

        {ROWS.map((row, r) => (
          <div className="kb-row" key={row}>
            {[...row].map((c, i) => (
              <Focusable key={c} focusKey={`kb-${r}-${i}`} className="kb-key" scroll={false} onPress={() => add(show(c))}>
                {show(c)}
              </Focusable>
            ))}
          </div>
        ))}

        <div className="kb-row">
          <Focusable focusKey="kb-shift" className={`kb-key kb-wide ${shift ? "kb-on" : ""}`} scroll={false} onPress={() => setShift((s) => !s)}><ButtonGlyph btn="LB" />⇧ Maiúsc.</Focusable>
          <Focusable focusKey="kb-space" className="kb-key kb-space" scroll={false} onPress={() => add(" ")}><ButtonGlyph btn="Y" />Espaço</Focusable>
          <Focusable focusKey="kb-back" className="kb-key kb-wide" scroll={false} onPress={del}><ButtonGlyph btn="X" />⌫ Apagar</Focusable>
          <Focusable focusKey="kb-paste" className="kb-key kb-wide" scroll={false} onPress={() => void paste()}><ButtonGlyph btn="RB" />Colar</Focusable>
          <Focusable focusKey="kb-clear" className="kb-key kb-wide" scroll={false} onPress={() => setValue("")}><ButtonGlyph btn="LT" />Limpar</Focusable>
        </div>

        <div className="kb-actions">
          <Focusable focusKey="kb-cancel" className="btn" scroll={false} onPress={onCancel}><ButtonGlyph btn="B" />Cancelar</Focusable>
          <Focusable focusKey="kb-ok" className="btn btn-primary" scroll={false} onPress={submit}><ButtonGlyph btn="Start" />{confirmLabel}</Focusable>
        </div>

        <p className="kb-legend">X apagar · Y espaço · LB maiúsculas · RB colar · LT limpar · Start confirmar · B cancelar</p>
      </FocusGroup>
    </div>
  );
}
