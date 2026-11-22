import { useEffect, useRef } from "react";
import { useModal } from "../hooks/useModal";
import { onAction } from "../input/actions";
import { FocusGroup, Focusable } from "./Focusable";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Diálogo de confirmação: o foco fica preso nele e B cancela. */
export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: Props) {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useModal("dialog-cancel");
  useEffect(() => onAction((a) => a === "back" && cancelRef.current()), []);

  return (
    <div className="overlay">
      <FocusGroup focusKey="dialog" className="dialog" boundary preferredChildFocusKey="dialog-cancel">
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          <Focusable focusKey="dialog-cancel" className="btn" onPress={onCancel} scroll={false}>
            Cancelar
          </Focusable>
          <Focusable focusKey="dialog-ok" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onPress={onConfirm} scroll={false}>
            {confirmLabel}
          </Focusable>
        </div>
      </FocusGroup>
    </div>
  );
}
