import type { ReactNode } from "react";
import { Focusable } from "./Focusable";

interface SettingProps {
  id: string;
  label: string;
  /** Frase curta, em letra menor, explicando o que a linha faz. */
  hint?: string;
  value: string;
  /** ← chama com -1 e → chama com +1. */
  onStep: (dir: 1 | -1) => void;
  /** Se true, o botão A também avança (listas de opções). Em números, o A não faz nada. */
  cycle?: boolean;
  onFocus?: () => void;
}

/** Rótulo da linha, com a explicação por baixo quando há. */
function Label({ label, hint }: { label: ReactNode; hint?: string }) {
  if (!hint) return <span>{label}</span>;
  return (
    <span className="setting-text">
      <span>{label}</span>
      <small className="setting-hint">{hint}</small>
    </span>
  );
}

/** Linha de ajuste: ← diminui e → aumenta, sem sair da linha. */
export function Setting({ id, label, hint, value, onStep, cycle, onFocus }: SettingProps) {
  return (
    <Focusable focusKey={`set-${id}`} className="setting" onFocus={onFocus} onAdjust={onStep} onPress={cycle ? () => onStep(1) : undefined}>
      <Label label={label} hint={hint} />
      <span className="setting-value">‹ {value} ›</span>
    </Focusable>
  );
}

interface ActionRowProps {
  id: string;
  /** O rótulo pode vir como `label` ou como filho (uso antigo). */
  label?: string;
  children?: ReactNode;
  hint?: string;
  /** Texto à direita (ex.: resumo da conta). */
  value?: string;
  onPress: () => void;
  onFocus?: () => void;
  danger?: boolean;
  arrow?: boolean;
}

/** Linha de ação (abre outra tela, executa algo). */
export function ActionRow({ id, label, children, hint, value, onPress, onFocus, danger, arrow }: ActionRowProps) {
  return (
    <Focusable focusKey={`set-${id}`} className={`setting ${danger ? "setting-danger" : ""}`} onFocus={onFocus} onPress={onPress}>
      <Label label={label ?? children} hint={hint} />
      {(value || arrow) && <span className="setting-value">{value}{value && arrow ? "  " : ""}{arrow ? "›" : ""}</span>}
    </Focusable>
  );
}
