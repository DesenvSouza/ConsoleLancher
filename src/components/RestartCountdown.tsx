import { useEffect, useState } from "react";
import { t } from "../i18n";
import { holdInput } from "../input/actions";
import { useModal } from "../hooks/useModal";
import { useRestart } from "../store/restart";
import { Hints } from "./Chrome";
import { FocusGroup, Focusable } from "./Focusable";

/** Contagem da reinicialização. Não há cancelar: a escolha foi feita na confirmação anterior. */
function Counting({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  const reason = useRestart((s) => s.reason);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    // Nenhum botão chega à tela de baixo enquanto o Windows se prepara para reiniciar.
    const release = holdInput(() => {});
    return () => {
      clearInterval(timer);
      release();
    };
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));

  return (
    <div className="overlay restart-overlay" role="alertdialog" aria-modal="true" aria-labelledby="restart-title">
      <div className="dialog">
        <h2 id="restart-title">{t("Reiniciando o PC")}</h2>
        <p role="status">{left === 0 ? t("Reiniciando…") : reason === "update" ? t("O PC será reiniciado em {n} s. Salve o que estiver aberto.", { n: left }) : t("O PC será reiniciado em {n} s para o modo console valer. Salve o que estiver aberto.", { n: left })}</p>
      </div>
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
