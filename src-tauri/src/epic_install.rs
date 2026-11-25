//! Instalar, abrir e desinstalar jogos da Epic sem a janela da Epic Games Launcher, usando o Legendary.
//!
//! O Legendary é um cliente de linha de comando, de código aberto (GPL-3.0), que baixa e instala os jogos da Epic direto do
//! CDN dela. Ele não vem no instalador: é baixado quando o jogador pede (`legendary.rs`). O launcher o executa como um
//! programa à parte, sem janela, e lê o andamento do que ele escreve. Os jogos instalados por ele não aparecem na Epic Games Launcher: o launcher os abre
//! pelo próprio Legendary.
//!
//! O Legendary mantém uma sessão própria (em `legendary\user.json`, na pasta de configuração do launcher), criada a partir da
//! sessão do launcher por um código de troca de uso único: assim os dois não disputam o mesmo token de renovação.
//! Sem o `legendary.exe`, instalar volta a abrir a página do jogo na Epic Games Launcher.

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const EXCHANGE_URL: &str = "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/exchange";

// ───────── Onde está o Legendary ─────────

/// Caminho do `legendary.exe`: a cópia que o jogador baixou, uma colocada ao lado do launcher, ou (em desenvolvimento) a da
/// pasta do projeto.
pub fn legendary_path(app_config: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec![crate::legendary::downloaded_path(app_config)];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("legendary.exe"));
            candidates.push(dir.join("resources").join("legendary").join("legendary.exe"));
            candidates.push(dir.join("legendary").join("legendary.exe"));
        }
    }
    #[cfg(debug_assertions)]
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("legendary").join("legendary.exe"));
    candidates.into_iter().find(|p| p.is_file())
}

fn config_dir(app_config: &Path) -> PathBuf {
    app_config.join("legendary")
}

fn command(app_config: &Path, args: &[&str]) -> Result<Command, String> {
    let exe = legendary_path(app_config).ok_or("O Legendary não está instalado. Baixe-o em Configurações › Contas › Epic Games.")?;
    let mut cmd = Command::new(exe);
    cmd.args(args).env("LEGENDARY_CONFIG_PATH", config_dir(app_config)).creation_flags(CREATE_NO_WINDOW).stdin(Stdio::null());
    Ok(cmd)
}

// ───────── Sessão ─────────

/// Código de troca (vale uns 5 minutos e uma vez) gerado a partir da sessão do launcher.
fn exchange_code(access_token: &str) -> Result<String, String> {
    let text = crate::epic::request("GET", EXCHANGE_URL, &[format!("Authorization: Bearer {access_token}")], None)?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|_| "A Epic não respondeu como esperado.".to_string())?;
    value.get("code").and_then(|v| v.as_str()).map(str::to_string).ok_or_else(|| "A Epic não devolveu o código de troca.".to_string())
}

/// A sessão do Legendary ainda serve? (existe e o token de renovação não venceu)
fn session_valid(app_config: &Path) -> bool {
    let Ok(raw) = std::fs::read(config_dir(app_config).join("user.json")) else { return false };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&raw) else { return false };
    if value.get("refresh_token").and_then(|v| v.as_str()).is_none() {
        return false;
    }
    // Vencimento em ISO 8601 ("2026-12-20T10:00:00.000Z"): compara como texto com o instante atual em UTC.
    match value.get("refresh_expires_at").and_then(|v| v.as_str()) {
        Some(at) => at > utc_now_iso().as_str(),
        None => true,
    }
}

fn utc_now_iso() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Dias desde 1970-01-01 para data civil (algoritmo de Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Garante que o Legendary tem uma sessão válida (cria uma a partir da do launcher, se preciso).
fn ensure_login(app_config: &Path) -> Result<(), String> {
    if session_valid(app_config) {
        return Ok(());
    }
    let token = crate::epic::access_token_for(app_config)?;
    let code = exchange_code(&token)?;
    let _ = std::fs::remove_file(config_dir(app_config).join("user.json"));
    let output = command(app_config, &["auth", "--token", &code])?.output().map_err(|e| e.to_string())?;
    if !output.status.success() || !session_valid(app_config) {
        let text = String::from_utf8_lossy(&output.stderr);
        return Err(format!("O Legendary não conseguiu entrar na Epic. {}", last_line(&text)));
    }
    Ok(())
}

/// Esquece a sessão do Legendary (ao sair da conta da Epic). Os jogos instalados continuam na lista dele.
pub fn sign_out(app_config: &Path) {
    let _ = std::fs::remove_file(config_dir(app_config).join("user.json"));
}

fn last_line(text: &str) -> String {
    text.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or_default().to_string()
}

// ───────── Jogos instalados pelo Legendary ─────────

/// Lê o `installed.json` do Legendary (nome interno → dados do jogo instalado).
pub fn parse_installed(text: &str) -> Vec<crate::epic::EpicInstalled> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else { return Vec::new() };
    let Some(map) = value.as_object() else { return Vec::new() };
    map.values()
        .filter(|game| !game.get("is_dlc").and_then(|v| v.as_bool()).unwrap_or(false))
        .filter_map(|game| {
            let text = |key: &str| game.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let (app_name, install_path, executable) = (text("app_name"), text("install_path"), text("executable"));
            if app_name.is_empty() || install_path.is_empty() || executable.is_empty() {
                return None;
            }
            Some(crate::epic::EpicInstalled {
                title: Some(text("title")).filter(|t| !t.is_empty()).unwrap_or_else(|| app_name.clone()),
                app_name,
                namespace: String::new(),
                catalog_item_id: String::new(),
                install_location: install_path,
                launch_executable: executable,
                size_bytes: game.get("install_size").and_then(|v| v.as_u64()).unwrap_or(0),
                incomplete: false,
                managed_by: "legendary".to_string(),
            })
        })
        .collect()
}

pub fn installed(app_config: &Path) -> Vec<crate::epic::EpicInstalled> {
    std::fs::read_to_string(config_dir(app_config).join("installed.json")).map(|t| parse_installed(&t)).unwrap_or_default()
}

// ───────── Andamento da instalação ─────────

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallState {
    /// "preparing", "running", "done", "failed" ou "cancelled".
    pub status: &'static str,
    /// 0 a 100.
    pub percent: f32,
    pub message: Option<String>,
}

struct Job {
    state: InstallState,
    child: Option<Child>,
}

static JOBS: Mutex<Option<HashMap<String, Arc<Mutex<Job>>>>> = Mutex::new(None);

fn job_of(app_name: &str) -> Option<Arc<Mutex<Job>>> {
    JOBS.lock().unwrap().as_ref().and_then(|jobs| jobs.get(app_name).cloned())
}

/// Estado de todas as instalações (em andamento ou terminadas há pouco).
pub fn states() -> HashMap<String, InstallState> {
    let jobs = JOBS.lock().unwrap();
    jobs.as_ref().map(|jobs| jobs.iter().map(|(name, job)| (name.clone(), job.lock().unwrap().state.clone())).collect()).unwrap_or_default()
}

/// Porcentagem de uma linha de andamento do Legendary (`= Progress: 12.34% (123/1000), Running for ...`).
pub fn parse_progress(line: &str) -> Option<f32> {
    let rest = line.split("Progress:").nth(1)?;
    let number: String = rest.trim_start().chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    number.parse().ok()
}

/// Pasta onde a Epic Games Launcher instala por padrão (a escolha do jogador nela), ou `C:\Users\<usuário>\Epic Games`.
fn default_install_dir() -> PathBuf {
    if let Some(dir) = crate::epic::preview_data_dir() {
        let settings = dir.join("settings").join("app-settings.json");
        if let Some(dir) = std::fs::read_to_string(settings)
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v.get("defaultInstallDir").and_then(|d| d.as_str()).map(PathBuf::from))
        {
            return dir;
        }
    }
    PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("Epic Games")
}

/// Divide o que o Legendary escreve em linhas (ele reescreve o andamento com `\r` em alguns terminais).
fn pump(mut stream: impl Read, mut on_line: impl FnMut(&str)) {
    let mut buffer = [0u8; 4096];
    let mut pending = Vec::new();
    while let Ok(n) = stream.read(&mut buffer) {
        if n == 0 {
            break;
        }
        for &byte in &buffer[..n] {
            if byte == b'\n' || byte == b'\r' {
                if !pending.is_empty() {
                    on_line(&String::from_utf8_lossy(&pending));
                    pending.clear();
                }
            } else {
                pending.push(byte);
            }
        }
    }
    if !pending.is_empty() {
        on_line(&String::from_utf8_lossy(&pending));
    }
}

/// Começa a instalar (em segundo plano). O andamento fica em `states()`.
pub fn start_install(app_config: &Path, app_name: &str) -> Result<(), String> {
    if !crate::epic::safe_name(app_name) {
        return Err("Identificador de jogo inválido.".into());
    }
    let job = Arc::new(Mutex::new(Job { state: InstallState { status: "preparing", percent: 0.0, message: None }, child: None }));
    {
        let mut jobs = JOBS.lock().unwrap();
        let jobs = jobs.get_or_insert_with(HashMap::new);
        if jobs.get(app_name).is_some_and(|job| matches!(job.lock().unwrap().state.status, "preparing" | "running")) {
            return Ok(());
        }
        jobs.insert(app_name.to_string(), job.clone());
    }

    let app_config = app_config.to_path_buf();
    let app_name = app_name.to_string();
    std::thread::spawn(move || {
        let fail = |job: &Arc<Mutex<Job>>, message: String| {
            let mut job = job.lock().unwrap();
            if job.state.status != "cancelled" {
                job.state = InstallState { status: "failed", percent: job.state.percent, message: Some(message) };
            }
        };
        if let Err(error) = ensure_login(&app_config) {
            return fail(&job, error);
        }
        let base = default_install_dir();
        let base_text = base.to_string_lossy().to_string();
        let mut cmd = match command(&app_config, &["install", &app_name, "--base-path", &base_text, "-y", "--skip-sdl", "--skip-dlcs"]) {
            Ok(cmd) => cmd,
            Err(error) => return fail(&job, error),
        };
        let (stdout, stderr) = {
            let mut current = job.lock().unwrap();
            if current.state.status == "cancelled" {
                return;
            }
            let mut child = match cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
                Ok(child) => child,
                Err(error) => {
                    drop(current);
                    return fail(&job, error.to_string());
                }
            };
            let streams = (child.stdout.take(), child.stderr.take());
            current.child = Some(child);
            streams
        };

        let last_error = Arc::new(Mutex::new(String::new()));
        let readers: Vec<_> = [stdout.map(|s| Box::new(s) as Box<dyn Read + Send>), stderr.map(|s| Box::new(s) as Box<dyn Read + Send>)]
            .into_iter()
            .flatten()
            .map(|stream| {
                let job = job.clone();
                let last_error = last_error.clone();
                std::thread::spawn(move || {
                    pump(stream, |line| {
                        if let Some(percent) = parse_progress(line) {
                            let mut job = job.lock().unwrap();
                            if job.state.status != "cancelled" {
                                job.state = InstallState { status: "running", percent, message: None };
                            }
                        } else if line.contains("ERROR") || line.contains("CRITICAL") {
                            *last_error.lock().unwrap() = line.trim().to_string();
                        }
                    });
                })
            })
            .collect();
        for reader in readers {
            let _ = reader.join();
        }
        let status = job.lock().unwrap().child.take().and_then(|mut child| child.wait().ok());
        let mut job = job.lock().unwrap();
        if job.state.status == "cancelled" {
            return;
        }
        if status.is_some_and(|s| s.success()) && installed(&app_config).iter().any(|game| game.app_name == app_name) {
            crate::epic::invalidate_installed();
            job.state = InstallState { status: "done", percent: 100.0, message: None };
        } else {
            let message = last_error.lock().unwrap().clone();
            job.state = InstallState { status: "failed", percent: job.state.percent, message: Some(if message.is_empty() { "A instalação não terminou.".to_string() } else { message }) };
        }
    });
    Ok(())
}

/// Cancela a instalação em andamento (o que já foi baixado fica para uma próxima tentativa continuar).
pub fn cancel_install(app_name: &str) {
    let Some(job) = job_of(app_name) else { return };
    let mut job = job.lock().unwrap();
    job.state = InstallState { status: "cancelled", percent: job.state.percent, message: None };
    if let Some(child) = job.child.as_mut() {
        // O Legendary baixa com vários processos: encerra a árvore inteira.
        let _ = Command::new("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"]).creation_flags(CREATE_NO_WINDOW).output();
        let _ = child.kill();
    }
}

/// Esquece o estado de uma instalação já resolvida (o jogador viu o resultado).
pub fn forget(app_name: &str) {
    if let Some(jobs) = JOBS.lock().unwrap().as_mut() {
        if jobs.get(app_name).is_some_and(|job| !matches!(job.lock().unwrap().state.status, "preparing" | "running")) {
            jobs.remove(app_name);
        }
    }
}

// ───────── Abrir e desinstalar ─────────

/// Abre o jogo pelo Legendary (o processo dele espera o jogo fechar; aqui só se dispara).
pub fn launch(app_config: &Path, app_name: &str) -> Result<(), String> {
    if !crate::epic::safe_name(app_name) {
        return Err("Identificador de jogo inválido.".into());
    }
    ensure_login(app_config)?;
    command(app_config, &["launch", app_name, "--skip-version-check"])?
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Desinstala o jogo (apaga a pasta dele).
pub fn uninstall(app_config: &Path, app_name: &str) -> Result<(), String> {
    if !crate::epic::safe_name(app_name) {
        return Err("Identificador de jogo inválido.".into());
    }
    let output = command(app_config, &["uninstall", app_name, "-y"])?.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        crate::epic::invalidate_installed();
        Ok(())
    } else {
        Err(format!("Não consegui desinstalar o jogo. {}", last_line(&String::from_utf8_lossy(&output.stderr))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_o_andamento_do_legendary() {
        let line = "[DLManager] INFO: = Progress: 12.34% (123/1000), Running for 00:00:10, ETA: 00:01:12";
        assert_eq!(parse_progress(line), Some(12.34));
        assert_eq!(parse_progress("[cli] INFO: Preparing download for Absolute Drift"), None);
        assert_eq!(parse_progress("= Progress: 100.00% (1000/1000)"), Some(100.0));
    }

    #[test]
    fn le_os_jogos_instalados_pelo_legendary() {
        let text = r#"{
          "Sugar": {"app_name":"Sugar","title":"Rocket League","install_path":"D:/Games/RocketLeague","executable":"Binaries/Win64/RocketLeague.exe","install_size":12345,"is_dlc":false},
          "SugarDLC": {"app_name":"SugarDLC","title":"Pacote","install_path":"D:/Games/RocketLeague","executable":"a.exe","is_dlc":true},
          "Vazio": {"app_name":"Vazio","title":"Sem pasta","install_path":"","executable":"a.exe"}
        }"#;
        let games = parse_installed(text);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].title, "Rocket League");
        assert_eq!(games[0].managed_by, "legendary");
        assert_eq!(games[0].size_bytes, 12345);
    }

    #[test]
    fn divide_as_linhas_por_quebra_ou_retorno() {
        let mut lines = Vec::new();
        pump("um\rdois\r\ntres".as_bytes(), |l| lines.push(l.to_string()));
        assert_eq!(lines, ["um", "dois", "tres"]);
    }

    #[test]
    #[ignore = "instala de verdade um jogo pequeno da conta Epic deste PC (Absolute Drift, ~150 MB) pelo Legendary"]
    fn instala_um_jogo_pequeno_pelo_legendary() {
        let dir = PathBuf::from(std::env::var("APPDATA").unwrap()).join("app.launcher.desktop");
        let app = "19927295d6e3467887d4e830d8c85963";
        start_install(&dir, app).unwrap();
        let mut last = String::new();
        for _ in 0..600 {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let state = states().get(app).cloned().unwrap();
            let line = format!("{} {:.1}% {:?}", state.status, state.percent, state.message);
            if line != last {
                println!("{line}");
                last = line;
            }
            if matches!(state.status, "done" | "failed" | "cancelled") {
                break;
            }
        }
        println!("instalados: {:?}", installed(&dir).iter().map(|g| (&g.title, &g.install_location)).collect::<Vec<_>>());
    }

    #[test]
    fn data_atual_em_iso() {
        let now = utc_now_iso();
        assert_eq!(now.len(), 19);
        assert!(now.starts_with("20"));
    }

    #[test]
    fn sessao_vencida_nao_serve() {
        let dir = std::env::temp_dir().join(format!("launcher-lgd-{}", std::process::id()));
        std::fs::create_dir_all(config_dir(&dir)).unwrap();
        let path = config_dir(&dir).join("user.json");
        std::fs::write(&path, r#"{"refresh_token":"x","refresh_expires_at":"2001-01-01T00:00:00.000Z"}"#).unwrap();
        assert!(!session_valid(&dir));
        std::fs::write(&path, r#"{"refresh_token":"x","refresh_expires_at":"2999-01-01T00:00:00.000Z"}"#).unwrap();
        assert!(session_valid(&dir));
        let _ = std::fs::remove_dir_all(dir);
    }
}
