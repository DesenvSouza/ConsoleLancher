import { useEffect, useId, useRef } from "react";
import { useModal } from "../hooks/useModal";
import { t } from "../i18n";
import { onAction } from "../input/actions";
import { Hints } from "./Chrome";
import { FocusGroup, Focusable } from "./Focusable";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  /** Texto do botão de cancelar (padrão: "Cancelar"). */
  cancelLabel?: string;
  /** Prefixo das chaves de foco: dois diálogos abertos ao mesmo tempo (ex.: a contagem do desligamento por cima de outro) não podem dividir as mesmas. */
  prefix?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Diálogo de confirmação: o foco fica preso nele e B cancela. */
// Pilha dos diálogos abertos: o B e o foco só valem para o que está por cima (o último a abrir).
const openDialogs: symbol[] = [];

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = t("Cancelar"), prefix = "dialog", danger, onConfirm, onCancel }: Props) {
  const dialogId = useId();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const self = useRef(Symbol("dialog"));

  useModal(`${prefix}-cancel`);
  useEffect(() => {
    const mine = self.current;
    openDialogs.push(mine);
    const off = onAction((a) => {
      if (a === "back" && openDialogs[openDialogs.length - 1] === mine) cancelRef.current();
    });
    return () => {
      off();
      const at = openDialogs.indexOf(mine);
      if (at >= 0) openDialogs.splice(at, 1);
    };
  }, []);

  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-message`}>
      <FocusGroup focusKey={prefix} className="dialog" boundary preferredChildFocusKey={`${prefix}-cancel`}>
        <h2 id={`${dialogId}-title`}>{title}</h2>
        <p id={`${dialogId}-message`}>{message}</p>
        <div className="dialog-actions">
          <Focusable focusKey={`${prefix}-cancel`} className="btn" onPress={onCancel} scroll={false}>
            {cancelLabel}
          </Focusable>
          <Focusable focusKey={`${prefix}-ok`} className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onPress={onConfirm} scroll={false}>
            {confirmLabel}
          </Focusable>
        </div>
      </FocusGroup>
      <Hints modal items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Cancelar" }]} />
    </div>
  );
}
