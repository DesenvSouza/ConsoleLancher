import type { ReactNode } from "react";
import { Focusable } from "./Focusable";

interface SettingProps {
  id: string;
  label: string;
  value: string;
  /** ← chama com -1 e → chama com +1. */
  onStep: (dir: 1 | -1) => void;
  /** Se true, o botão A também avança (listas de opções). Em números, o A não faz nada. */
  cycle?: boolean;
}

/** Linha de ajuste: ← diminui e → aumenta, sem sair da linha. */
export function Setting({ id, label, value, onStep, cycle }: SettingProps) {
  return (
    <Focusable focusKey={`set-${id}`} className="setting" onAdjust={onStep} onPress={cycle ? () => onStep(1) : undefined}>
      <span>{label}</span>
      <span className="setting-value">‹ {value} ›</span>
    </Focusable>
  );
}

/** Linha de ação (abre outra tela, executa algo). */
export function ActionRow({ id, children, onPress, danger, arrow }: { id: string; children: ReactNode; onPress: () => void; danger?: boolean; arrow?: boolean }) {
  return (
    <Focusable focusKey={`set-${id}`} className={`setting ${danger ? "setting-danger" : ""}`} onPress={onPress}>
      <span>{children}</span>
      {arrow && <span className="setting-value">›</span>}
    </Focusable>
  );
}
