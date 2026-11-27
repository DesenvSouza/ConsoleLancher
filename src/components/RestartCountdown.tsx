import { useEffect, useRef, useState } from "react";
import { playSound } from "../audio/sounds";
import { t } from "../i18n";
import { holdInput } from "../input/actions";
import { useModal } from "../hooks/useModal";
import { useRestart } from "../store/restart";
import { useUI } from "../store/ui";
import { Hints } from "./Chrome";
import { FocusGroup, Focusable } from "./Focusable";

/** Se o PC continuar ligado este tempo depois do fim da contagem, o aviso deixa de prender o controle. */
const GIVE_UP_MS = 30_000;

/**
 * Contagem da reinicialização. Depois de uma atualização, B cancela. No modo console não há cancelar: reiniciar é
 * obrigatório e a escolha foi feita na confirmação anterior.
 */
function Counting({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  const reason = useRestart((s) => s.reason);
  const cancellable = reason === "update";
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const cancel = () => {
    void useRestart.getState().cancel().then((done) => {
      playSound(done ? "back" : "warning");
      useUI.getState().showToast(done ? t("Reinício cancelado.") : t("Não foi possível cancelar o reinício."), done ? undefined : "warning");
    });
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - endsAt > GIVE_UP_MS) useRestart.getState().giveUp();
    }, 500);
    // Nenhum botão chega à tela de baixo enquanto o Windows se prepara para reiniciar.
    const release = holdInput((action) => {
      if (action === "back" && useRestart.getState().reason === "update") cancelRef.current();
    });
    return () => {
      clearInterval(timer);
      release();
    };
  }, [endsAt]);

  return (
    <div className="overlay restart-overlay" role="alertdialog" aria-modal="true" aria-labelledby="restart-title">
      <div className="dialog">
        <h2 id="restart-title">{t("Reiniciando o PC")}</h2>
        <p role="status">{left === 0 ? t("Reiniciando…") : reason === "update" ? t("O PC será reiniciado em {n} s.", { n: left }) : t("O PC será reiniciado em {n} s para o modo console valer. Salve o que estiver aberto.", { n: left })}</p>
        {cancellable && left > 0 && (
          <div className="dialog-actions">
            <button type="button" className="btn is-focused" onClick={cancel}>{t("Cancelar o reinício")}</button>
          </div>
        )}
      </div>
      {cancellable && left > 0 && <Hints modal items={[{ btn: "B", label: "Cancelar o reinício" }]} />}
    </div>
  );
}

/** O Windows recusou o pedido: o modo console já está registrado e vale na próxima reinicialização. */
function Failed() {
  const reason = useRestart((s) => s.reason);
  useModal("restart-ok");
  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="restart-title">
      <FocusGroup focusKey="restart" className="dialog" boundary preferredChildFocusKey="restart-ok">
        <h2 id="restart-title">{t("Reinicie o PC")}</h2>
        <p>{reason === "update" ? t("Não foi possível reiniciar sozinho. Reinicie pelo menu de energia do Windows ou pelo menu Guia.") : t("Não foi possível reiniciar sozinho. O modo console só vale depois de reiniciar: faça isso pelo menu de energia do Windows ou pelo menu Guia.")}</p>
        <div className="dialog-actions">
          <Focusable focusKey="restart-ok" className="btn btn-primary" scroll={false} onPress={() => useRestart.getState().dismiss()}>
            {t("Entendi")}
          </Focusable>
        </div>
      </FocusGroup>
      <Hints modal items={[{ btn: "A", label: "Selecionar" }]} />
    </div>
  );
}

export function RestartCountdown() {
  const endsAt = useRestart((s) => s.endsAt);
  const failed = useRestart((s) => s.failed);
  if (failed) return <Failed />;
  return endsAt === null ? null : <Counting endsAt={endsAt} />;
}
