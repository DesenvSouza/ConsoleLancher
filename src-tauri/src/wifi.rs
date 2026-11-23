//! Wi-Fi para o painel do sistema: listar redes, conectar (com senha digitada no teclado da tela), desconectar e esquecer.
//!
//! Usa a API Wlan do Windows. As senhas só passam pela memória: viram o perfil da rede (que o Windows guarda protegido)
//! e nunca são registradas em log nem devolvidas à interface.

use std::ffi::c_void;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::NetworkManagement::WiFi::{
    dot11_BSS_type_infrastructure, wlan_connection_mode_profile, wlan_interface_state_connected, wlan_intf_opcode_current_connection,
    WlanCloseHandle, WlanConnect, WlanDeleteProfile, WlanDisconnect, WlanEnumInterfaces, WlanFreeMemory, WlanGetAvailableNetworkList,
    WlanOpenHandle, WlanQueryInterface, WlanScan, WlanSetProfile, DOT11_SSID, WLAN_AVAILABLE_NETWORK_CONNECTED,
    WLAN_AVAILABLE_NETWORK_HAS_PROFILE, WLAN_AVAILABLE_NETWORK_LIST, WLAN_CONNECTION_ATTRIBUTES, WLAN_CONNECTION_PARAMETERS,
    WLAN_INTERFACE_INFO_LIST,
};

/// Como a rede se protege (o que decide se precisa de senha e como montar o perfil).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Security {
    /// Sem senha.
    Open,
    /// WPA2 pessoal (a mais comum).
    Wpa2,
    /// WPA3 pessoal.
    Wpa3,
    /// WPA pessoal antigo.
    Wpa,
    /// Redes de empresa/escola (usuário e senha, certificados): não dá para conectar daqui.
    Enterprise,
    /// Qualquer outra coisa.
    Other,
}

impl Security {
    fn from_wlan(secured: bool, auth: i32) -> Self {
        match (secured, auth) {
            (false, _) => Security::Open,
            (true, 1) => Security::Open, // "aberta" mas marcada com segurança: tratada como aberta
            (true, 4) => Security::Wpa,
            (true, 7) => Security::Wpa2,
            (true, 9) => Security::Wpa3,
            (true, 3 | 6 | 8 | 11) => Security::Enterprise,
            _ => Security::Other,
        }
    }

    fn needs_password(self) -> bool {
        matches!(self, Security::Wpa | Security::Wpa2 | Security::Wpa3)
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WifiNetwork {
    pub ssid: String,
    /// 0 a 100.
    pub signal: u32,
    pub security: Security,
    /// O Windows já tem a senha desta rede guardada.
    pub known: bool,
    pub connected: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WifiList {
    /// Há um adaptador Wi-Fi neste PC (e o serviço do Windows está ativo).
    pub adapter: bool,
    pub networks: Vec<WifiNetwork>,
}

/// Perfil XML da rede (o formato que o Windows guarda). Só para redes com senha (ou abertas).
fn profile_xml(ssid: &str, security: Security, password: Option<&str>) -> Result<String, String> {
    let name = xml_escape(ssid);
    let hex: String = ssid.bytes().map(|b| format!("{b:02X}")).collect();
    let (authentication, encryption) = match security {
        Security::Open => ("open", "none"),
        Security::Wpa2 => ("WPA2PSK", "AES"),
        Security::Wpa3 => ("WPA3SAE", "AES"),
        Security::Wpa => ("WPAPSK", "TKIP"),
        Security::Enterprise | Security::Other => return Err("Este tipo de rede não é aceito aqui.".into()),
    };
    let key = if security.needs_password() {
        let password = password.filter(|p| !p.is_empty()).ok_or("Informe a senha da rede.")?;
        format!(
            "<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>{}</keyMaterial></sharedKey>",
            xml_escape(password)
        )
    } else {
        String::new()
    };
    // WPA3 pessoal precisa do esquema v4 para o modo de transição (redes que aceitam WPA2 e WPA3).
    let transition = if security == Security::Wpa3 {
        "<transitionMode xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v4\">true</transitionMode>"
    } else {
        ""
    };
    Ok(format!(
        "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\"><name>{name}</name>\
         <SSIDConfig><SSID><hex>{hex}</hex><name>{name}</name></SSID></SSIDConfig><connectionType>ESS</connectionType>\
         <connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>{authentication}</authentication>\
         <encryption>{encryption}</encryption><useOneX>false</useOneX>{transition}</authEncryption>{key}</security></MSM></WLANProfile>"
    ))
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn ssid_text(ssid: &DOT11_SSID) -> String {
    let length = (ssid.uSSIDLength as usize).min(ssid.ucSSID.len());
    String::from_utf8_lossy(&ssid.ucSSID[..length]).into_owned()
}

fn from_wide(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

/// Conexão aberta com o serviço Wi-Fi do Windows, usando o primeiro adaptador.
struct Client {
    handle: HANDLE,
    interface: GUID,
}

impl Client {
    fn open() -> Option<Client> {
        // SAFETY: ciclo abrir/enumerar/liberar da API Wlan; o identificador é fechado em `Drop`.
        unsafe {
            let mut version = 0u32;
            let mut handle = HANDLE::default();
            if WlanOpenHandle(2, None, &mut version, &mut handle) != 0 {
                return None;
            }
            let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
            let mut interface = None;
            if WlanEnumInterfaces(handle, None, &mut list) == 0 && !list.is_null() {
                if (*list).dwNumberOfItems > 0 {
                    interface = Some((*list).InterfaceInfo[0].InterfaceGuid);
                }
                WlanFreeMemory(list as *const c_void);
            }
            match interface {
                Some(interface) => Some(Client { handle, interface }),
                None => {
                    WlanCloseHandle(handle, None);
                    None
                }
            }
        }
    }

    fn scan(&self) {
        // SAFETY: pede uma nova varredura; o resultado chega depois, na lista de redes.
        unsafe { WlanScan(self.handle, &self.interface, None, None, None) };
    }

    /// Nome da rede a que o PC está conectado agora.
    fn connected_ssid(&self) -> Option<String> {
        // SAFETY: consulta a conexão atual e libera a memória devolvida pelo Windows.
        unsafe {
            let mut size = 0u32;
            let mut data: *mut c_void = std::ptr::null_mut();
            if WlanQueryInterface(self.handle, &self.interface, wlan_intf_opcode_current_connection, None, &mut size, &mut data, None) != 0
                || data.is_null()
            {
                return None;
            }
            let attributes = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
            let name = (attributes.isState == wlan_interface_state_connected).then(|| ssid_text(&attributes.wlanAssociationAttributes.dot11Ssid));
            WlanFreeMemory(data);
            name
        }
    }

    /// As redes à vista, uma por nome, com a mais forte primeiro. O segundo valor é o nome do perfil guardado (se houver).
    fn networks(&self) -> Vec<(WifiNetwork, String)> {
        // SAFETY: lista as redes disponíveis e libera a memória devolvida pelo Windows.
        unsafe {
            let mut list: *mut WLAN_AVAILABLE_NETWORK_LIST = std::ptr::null_mut();
            if WlanGetAvailableNetworkList(self.handle, &self.interface, 0, None, &mut list) != 0 || list.is_null() {
                return Vec::new();
            }
            let items = std::slice::from_raw_parts((*list).Network.as_ptr(), (*list).dwNumberOfItems as usize);
            let mut networks: Vec<(WifiNetwork, String)> = Vec::new();
            for item in items {
                if item.dot11BssType != dot11_BSS_type_infrastructure {
                    continue;
                }
                let ssid = ssid_text(&item.dot11Ssid);
                if ssid.is_empty() {
                    continue; // rede oculta: não dá para mostrar
                }
                let network = WifiNetwork {
                    signal: item.wlanSignalQuality.min(100),
                    security: Security::from_wlan(item.bSecurityEnabled.as_bool(), item.dot11DefaultAuthAlgorithm.0),
                    known: item.dwFlags & WLAN_AVAILABLE_NETWORK_HAS_PROFILE != 0,
                    connected: item.dwFlags & WLAN_AVAILABLE_NETWORK_CONNECTED != 0,
                    ssid,
                };
                let profile = from_wide(&item.strProfileName);
                match networks.iter_mut().find(|(n, _)| n.ssid == network.ssid) {
                    Some(existing) if existing.0.signal >= network.signal => {}
                    Some(existing) => *existing = (network, profile),
                    None => networks.push((network, profile)),
                }
            }
            WlanFreeMemory(list as *const c_void);
            networks.sort_by(|a, b| b.0.connected.cmp(&a.0.connected).then(b.0.signal.cmp(&a.0.signal)));
            networks
        }
    }

    fn connect_profile(&self, profile: &str) -> Result<(), String> {
        let name = wide(profile);
        let parameters = WLAN_CONNECTION_PARAMETERS {
            wlanConnectionMode: wlan_connection_mode_profile,
            strProfile: PCWSTR(name.as_ptr()),
            pDot11Ssid: std::ptr::null_mut(),
            pDesiredBssidList: std::ptr::null_mut(),
            dot11BssType: dot11_BSS_type_infrastructure,
            dwFlags: 0,
        };
        // SAFETY: `name` e `parameters` vivem até o fim da chamada.
        match unsafe { WlanConnect(self.handle, &self.interface, &parameters, None) } {
            0 => Ok(()),
            code => Err(format!("Não foi possível iniciar a conexão: código {code}")),
        }
    }

    fn delete_profile(&self, profile: &str) -> u32 {
        let name = wide(profile);
        // SAFETY: `name` termina em zero e vive até o fim da chamada.
        unsafe { WlanDeleteProfile(self.handle, &self.interface, PCWSTR(name.as_ptr()), None) }
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        // SAFETY: fecha o identificador aberto em `open`.
        unsafe { WlanCloseHandle(self.handle, None) };
    }
}

/// Este PC tem um adaptador Wi-Fi (e o serviço do Windows está ativo).
pub fn has_adapter() -> bool {
    Client::open().is_some()
}

/// As redes ao alcance. Com `rescan`, pede uma varredura nova e espera um instante pelo resultado.
pub fn list(rescan: bool) -> WifiList {
    let Some(client) = Client::open() else { return WifiList { adapter: false, networks: Vec::new() } };
    if rescan {
        client.scan();
        std::thread::sleep(Duration::from_millis(3500));
    }
    WifiList { adapter: true, networks: client.networks().into_iter().map(|(network, _)| network).collect() }
}

/// Conecta a uma rede. Sem `password`, usa a senha que o Windows já guarda; com ela, cria (ou atualiza) o perfil.
pub fn connect(ssid: &str, password: Option<&str>) -> Result<(), String> {
    let client = Client::open().ok_or("Este PC não tem Wi-Fi.")?;
    let (network, saved_profile) = client
        .networks()
        .into_iter()
        .find(|(n, _)| n.ssid == ssid)
        .ok_or("A rede não está mais ao alcance.")?;

    let mut created = None;
    let profile = if network.known && password.is_none() {
        saved_profile
    } else if network.security.needs_password() || network.security == Security::Open {
        let xml = profile_xml(ssid, network.security, password)?;
        let (xml_w, mut reason) = (wide(&xml), 0u32);
        // SAFETY: perfil terminado em zero; sobrescreve o perfil de mesmo nome.
        let code = unsafe { WlanSetProfile(client.handle, &client.interface, 0, PCWSTR(xml_w.as_ptr()), PCWSTR::null(), true, None, &mut reason) };
        if code != 0 {
            return Err(format!("O Windows recusou o perfil da rede: código {code}, motivo {reason}"));
        }
        if !network.known {
            created = Some(ssid.to_string());
        }
        ssid.to_string()
    } else {
        return Err("Este tipo de rede não é aceito aqui.".into());
    };

    client.connect_profile(&profile)?;
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if client.connected_ssid().as_deref() == Some(ssid) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    // Não conectou (quase sempre senha errada): não deixa para trás um perfil que acabamos de criar.
    if let Some(profile) = created {
        client.delete_profile(&profile);
    }
    Err("Não foi possível conectar. Confira a senha.".into())
}

pub fn disconnect() -> Result<(), String> {
    let client = Client::open().ok_or("Este PC não tem Wi-Fi.")?;
    // SAFETY: desconecta o adaptador aberto.
    match unsafe { WlanDisconnect(client.handle, &client.interface, None) } {
        0 => Ok(()),
        code => Err(format!("código {code}")),
    }
}

/// Esquece a rede (apaga a senha guardada no Windows).
pub fn forget(ssid: &str) -> Result<(), String> {
    let client = Client::open().ok_or("Este PC não tem Wi-Fi.")?;
    let profile = client
        .networks()
        .into_iter()
        .find(|(n, _)| n.ssid == ssid)
        .map(|(_, profile)| profile)
        .filter(|profile| !profile.is_empty())
        .unwrap_or_else(|| ssid.to_string());
    match client.delete_profile(&profile) {
        0 => Ok(()),
        code => Err(format!("código {code}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seguranca_a_partir_do_windows() {
        assert_eq!(Security::from_wlan(false, 1), Security::Open);
        assert_eq!(Security::from_wlan(true, 7), Security::Wpa2);
        assert_eq!(Security::from_wlan(true, 9), Security::Wpa3);
        assert_eq!(Security::from_wlan(true, 4), Security::Wpa);
        assert_eq!(Security::from_wlan(true, 6), Security::Enterprise);
        assert_eq!(Security::from_wlan(true, 10), Security::Other);
        assert!(Security::Wpa2.needs_password());
        assert!(!Security::Open.needs_password());
    }

    #[test]
    fn perfil_wpa2_leva_nome_em_hex_e_senha() {
        let xml = profile_xml("Casa 5G", Security::Wpa2, Some("s3nha")).unwrap();
        assert!(xml.contains("<name>Casa 5G</name>"));
        assert!(xml.contains("<hex>43617361203547</hex>"));
        assert!(xml.contains("<authentication>WPA2PSK</authentication>"));
        assert!(xml.contains("<keyMaterial>s3nha</keyMaterial>"));
        assert!(xml.contains("<protected>false</protected>"));
    }

    #[test]
    fn perfil_escapa_caracteres_especiais() {
        let xml = profile_xml("A&B <1>", Security::Wpa2, Some("p\"a'ss&<>")).unwrap();
        assert!(xml.contains("<name>A&amp;B &lt;1&gt;</name>"));
        assert!(xml.contains("<keyMaterial>p&quot;a&apos;ss&amp;&lt;&gt;</keyMaterial>"));
        assert!(!xml.contains("p\"a'ss"));
    }

    #[test]
    fn perfil_aberto_nao_tem_senha_e_wpa3_tem_transicao() {
        let open = profile_xml("Cafe", Security::Open, None).unwrap();
        assert!(open.contains("<authentication>open</authentication>") && open.contains("<encryption>none</encryption>"));
        assert!(!open.contains("sharedKey"));
        let wpa3 = profile_xml("Cafe", Security::Wpa3, Some("12345678")).unwrap();
        assert!(wpa3.contains("WPA3SAE") && wpa3.contains("transitionMode"));
    }

    #[test]
    fn perfil_exige_senha_e_recusa_redes_de_empresa() {
        assert!(profile_xml("Casa", Security::Wpa2, None).is_err());
        assert!(profile_xml("Casa", Security::Wpa2, Some("")).is_err());
        assert!(profile_xml("Empresa", Security::Enterprise, Some("x")).is_err());
    }

    /// Leitura no PC real (nada é alterado): `cargo test --lib lista_as_redes_do_pc -- --ignored --nocapture`.
    #[test]
    #[ignore = "usa o adaptador Wi-Fi deste PC (se houver)"]
    fn lista_as_redes_do_pc() {
        let list = list(false);
        println!("{list:#?}");
    }
}
