import { useMemo } from "react";
import { t } from "../i18n";
import { hideDuplicates } from "../lib/duplicates";
import { GAME_SOURCES, STORE_ACCOUNTS, STORE_ORDER } from "../lib/stores";
import { cycle } from "../lib/util";
import { useLibrary } from "../store/library";
import { useLibraryConfig } from "../store/libraryConfig";
import { Setting } from "./Setting";

/** As opções de jogos repetidos entre lojas (Configurações › Jogos e biblioteca e a etapa Contas do assistente). */
export function DuplicateSettings({ onFocus }: { onFocus: (focusKey: string) => () => void }) {
  const games = useLibrary((s) => s.games);
  const mode = useLibraryConfig((c) => c.duplicates);
  const preferred = useLibraryConfig((c) => c.preferredStore);
  const preferInstalled = useLibraryConfig((c) => c.preferInstalled);
  const setOptions = useLibraryConfig((c) => c.setOptions);
  /** As lojas com conta no launcher e as que têm jogos na biblioteca. */
  const stores = useMemo(() => STORE_ORDER.filter((id) => STORE_ACCOUNTS.some((a) => a.id === id) || games.some((g) => g.source === id)), [games]);
  const hidden = useMemo(() => (mode === "hide" ? games.length - hideDuplicates(games, { preferred, preferInstalled }).length : 0), [games, mode, preferred, preferInstalled]);
  const hide = mode === "hide";

  return (
    <>
      <Setting
        cycle
        id="duplicates"
        label={t("Jogos repetidos entre lojas")}
        hint={!hide ? t("O mesmo jogo em duas lojas aparece duas vezes no Início e na Biblioteca") : hidden === 0 ? t("Nenhum jogo repetido encontrado por enquanto") : hidden === 1 ? t("1 cópia repetida está oculta agora") : t("{n} cópias repetidas estão ocultas agora", { n: hidden })}
        value={hide ? t("Ocultar") : t("Mostrar todos")}
        onFocus={onFocus("set-duplicates")}
        onStep={() => setOptions({ duplicates: hide ? "show" : "hide" })}
      />
      {hide && (
        <>
          <Setting
            cycle
            id="preferred-store"
            label={t("Loja preferida")}
            hint={t("Quando o jogo está em mais de uma loja, aparece a versão desta")}
            value={t(GAME_SOURCES[preferred].label)}
            onFocus={onFocus("set-preferred-store")}
            onStep={(d) => setOptions({ preferredStore: cycle(stores, Math.max(0, stores.indexOf(preferred)), d) })}
          />
          <Setting
            cycle
            id="prefer-installed"
            label={t("Se só a outra cópia estiver instalada")}
            hint={t("O que aparece quando o jogo não está instalado pela loja preferida, mas está por outra")}
            value={preferInstalled ? t("Mostrar a instalada") : t("Mostrar a preferida")}
            onFocus={onFocus("set-prefer-installed")}
            onStep={() => setOptions({ preferInstalled: !preferInstalled })}
          />
        </>
      )}
    </>
  );
}
