//! Atualização do launcher: lê o `latest.json` da última versão publicada no GitHub, baixa o instalador e confere a
//! assinatura dele com a chave pública de `tauri.conf.json` antes de instalar.
//!
//! São três passos separados, para a instalação nunca começar no meio de um jogo:
//! 1. `update_check`: há versão mais nova?
//! 2. `update_download`: baixa e confere a assinatura (o pacote fica na memória).
//! 3. `update_apply`: roda o instalador. O launcher fecha e o próprio instalador o reabre.
//!
//! No modo console o instalador fecharia a "área de trabalho" do Windows: antes dele o Explorer é aberto, e o vigia
//! (veja `startup.rs`) sai sozinho. O modo console volta a valer no próximo login.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Error, Update, UpdaterExt};

/// Quanto esperar pela resposta ao procurar uma versão nova.
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
/// Teto do download inteiro (um download parado não fica pendurado para sempre).
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// O pacote já baixado e conferido, esperando a instalação.
static READY: Mutex<Option<(Update, Vec<u8>)>> = Mutex::new(None);
static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static RECEIVED: AtomicU64 = AtomicU64::new(0);
static TOTAL: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// A versão instalada.
    current: String,
    /// "ok", "dev" (modo de desenvolvimento: procura, mas não instala) ou "unconfigured" (sem chave pública).
    support: &'static str,
    /// Versão já baixada e conferida, pronta para instalar.
    ready: Option<String>,
    downloading: bool,
    /// Andamento do download em bytes (`total` é 0 enquanto o tamanho não é conhecido).
    received: u64,
    total: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    version: String,
    /// O texto da publicação (o que mudou).
    notes: Option<String>,
}

/// A chave pública das atualizações, se alguém já a colocou em `tauri.conf.json`.
fn has_public_key(plugin: Option<&serde_json::Value>) -> bool {
    plugin.and_then(|p| p.get("pubkey")).and_then(|key| key.as_str()).is_some_and(|key| !key.trim().is_empty())
}

fn support(app: &AppHandle) -> &'static str {
    if !has_public_key(app.config().plugins.0.get("updater")) {
        "unconfigured"
    } else if cfg!(debug_assertions) {
        "dev"
    } else {
        "ok"
    }
}

/// O erro da biblioteca dito em português, sem detalhes técnicos (eles vão para o registro).
fn describe(error: Error) -> String {
    eprintln!("atualização: {error}");
    match error {
        Error::ReleaseNotFound => "Nenhuma versão publicada foi encontrada.",
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => "A versão publicada não tem um instalador para este PC.",
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) | Error::SignedVersionMismatch { .. } | Error::MissingSignedVersion => {
            "A assinatura do pacote não confere. A atualização foi descartada."
        }
        Error::Reqwest(_) | Error::Network(_) => "Não foi possível falar com o GitHub. Confira a conexão com a internet.",
        _ => "Não foi possível atualizar o launcher.",
    }
    .into()
}

async fn find(app: &AppHandle, timeout: Duration) -> Result<Option<Update>, String> {
    if support(app) == "unconfigured" {
        return Err("As atualizações automáticas ainda não foram configuradas nesta versão.".into());
    }
    app.updater_builder().timeout(timeout).build().map_err(describe)?.check().await.map_err(describe)
}

fn ready_version() -> Option<String> {
    READY.lock().unwrap().as_ref().map(|(update, _)| update.version.clone())
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateStatus {
    UpdateStatus {
        current: app.package_info().version.to_string(),
        support: support(&app),
        ready: ready_version(),
        downloading: DOWNLOADING.load(Ordering::Relaxed),
        received: RECEIVED.load(Ordering::Relaxed),
        total: TOTAL.load(Ordering::Relaxed),
    }
}

/// A versão mais nova publicada, ou nada se esta já é a mais recente.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<Available>, String> {
    Ok(find(&app, CHECK_TIMEOUT).await?.map(|update| Available { version: update.version.clone(), notes: update.body.clone() }))
}

/// Baixa a versão nova e confere a assinatura. Devolve a versão que ficou pronta para instalar.
#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<String, String> {
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        return Err("A atualização já está sendo baixada.".into());
    }
    let result = download(&app).await;
    DOWNLOADING.store(false, Ordering::SeqCst);
    result
}

async fn download(app: &AppHandle) -> Result<String, String> {
    let update = find(app, DOWNLOAD_TIMEOUT).await?.ok_or("Você já está na versão mais recente.")?;
    if ready_version().as_deref() == Some(update.version.as_str()) {
        return Ok(update.version);
    }
    RECEIVED.store(0, Ordering::Relaxed);
    TOTAL.store(0, Ordering::Relaxed);
    let bytes = update
        .download(
            |chunk, total| {
                RECEIVED.fetch_add(chunk as u64, Ordering::Relaxed);
                TOTAL.store(total.unwrap_or(0), Ordering::Relaxed);
            },
            || {},
        )
        .await
        .map_err(describe)?;
    let version = update.version.clone();
    *READY.lock().unwrap() = Some((update, bytes));
    Ok(version)
}

/// Instala o pacote já baixado. Se der certo, não volta: o launcher fecha e o instalador o reabre.
#[tauri::command]
pub async fn update_apply() -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("A instalação de atualizações só funciona no launcher instalado.".into());
    }
    // Instalar fecha o launcher, e com ele iria junto o instalador da Epic.
    if crate::epic_install::states().values().any(|job| matches!(job.status, "preparing" | "running")) {
        return Err("Espere a instalação do jogo da Epic terminar para atualizar.".into());
    }
    tauri::async_runtime::spawn_blocking(|| {
        // No modo console não há Explorer: sem ele a tela ficaria preta enquanto o instalador trabalha.
        if crate::startup::supervised() {
            crate::startup::ensure_explorer(Duration::from_secs(20))?;
        }
        let ready = READY.lock().unwrap();
        let (update, bytes) = ready.as_ref().ok_or("Baixe a atualização antes de instalar.")?;
        // O mesmo cuidado da saída normal: devolve o que o launcher mudou no Windows.
        crate::guide::close(false);
        crate::hide::set_fullscreen(false);
        crate::perf_etw::stop();
        update.install(bytes).map_err(describe)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sem_chave_publica_nao_ha_atualizacao() {
        assert!(!has_public_key(None));
        assert!(!has_public_key(Some(&json!({}))));
        assert!(!has_public_key(Some(&json!({ "pubkey": "" }))));
        assert!(!has_public_key(Some(&json!({ "pubkey": "   " }))));
        assert!(has_public_key(Some(&json!({ "pubkey": "dW50cnVzdGVk" }))));
    }

    /// A configuração publicada aponta para o repositório certo, por HTTPS, e exige a versão dentro da assinatura.
    #[test]
    fn configuracao_das_atualizacoes() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &config["plugins"]["updater"];
        let endpoint = updater["endpoints"][0].as_str().unwrap();
        assert!(endpoint.starts_with("https://github.com/DesenvSouza/ConsoleLancher/releases/"));
        assert!(endpoint.ends_with("/latest.json"));
        assert_eq!(updater["requireSignedVersion"], json!(true));
        assert!(updater["dangerousInsecureTransportProtocol"].is_null());
    }
}
