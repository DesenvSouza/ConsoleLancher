import { useCallback, useEffect, useRef, useState } from "react";
import intro from "../assets/intro.mp4";
import { useSoundSettings } from "../audio/sounds";
import { holdInput } from "../input/actions";
import { useIntro } from "../store/intro";

/** Se o vídeo não começar a tocar neste tempo, o launcher aparece sem ele. */
const START_LIMIT_MS = 3000;
/** Teto da abertura inteira (o vídeo tem 4,2 s): ela nunca fica presa na frente do launcher. */
const MAX_MS = 8000;
const FADE_MS = 450;

/**
 * A abertura em vídeo, por cima de tudo enquanto o launcher carrega as bibliotecas por trás. Qualquer botão, tecla ou clique
 * pula; esse aperto não chega ao launcher. O som do vídeo segue a opção "Efeitos sonoros".
 */
export function Intro() {
  const [phase, setPhase] = useState<"playing" | "leaving" | "done">("playing");
  const video = useRef<HTMLVideoElement>(null);
  const leave = useCallback(() => setPhase((current) => (current === "playing" ? "leaving" : current)), []);
  const covering = phase !== "done";

  // Enquanto o vídeo está na frente, nenhum botão chega ao launcher.
  useEffect(() => {
    if (!covering) return;
    const release = holdInput(leave);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F11") return;
      // Antes da navegação por setas e dos atalhos do teclado, que ouvem a mesma tecla depois.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) leave();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      release();
      window.removeEventListener("keydown", onKey, true);
    };
  }, [covering, leave]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = !useSoundSettings.getState().enabled;
    // Se o navegador não deixar tocar com som, toca sem som; se nem assim, segue direto para o launcher.
    element.play().catch(() => {
      element.muted = true;
      return element.play();
    }).catch(leave);
    const start = window.setTimeout(() => {
      if (element.currentTime === 0) leave();
    }, START_LIMIT_MS);
    const max = window.setTimeout(leave, MAX_MS);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(max);
    };
  }, [leave]);

  useEffect(() => {
    if (phase !== "leaving") return;
    video.current?.pause();
    useIntro.setState({ playing: false });
    const timer = window.setTimeout(() => setPhase("done"), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (!covering) return null;
  return (
    <div className={`intro ${phase === "leaving" ? "is-leaving" : ""}`} aria-hidden="true" onClick={leave}>
      <video ref={video} src={intro} preload="auto" playsInline disablePictureInPicture onEnded={leave} onError={leave} />
    </div>
  );
}
