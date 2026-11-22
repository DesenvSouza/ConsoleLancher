import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup } from "../components/Focusable";
import { OnScreenKeyboard } from "../components/OnScreenKeyboard";
import { ActionRow, Setting } from "../components/Setting";
import { steam } from "../lib/steam";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
import { useUserData } from "../store/userData";

/** Conta Steam: mostra a conta logada e configura a chave da Web API (uma vez), sem mexer em arquivos. */
export function Account() {
  const { mode, steam: info, keyStatus, syncing, setupAccount, clearKey, syncOwned } = useLibrary();
  const ownedCount = useUserData((u) => u.owned.length);
  const hideToasts = useUserData((u) => u.hideSteamToasts);
  const setHideToasts = useUserData((u) => u.setHideSteamToasts);
  const back = useUI((s) => s.back);
  const [typing, setTyping] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setFocus("set-addkey");
  }, []);

  const demo = mode === "mock";
  const name = demo ? "Conta de demonstração" : info?.personaName || info?.accountName || "Steam não encontrada";
  const configured = !!keyStatus?.configured;
  const accountLine = demo
    ? "Você está no navegador: a validação real só acontece no app."
    : !info?.found
      ? "Instale a Steam e entre na sua conta."
      : !info.loggedIn
        ? "A Steam está fechada ou sem login. Abra a Steam e entre na sua conta."
        : `Conta logada na Steam${info.accountName ? ` · ${info.accountName}` : ""}`;

  const openKeyPage = async () => {
    const ui = useUI.getState();
    try {
      if (demo) return ui.showToast("(navegador) No app, a página abre dentro da Steam.");
      await steam.openKeyPage();
      ui.showToast("A página abriu na Steam. Crie a chave, copie-a e volte aqui para usar \"Colar\".");
    } catch (e) {
      ui.showToast(String(e));
    }
  };

  return (
    <div className="screen settings">
      <TopBar title="Conta Steam" />

      {/* Duas colunas: a conta e as ações à esquerda; as instruções, sempre inteiras, à direita
          (texto dentro de uma lista rolável ficava cortado, pois só a lista rola ao focar uma linha). */}
      <div className="account-layout">
        <div className="account-main">
          <section className="account-card">
            <div className="account-avatar">{name.charAt(0).toUpperCase()}</div>
            <div className="account-info">
              <h2>{name}</h2>
              <p>{accountLine}</p>
              <p className={configured ? "account-ok" : "account-warn"}>
                {configured
                  ? `Chave da Web API configurada (…${keyStatus?.last4 ?? "????"}) · ${ownedCount} jogos na biblioteca`
                  : "Chave da Web API não configurada: só os jogos instalados aparecem."}
              </p>
            </div>
          </section>

          <FocusGroup focusKey="account-list" className="settings-list" preferredChildFocusKey="set-addkey">
            <ActionRow id="addkey" onPress={() => setTyping(true)}>{configured ? "Alterar a chave da conta" : "Adicionar a chave da conta"}</ActionRow>
            <ActionRow id="keypage" onPress={() => void openKeyPage()}>Criar a chave na Steam</ActionRow>
            {configured && <ActionRow id="sync" onPress={() => void syncOwned()}>{syncing ? "Sincronizando…" : "Sincronizar biblioteca agora"}</ActionRow>}
            {configured && !keyStatus?.fromEnv && <ActionRow danger id="removekey" onPress={() => setConfirmRemove(true)}>Remover a chave desta conta</ActionRow>}
            <Setting cycle id="toasts" label="Notificações e overlay da Steam" value={hideToasts ? "Ocultas" : "Mostrar"} onStep={() => setHideToasts(!hideToasts)} />
            <ActionRow id="back" onPress={back}>Voltar</ActionRow>
          </FocusGroup>
        </div>

        <aside className="account-help">
          <h3 className="settings-title">Como configurar (só uma vez)</h3>
          <ol className="account-steps">
            <li>Escolha <b>Criar a chave na Steam</b>. A página abre dentro da Steam, já logada. No campo de domínio escreva <b>localhost</b>.</li>
            <li>Copie a chave mostrada (32 caracteres).</li>
            <li>Volte, escolha <b>Adicionar a chave da conta</b>, use <b>Colar</b> e confirme.</li>
          </ol>
          <p className="account-note">A chave é testada na hora e fica salva só neste PC. Com ela, aparece toda a biblioteca, inclusive os jogos não instalados. Sem ela, só os instalados.</p>
        </aside>
      </div>

      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />

      {typing && (
        <OnScreenKeyboard
          title="Chave da Web API da Steam"
          hint="Use Colar para trazer a chave copiada, ou digite os 32 caracteres (números e letras de A a F)."
          placeholder="32 caracteres"
          maxLength={32}
          confirmLabel="Validar e salvar"
          onCancel={() => setTyping(false)}
          onSubmit={(key) => {
            setTyping(false);
            void setupAccount(key);
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Remover a chave desta conta?"
          message="Os jogos não instalados deixam de ser atualizados na lista. Você pode adicionar a chave de novo quando quiser."
          confirmLabel="Remover"
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            void clearKey();
          }}
        />
      )}
    </div>
  );
}
