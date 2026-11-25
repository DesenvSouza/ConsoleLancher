import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup } from "../components/Focusable";
import { CardFace } from "../components/GameCard";
import { ActionRow, Setting } from "../components/Setting";
import { t } from "../i18n";
import type { Game } from "../lib/types";
import { cycle, indexOf } from "../lib/util";
import { usePreviewGames } from "../hooks/usePreviewGames";
import {
  BADGE_LABELS,
  BADGE_POSITIONS,
  BADGE_POS_LABELS,
  BADGE_STYLES,
  COVER_LABELS,
  COVER_STYLES,
  useNotInstalled,
} from "../store/notInstalled";

const yesNo = (v: boolean) => (v ? t("Sim") : t("Não"));

/** Configurações › Jogos não instalados: como o launcher avisa que um jogo ainda não está instalado. */
export function NotInstalledSettings() {
  const n = useNotInstalled();
  const { games } = usePreviewGames();
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setFocus("set-ni-badge");
  }, []);

  // Prévia com jogos da própria biblioteca: um instalado e um não instalado (o mesmo, focado e sem foco).
  const sample = useMemo(() => {
    const installed = games.find((g) => g.state === "installed");
    const missing = games.find((g) => g.state === "not_installed") ?? installed;
    return installed && missing ? { installed, missing: { ...missing, state: "not_installed" as const } } : null;
  }, [games]);

  const face = (g: Game, focused = false) => (
    <div className={`card card-poster card-s ni-sample ${focused ? "is-focused" : ""}`}>
      <CardFace game={g} shape="poster" />
    </div>
  );

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Jogos não instalados")} />

      <div className="ni-layout">
      {sample && (
        <div className="ni-preview" aria-label={t("Prévia")}>
          <figure>
            {face(sample.installed)}
            <figcaption>{t("Instalado")}</figcaption>
          </figure>
          <figure>
            {face(sample.missing)}
            <figcaption>{t("Não instalado")}</figcaption>
          </figure>
          <figure>
            {face(sample.missing, true)}
            <figcaption>{t("Não instalado, selecionado")}</figcaption>
          </figure>
        </div>
      )}

      <FocusGroup focusKey="ni-list" className="settings-list settings-page" preferredChildFocusKey="set-ni-badge">
        <h3 className="settings-title">{t("Nos cartões")}</h3>
        <Setting cycle id="ni-badge" label={t("Selo")} value={t(BADGE_LABELS[n.badge])} onStep={(d) => n.set({ badge: cycle(BADGE_STYLES, indexOf(BADGE_STYLES, n.badge), d) })} />
        <Setting cycle id="ni-pos" label={t("Posição do selo")} value={t(BADGE_POS_LABELS[n.badgePos])} onStep={(d) => n.set({ badgePos: cycle(BADGE_POSITIONS, indexOf(BADGE_POSITIONS, n.badgePos), d) })} />
        <Setting cycle id="ni-cover" label={t("Capa")} hint={t("Deixa os não instalados apagados, para se destacarem os instalados")} value={t(COVER_LABELS[n.cover])} onStep={(d) => n.set({ cover: cycle(COVER_STYLES, indexOf(COVER_STYLES, n.cover), d) })} />
        <Setting cycle id="ni-focus" label={t("Cor ao selecionar")} hint={t("A capa volta à cor normal quando o cartão está selecionado")} value={yesNo(n.colorOnFocus)} onStep={() => n.set({ colorOnFocus: !n.colorOnFocus })} />

        <h3 className="settings-title">{t("Nas listas")}</h3>
        <Setting cycle id="ni-home" label={t("Esconder do Início")} hint={t("Só a fileira “Não instalados” continua mostrando esses jogos")} value={yesNo(n.hideFromHome)} onStep={() => n.set({ hideFromHome: !n.hideFromHome })} />
        <Setting cycle id="ni-first" label={t("Instalados primeiro na biblioteca")} hint={t("Mantém a ordem escolhida dentro de cada grupo")} value={yesNo(n.installedFirst)} onStep={() => n.set({ installedFirst: !n.installedFirst })} />

        <ActionRow id="ni-reset" label={t("Restaurar o padrão")} onPress={() => setConfirmReset(true)} />
      </FocusGroup>
      </div>

      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />

      {confirmReset && (
        <ConfirmDialog
          title={t("Restaurar o padrão?")}
          message={t("O selo, a capa e as opções das listas voltam ao que eram no início.")}
          confirmLabel={t("Restaurar")}
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            n.reset();
          }}
        />
      )}
    </div>
  );
}
