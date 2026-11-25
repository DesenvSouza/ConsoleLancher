//! O Legendary não vem no instalador: quando o jogador quer instalar jogos da Epic pelo launcher, ele é baixado no PC dele,
//! direto da publicação oficial do projeto (GPL-3.0), numa versão fixa e conferida pelo SHA-256 antes de ser usado.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

/// Versão, endereço e conteúdo esperados. Para atualizar: troque os quatro juntos (e `scripts/get-legendary.ps1`).
pub const VERSION: &str = "0.20.43";
const URL: &str = "https://github.com/Heroic-Games-Launcher/legendary/releases/download/0.20.43/legendary_windows_x86_64.exe";
const SHA256: &str = "ec1ad2d19d44e07b2b0330191c300979f102c509f2a889708099f453c5188f20";
const SIZE: u64 = 16_291_172;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static DOWNLOADING: AtomicBool = AtomicBool::new(false);

/// Onde a cópia baixada fica (na pasta de configuração do launcher, deste usuário).
pub fn downloaded_path(app_config: &Path) -> PathBuf {
    app_config.join("legendary-bin").join("legendary.exe")
}

fn partial_path(app_config: &Path) -> PathBuf {
    downloaded_path(app_config).with_extension("part")
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LegendaryStatus {
    /// Há um Legendary pronto para usar.
    pub available: bool,
    pub downloading: bool,
    /// Bytes já baixados e o total esperado.
    pub received: u64,
    pub total: u64,
    pub version: &'static str,
}

pub fn status(app_config: &Path) -> LegendaryStatus {
    let downloading = DOWNLOADING.load(Ordering::SeqCst);
    let received = if downloading { std::fs::metadata(partial_path(app_config)).map(|m| m.len()).unwrap_or(0) } else { 0 };
    LegendaryStatus { available: crate::epic_install::legendary_path(app_config).is_some(), downloading, received, total: SIZE, version: VERSION }
}

/// SHA-256 em hexadecimal, pela criptografia do próprio Windows.
fn sha256(data: &[u8]) -> Result<String, String> {
    use windows_sys::Win32::Security::Cryptography::{BCryptHash, BCRYPT_SHA256_ALG_HANDLE};
    let length = u32::try_from(data.len()).map_err(|_| "Arquivo grande demais para conferir.".to_string())?;
    let mut digest = [0u8; 32];
    // SAFETY: os ponteiros e tamanhos descrevem `data` e `digest`, vivos durante a chamada; sem segredo (ponteiro nulo).
    let code = unsafe { BCryptHash(BCRYPT_SHA256_ALG_HANDLE, std::ptr::null(), 0, data.as_ptr(), length, digest.as_mut_ptr(), 32) };
    if code != 0 {
        return Err("O Windows não conseguiu conferir o arquivo baixado.".into());
    }
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Confere o arquivo e só então o coloca no lugar. Um arquivo que não confere é apagado.
fn install_verified(partial: &Path, target: &Path, expected: &str) -> Result<(), String> {
    let data = std::fs::read(partial).map_err(|e| e.to_string())?;
    if sha256(&data)? != expected {
        let _ = std::fs::remove_file(partial);
        return Err("O arquivo baixado não confere com o esperado e foi apagado. Tente de novo.".into());
    }
    let _ = std::fs::remove_file(target);
    std::fs::rename(partial, target).map_err(|e| e.to_string())
}

fn fetch(partial: &Path) -> Result<(), String> {
    let output = Command::new("curl.exe")
        .args(["-sS", "-L", "--fail", "--proto", "=https", "--proto-redir", "=https", "--connect-timeout", "20", "--max-time", "900", "-o"])
        .arg(partial)
        .arg(URL)
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Não consegui executar o curl: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let _ = std::fs::remove_file(partial);
        Err("Não foi possível baixar o Legendary. Confira a internet e tente de novo.".into())
    }
}

/// Baixa, confere e instala. Um pedido de cada vez; se já há um Legendary, não faz nada.
pub fn download(app_config: &Path) -> Result<(), String> {
    if crate::epic_install::legendary_path(app_config).is_some() {
        return Ok(());
    }
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        return Err("O Legendary já está sendo baixado.".into());
    }
    let target = downloaded_path(app_config);
    let partial = partial_path(app_config);
    let result = target
        .parent()
        .ok_or_else(|| "Pasta de configuração inválida.".to_string())
        .and_then(|dir| std::fs::create_dir_all(dir).map_err(|e| e.to_string()))
        .and_then(|()| fetch(&partial))
        .and_then(|()| install_verified(&partial, &target, SHA256));
    DOWNLOADING.store(false, Ordering::SeqCst);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("launcher-legendary-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn calcula_o_sha256() {
        assert_eq!(sha256(b"abc").unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn so_instala_o_arquivo_que_confere() {
        let dir = temp("confere");
        let (partial, target) = (dir.join("a.part"), dir.join("a.exe"));
        std::fs::write(&partial, b"abc").unwrap();
        assert!(install_verified(&partial, &target, SHA256).is_err());
        assert!(!partial.exists() && !target.exists());
        std::fs::write(&partial, b"abc").unwrap();
        install_verified(&partial, &target, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad").unwrap();
        assert!(target.exists() && !partial.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "baixa de verdade o Legendary (~16 MB) do GitHub numa pasta temporária"]
    fn baixa_e_confere_o_legendary() {
        let dir = temp("baixa");
        let partial = partial_path(&dir);
        std::fs::create_dir_all(partial.parent().unwrap()).unwrap();
        fetch(&partial).unwrap();
        install_verified(&partial, &downloaded_path(&dir), SHA256).unwrap();
        assert_eq!(std::fs::metadata(downloaded_path(&dir)).unwrap().len(), SIZE);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
