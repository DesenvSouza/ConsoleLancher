//! Pedidos ao Windows feitos direto pela API, sem abrir outro programa (rundll32, PowerShell) por baixo. É mais rápido e
//! evita um comportamento que os antivírus tratam com desconfiança: programas auxiliares escondidos.

use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows_sys::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Abre um endereço (`steam://...`, `https://...`) com o programa registrado no Windows.
pub fn open_uri(uri: &str) -> Result<(), String> {
    let uri = uri.to_string();
    // Uma thread só para isto: alguns protocolos pedem o COM iniciado, e as threads de comando não podem ser mexidas.
    std::thread::spawn(move || {
        let (verb, target) = (wide("open"), wide(&uri));
        // SAFETY: textos terminados em zero e válidos durante a chamada; o COM é encerrado na mesma thread que o iniciou.
        unsafe {
            let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let result = ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) as isize;
            if com {
                CoUninitialize();
            }
            // Valores até 32 são os códigos de erro do ShellExecute.
            if result > 32 {
                Ok(())
            } else {
                Err(format!("O Windows não conseguiu abrir o endereço (código {result})."))
            }
        }
    })
    .join()
    .map_err(|_| "O Windows não conseguiu abrir o endereço.".to_string())?
}

/// O texto da área de transferência (vazio se não houver texto).
pub fn clipboard_text() -> String {
    const CF_UNICODETEXT: u32 = 13;
    // SAFETY: a área de transferência é fechada ao final; o bloco é lido travado, dentro do tamanho informado pelo Windows.
    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return String::new();
        }
        let mut text = String::new();
        let handle = GetClipboardData(CF_UNICODETEXT);
        if !handle.is_null() {
            let data = GlobalLock(handle) as *const u16;
            if !data.is_null() {
                let units = std::slice::from_raw_parts(data, GlobalSize(handle) / 2);
                let end = units.iter().position(|&unit| unit == 0).unwrap_or(units.len());
                text = String::from_utf16_lossy(&units[..end]);
                GlobalUnlock(handle);
            }
        }
        CloseClipboard();
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    /// Registra um protocolo só de teste, abre um endereço dele e confere que o programa registrado rodou.
    #[test]
    fn abre_um_endereco_pelo_programa_registrado() {
        let scheme = format!("launcherteste{}", std::process::id());
        let marker = std::env::temp_dir().join(format!("{scheme}.txt"));
        let _ = std::fs::remove_file(&marker);
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let base = format!(r"Software\Classes\{scheme}");
        let (key, _) = root.create_subkey(&base).unwrap();
        key.set_value("URL Protocol", &"").unwrap();
        let (command, _) = root.create_subkey(format!(r"{base}\shell\open\command")).unwrap();
        command.set_value("", &format!(r#"cmd.exe /d /c type nul > "{}""#, marker.display())).unwrap();

        let opened = open_uri(&format!("{scheme}:ola"));
        for _ in 0..100 {
            if marker.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let ran = marker.exists();
        let _ = root.delete_subkey_all(&base);
        let _ = std::fs::remove_file(&marker);
        assert_eq!(opened, Ok(()));
        assert!(ran, "o programa registrado não rodou");
    }
}
