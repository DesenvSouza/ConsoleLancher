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
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Diálogo de confirmação: o foco fica preso nele e B cancela. */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = t("Cancelar"), danger, onConfirm, onCancel }: Props) {
  const dialogId = useId();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useModal("dialog-cancel");
  useEffect(() => onAction((a) => a === "back" && cancelRef.current()), []);

  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-message`}>
      <FocusGroup focusKey="dialog" className="dialog" boundary preferredChildFocusKey="dialog-cancel">
        <h2 id={`${dialogId}-title`}>{title}</h2>
        <p id={`${dialogId}-message`}>{message}</p>
        <div className="dialog-actions">
          <Focusable focusKey="dialog-cancel" className="btn" onPress={onCancel} scroll={false}>
            {cancelLabel}
          </Focusable>
          <Focusable focusKey="dialog-ok" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onPress={onConfirm} scroll={false}>
            {confirmLabel}
          </Focusable>
        </div>
      </FocusGroup>
      <Hints modal items={[{ btn: "A", label: "Confirmar" }, { btn: "B", label: "Cancelar" }]} />
    </div>
  );
}
