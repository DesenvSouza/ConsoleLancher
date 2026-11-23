//! Controles do sistema para o launcher: volume, saída de áudio, rede e bateria do controle.
//!
//! Servem ao painel "Sistema" (ícones ao lado do relógio) e ao menu Guia. No modo console (sem Explorer) não há bandeja,
//! relógio nem controle de volume do Windows, então o launcher precisa ter os dele.
//!
//! Cada parte falha sozinha: se o Windows não responder sobre o áudio, por exemplo, a rede e a bateria continuam saindo.

use std::ffi::c_void;

use serde::Serialize;
use windows::core::PWSTR;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eCommunications, eConsole, eMultimedia, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::NetworkManagement::WiFi::{
    wlan_intf_opcode_current_connection, wlan_interface_state_connected, WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory,
    WlanOpenHandle, WlanQueryInterface, WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO_LIST,
};
use windows::Win32::Networking::NetworkListManager::{
    INetworkListManager, NetworkListManager, NLM_CONNECTIVITY_IPV4_INTERNET, NLM_CONNECTIVITY_IPV6_INTERNET,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};

// ───────── Dados que vão para a interface ─────────

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub id: String,
    pub name: String,
    /// É a saída padrão do Windows agora.
    pub current: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    /// "wifi", "wired" ou "none".
    pub kind: &'static str,
    /// Nome da rede Wi-Fi (vazio nos outros casos).
    pub name: String,
    /// Qualidade do sinal Wi-Fi, de 0 a 100.
    pub signal: u32,
    /// O Windows acha que há internet.
    pub internet: bool,
    /// Este PC tem um adaptador Wi-Fi (sem ele, o launcher nem mostra as opções de Wi-Fi).
    pub wifi_adapter: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Bluetooth {
    /// Este PC tem um adaptador Bluetooth ligado.
    pub adapter: bool,
    /// Quantos dispositivos emparelhados estão conectados agora.
    pub connected: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Pad {
    /// Número do controle (1 a 4).
    pub number: u32,
    /// "wired", "empty", "low", "medium", "full" ou "unknown".
    pub battery: &'static str,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    /// 0 a 100.
    pub percent: u32,
    pub muted: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    /// None quando o Windows não respondeu sobre o áudio (sem dispositivo de saída, por exemplo).
    pub volume: Option<Volume>,
    pub outputs: Vec<Output>,
    pub network: Network,
    pub bluetooth: Bluetooth,
    pub pads: Vec<Pad>,
}

// ───────── COM ─────────

/// Inicializa o COM nesta thread enquanto durar a chamada (sem desfazer o que outra parte do programa já tinha feito).
struct Com(bool);

impl Com {
    fn new() -> Self {
        // SAFETY: inicialização padrão do COM; se a thread já estava em outro modo, só não desfazemos depois.
        Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: par do CoInitializeEx que deu certo acima.
            unsafe { CoUninitialize() };
        }
    }
}

fn text(pwstr: PWSTR) -> String {
    // SAFETY: o Windows devolve uma string terminada em zero que nós liberamos em seguida.
    unsafe {
        let value = pwstr.to_string().unwrap_or_default();
        CoTaskMemFree(Some(pwstr.0 as *const c_void));
        value
    }
}

// ───────── Áudio ─────────

fn enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
    // SAFETY: criação padrão do enumerador de dispositivos de áudio.
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

fn endpoint_volume(device: &IMMDevice) -> windows::core::Result<IAudioEndpointVolume> {
    // SAFETY: ativa a interface de volume do próprio dispositivo.
    unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) }
}

fn default_volume() -> windows::core::Result<IAudioEndpointVolume> {
    // SAFETY: consulta o dispositivo de saída padrão.
    let device = unsafe { enumerator()?.GetDefaultAudioEndpoint(eRender, eConsole)? };
    endpoint_volume(&device)
}

fn device_id(device: &IMMDevice) -> windows::core::Result<String> {
    // SAFETY: GetId devolve memória do COM, liberada em `text`.
    Ok(text(unsafe { device.GetId()? }))
}

fn device_name(device: &IMMDevice) -> String {
    // SAFETY: leitura da propriedade "nome amigável" do dispositivo.
    unsafe {
        device
            .OpenPropertyStore(STGM_READ)
            .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
            .map(|value| value.to_string())
            .unwrap_or_default()
    }
}

fn read_volume() -> Option<Volume> {
    let volume = default_volume().ok()?;
    // SAFETY: só leitura do volume mestre.
    unsafe {
        let level = volume.GetMasterVolumeLevelScalar().ok()?;
        let muted = volume.GetMute().map(|m| m.as_bool()).unwrap_or(false);
        Some(Volume { percent: to_percent(level), muted })
    }
}

fn to_percent(level: f32) -> u32 {
    (level.clamp(0.0, 1.0) * 100.0).round() as u32
}

fn read_outputs() -> Vec<Output> {
    let Ok(enumerator) = enumerator() else { return Vec::new() };
    // SAFETY: lista os dispositivos de saída ativos e o padrão atual.
    unsafe {
        let current = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok().and_then(|d| device_id(&d).ok());
        let Ok(list) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return Vec::new() };
        let count = list.GetCount().unwrap_or(0);
        (0..count)
            .filter_map(|i| list.Item(i).ok())
            .filter_map(|device| {
                let id = device_id(&device).ok()?;
                let name = device_name(&device);
                Some(Output { current: current.as_deref() == Some(id.as_str()), name, id })
            })
            .collect()
    }
}

pub fn set_volume(percent: u32) -> Result<Volume, String> {
    let _com = Com::new();
    let level = percent.min(100) as f32 / 100.0;
    let volume = default_volume().map_err(|e| e.to_string())?;
    // SAFETY: ajuste do volume mestre do dispositivo padrão. Mexer no volume tira do mudo (como o do Windows).
    unsafe {
        volume.SetMasterVolumeLevelScalar(level, std::ptr::null()).map_err(|e| e.to_string())?;
        if percent > 0 {
            let _ = volume.SetMute(false, std::ptr::null());
        }
    }
    read_volume().ok_or_else(|| "sem volume".to_string())
}

pub fn set_mute(muted: bool) -> Result<Volume, String> {
    let _com = Com::new();
    let volume = default_volume().map_err(|e| e.to_string())?;
    // SAFETY: liga ou desliga o mudo do dispositivo padrão.
    unsafe { volume.SetMute(muted, std::ptr::null()).map_err(|e| e.to_string())? };
    read_volume().ok_or_else(|| "sem volume".to_string())
}

// A troca do dispositivo padrão não tem API documentada: o próprio Windows (e os programas que trocam a saída) usa esta
// interface do sistema. Só o método `SetDefaultEndpoint` é chamado; os outros existem para a tabela de métodos ficar na
// ordem certa. Os nomes seguem o Windows (por isso o módulo à parte, sem o aviso de nome em snake_case).
#[allow(non_snake_case)]
mod policy {
    use std::ffi::c_void;
    use windows::core::{interface, IUnknown, IUnknown_Vtbl, GUID, HRESULT, PCWSTR};
    use windows::Win32::Media::Audio::ERole;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

    #[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
    unsafe trait IPolicyConfig: IUnknown {
        fn GetMixFormat(&self, device: PCWSTR, format: *mut *mut c_void) -> HRESULT;
        fn GetDeviceFormat(&self, device: PCWSTR, default: i32, format: *mut *mut c_void) -> HRESULT;
        fn ResetDeviceFormat(&self, device: PCWSTR) -> HRESULT;
        fn SetDeviceFormat(&self, device: PCWSTR, endpoint: *mut c_void, mix: *mut c_void) -> HRESULT;
        fn GetProcessingPeriod(&self, device: PCWSTR, default: i32, default_period: *mut i64, min_period: *mut i64) -> HRESULT;
        fn SetProcessingPeriod(&self, device: PCWSTR, period: *mut i64) -> HRESULT;
        fn GetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
        fn SetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
        fn GetPropertyValue(&self, device: PCWSTR, fx: i32, key: *const c_void, value: *mut c_void) -> HRESULT;
        fn SetPropertyValue(&self, device: PCWSTR, fx: i32, key: *const c_void, value: *mut c_void) -> HRESULT;
        fn SetDefaultEndpoint(&self, device: PCWSTR, role: ERole) -> HRESULT;
        fn SetEndpointVisibility(&self, device: PCWSTR, visible: i32) -> HRESULT;
    }

    const CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

    /// Define o dispositivo (`id`, terminado em zero) como o padrão para uma função (jogos, mídia ou comunicação).
    ///
    /// # Safety
    /// `id` precisa ser um identificador de dispositivo de áudio válido, terminado em zero.
    pub unsafe fn set_default_endpoint(id: &[u16], role: ERole) -> Result<(), String> {
        let policy: IPolicyConfig = CoCreateInstance(&CLIENT, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        policy.SetDefaultEndpoint(PCWSTR(id.as_ptr()), role).ok().map_err(|e| e.to_string())
    }
}

/// Troca a saída de áudio padrão (para jogos, mídia e comunicação). Só aceita dispositivos que estão na lista atual.
pub fn set_output(id: &str) -> Result<(), String> {
    let _com = Com::new();
    if !read_outputs().iter().any(|o| o.id == id) {
        return Err("Esta saída de áudio não está mais disponível.".into());
    }
    let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `wide` termina em zero e vive até o fim da chamada; o dispositivo foi conferido na lista acima.
    unsafe {
        for role in [eConsole, eMultimedia, eCommunications] {
            policy::set_default_endpoint(&wide, role)?;
        }
    }
    Ok(())
}

// ───────── Rede ─────────

fn internet_available() -> bool {
    // SAFETY: consulta o gerenciador de redes do Windows.
    unsafe {
        let Ok(manager) = CoCreateInstance::<_, INetworkListManager>(&NetworkListManager, None, CLSCTX_ALL) else { return false };
        manager
            .GetConnectivity()
            .is_ok_and(|c| c.0 & (NLM_CONNECTIVITY_IPV4_INTERNET.0 | NLM_CONNECTIVITY_IPV6_INTERNET.0) != 0)
    }
}

/// Nome e sinal da rede Wi-Fi a que o PC está conectado (None se não há Wi-Fi ou não está conectado).
fn wifi_connection() -> Option<(String, u32)> {
    // SAFETY: usa a API Wlan com o ciclo abrir/enumerar/consultar/liberar/fechar; toda memória do Windows é liberada.
    unsafe {
        let mut version = 0u32;
        let mut handle = HANDLE::default();
        if WlanOpenHandle(2, None, &mut version, &mut handle) != 0 {
            return None;
        }
        let mut found = None;
        let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        if WlanEnumInterfaces(handle, None, &mut list) == 0 && !list.is_null() {
            let interfaces = std::slice::from_raw_parts((*list).InterfaceInfo.as_ptr(), (*list).dwNumberOfItems as usize);
            for info in interfaces {
                if info.isState != wlan_interface_state_connected {
                    continue;
                }
                let mut size = 0u32;
                let mut data: *mut c_void = std::ptr::null_mut();
                if WlanQueryInterface(handle, &info.InterfaceGuid, wlan_intf_opcode_current_connection, None, &mut size, &mut data, None) == 0
                    && !data.is_null()
                {
                    let attributes = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
                    let ssid = &attributes.wlanAssociationAttributes.dot11Ssid;
                    let length = (ssid.uSSIDLength as usize).min(ssid.ucSSID.len());
                    let name = String::from_utf8_lossy(&ssid.ucSSID[..length]).into_owned();
                    found = Some((name, attributes.wlanAssociationAttributes.wlanSignalQuality));
                    WlanFreeMemory(data);
                    break;
                }
            }
            WlanFreeMemory(list as *const c_void);
        }
        WlanCloseHandle(handle, None);
        found
    }
}

fn read_network() -> Network {
    let internet = internet_available();
    let wifi_adapter = crate::wifi::has_adapter();
    match wifi_connection() {
        Some((name, signal)) => Network { kind: "wifi", name, signal: signal.min(100), internet, wifi_adapter },
        // Sem Wi-Fi conectado: com internet (ou com rede local), é cabo.
        None if internet => Network { kind: "wired", name: String::new(), signal: 0, internet, wifi_adapter },
        None => Network { kind: "none", name: String::new(), signal: 0, internet: false, wifi_adapter },
    }
}

// ───────── Bateria do controle (XInput) ─────────

fn battery_label(battery_type: u8, level: u8) -> Option<&'static str> {
    match battery_type {
        0 => None, // sem controle neste número
        1 => Some("wired"),
        _ => Some(match level {
            0 => "empty",
            1 => "low",
            2 => "medium",
            3 => "full",
            _ => "unknown",
        }),
    }
}

#[repr(C)]
#[derive(Default)]
struct BatteryInformation {
    battery_type: u8,
    battery_level: u8,
}

type GetBatteryFn = unsafe extern "system" fn(user: u32, dev_type: u8, info: *mut BatteryInformation) -> u32;

fn read_pads() -> Vec<Pad> {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    let name: Vec<u16> = "xinput1_4.dll\0".encode_utf16().collect();
    // SAFETY: carrega o XInput do sistema e chama a função documentada `XInputGetBatteryInformation`.
    unsafe {
        let module = LoadLibraryW(name.as_ptr());
        if module.is_null() {
            return Vec::new();
        }
        let Some(function) = GetProcAddress(module, c"XInputGetBatteryInformation".as_ptr().cast()) else { return Vec::new() };
        let get: GetBatteryFn = std::mem::transmute::<unsafe extern "system" fn() -> isize, GetBatteryFn>(function);
        (0..4u32)
            .filter_map(|user| {
                let mut info = BatteryInformation::default();
                if get(user, 0, &mut info) != 0 {
                    return None;
                }
                battery_label(info.battery_type, info.battery_level).map(|battery| Pad { number: user + 1, battery })
            })
            .collect()
    }
}

// ───────── Tudo junto ─────────

pub fn status() -> SystemStatus {
    let _com = Com::new();
    let bluetooth = crate::bluetooth::paired();
    SystemStatus {
        volume: read_volume(),
        outputs: read_outputs(),
        network: read_network(),
        bluetooth: Bluetooth { adapter: bluetooth.adapter, connected: bluetooth.devices.iter().filter(|d| d.connected).count() as u32 },
        pads: read_pads(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_vira_porcentagem_dentro_de_0_a_100() {
        assert_eq!(to_percent(0.0), 0);
        assert_eq!(to_percent(0.5), 50);
        assert_eq!(to_percent(0.333), 33);
        assert_eq!(to_percent(1.0), 100);
        assert_eq!(to_percent(1.7), 100);
        assert_eq!(to_percent(-0.2), 0);
    }

    #[test]
    fn bateria_do_controle() {
        assert_eq!(battery_label(0, 0), None);
        assert_eq!(battery_label(1, 3), Some("wired"));
        assert_eq!(battery_label(2, 0), Some("empty"));
        assert_eq!(battery_label(3, 1), Some("low"));
        assert_eq!(battery_label(2, 2), Some("medium"));
        assert_eq!(battery_label(255, 3), Some("full"));
        assert_eq!(battery_label(2, 9), Some("unknown"));
    }

    /// Leitura no PC real (nada é alterado): `cargo test --lib lista_o_estado_do_pc -- --ignored --nocapture`.
    #[test]
    #[ignore = "usa o áudio, a rede e o controle deste PC"]
    fn lista_o_estado_do_pc() {
        let status = status();
        println!("{status:#?}");
        assert!(status.volume.is_some(), "o Windows não respondeu sobre o volume");
        assert!(status.outputs.iter().any(|o| o.current), "nenhuma saída marcada como atual");
    }

    /// Escreve o MESMO volume e a MESMA saída que já estão em uso (efeito nulo), só para provar que a escrita funciona.
    #[test]
    #[ignore = "escreve no áudio deste PC (os mesmos valores que já estão em uso)"]
    fn escreve_os_valores_atuais() {
        let _com = Com::new();
        let before = read_volume().expect("volume");
        let again = if before.muted { set_mute(true).expect("mudo") } else { set_volume(before.percent).expect("volume") };
        assert_eq!(again.percent, before.percent);
        let current = read_outputs().into_iter().find(|o| o.current).expect("saída atual");
        set_output(&current.id).expect("trocar para a mesma saída");
        let after = read_outputs().into_iter().find(|o| o.current).expect("saída atual depois");
        assert_eq!(after.id, current.id);
        assert!(set_output("não-existe").is_err());
    }
}
