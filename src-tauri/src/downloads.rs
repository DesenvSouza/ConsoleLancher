//! Apoio à página de downloads e jogos instalados: espaço livre dos discos e o desligamento programado.

use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::process::Command;
use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Espaço de um disco (o da pasta informada).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub path: String,
    /// Espaço livre para este usuário, em bytes.
    pub free: u64,
    /// Tamanho total do disco, em bytes.
    pub total: u64,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Espaço livre e total do disco onde está cada pasta. Pastas que não existem mais ficam de fora.
#[tauri::command(async)]
pub fn disk_usage(paths: Vec<String>) -> Vec<DiskInfo> {
    paths
        .into_iter()
        .filter_map(|path| {
            let (mut free, mut total, mut total_free) = (0u64, 0u64, 0u64);
            // SAFETY: os três ponteiros apontam para variáveis locais e o caminho termina em zero.
            let ok = unsafe { GetDiskFreeSpaceExW(wide(&path).as_ptr(), &mut free, &mut total, &mut total_free) };
            (ok != 0).then_some(DiskInfo { path, free, total })
        })
        .collect()
}

/// Programa o desligamento do Windows para daqui a `seconds` segundos. É o próprio Windows quem conta o tempo: se o
/// launcher fechar, o desligamento continua valendo (e pode ser cancelado por `power_cancel` ou `shutdown /a`).
#[tauri::command(async)]
pub fn power_schedule(seconds: u32) -> Result<(), String> {
    let seconds = seconds.min(3600).to_string();
    let output = Command::new("shutdown.exe")
        .args(["/s", "/t", &seconds, "/c", "Downloads concluídos: o PC será desligado."])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    // 1190 = já existe um desligamento programado: tudo bem, ele vale.
    if output.status.code() == Some(1190) {
        return Ok(());
    }
    Err(format!("Não consegui programar o desligamento: {}", String::from_utf8_lossy(&output.stderr).trim()))
}

/// Reinicia o Windows daqui a `seconds` segundos. Usado ao ativar o modo console, que só vale depois de reiniciar.
#[tauri::command(async)]
pub fn power_restart(seconds: u32) -> Result<(), String> {
    // Nunca reinicia o PC de quem está desenvolvendo.
    if cfg!(debug_assertions) {
        return Err("A reinicialização só funciona no launcher instalado.".into());
    }
    // Um desligamento já programado desligaria o PC em vez de reiniciar: é cancelado antes.
    power_cancel()?;
    let output = Command::new("shutdown.exe")
        .args(["/r", "/t", &seconds.clamp(5, 600).to_string(), "/c", "O Console Launcher vai reiniciar o PC."])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!("Não consegui reiniciar o PC: {}", String::from_utf8_lossy(&output.stderr).trim()))
    }
}

/// Cancela um desligamento programado (`shutdown /a`). Sem nada programado, não faz nada.
#[tauri::command(async)]
pub fn power_cancel() -> Result<(), String> {
    let output = Command::new("shutdown.exe").arg("/a").creation_flags(CREATE_NO_WINDOW).output().map_err(|e| e.to_string())?;
    // 1116 = não havia desligamento programado.
    if output.status.success() || output.status.code() == Some(1116) {
        Ok(())
    } else {
        Err(format!("Não consegui cancelar o desligamento: {}", String::from_utf8_lossy(&output.stderr).trim()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn espaco_do_disco_do_sistema() {
        let info = disk_usage(vec!["C:\\".into(), "Z:\\pasta\\que\\nao\\existe".into()]);
        assert_eq!(info.len(), 1, "a pasta inexistente fica de fora");
        assert!(info[0].total > 0 && info[0].free <= info[0].total);
    }
}
