import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";
import { onAction } from "../input/actions";
import { useUI } from "../store/ui";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Se uma tela falhar ao ser desenhada, mostra o erro e deixa voltar (B), em vez de deixar a tela inteira preta.
 * O App a recria a cada tela (pela `key`), então navegar já a limpa.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  private stop?: () => void;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Falha ao desenhar a tela", error, info.componentStack); // i18n-ignore
    // B volta para a tela anterior (ou para o início, se não houver).
    this.stop?.();
    this.stop = onAction((action) => {
      if (action !== "back" && action !== "confirm") return;
      const ui = useUI.getState();
      if (ui.history.length > 0) ui.back();
      else ui.navigate({ name: "home" });
    });
  }

  componentWillUnmount() {
    this.stop?.();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="screen">
        <div className="empty-state">
          <h2>{t("Algo deu errado nesta tela")}</h2>
          <p>{t("Aperte B para voltar. Se continuar, reinicie o launcher.")}</p>
          <p className="empty-hint">{this.state.error.message}</p>
        </div>
      </div>
    );
  }
}
