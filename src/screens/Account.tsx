import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup } from "../components/Focusable";
import { OnScreenKeyboard } from "../components/OnScreenKeyboard";
import { QrLoginDialog } from "../components/QrLoginDialog";
import { ActionRow } from "../components/Setting";
import { t, te } from "../i18n";
import { rich } from "../i18n/rich";
import { steam } from "../lib/steam";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
import { useUserData } from "../store/userData";

/** Conta Steam: mostra a conta logada e configura a chave da Web API (uma vez), sem mexer em arquivos. */
export function Account() {
  const { mode, steam: info, keyStatus, syncing, setupAccount, clearKey, syncOwned, qrSignedIn, signOutQr } = useLibrary();
  const ownedCount = useUserData((u) => u.owned.length);
  const back = useUI((s) => s.back);
  const [typing, setTyping] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setFocus("set-qr");
  }, []);

  const demo = mode === "mock";
  const name = demo ? t("Conta de demonstração") : info?.personaName || info?.accountName || t("Steam não encontrada");
  const session = keyStatus?.session ?? null;
  const hasKey = !!keyStatus?.last4;
  const configured = !!keyStatus?.configured;
  const accountLine = demo
    ? t("Você está no navegador: a validação real só acontece no app.")
    : !info?.found
      ? t("Instale a Steam e entre na sua conta.")
      : !info.loggedIn
        ? t("A Steam está fechada ou sem login. Abra a Steam e entre na sua conta.")
        : `${t("Conta logada na Steam")}${info.accountName ? ` · ${info.accountName}` : ""}`;

  const openKeyPage = async () => {
    const ui = useUI.getState();
    try {
      if (demo) return ui.showToast(t("(navegador) No app, a página abre dentro da Steam."));
      await steam.openKeyPage();
      ui.showToast(t("A página abriu na Steam. Crie a chave, copie-a e volte aqui para usar \"Colar\"."));
    } catch (e) {
      ui.showToast(te(e));
    }
  };

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Conta Steam")} />

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
                {session
                  ? t("Conectada por QR code{account} · {n} jogos na biblioteca", { account: session.accountName ? ` (${session.accountName})` : "", n: ownedCount })
                  : hasKey
                    ? t("Chave da Web API configurada (…{last4}) · {n} jogos na biblioteca", { last4: keyStatus?.last4 ?? "????", n: ownedCount })
                    : t("Entre com o QR code para ver toda a biblioteca: sem isso, só os jogos instalados aparecem.")}
              </p>
            </div>
          </section>

          <FocusGroup focusKey="account-list" className="settings-list" preferredChildFocusKey="set-qr">
            <ActionRow id="qr" onPress={() => setQrOpen(true)}>{session ? t("Entrar com outra conta (QR code)") : t("Entrar com a conta Steam (QR code)")}</ActionRow>
            {configured && (
              <ActionRow id="sync" label={syncing ? t("Sincronizando…") : t("Sincronizar biblioteca agora")} hint={t("A lista também se atualiza sozinha a cada 5 minutos, quando não há jogo aberto")} onPress={() => void syncOwned()} />
            )}
            {session && <ActionRow danger id="signout" onPress={() => void signOutQr()}>{t("Sair do login por QR code")}</ActionRow>}

            <h3 className="settings-title account-alt-title">{t("Alternativa: chave da Web API")}</h3>
            <ActionRow id="addkey" onPress={() => setTyping(true)}>{hasKey ? t("Alterar a chave da conta") : t("Adicionar a chave da conta")}</ActionRow>
            <ActionRow id="keypage" onPress={() => void openKeyPage()}>{t("Criar a chave na Steam")}</ActionRow>
            {hasKey && !keyStatus?.fromEnv && <ActionRow danger id="removekey" onPress={() => setConfirmRemove(true)}>{t("Remover a chave desta conta")}</ActionRow>}

            <ActionRow id="back" onPress={back}>{t("Voltar")}</ActionRow>
          </FocusGroup>
        </div>

        <aside className="account-help">
          <h3 className="settings-title">{t("Entrar com o QR code (recomendado)")}</h3>
          <ol className="account-steps">
            <li>{rich(t("Escolha <b>Entrar com a conta Steam (QR code)</b>."))}</li>
            <li>{rich(t("No app da Steam do celular, abra o <b>Steam Guard</b> e toque em <b>Ler um código QR</b>."))}</li>
            <li>{rich(t("Aponte a câmera para o código na tela e <b>aprove</b> o login."))}</li>
          </ol>
          <p className="account-note">{t("Não há campo de e-mail nem de senha: quem aprova é o seu celular. Com o login, aparece toda a biblioteca, inclusive os jogos não instalados. A sessão fica guardada só neste PC, cifrada pelo Windows, e você pode sair dela aqui quando quiser.")}</p>

          <h3 className="settings-title">{t("Ou use a chave (opcional)")}</h3>
          <p className="account-note">{rich(t("Crie a chave na Steam (no campo de domínio escreva <b>localhost</b>), copie-a e use <b>Adicionar a chave da conta</b>. Ela só lê a biblioteca; o QR code vale primeiro quando os dois existem."))}</p>
        </aside>
      </div>

      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />

      {qrOpen && (
        <QrLoginDialog
          onCancel={() => setQrOpen(false)}
          onSignedIn={(accountName, steamId) => {
            setQrOpen(false);
            void qrSignedIn(accountName, steamId);
          }}
        />
      )}

      {typing && (
        <OnScreenKeyboard
          title={t("Chave da Web API da Steam")}
          hint={t("Use Colar para trazer a chave copiada, ou digite os 32 caracteres (números e letras de A a F).")}
          placeholder={t("32 caracteres")}
          maxLength={32}
          confirmLabel={t("Validar e salvar")}
          onCancel={() => setTyping(false)}
          onSubmit={(key) => {
            setTyping(false);
            void setupAccount(key);
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={t("Remover a chave desta conta?")}
          message={t("Os jogos não instalados deixam de ser atualizados na lista. Você pode adicionar a chave de novo quando quiser.")}
          confirmLabel={t("Remover")}
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
