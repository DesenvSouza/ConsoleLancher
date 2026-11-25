import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useRef, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup } from "../components/Focusable";
import { ActionRow, Setting } from "../components/Setting";
import { te, t } from "../i18n";
import { api, type StartupStatus } from "../lib/api";
import { restartBlocker, useRestart } from "../store/restart";
import { useUI } from "../store/ui";

const first = "set-startup-autostart";

/** Abrir o launcher ao entrar no Windows e, para quem quer um console de verdade, o "modo console" (sem Explorer). */
export function StartupSettings() {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmConsole, setConfirmConsole] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const saving = useRef(false);
  const loaded = status !== null;

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    const late = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 8000));
    void Promise.race([api.startupStatus(), late]).then((s) => {
      if (!active) return;
      if (typeof s?.autostart === "boolean") setStatus(s);
      else setLoadFailed(true);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (loaded) setFocus(first);
    else if (loadFailed) setFocus("set-startup-retry");
  }, [loaded, loadFailed]);

  /** Abre uma confirmação que termina em reinicialização, ou diz por que não dá para reiniciar agora. */
  function askForRestart(open: () => void) {
    const blocker = restartBlocker();
    if (blocker) useUI.getState().showToast(t(blocker), "warning");
    else open();
  }

  async function change(run: () => Promise<StartupStatus>): Promise<StartupStatus | undefined> {
    if (saving.current) return;
    saving.current = true;
    try {
      const next = await run();
      setStatus(next);
      return next;
    } catch (error) {
      useUI.getState().showToast(te(error), "warning");
    } finally {
      saving.current = false;
    }
  }

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Inicialização com o Windows")} />
      <FocusGroup focusKey="startup-settings" className="settings-list settings-page" preferredChildFocusKey={first} disabled={!loaded && !loadFailed}>
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
              hint={t("O Windows entra direto no launcher, sem área de trabalho. Ativar exige reiniciar o PC")}
              value={status.console ? t("Ativado") : t("Desativado")}
              onStep={() => (status.console ? void change(() => api.setConsoleMode(false)) : askForRestart(() => setConfirmConsole(true)))}
            />

            {import.meta.env.DEV && !status.available && <p className="account-note startup-warn" role="status">{t("Disponível só no launcher instalado, não no modo de desenvolvimento.")}</p>}
            <p className="account-note">{t("Só uma das duas fica ligada: ligar uma desliga a outra.")}</p>
            {status.consoleActive && <p className="account-note" role="status">{t("O launcher está funcionando como área de trabalho agora.")}</p>}
            {status.console && !status.consoleActive && (
              <>
                <p className="account-note startup-warn" role="status">{t("Modo console ativado: ele só vale depois que o PC for reiniciado.")}</p>
                <ActionRow id="startup-restart" label={t("Reiniciar o PC agora")} onPress={() => askForRestart(() => setConfirmRestart(true))} />
              </>
            )}
            <p className="account-note startup-warn">{t("Atenção: é um recurso avançado. Sem a área de trabalho, o Windows não mostra barra de tarefas, menu Iniciar, relógio nem ícones da bandeja, e os programas da inicialização do Windows não abrem (o launcher abre a Steam sozinho). Vale só para este usuário do Windows.")}</p>
            <p className="account-note">{t("Proteções: se o launcher fechar ou travar, ele reabre sozinho; se falhar 3 vezes seguidas, a área de trabalho volta. Em Sair para a área de trabalho, o Explorer é aberto antes de o launcher fechar.")}</p>
            <p className="account-note">{t("Se algo der errado: Ctrl+Alt+Del › Gerenciador de Tarefas › Executar nova tarefa › digite explorer. Para desfazer de vez, desligue o modo console aqui ou execute o arquivo {path}.", { path: status.restoreScript })}</p>
          </>
        ) : (
          loadFailed ? (
            <>
              <p className="account-note startup-warn" role="alert">{t("Não foi possível ler as opções de inicialização. Nada foi alterado.")}</p>
              <ActionRow id="startup-retry" label={t("Tentar de novo")} onPress={() => setAttempt((n) => n + 1)} />
            </>
          ) : (
            <p role="status">{t("Carregando opções…")}</p>
          )
        )}
      </FocusGroup>
      <Hints items={[{ btn: "A", label: "Alternar" }, { btn: "B", label: "Voltar" }]} />

      {confirmConsole && (
        <ConfirmDialog
          title={t("Ativar o modo console e reiniciar?")}
          message={t("O PC será reiniciado em seguida: é obrigatório para o modo console valer. Salve o que estiver aberto, porque os programas serão fechados. Ao voltar, o launcher ocupa o lugar da área de trabalho, sem barra de tarefas, menu Iniciar nem bandeja. Sair para a área de trabalho sempre traz o Windows de volta. Vale só para este usuário.")}
          confirmLabel={t("Ativar e reiniciar")}
          danger
          onCancel={() => setConfirmConsole(false)}
          onConfirm={() => {
            setConfirmConsole(false);
            void change(() => api.setConsoleMode(true)).then((next) => {
              if (next?.console) void useRestart.getState().start();
            });
          }}
        />
      )}

      {confirmRestart && (
        <ConfirmDialog
          title={t("Reiniciar o PC agora?")}
          message={t("Salve o que estiver aberto: os programas serão fechados.")}
          confirmLabel={t("Reiniciar o PC")}
          danger
          onCancel={() => setConfirmRestart(false)}
          onConfirm={() => {
            setConfirmRestart(false);
            void useRestart.getState().start();
          }}
        />
      )}
    </div>
  );
}
