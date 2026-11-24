import { useEffect, useRef, useState } from "react";
import { useModal } from "../hooks/useModal";
import { t, te } from "../i18n";
import { onAction } from "../input/actions";
import { api } from "../lib/api";
import { describeLaunch, formatElapsed, LAUNCH_WAIT_MS } from "../lib/launch";
import { steam } from "../lib/steam";
import { useLaunch } from "../store/launch";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
import { useUserData } from "../store/userData";
import { Hints } from "./Chrome";
import { FocusGroup, Focusable } from "./Focusable";

/** Só mostra a tela se a abertura demora: a maioria abre em 1 ou 2 segundos e não precisa de aviso. */
const SHOW_AFTER_MS = 2500;
/** Instante de espera antes de abrir a janela da Steam quando ela pede uma resposta. */
const PROMPT_DELAY_MS = 400;
/**
 * Mostrar o texto do contrato na tela do launcher (e aceitar por trás, com um clique automático) em vez de abrir a caixa
 * da própria Steam, recortada, para o jogador aceitar com o controle. O jogador prefere a caixa da Steam.
 */
const CONTRACT_IN_LAUNCHER = false;

type Contract = { state: "loading" } | { state: "ready"; text: string } | { state: "error" };

/**
 * Acompanha o "Jogar" até o jogo abrir: lê as etapas que a Steam registra e as explica ao jogador, em vez de deixá-lo
 * esperando sem saber o que acontece (contrato a aceitar, componentes a instalar, nuvem, jogo carregando).
 */
export function LaunchWatcher() {
  const launching = useLibrary((s) => s.launching);
  const ids = Object.keys(launching);
  // Uma abertura de cada vez: a mais antiga.
  const id = ids.sort((a, b) => launching[a] - launching[b])[0];
  if (!id || !steam.available) return null;
  return <LaunchScreen key={id} id={id} startedAt={launching[id]} />;
}

function stopLaunching(id: string) {
  const { [id]: _gone, ...rest } = useLibrary.getState().launching;
  useLibrary.setState({ launching: rest });
}

function LaunchScreen({ id, startedAt }: { id: string; startedAt: number }) {
  const game = useLibrary((s) => s.games.find((g) => g.id === id));
  const status = useLaunch((s) => s.status[id]) ?? null;
  const dismissedAt = useLaunch((s) => s.dismissed[id]);
  const preferred = useUserData((u) => u.preferredLanguage);
  const [now, setNow] = useState(() => Date.now());
  /** A janela da Steam foi aberta para o jogador responder nela (o controle vira mouse). */
  const [manual, setManual] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [contract, setContract] = useState<Contract>({ state: "loading" });

  // Lê a etapa a cada 0,7 s enquanto a abertura durar.
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const from = useLaunch.getState().marks[id];
      if (from === undefined || !game?.appId || game.source !== "steam") return;
      const next = await steam.launchStatus(game.appId, from).catch(() => null);
      if (alive && next) useLaunch.getState().setStatus(id, next);
    };
    const t = setInterval(() => {
      setNow(Date.now());
      void read();
    }, 700);
    return () => {
      alive = false;
      clearInterval(t);
      useLaunch.getState().clear(id);
    };
  }, [id, game?.appId]);

  const baseStep: ReturnType<typeof describeLaunch> = game?.source === "epic"
    ? { title: t("Aguardando a janela do jogo"), detail: "" }
    : describeLaunch(status);
  // Jogo com atualização: a Steam a baixa antes de abrir, e o jogador precisa saber que é isso que está esperando.
  const step = game?.update && !baseStep.needsPlayer
    ? { ...baseStep, detail: [game.update === "running" && game.progress !== undefined ? t("Atualizando o jogo: {pct}%.", { pct: Math.round(game.progress * 100) }) : t("Este jogo tem uma atualização: a Steam a baixa antes de abrir, o que pode demorar."), baseStep.detail].filter(Boolean).join(" ") }
    : baseStep;
  const failed = !!status?.failed;
  const eulaId = CONTRACT_IN_LAUNCHER && status?.task === "ShowEula" ? status.eula : null;

  // O texto do contrato vem da página pública da loja, no idioma do jogador.
  useEffect(() => {
    if (!eulaId) return;
    let alive = true;
    setContract({ state: "loading" });
    steam
      .eulaText(eulaId, preferred)
      .then((text) => alive && setContract({ state: "ready", text }))
      .catch(() => alive && setContract({ state: "error" }));
    return () => {
      alive = false;
    };
  }, [eulaId, preferred]);

  const showSteam = () => {
    setManual(true);
    if (game?.appId) void steam.showPrompt(game.appId).catch((e) => useUI.getState().showToast(te(e), "warning"));
  };

  // A Steam pede algo que não é um contrato (ou o contrato não foi identificado): abre a Steam para o jogador responder.
  const eulaIdRef = useRef(eulaId);
  eulaIdRef.current = eulaId;
  const autoShown = useRef("");
  useEffect(() => {
    const task = status?.task ?? "";
    if (!step.needsPlayer || autoShown.current === task) return;
    autoShown.current = task;
    const timer = setTimeout(() => {
      if (!eulaIdRef.current) showSteam();
    }, PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [step.needsPlayer, status?.task]); // eslint-disable-line react-hooks/exhaustive-deps

  const accept = async () => {
    setAccepting(true);
    try {
      await steam.acceptEula();
    } catch (e) {
      // Não achei o botão na Steam: o jogador aceita nela mesma, com o controle como mouse.
      setAccepting(false);
      useUI.getState().showToast(`${te(e)} ${t("Aceite na janela da Steam.")}`, "warning");
      showSteam();
    }
  };

  // A Steam registra o aceite do contrato, mas a abertura que o pediu fica esperando para sempre: pede a abertura de novo
  // (já sem o contrato) e a Steam segue com as etapas.
  const relaunched = useRef(false);
  useEffect(() => {
    if (relaunched.current || !game || !status?.eulaAccepted || status.task !== "ShowEula") return;
    relaunched.current = true;
    void api.launchGame(game, true).catch(() => {});
  }, [status?.eulaAccepted, status?.task, game]);

  // A Steam já recebeu a resposta (ou a abertura acabou): o controle volta a ser só do launcher, a Steam se esconde de novo
  // e o foco vai para o jogo (ou para o launcher).
  const manualRef = useRef(false);
  manualRef.current = manual;
  useEffect(() => {
    if (!manual || step.needsPlayer) return;
    void steam.promptDone().catch(() => {});
    setManual(false);
  }, [manual, step.needsPlayer]);
  // A tela some com a janela da Steam ainda pedida (o jogo abriu por outro caminho): também devolve tudo ao lugar.
  useEffect(() => () => { if (manualRef.current) void steam.promptDone().catch(() => {}); }, []);
  // O aceite andou: a tela volta ao andamento normal.
  useEffect(() => {
    if (accepting && !step.needsPlayer) setAccepting(false);
  }, [accepting, step.needsPlayer]);

  const elapsed = now - startedAt;
  const canStopWaiting = elapsed >= LAUNCH_WAIT_MS && !failed && !step.needsPlayer && !game?.update
    && (!status?.found || status.completed);
  const stage = failed ? "failed" : canStopWaiting ? "unconfirmed" : status?.task ?? "";
  const visible = dismissedAt !== stage && (failed || step.needsPlayer || elapsed >= SHOW_AFTER_MS);

  if (!visible) return null;
  const showContract = !!eulaId && !manual;
  return (
    <LaunchDialog
      id={id}
      title={game?.title ?? t("o jogo")}
      step={step}
      failed={failed}
      elapsed={elapsed}
      canStopWaiting={canStopWaiting}
      onDismiss={() => useLaunch.getState().dismiss(id, stage)}
      manual={manual}
      contract={showContract ? contract : null}
      accepting={accepting}
      onAccept={() => void accept()}
      onShowSteam={showSteam}
    />
  );
}

interface DialogProps {
  id: string;
  title: string;
  step: ReturnType<typeof describeLaunch>;
  failed: boolean;
  elapsed: number;
  canStopWaiting: boolean;
  onDismiss: () => void;
  manual: boolean;
  /** Contrato a mostrar na tela (null = andamento normal). */
  contract: Contract | null;
  accepting: boolean;
  onAccept: () => void;
  onShowSteam: () => void;
}

function LaunchDialog({ id, title, step, failed, elapsed, canStopWaiting, onDismiss, manual, contract, accepting, onAccept, onShowSteam }: DialogProps) {
  const contractReady = contract?.state === "ready";
  const firstFocus = contract ? "launch-refuse" : step.needsPlayer ? "launch-show" : "launch-close";
  useModal(firstFocus);
  const textRef = useRef<HTMLDivElement>(null);

  const close = () => {
    if (failed || contract) {
      // A abertura falhou ou o jogador recusou o contrato: encerra o "Abrindo…" do jogo.
      stopLaunching(id);
    } else {
      onDismiss();
    }
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(
    () =>
      onAction((a) => {
        if (a === "back") closeRef.current();
        // Cima e baixo rolam o contrato (os botões ficam lado a lado, então não disputam o direcional).
        if (contractReady && (a === "up" || a === "down")) textRef.current?.scrollBy({ top: a === "up" ? -170 : 170, behavior: "smooth" });
        // LB e RB rolam uma página (o contrato é longo).
        if (contractReady && (a === "lb" || a === "rb") && textRef.current) {
          const page = textRef.current.clientHeight * 0.9;
          textRef.current.scrollBy({ top: a === "lb" ? -page : page, behavior: "smooth" });
        }
      }),
    [contractReady],
  );

  return (
    <div className="overlay" role="alertdialog" aria-modal="true">
      <FocusGroup focusKey="launch" className={`dialog launch-dialog ${contract ? "launch-dialog-wide" : ""}`} boundary preferredChildFocusKey={firstFocus}>
        {contract ? (
          <>
            <h2>{t("Contrato de {title}", { title })}</h2>
            <p>{t("A Steam pede que você leia e aceite este contrato para jogar. A decisão é sua. Direcionais para cima e para baixo rolam o texto; LB e RB rolam uma página.")}</p>
            {contract.state === "loading" && (
              <p className="launch-step">
                <span className="spinner" />
                {t("Carregando o contrato…")}
              </p>
            )}
            {contract.state === "error" && <p className="launch-note">{t("Não foi possível carregar o texto aqui. Você pode lê-lo e aceitá-lo na janela da Steam.")}</p>}
            {contract.state === "ready" && (
              <div className="launch-contract" ref={textRef} tabIndex={-1}>
                {contract.text}
              </div>
            )}
            {accepting && (
              <p className="launch-step">
                <span className="spinner" />
                {t("Aceitando…")}
              </p>
            )}
            <div className="dialog-actions">
              <Focusable focusKey="launch-refuse" className="btn" onPress={accepting ? undefined : close} scroll={false}>
                {t("Recusar")}
              </Focusable>
              {contract.state === "error" ? (
                <Focusable focusKey="launch-show" className="btn btn-primary" onPress={onShowSteam} scroll={false}>
                  {t("Abrir a Steam")}
                </Focusable>
              ) : (
                <Focusable focusKey="launch-accept" className={`btn btn-primary ${accepting ? "is-busy" : ""}`} onPress={contractReady && !accepting ? onAccept : undefined} scroll={false}>
                  {t("Aceitar")}
                </Focusable>
              )}
            </div>
          </>
        ) : (
          <>
            <h2>{failed ? step.title : t("Abrindo {title}", { title })}</h2>
            {!failed && (
              <p className="launch-step">
                {!step.needsPlayer && <span className="spinner" />}
                {step.title}
              </p>
            )}
            {step.detail && <p>{step.detail}</p>}
            {step.slow && <p className="launch-note">{t("Não feche o launcher nem desligue o PC: isso é normal e acontece só na primeira vez.")}</p>}
            {manual && step.needsPlayer && (
              <p className="launch-note">
                {t("O controle funciona como mouse na janela da Steam: o cursor já está no botão Aceitar, então basta apertar A. O analógico esquerdo move o cursor, B cancela, Y é Enter e os direcionais são setas. Start volta ao launcher. Depois de responder, o jogo continua sozinho.")}
              </p>
            )}
            <p className="launch-time">{formatElapsed(elapsed)}</p>
            <div className="dialog-actions">
              <Focusable focusKey="launch-close" className="btn" onPress={close} scroll={false}>
                {failed ? t("Fechar") : t("Continuar no launcher")}
              </Focusable>
              {canStopWaiting && (
                <Focusable focusKey="launch-stop-waiting" className="btn" onPress={() => stopLaunching(id)} scroll={false}>
                  {t("Parar de aguardar")}
                </Focusable>
              )}
              {step.needsPlayer && (
                <Focusable focusKey="launch-show" className="btn btn-primary" onPress={onShowSteam} scroll={false}>
                  {t("Mostrar a janela da Steam")}
                </Focusable>
              )}
            </div>
          </>
        )}
      </FocusGroup>
      <Hints
        modal
        items={
          contract
            ? [
                { btn: "A", label: "Selecionar" },
                ...(contractReady ? [{ btn: "RB", label: "Próxima página" } as const] : []),
                { btn: "B", label: "Recusar" },
              ]
            : [{ btn: "A", label: "Selecionar" }, { btn: "B", label: failed ? "Fechar" : "Continuar no launcher" }]
        }
      />
    </div>
  );
}
