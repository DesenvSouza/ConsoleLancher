import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useRef, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup } from "../components/Focusable";
import { Setting } from "../components/Setting";
import { te, t } from "../i18n";
import { api, type StartupStatus } from "../lib/api";
import { useUI } from "../store/ui";

const first = "set-startup-autostart";

/** Abrir o launcher ao entrar no Windows e, para quem quer um console de verdade, o "modo console" (sem Explorer). */
export function StartupSettings() {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmConsole, setConfirmConsole] = useState(false);
  const saving = useRef(false);
  const loaded = status !== null;

  useEffect(() => {
    let active = true;
    void api.startupStatus().then((s) => {
      if (active) setStatus(s);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loaded) setFocus(first);
  }, [loaded]);

  async function change(run: () => Promise<StartupStatus>) {
    if (saving.current) return;
    saving.current = true;
    try {
      setStatus(await run());
    } catch (error) {
      useUI.getState().showToast(te(error), "warning");
    } finally {
      saving.current = false;
    }
  }

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Inicialização com o Windows")} />
      <FocusGroup focusKey="startup-settings" className="settings-list settings-page" preferredChildFocusKey={first} disabled={!loaded}>
        {status ? (
          <>
            <h3 className="settings-title">{t("Ao ligar o PC")}</h3>
            <Setting
              cycle
              id="startup-autostart"
              label={t("Abrir o launcher ao entrar no Windows")}
              hint={t("O launcher abre sozinho quando você entra no Windows. A área de trabalho continua existindo por baixo.")}
              value={status.autostart ? t("Ligado") : t("Desligado")}
              onStep={() => void change(() => api.setAutostart(!status.autostart))}
            />

            <h3 className="settings-title">{t("Modo console")}</h3>
            <Setting
              cycle
              id="startup-console"
              badge={t("Recomendado")}
              label={t("Modo console")}
              hint={t("O Windows entra direto no launcher, sem área de trabalho, barra de tarefas nem menu Iniciar")}
              value={status.console ? t("Ativado") : t("Desativado")}
              onStep={() => (status.console ? void change(() => api.setConsoleMode(false)) : setConfirmConsole(true))}
            />

            {import.meta.env.DEV && !status.available && <p className="account-note startup-warn" role="status">{t("Disponível só no launcher instalado, não no modo de desenvolvimento.")}</p>}
            <p className="account-note">{t("Só uma das duas fica ligada: ligar uma desliga a outra.")}</p>
            {status.consoleActive && <p className="account-note" role="status">{t("O launcher está funcionando como área de trabalho agora.")}</p>}
            {status.console && !status.consoleActive && <p className="account-note" role="status">{t("Modo console ativado: vale a partir da próxima vez que você entrar no Windows.")}</p>}
            <p className="account-note startup-warn">{t("Atenção: é um recurso avançado. Sem a área de trabalho, o Windows não mostra barra de tarefas, menu Iniciar, relógio nem ícones da bandeja, e os programas da inicialização do Windows não abrem (o launcher abre a Steam sozinho). Vale só para este usuário do Windows.")}</p>
            <p className="account-note">{t("Proteções: se o launcher fechar ou travar, ele reabre sozinho; se falhar 3 vezes seguidas, a área de trabalho volta. Em Sair para a área de trabalho, o Explorer é aberto antes de o launcher fechar.")}</p>
            <p className="account-note">{t("Se algo der errado: Ctrl+Alt+Del › Gerenciador de Tarefas › Executar nova tarefa › digite explorer. Para desfazer de vez, desligue o modo console aqui ou execute o arquivo {path}.", { path: status.restoreScript })}</p>
          </>
        ) : (
          <p role="status">{loadFailed ? t("Não foi possível ler estas opções.") : t("Carregando opções…")}</p>
        )}
      </FocusGroup>
      <Hints items={[{ btn: "A", label: "Alternar" }, { btn: "B", label: "Voltar" }]} />

      {confirmConsole && (
        <ConfirmDialog
          title={t("Ativar o modo console?")}
          message={t("Na próxima vez que você entrar no Windows, o launcher ocupará o lugar da área de trabalho: sem barra de tarefas, menu Iniciar nem bandeja. Se o launcher fechar ou travar, ele reabre sozinho, e Sair para a área de trabalho sempre traz o Windows de volta. Vale só para este usuário.")}
          confirmLabel={t("Ativar modo console")}
          danger
          onCancel={() => setConfirmConsole(false)}
          onConfirm={() => {
            setConfirmConsole(false);
            void change(() => api.setConsoleMode(true));
          }}
        />
      )}
    </div>
  );
}
