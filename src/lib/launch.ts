import { t } from "../i18n";
import type { LaunchStatus } from "./steam";

/** Como a abertura de um jogo aparece para o jogador. */
export interface LaunchStep {
  title: string;
  detail: string;
  /** O jogador precisa fazer algo (a Steam espera uma resposta numa janela dela). */
  needsPlayer?: boolean;
  /** Etapa que costuma demorar: avisa para ter paciência. */
  slow?: boolean;
}

const STEPS: Record<string, LaunchStep> = {
  WaitingPrevProcess: { title: "Aguardando o jogo anterior fechar", detail: "A Steam espera o jogo que estava aberto terminar de fechar." },
  ShowEula: {
    title: "A Steam espera você aceitar o contrato do jogo",
    detail: "A Steam abriu o contrato no meio da tela. Leia e aperte A em Aceitar (o cursor já está nele) para o jogo abrir.",
    needsPlayer: true,
  },
  CheckShaderDepotManifest: { title: "Verificando os shaders do jogo", detail: "A Steam confere se há shaders prontos para baixar." },
  RunningInstallScript: {
    title: "Instalando os componentes do jogo",
    detail: "Na primeira vez, a Steam instala o que o jogo precisa (DirectX, Visual C++, .NET). Pode levar alguns minutos.",
    slow: true,
  },
  SynchronizingCloud: { title: "Sincronizando seus saves na nuvem", detail: "Se a conexão estiver lenta, pode demorar um pouco." },
  SynchronizingStats: { title: "Sincronizando conquistas e estatísticas", detail: "" },
  SynchronizingControllerConfig: { title: "Preparando a configuração do controle", detail: "" },
  SiteLicenseSeatCheckout: { title: "Verificando a licença do jogo", detail: "" },
  DelayLaunch: { title: "Preparando para abrir", detail: "" },
  ShowInterstitials: { title: "Preparando para abrir", detail: "" },
  CreatingProcess: { title: "Iniciando o jogo", detail: "" },
  WaitingGameWindow: {
    title: "Aguardando a janela do jogo",
    detail: "O jogo foi iniciado. Na primeira vez, alguns jogos preparam arquivos ou compilam shaders antes de mostrar a tela, o que pode levar vários minutos.",
    slow: true,
  },
  Completed: { title: "Jogo iniciado", detail: "O jogo foi iniciado e está carregando." },
};

const WAITING_FOR_STEAM: LaunchStep = { title: "Pedindo à Steam para abrir o jogo", detail: "Aguardando a Steam responder." };

/** Descrição de uma abertura em andamento a partir do que a Steam registrou (null = ainda sem resposta). */
export function describeLaunch(status: LaunchStatus | null): LaunchStep {
  if (!status || !status.found) return translated(WAITING_FOR_STEAM);
  if (status.failed) {
    return { title: t("A Steam não conseguiu abrir o jogo"), detail: t("Erro da Steam: {error}. Tente de novo ou verifique os arquivos do jogo.", { error: status.failed }) };
  }
  const step: LaunchStep = STEPS[status.task]
    ? translated(STEPS[status.task])
    : { title: t("Preparando o jogo"), detail: status.task ? t("Etapa da Steam: {task}.", { task: status.task }) : "" };
  // Uma etapa que a Steam marca como "esperando resposta" sem ser o contrato (opções de inicialização, chave...) também é do jogador.
  if (status.waitingUser && !step.needsPlayer && status.task !== "ShowInterstitials" && status.task !== "CreatingProcess") {
    return { title: t("A Steam espera uma resposta sua"), detail: t("Há uma janela da Steam aguardando. Abra-a para continuar."), needsPlayer: true };
  }
  return step;
}

/** A etapa com os textos no idioma atual (os textos em português do código são a chave da tradução). */
function translated(step: LaunchStep): LaunchStep {
  return { ...step, title: t(step.title), detail: step.detail ? t(step.detail) : "" };
}

/** "12 s", "1 min 05 s". */
export function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec} s`;
  return `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, "0")} s`;
}
