//! Bluetooth para o painel do sistema: dispositivos emparelhados, procurar novos, parear, conectar/desconectar e esquecer.
//!
//! - Listar, procurar, parear e esquecer usam a API de dispositivos do Windows (WinRT), que enxerga o Bluetooth clássico
//!   (fones, caixas, controles de PlayStation) e o Bluetooth de baixo consumo (controle do Xbox, teclados).
//! - Conectar e desconectar **áudio** (fones e caixas) liga e desliga os serviços de áudio do dispositivo pela API clássica
//!   do Windows. Controles e teclados não precisam disso: conectam sozinhos quando são ligados.
//! - O emparelhamento aceita só o modo "sem código" (o comum em controles, fones e caixas). Dispositivos que pedem um
//!   código (alguns teclados e celulares) precisam ser emparelhados pelo Windows.

use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::{GUID, HSTRING};
use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice, BluetoothMajorClass};
use windows::Devices::Enumeration::{
    DeviceInformation, DevicePairingKinds, DevicePairingRequestedEventArgs, DevicePairingResultStatus, DeviceUnpairingResultStatus,
};
use windows::Foundation::TypedEventHandler;
use windows::Win32::Devices::Bluetooth::{
    BluetoothSetServiceState, BLUETOOTH_ADDRESS, BLUETOOTH_DEVICE_INFO, BLUETOOTH_SERVICE_DISABLE, BLUETOOTH_SERVICE_ENABLE,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BtDevice {
    pub id: String,
    pub name: String,
    pub paired: bool,
    pub connected: bool,
    /// "audio" (fones, caixas), "input" (controles, teclados, mouses) ou "other".
    pub kind: &'static str,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BtList {
    /// Há um adaptador Bluetooth ativo neste PC.
    pub adapter: bool,
    pub devices: Vec<BtDevice>,
}

struct Com(bool);

impl Com {
    fn new() -> Self {
        // SAFETY: inicialização padrão do COM nesta thread; só desfazemos o que nós mesmos fizemos.
        Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: par do CoInitializeEx que deu certo.
            unsafe { CoUninitialize() };
        }
    }
}

fn kind_of_class(major: BluetoothMajorClass) -> &'static str {
    match major {
        BluetoothMajorClass::AudioVideo => "audio",
        BluetoothMajorClass::Peripheral => "input",
        _ => "other",
    }
}

/// Procura dispositivos (já emparelhados ou ainda não) no Bluetooth clássico e no de baixo consumo.
/// Sem adaptador Bluetooth, o Windows devolve lista vazia; `None` só quando a consulta nem pôde ser feita.
fn find(paired: bool) -> Option<Vec<BtDevice>> {
    let mut devices: Vec<BtDevice> = Vec::new();
    let mut asked = false;

    // Chamadas WinRT bloqueantes, feitas fora da thread da interface.
    {
        let classic = BluetoothDevice::GetDeviceSelectorFromPairingState(paired).ok();
        let low_energy = BluetoothLEDevice::GetDeviceSelectorFromPairingState(paired).ok();

        for (selector, is_le) in [(classic, false), (low_energy, true)] {
            let Some(selector) = selector else { continue };
            let Ok(operation) = DeviceInformation::FindAllAsyncAqsFilter(&selector) else { continue };
            let Ok(found) = operation.join() else { continue };
            asked = true;
            for info in found {
                let (Ok(id), Ok(name)) = (info.Id(), info.Name()) else { continue };
                let name = name.to_string();
                if name.trim().is_empty() {
                    continue; // dispositivo sem nome: não há o que mostrar
                }
                let (connected, kind) = if is_le {
                    match BluetoothLEDevice::FromIdAsync(&id).and_then(|o| o.join()) {
                        Ok(device) => (device.ConnectionStatus().is_ok_and(|s| s == BluetoothConnectionStatus::Connected), "input"),
                        Err(_) => (false, "input"),
                    }
                } else {
                    match BluetoothDevice::FromIdAsync(&id).and_then(|o| o.join()) {
                        Ok(device) => (
                            device.ConnectionStatus().is_ok_and(|s| s == BluetoothConnectionStatus::Connected),
                            device.ClassOfDevice().and_then(|c| c.MajorClass()).map(kind_of_class).unwrap_or("other"),
                        ),
                        Err(_) => (false, "other"),
                    }
                };
                devices.push(BtDevice { id: id.to_string(), name, paired, connected, kind });
            }
        }
    }
    asked.then(|| merge_by_name(devices))
}

/// O mesmo aparelho costuma aparecer duas vezes (clássico e baixo consumo): fica um só, conectado se algum estiver.
fn merge_by_name(devices: Vec<BtDevice>) -> Vec<BtDevice> {
    let mut merged: Vec<BtDevice> = Vec::new();
    for device in devices {
        match merged.iter_mut().find(|d| d.name == device.name) {
            Some(existing) => {
                existing.connected |= device.connected;
                if existing.kind == "other" {
                    existing.kind = device.kind;
                }
            }
            None => merged.push(device),
        }
    }
    merged.sort_by(|a, b| b.connected.cmp(&a.connected).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    merged
}

/// Os dispositivos já emparelhados, com o estado de conexão.
pub fn paired() -> BtList {
    let _com = Com::new();
    match find(true) {
        Some(devices) => BtList { adapter: true, devices },
        None => BtList { adapter: false, devices: Vec::new() },
    }
}

/// Tempo máximo da busca por dispositivos novos. O Windows faz uma varredura de ~30 s e entrega tudo no fim dela.
const DISCOVER_SECONDS: u64 = 45;

/// Procura dispositivos novos por perto (leva uns 30 s). Os já emparelhados não entram.
pub fn discover() -> BtList {
    let _com = Com::new();
    let known: HashSet<String> = find(true).unwrap_or_default().into_iter().map(|d| d.name).collect();
    let (Ok(classic), Ok(low_energy)) = (BluetoothDevice::GetDeviceSelectorFromPairingState(false), BluetoothLEDevice::GetDeviceSelectorFromPairingState(false))
    else {
        return BtList { adapter: false, devices: Vec::new() };
    };

    // Dois observadores (clássico e baixo consumo) ouvem ao mesmo tempo: o resultado vai chegando e a espera é uma só.
    let found: Arc<Mutex<Vec<(String, String, bool)>>> = Arc::new(Mutex::new(Vec::new()));
    let finished = Arc::new(AtomicUsize::new(0));
    let mut watchers = Vec::new();
    for (selector, is_le) in [(classic, false), (low_energy, true)] {
        let Ok(watcher) = DeviceInformation::CreateWatcherAqsFilter(&selector) else { continue };
        let sink = Arc::clone(&found);
        let added = watcher.Added(&TypedEventHandler::new(move |_, info: windows::core::Ref<'_, DeviceInformation>| {
            if let Some(info) = info.as_ref() {
                sink.lock().unwrap().push((info.Id()?.to_string(), info.Name()?.to_string(), is_le));
            }
            Ok(())
        }));
        let done = Arc::clone(&finished);
        let completed = watcher.EnumerationCompleted(&TypedEventHandler::new(move |_, _| {
            done.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }));
        if added.is_ok() && completed.is_ok() && watcher.Start().is_ok() {
            watchers.push(watcher);
        }
    }
    if watchers.is_empty() {
        return BtList { adapter: false, devices: Vec::new() };
    }
    // Espera as duas varreduras terminarem (ou o limite de tempo).
    let deadline = Instant::now() + Duration::from_secs(DISCOVER_SECONDS);
    while finished.load(Ordering::SeqCst) < watchers.len() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
    }
    for watcher in &watchers {
        let _ = watcher.Stop();
    }

    let found = found.lock().unwrap().clone();
    let devices = found
        .into_iter()
        .filter(|(_, name, _)| !name.trim().is_empty() && !known.contains(name))
        .map(|(id, name, is_le)| {
            let kind = if is_le {
                "input"
            } else {
                BluetoothDevice::FromIdAsync(&HSTRING::from(id.as_str()))
                    .and_then(|o| o.join())
                    .and_then(|d| d.ClassOfDevice())
                    .and_then(|c| c.MajorClass())
                    .map(kind_of_class)
                    .unwrap_or("other")
            };
            BtDevice { id, name, paired: false, connected: false, kind }
        })
        .collect();
    BtList { adapter: true, devices: merge_by_name(devices) }
}

/// Empareia (modo "sem código"): o dispositivo precisa estar em modo de emparelhamento.
pub fn pair(id: &str) -> Result<(), String> {
    let _com = Com::new();
    let info = DeviceInformation::CreateFromIdAsync(&HSTRING::from(id)).and_then(|o| o.join()).map_err(|e| e.to_string())?;
    let custom = info.Pairing().and_then(|p| p.Custom()).map_err(|e| e.to_string())?;
    let token = custom
        .PairingRequested(&TypedEventHandler::new(|_, args: windows::core::Ref<'_, DevicePairingRequestedEventArgs>| {
            if let Some(args) = args.as_ref() {
                args.Accept()?;
            }
            Ok(())
        }))
        .map_err(|e| e.to_string())?;
    let result = custom.PairAsync(DevicePairingKinds::ConfirmOnly).and_then(|o| o.join());
    let _ = custom.RemovePairingRequested(token);
    match result.map_err(|e| e.to_string())?.Status().map_err(|e| e.to_string())? {
        DevicePairingResultStatus::Paired | DevicePairingResultStatus::AlreadyPaired => Ok(()),
        DevicePairingResultStatus::AuthenticationNotAllowed
        | DevicePairingResultStatus::AuthenticationFailure
        | DevicePairingResultStatus::RequiredHandlerNotRegistered => {
            Err("Este dispositivo pede um código de emparelhamento. Emparelhe pelo Windows.".into())
        }
        DevicePairingResultStatus::ConnectionRejected | DevicePairingResultStatus::Failed => {
            Err("Não foi possível emparelhar. Coloque o dispositivo em modo de emparelhamento e tente de novo.".into())
        }
        other => Err(format!("O emparelhamento não foi concluído: código {}", other.0)),
    }
}

/// Esquece o dispositivo (remove o emparelhamento).
pub fn forget(id: &str) -> Result<(), String> {
    let _com = Com::new();
    let info = DeviceInformation::CreateFromIdAsync(&HSTRING::from(id)).and_then(|o| o.join()).map_err(|e| e.to_string())?;
    let result = info.Pairing().and_then(|p| p.UnpairAsync()).and_then(|o| o.join()).map_err(|e| e.to_string())?;
    match result.Status().map_err(|e| e.to_string())? {
        DeviceUnpairingResultStatus::Unpaired | DeviceUnpairingResultStatus::AlreadyUnpaired => Ok(()),
        other => Err(format!("Não foi possível esquecer o dispositivo: código {}", other.0)),
    }
}

// Serviços de áudio do Bluetooth clássico: fone/caixa (A2DP), mãos-livres e fone antigo.
const AUDIO_SERVICES: [GUID; 3] = [
    GUID::from_u128(0x0000110b_0000_1000_8000_00805f9b34fb),
    GUID::from_u128(0x0000111e_0000_1000_8000_00805f9b34fb),
    GUID::from_u128(0x00001108_0000_1000_8000_00805f9b34fb),
];

fn classic_device(id: &str) -> Result<BluetoothDevice, String> {
    BluetoothDevice::FromIdAsync(&HSTRING::from(id))
        .and_then(|o| o.join())
        .map_err(|_| "Este dispositivo não é de áudio: ele conecta sozinho quando você o liga.".to_string())
}

fn is_connected(id: &str) -> bool {
    classic_device(id).and_then(|d| d.ConnectionStatus().map_err(|e| e.to_string())).is_ok_and(|s| s == BluetoothConnectionStatus::Connected)
}

fn set_audio_services(address: u64, enable: bool) {
    let info = BLUETOOTH_DEVICE_INFO {
        dwSize: std::mem::size_of::<BLUETOOTH_DEVICE_INFO>() as u32,
        Address: BLUETOOTH_ADDRESS { Anonymous: windows::Win32::Devices::Bluetooth::BLUETOOTH_ADDRESS_0 { ullLong: address } },
        ..Default::default()
    };
    let flag = if enable { BLUETOOTH_SERVICE_ENABLE } else { BLUETOOTH_SERVICE_DISABLE };
    for service in &AUDIO_SERVICES {
        // SAFETY: `info` está preenchido e vive até o fim da chamada; erros de serviços que o aparelho não tem são esperados.
        unsafe { BluetoothSetServiceState(None, &info, service, flag) };
    }
}

fn wait_for(id: &str, connected: bool, seconds: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
        if is_connected(id) == connected {
            return true;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    is_connected(id) == connected
}

/// Conecta (ou desconecta) um dispositivo de áudio já emparelhado.
pub fn set_connected(id: &str, connect: bool) -> Result<(), String> {
    let _com = Com::new();
    let address = classic_device(id)?.BluetoothAddress().map_err(|e| e.to_string())?;
    if connect {
        // Desligar e ligar de novo os serviços faz o Windows refazer a conexão.
        set_audio_services(address, false);
        std::thread::sleep(Duration::from_millis(400));
        set_audio_services(address, true);
        if wait_for(id, true, 12) {
            Ok(())
        } else {
            Err("Não foi possível conectar. Ligue o dispositivo e deixe-o perto do PC.".into())
        }
    } else {
        set_audio_services(address, false);
        if wait_for(id, false, 6) {
            Ok(())
        } else {
            Err("O dispositivo continua conectado.".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(name: &str, connected: bool, kind: &'static str) -> BtDevice {
        BtDevice { id: name.to_string(), name: name.to_string(), paired: true, connected, kind }
    }

    #[test]
    fn mesmo_aparelho_em_duas_listas_vira_um() {
        let merged = merge_by_name(vec![device("JBL", false, "audio"), device("Controle", true, "input"), device("JBL", true, "other")]);
        assert_eq!(merged.len(), 2);
        let jbl = merged.iter().find(|d| d.name == "JBL").unwrap();
        assert!(jbl.connected);
        assert_eq!(jbl.kind, "audio");
    }

    #[test]
    fn conectados_vem_primeiro_e_o_resto_em_ordem_alfabetica() {
        let merged = merge_by_name(vec![device("b", false, "audio"), device("c", true, "audio"), device("A", false, "input")]);
        let names: Vec<_> = merged.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, ["c", "A", "b"]);
    }

    #[test]
    fn classe_do_dispositivo() {
        assert_eq!(kind_of_class(BluetoothMajorClass::AudioVideo), "audio");
        assert_eq!(kind_of_class(BluetoothMajorClass::Peripheral), "input");
        assert_eq!(kind_of_class(BluetoothMajorClass::Phone), "other");
    }

    /// Leitura no PC real (nada é alterado): `cargo test --lib lista_os_emparelhados -- --ignored --nocapture`.
    #[test]
    #[ignore = "usa o Bluetooth deste PC"]
    fn lista_os_emparelhados() {
        let list = paired();
        println!("{list:#?}");
        assert!(list.adapter, "nenhum adaptador Bluetooth respondeu");
    }

    /// Procura dispositivos por perto (só procura, não emparelha): `cargo test --lib procura_por_perto -- --ignored --nocapture`.
    #[test]
    #[ignore = "faz uma busca Bluetooth de alguns segundos"]
    fn procura_por_perto() {
        let started = std::time::Instant::now();
        let list = discover();
        println!("{} dispositivo(s) novo(s) em {:?}: {list:#?}", list.devices.len(), started.elapsed());
        assert!(list.adapter);
    }
}
