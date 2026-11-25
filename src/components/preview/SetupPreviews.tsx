import { ButtonGlyph } from "../Chrome";
import { t } from "../../i18n";
import { useMusic, TRACKS } from "../../audio/music";
import { useSoundSettings } from "../../audio/sounds";
import { usePadKind } from "../../input/padKind";
import { useStoreAccounts } from "../../hooks/useStoreAccounts";
import { useSystem } from "../../store/system";

/** Moldura simples das prévias do assistente que não são uma tela do launcher em miniatura. */
function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="pv setup-panel">
      <figcaption className="pv-label">{label}</figcaption>
      <div className="setup-panel-body">{children}</div>
    </figure>
  );
}

/** Os botões do controle como vão aparecer nas dicas do launcher (segue a escolha de ícones: Xbox ou PlayStation). */
export function ControllerPreview() {
  const choice = usePadKind((p) => p.icons);
  const detected = usePadKind((p) => p.detected);
  const kind = choice === "auto" ? detected : choice;
  const rows: { btn: "A" | "B" | "X" | "Y" | "LB" | "RB" | "Start" | "Select"; label: string }[] = [
    { btn: "A", label: "Selecionar" },
    { btn: "B", label: "Voltar" },
    { btn: "X", label: "Biblioteca" },
    { btn: "Y", label: "Downloads" },
    { btn: "LB", label: "Seção anterior" },
    { btn: "RB", label: "Próxima seção" },
    { btn: "Start", label: "Opções do jogo" },
    { btn: "Select", label: "Configurações" },
  ];
  return (
    <Panel label={t("Seus botões")}>
      <p className="setup-panel-note">{kind === "playstation" ? t("Ícones de PlayStation") : t("Ícones de Xbox")}</p>
      <ul className="setup-keys">
        {rows.map((row) => (
          <li key={row.btn}>
            <ButtonGlyph btn={row.btn} />
            <span>{t(row.label)}</span>
          </li>
        ))}
      </ul>
      <p className="setup-panel-note">{t("No teclado: setas, Enter (A), Esc (B), Q e E (seções), X, C, Tab e F1.")}</p>
    </Panel>
  );
}

/** As lojas e a situação de cada conta. */
export function AccountsPreview() {
  const stores = useStoreAccounts();
  return (
    <Panel label={t("Suas contas")}>
      <ul className="setup-stores">
        {stores.map((store) => (
          <li key={store.id} className={store.connected ? "is-on" : ""}>
            {store.icon && <img src={store.icon} alt="" draggable={false} />}
            <span className="setup-store-text">
              <b>{t(store.name)}</b>
              <small>{store.summary}</small>
            </span>
            <em>{store.connected ? t("Conectada") : store.detected ? t("Falta entrar na conta") : t("Não conectada")}</em>
          </li>
        ))}
      </ul>
      <p className="setup-panel-note">{t("Conectar uma conta traz toda a biblioteca, inclusive os jogos que ainda não estão instalados.")}</p>
    </Panel>
  );
}

/** O que o modo console faz, quando vale a pena, os riscos e como voltar atrás. */
export function StartupPreview({ restoreScript }: { restoreScript?: string }) {
  return (
    <Panel label={t("Modo console: antes de ativar")}>
      <section className="setup-advice is-good">
        <h4>{t("Recomendado para um PC usado como console")}</h4>
        <p>{t("O PC liga direto no launcher, tudo pelo controle, sem nada da área de trabalho aparecendo. Em um PC usado também para trabalho, deixe desativado.")}</p>
      </section>
      <section className="setup-advice is-risk">
        <h4>{t("Riscos")}</h4>
        <ul>
          <li>{t("Somem a barra de tarefas, o menu Iniciar, o relógio e os ícones da bandeja.")}</li>
          <li>{t("Os programas que abrem junto com o Windows (periféricos, VPN, nuvem…) não abrem; a Steam o launcher abre sozinho.")}</li>
          <li>{t("Se algo der errado, a tela pode ficar sem área de trabalho e você precisará de um teclado para voltar.")}</li>
        </ul>
      </section>
      <section className="setup-advice">
        <h4>{t("Proteções e como voltar")}</h4>
        <ul>
          <li>{t("Se o launcher fechar ou travar, ele reabre; depois de 3 falhas seguidas a área de trabalho volta.")}</li>
          <li>{t("Em Sair para a área de trabalho, o Windows abre antes de o launcher fechar.")}</li>
          <li>{t("Emergência: Ctrl+Alt+Del › Gerenciador de Tarefas › Executar nova tarefa › digite explorer.")}</li>
        </ul>
        {restoreScript && <p className="setup-path">{t("Para desfazer de vez, desligue o modo console aqui ou execute o arquivo {path}.", { path: restoreScript })}</p>}
      </section>
    </Panel>
  );
}

/** Estado do áudio: efeitos, música e volume. */
export function AudioPreview() {
  const effects = useSoundSettings((s) => s.enabled);
  const music = useMusic();
  const output = useSystem((s) => s.status?.outputs.find((o) => o.current)?.name);
  const musicName = music.choice === "off" ? t("Desligada") : music.choice === "all" ? t("Todas (embaralhadas)") : (TRACKS.find((track) => track.id === music.choice)?.name ?? music.choice);
  return (
    <Panel label={t("Áudio")}>
      <dl className="setup-audio">
        {output && (
          <div>
            <dt>{t("Saída de áudio")}</dt>
            <dd>{output}</dd>
          </div>
        )}
        <div>
          <dt>{t("Efeitos sonoros")}</dt>
          <dd>{effects ? t("Ativados") : t("Desativados")}</dd>
        </div>
        <div>
          <dt>{t("Música de fundo")}</dt>
          <dd>{musicName}</dd>
        </div>
        <div>
          <dt>{t("Volume da música")}</dt>
          <dd>
            <span className="setup-meter" aria-hidden="true">
              <i style={{ width: music.choice === "off" ? "0%" : `${music.volume}%` }} />
            </span>
            {music.choice === "off" ? "—" : `${music.volume}%`}
          </dd>
        </div>
      </dl>
      <p className="setup-panel-note">{t("Os efeitos tocam quando você muda uma opção; a música toca no launcher quando nenhum jogo está aberto.")}</p>
    </Panel>
  );
}
