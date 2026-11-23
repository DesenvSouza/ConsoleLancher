import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState } from "react";
import { useModal } from "../hooks/useModal";
import { t, te } from "../i18n";
import { rich } from "../i18n/rich";
import { onAction } from "../input/actions";
import { isTauri } from "../lib/api";
import { steam, type QrChallenge, type QrPoll } from "../lib/steam";
import { Hints } from "./Chrome";
import { FocusGroup, Focusable } from "./Focusable";

interface Props {
  /** O jogador aprovou o QR no celular: a sessão já está guardada neste PC. */
  onSignedIn: (accountName: string, steamId: string) => void;
  onCancel: () => void;
}

/** QR code como SVG (preto sobre branco, com margem: leitores de celular precisam do espaço em volta). */
function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 3, scalable: true });
}

/** No navegador (sem o app) o QR é de mentira e a aprovação vem sozinha depois de alguns segundos. */
const mockBegin = (): Promise<QrChallenge> => Promise.resolve({ clientId: "1", requestId: "1", challengeUrl: "https://s.team/q/1/10349974896347377710", interval: 2 });
const mockPoll = (since: number): Promise<QrPoll> =>
  Promise.resolve(Date.now() - since > 8000 ? { approved: true, accountName: "conta_demo", steamId: "76561198000000000" } : { approved: false });

/**
 * Login na Steam lendo um QR code com o app da Steam no celular. Não há campo para e-mail nem senha: quem aprova é o
 * celular (com o Steam Guard dele).
 */
export function QrLoginDialog({ onSignedIn, onCancel }: Props) {
  useModal("qr-cancel");
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => onAction((a) => a === "back" && cancelRef.current()), []);

  const [challenge, setChallenge] = useState<QrChallenge | null>(null);
  const [error, setError] = useState("");
  /** Muda para pedir um QR novo. */
  const [round, setRound] = useState(0);

  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    setChallenge(null);
    setError("");

    const pollLoop = (current: QrChallenge) => {
      timer = setTimeout(async () => {
        try {
          const result = await (isTauri ? steam.authPoll(current.clientId, current.requestId) : mockPoll(startedAt));
          if (!alive) return;
          if (result.approved && result.steamId) {
            signedIn.current(result.accountName ?? "", result.steamId);
            return;
          }
          // A Steam troca o QR de tempos em tempos: mostra o novo.
          const next = result.newClientId && result.newChallengeUrl ? { ...current, clientId: result.newClientId, challengeUrl: result.newChallengeUrl } : current;
          if (next !== current) setChallenge(next);
          pollLoop(next);
        } catch {
          if (!alive) return;
          setError(t("O QR expirou. Gerando outro…"));
          setTimeout(() => alive && setRound((r) => r + 1), 1200);
        }
      }, Math.max(2, current.interval) * 1000);
    };

    (async () => {
      try {
        const fresh = await (isTauri ? steam.authBegin() : mockBegin());
        if (!alive) return;
        setChallenge(fresh);
        pollLoop(fresh);
      } catch (e) {
        if (alive) setError(te(e));
      }
    })();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [round]);

  const svg = useMemo(() => (challenge ? qrSvg(challenge.challengeUrl) : ""), [challenge]);

  return (
    <div className="overlay" role="alertdialog" aria-modal="true">
      <FocusGroup focusKey="qr-dialog" className="dialog qr-dialog" boundary preferredChildFocusKey="qr-cancel">
        <h2>{t("Entrar com a conta Steam")}</h2>
        <div className="qr-body">
          <div className="qr-box">
            {svg ? <div className="qr-code" aria-label={t("QR code de login da Steam")} dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="spinner qr-spinner" />}
          </div>
          <ol className="qr-steps">
            <li>{rich(t("Abra o app da <b>Steam</b> no celular."))}</li>
            <li>{rich(t("Toque no ícone do <b>Steam Guard</b> (escudo) e em <b>Ler um código QR</b>."))}</li>
            <li>{rich(t("Aponte a câmera para o código ao lado e <b>aprove</b> o login."))}</li>
          </ol>
        </div>
        <p className={error ? "qr-note qr-error" : "qr-note"}>
          {error || (isTauri ? t("Esperando a aprovação no celular… Sua senha nunca passa por este launcher.") : t("(navegador) Código de demonstração: ele só funciona no app."))}
        </p>
        <div className="dialog-actions">
          <Focusable focusKey="qr-cancel" className="btn" onPress={onCancel} scroll={false}>
            {t("Cancelar")}
          </Focusable>
          <Focusable focusKey="qr-renew" className="btn btn-primary" onPress={() => setRound((r) => r + 1)} scroll={false}>
            {t("Gerar outro QR")}
          </Focusable>
        </div>
      </FocusGroup>
      <Hints modal items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Cancelar" }]} />
    </div>
  );
}
