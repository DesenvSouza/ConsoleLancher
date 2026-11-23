import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { playSound } from "../audio/sounds";
import { useModal } from "../hooks/useModal";
import { t, te } from "../i18n";
import { onAction } from "../input/actions";
import { api, type BtDevice, type BtList, type WifiList, type WifiNetwork } from "../lib/api";
import { useSystem } from "../store/system";
import { useUI } from "../store/ui";
import { Hints, type Hint } from "./Chrome";
import { ConfirmDialog } from "./ConfirmDialog";
import { FocusGroup, Focusable } from "./Focusable";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import { NetworkIcon } from "./System";

/** Quando há um diálogo ou o teclado por cima desta tela, os botões são deles (o painel conta como 1 modal). */
function coveredByDialog(): boolean {
  return useUI.getState().modalDepth > 1;
}

function toast(text: string, sound?: "success" | "warning") {
  useUI.getState().showToast(text, sound);
}

interface ShellProps {
  title: string;
  /** Linha de estado embaixo do título (o que está acontecendo agora). */
  status: string;
  firstFocus: string;
  hints: Hint[];
  onBack: () => void;
  /** Botões extras (X, Y) tratados pela tela. */
  onButton: (button: "x" | "y") => void;
  children: ReactNode;
}

/** Moldura das duas telas: título, lista rolável e legenda. B volta ao painel Sistema. */
function Shell({ title, status, firstFocus, hints, onBack, onButton, children }: ShellProps) {
  const backRef = useRef(onBack);
  const buttonRef = useRef(onButton);
  backRef.current = onBack;
  buttonRef.current = onButton;

  useModal(firstFocus);
  useEffect(() => onAction((a) => {
    if (coveredByDialog()) return;
    if (a === "back") {
      playSound("back");
      backRef.current();
    } else if (a === "x" || a === "y") buttonRef.current(a);
  }), []);

  return (
    <div className="overlay">
      <FocusGroup focusKey="sys-sub" className="menu sys-menu sys-sub" boundary preferredChildFocusKey={firstFocus}>
        <div className="menu-head">
          <div>
            <h2>{title}</h2>
            <p role="status">{status}</p>
          </div>
        </div>
        {children}
      </FocusGroup>
      <Hints modal items={hints} />
    </div>
  );
}

// ───────── Wi-Fi ─────────

function securityText(network: WifiNetwork): string {
  if (network.security === "enterprise" || network.security === "other") return t("Rede não aceita aqui");
  if (network.known) return t("Senha salva");
  return network.security === "open" ? t("Aberta") : t("Protegida por senha");
}

export function WifiPanel() {
  const closeSub = useSystem((s) => s.closeSubpanel);
  const [list, setList] = useState<WifiList | null>(null);
  const [busy, setBusy] = useState("");
  const [password, setPassword] = useState<WifiNetwork | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "disconnect" | "forget"; network: WifiNetwork } | null>(null);
  const focused = useRef<string | null>(null);
  const working = useRef(false);

  const load = useCallback(async (rescan: boolean) => {
    if (working.current && rescan) return;
    if (rescan) setBusy(t("Procurando redes…"));
    try {
      setList(await api.wifiList(rescan));
    } catch (error) {
      toast(te(error), "warning");
    } finally {
      if (rescan) setBusy("");
    }
  }, []);

  // Mostra o que o Windows já sabe e, em seguida, pede uma busca nova.
  useEffect(() => {
    let alive = true;
    void api.wifiList(false).then((first) => {
      if (!alive) return;
      setList(first);
      if (first.adapter) void load(true);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [load]);

  async function run(label: string, action: () => Promise<void>, done: string) {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    try {
      await action();
      toast(done, "success");
    } catch (error) {
      toast(te(error), "warning");
    } finally {
      working.current = false;
      setBusy("");
      void useSystem.getState().refresh();
      void load(false);
    }
  }

  function connect(network: WifiNetwork, secret?: string) {
    void run(t("Conectando a {name}…", { name: network.ssid }), () => api.wifiConnect(network.ssid, secret), t("Conectado a {name}", { name: network.ssid }));
  }

  function choose(network: WifiNetwork) {
    if (working.current) return;
    if (network.connected) return setConfirm({ kind: "disconnect", network });
    if (network.security === "enterprise" || network.security === "other") return toast(t("Este tipo de rede não é aceito aqui."), "warning");
    if (network.known || network.security === "open") return connect(network);
    setPassword(network);
  }

  const onButton = (button: "x" | "y") => {
    if (button === "x") return void load(true);
    const network = list?.networks.find((n) => `sys-wifi-${n.ssid}` === focused.current);
    if (network?.known) setConfirm({ kind: "forget", network });
  };

  const networks = list?.networks ?? [];
  return (
    <>
      <Shell
        title={t("Wi-Fi")}
        status={busy || (list && !list.adapter ? t("Este PC não tem Wi-Fi") : t("Escolha uma rede"))}
        firstFocus="sys-wifi-scan"
        hints={[{ btn: "A", label: "Selecionar" }, { btn: "X", label: "Atualizar" }, { btn: "Y", label: "Esquecer rede" }, { btn: "B", label: "Voltar" }]}
        onBack={closeSub}
        onButton={onButton}
      >
        {list && !list.adapter ? (
          <p className="sys-info warn">{t("Nenhum adaptador Wi-Fi foi encontrado neste PC (ou ele está desligado).")}</p>
        ) : (
          <>
            <Focusable focusKey="sys-wifi-scan" className="sys-row" scroll={false} onFocus={() => { focused.current = null; }} onPress={() => void load(true)}>
              <span className="sys-label">{t("Procurar redes")}</span>
            </Focusable>
            {networks.map((network) => (
              <Focusable
                key={network.ssid}
                focusKey={`sys-wifi-${network.ssid}`}
                className="sys-row"
                onFocus={() => { focused.current = `sys-wifi-${network.ssid}`; }}
                onPress={() => choose(network)}
              >
                <span className="sys-label">
                  {network.ssid}
                  <small>{securityText(network)}</small>
                </span>
                <span className={`sys-value ${network.connected ? "" : "sys-dim"}`}>
                  {network.connected ? t("Conectada") : ""}
                  <span className="sys-ind"><NetworkIcon network={{ kind: "wifi", name: network.ssid, signal: network.signal, internet: true, wifiAdapter: true }} /></span>
                </span>
              </Focusable>
            ))}
            {list && networks.length === 0 && !busy && <p className="sys-info">{t("Nenhuma rede encontrada. Aperte X para procurar de novo.")}</p>}
          </>
        )}
      </Shell>

      {password && (
        <OnScreenKeyboard
          secret
          title={t("Senha de {name}", { name: password.ssid })}
          hint={t("Digite a senha do Wi-Fi.")}
          placeholder={t("Senha")}
          maxLength={63}
          confirmLabel={t("Conectar")}
          onCancel={() => setPassword(null)}
          onSubmit={(secret) => {
            const network = password;
            if (network.security !== "open" && secret.length < 8) return toast(t("A senha do Wi-Fi tem de 8 a 63 caracteres."), "warning");
            setPassword(null);
            connect(network, secret);
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "disconnect" ? t("Desconectar de {name}?", { name: confirm.network.ssid }) : t("Esquecer {name}?", { name: confirm.network.ssid })}
          message={confirm.kind === "disconnect" ? t("O PC fica sem essa rede até você conectar de novo.") : t("A senha salva é apagada. Na próxima vez será preciso digitá-la.")}
          confirmLabel={confirm.kind === "disconnect" ? t("Desconectar") : t("Esquecer")}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const { kind, network } = confirm;
            setConfirm(null);
            if (kind === "disconnect") void run(t("Desconectando…"), api.wifiDisconnect, t("Desconectado de {name}", { name: network.ssid }));
            else void run(t("Esquecendo a rede…"), () => api.wifiForget(network.ssid), t("Rede esquecida"));
          }}
        />
      )}
    </>
  );
}

// ───────── Bluetooth ─────────

function kindText(device: BtDevice): string {
  return device.kind === "audio" ? t("Áudio (fone ou caixa)") : device.kind === "input" ? t("Controle, teclado ou mouse") : t("Dispositivo");
}

export function BluetoothPanel() {
  const closeSub = useSystem((s) => s.closeSubpanel);
  const [paired, setPaired] = useState<BtList | null>(null);
  const [nearby, setNearby] = useState<BtDevice[]>([]);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<BtDevice | null>(null);
  const focused = useRef<string | null>(null);
  const working = useRef(false);

  const load = useCallback(async () => {
    try {
      setPaired(await api.bluetoothPaired());
    } catch (error) {
      toast(te(error), "warning");
    }
  }, []);

  useEffect(() => {
    void load();
    // Conecta/desconecta por fora (ligar o fone, por exemplo): acompanha o estado enquanto a tela está aberta.
    const timer = setInterval(() => { if (!working.current) void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function run(label: string, action: () => Promise<void>, done: string) {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    try {
      await action();
      toast(done, "success");
    } catch (error) {
      toast(te(error), "warning");
    } finally {
      working.current = false;
      setBusy("");
      void load();
    }
  }

  function scan() {
    if (working.current) return;
    working.current = true;
    setBusy(t("Procurando dispositivos… (cerca de 30 s)"));
    api.bluetoothDiscover().then((found) => {
      setNearby(found.devices);
      if (found.devices.length === 0) toast(t("Nenhum dispositivo novo encontrado. Coloque-o em modo de emparelhamento."), "warning");
    }).catch((error) => toast(te(error), "warning")).finally(() => {
      working.current = false;
      setBusy("");
    });
  }

  function chooseNew(device: BtDevice) {
    void run(t("Emparelhando com {name}…", { name: device.name }), async () => {
      await api.bluetoothPair(device.id);
      setNearby((list) => list.filter((d) => d.id !== device.id));
    }, t("{name} emparelhado", { name: device.name }));
  }

  function choosePaired(device: BtDevice) {
    if (working.current) return;
    if (device.kind !== "audio") return toast(t("Este dispositivo conecta sozinho quando você o liga."));
    const connect = !device.connected;
    void run(
      connect ? t("Conectando a {name}…", { name: device.name }) : t("Desconectando de {name}…", { name: device.name }),
      () => api.bluetoothSetConnected(device.id, connect),
      connect ? t("Conectado a {name}", { name: device.name }) : t("Desconectado de {name}", { name: device.name }),
    );
  }

  const onButton = (button: "x" | "y") => {
    if (button === "x") return scan();
    const device = paired?.devices.find((d) => `sys-bt-${d.id}` === focused.current);
    if (device) setConfirm(device);
  };

  return (
    <>
      <Shell
        title={t("Bluetooth")}
        status={busy || (paired && !paired.adapter ? t("Este PC não tem Bluetooth") : t("Dispositivos emparelhados"))}
        firstFocus="sys-bt-scan"
        hints={[{ btn: "A", label: "Selecionar" }, { btn: "X", label: "Procurar novos" }, { btn: "Y", label: "Esquecer dispositivo" }, { btn: "B", label: "Voltar" }]}
        onBack={closeSub}
        onButton={onButton}
      >
        {paired && !paired.adapter ? (
          <p className="sys-info warn">{t("Nenhum adaptador Bluetooth foi encontrado neste PC (ou ele está desligado).")}</p>
        ) : (
          <>
            <Focusable focusKey="sys-bt-scan" className="sys-row" scroll={false} onFocus={() => { focused.current = null; }} onPress={scan}>
              <span className="sys-label">
                {t("Procurar novos dispositivos")}
                <small>{t("Coloque o dispositivo em modo de emparelhamento antes de procurar.")}</small>
              </span>
            </Focusable>
            {paired?.devices.map((device) => (
              <Focusable
                key={device.id}
                focusKey={`sys-bt-${device.id}`}
                className="sys-row"
                onFocus={() => { focused.current = `sys-bt-${device.id}`; }}
                onPress={() => choosePaired(device)}
              >
                <span className="sys-label">
                  {device.name}
                  <small>{kindText(device)}</small>
                </span>
                <span className={`sys-value ${device.connected ? "" : "sys-dim"}`}>{device.connected ? t("Conectado") : t("Desconectado")}</span>
              </Focusable>
            ))}
            {paired && paired.devices.length === 0 && <p className="sys-info">{t("Nenhum dispositivo emparelhado ainda.")}</p>}
            {nearby.length > 0 && <h3 className="sys-heading">{t("Encontrados por perto")}</h3>}
            {nearby.map((device) => (
              <Focusable
                key={device.id}
                focusKey={`sys-bt-${device.id}`}
                className="sys-row"
                onFocus={() => { focused.current = null; }}
                onPress={() => chooseNew(device)}
              >
                <span className="sys-label">
                  {device.name}
                  <small>{kindText(device)}</small>
                </span>
                <span className="sys-value">{t("Emparelhar")}</span>
              </Focusable>
            ))}
          </>
        )}
      </Shell>

      {confirm && (
        <ConfirmDialog
          title={t("Esquecer {name}?", { name: confirm.name })}
          message={t("O dispositivo será removido do PC. Para usá-lo de novo, será preciso emparelhar outra vez.")}
          confirmLabel={t("Esquecer")}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const device = confirm;
            setConfirm(null);
            void run(t("Esquecendo {name}…", { name: device.name }), () => api.bluetoothForget(device.id), t("{name} esquecido", { name: device.name }));
          }}
        />
      )}
    </>
  );
}
