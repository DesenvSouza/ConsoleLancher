import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup } from "../components/Focusable";
import { OnScreenKeyboard } from "../components/OnScreenKeyboard";
import { ActionRow } from "../components/Setting";
import { t, te } from "../i18n";
import { rich } from "../i18n/rich";
import { api } from "../lib/api";
import { epic } from "../lib/epic";
import { useEpic } from "../store/epic";
import { useUI } from "../store/ui";

/** "agora há pouco", "há 12 min", "há 3 h", "há 2 d". */
function relativeTime(at: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (minutes < 1) return t("agora há pouco");
  if (minutes < 60) return t("há {n} min", { n: minutes });
  if (minutes < 24 * 60) return t("há {n} h", { n: Math.floor(minutes / 60) });
  return t("há {n} d", { n: Math.floor(minutes / (24 * 60)) });
}

/**
 * Conta da Epic Games: o login acontece no site da Epic (no navegador deste PC); o site mostra um código e o jogador o
 * devolve aqui, colando o que copiou ou digitando. Senha e verificação em duas etapas nunca passam pelo launcher.
 */
export function EpicAccount() {
  const status = useEpic((s) => s.status);
  const gameCount = useEpic((s) => s.library.length);
  const fetchedAt = useEpic((s) => s.fetchedAt);
  const syncing = useEpic((s) => s.syncing);
  const back = useUI((s) => s.back);
  const [typing, setTyping] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [busy, setBusy] = useState(false);

  const signedIn = !!status?.signedIn;
  const launcherMissing = status !== null && !status.launcherInstalled;

  useEffect(() => {
    void useEpic.getState().refreshStatus();
    setFocus(signedIn ? "set-epic-sync" : "set-epic-open");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ui = useUI.getState;
  const openLogin = async () => {
    try {
      await epic.openLogin();
      ui().showToast(t("A página de login da Epic abriu no navegador. Entre, copie o código que ela mostra e volte aqui."));
    } catch (e) {
      ui().showToast(te(e), "warning");
    }
  };
  const submit = async (code: string) => {
    setBusy(true);
    try {
      await useEpic.getState().signIn(code);
    } finally {
      setBusy(false);
    }
  };
  const paste = async () => {
    const text = (await api.readClipboard()).trim();
    if (!text) return ui().showToast(t("Não há nada copiado. Copie o código na página da Epic e tente de novo."), "warning");
    await submit(text);
  };

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Conta Epic Games")} />

      <div className="account-layout">
        <div className="account-main">
          <section className="account-card">
            <div className="account-avatar">{(status?.displayName ?? "E").charAt(0).toUpperCase()}</div>
            <div className="account-info">
              <h2>{signedIn ? status?.displayName || t("Conta da Epic") : t("Epic Games")}</h2>
              <p>
                {launcherMissing
                  ? t("A Epic Games Launcher não foi encontrada neste PC: dá para listar a biblioteca, mas abrir e instalar jogos precisa dela.")
                  : t("Abrir e instalar jogos usa a Epic Games Launcher, que fica em segundo plano.")}
              </p>
              <p className={signedIn ? "account-ok" : "account-warn"}>
                {signedIn
                  ? t("Conectada · {n} jogos na biblioteca", { n: gameCount })
                  : t("Entre para ver toda a biblioteca: sem isso, só os jogos instalados aparecem.")}
              </p>
            </div>
          </section>

          <FocusGroup focusKey="epic-account-list" className="settings-list" preferredChildFocusKey={signedIn ? "set-epic-sync" : "set-epic-open"}>
            {signedIn ? (
              <>
                <ActionRow
                  id="epic-sync"
                  label={syncing ? t("Sincronizando…") : t("Sincronizar biblioteca agora")}
                  hint={fetchedAt > 0 ? t("Última atualização: {when}. A lista também se atualiza sozinha a cada hora, quando não há jogo aberto.", { when: relativeTime(fetchedAt) }) : t("A lista também se atualiza sozinha a cada hora, quando não há jogo aberto")}
                  onPress={() => void useEpic.getState().sync()}
                />
                <ActionRow id="epic-launcher" hint={t("Para desinstalar, atualizar e ver downloads")} onPress={() => void epic.openLibrary().catch((e) => ui().showToast(te(e), "warning"))}>
                  {t("Abrir a Epic Games Launcher")}
                </ActionRow>
                <ActionRow danger id="epic-signout" onPress={() => setConfirmSignOut(true)}>{t("Sair da conta da Epic")}</ActionRow>
              </>
            ) : (
              <>
                <ActionRow id="epic-open" hint={t("Abre o login da Epic numa janela. O controle vira mouse nela (Start volta ao launcher)")} onPress={() => void useEpic.getState().startLogin()}>{t("Entrar com a conta Epic")}</ActionRow>
                <h3 className="settings-title account-alt-title">{t("Alternativa: código do navegador")}</h3>
                <ActionRow id="epic-browser" hint={t("Abre o site da Epic no navegador deste PC")} onPress={() => void openLogin()}>{t("Abrir a página de login no navegador")}</ActionRow>
                <ActionRow id="epic-paste" hint={t("Use depois de copiar o código na página")} onPress={() => void paste()}>{busy ? t("Entrando…") : t("Colar o código copiado")}</ActionRow>
                <ActionRow id="epic-type" onPress={() => setTyping(true)}>{t("Digitar o código")}</ActionRow>
              </>
            )}
            <ActionRow id="epic-back" onPress={back}>{t("Voltar")}</ActionRow>
          </FocusGroup>
        </div>

        <aside className="account-help">
          {signedIn ? (
            <>
              <h3 className="settings-title">{t("Biblioteca da conta")}</h3>
              <p className="account-note">{t("A lista mostra todos os jogos da conta, inclusive os que não estão instalados. A Epic não informa o tempo de jogo: o launcher conta só o que você joga por aqui.")}</p>
              <p className="account-note">{t("Instalar, atualizar e desinstalar são feitos na Epic Games Launcher, que o launcher abre para você.")}</p>
            </>
          ) : (
            <>
              <h3 className="settings-title">{t("Como entrar")}</h3>
              <ol className="account-steps">
                <li>{rich(t("Escolha <b>Entrar com a conta Epic</b>: o login da Epic abre numa janela."))}</li>
                <li>{rich(t("Entre nela (e-mail e senha; o controle vira mouse, e um teclado ajuda a digitar)."))}</li>
                <li>{rich(t("Ao entrar, a janela fecha sozinha e a biblioteca aparece."))}</li>
              </ol>
              <p className="account-note">{t("A senha e a verificação em duas etapas ficam só no site da Epic. O código vale por poucos minutos e uma única vez; o launcher guarda só a sessão, cifrada pelo Windows, e você pode sair dela aqui quando quiser.")}</p>
              <p className="account-note">{t("A Epic não oferece uma forma oficial de listar a biblioteca. O launcher usa o mesmo caminho da Epic Games Launcher; se a Epic mudar isso, a lista pode falhar, mas os jogos instalados continuam aparecendo.")}</p>
            </>
          )}
        </aside>
      </div>

      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />

      {typing && (
        <OnScreenKeyboard
          title={t("Código da Epic")}
          hint={t("Use Colar para trazer o código copiado, ou digite os 32 caracteres (números e letras).")}
          placeholder={t("32 caracteres")}
          maxLength={400}
          confirmLabel={t("Entrar")}
          onCancel={() => setTyping(false)}
          onSubmit={(code) => {
            setTyping(false);
            void submit(code);
          }}
        />
      )}

      {confirmSignOut && (
        <ConfirmDialog
          title={t("Sair da conta da Epic?")}
          message={t("Só os jogos instalados continuam aparecendo na lista, até você entrar de novo. A sessão guardada neste PC é apagada.")}
          confirmLabel={t("Sair da conta")}
          cancelLabel={t("Continuar conectado")}
          danger
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => {
            setConfirmSignOut(false);
            void useEpic.getState().signOut();
          }}
        />
      )}
    </div>
  );
}
