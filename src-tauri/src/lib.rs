mod appinfo;
mod hide;
mod steam;

use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::{AppHandle, Manager};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Abre um URI (ex.: steam://...) com o programa registrado no Windows, sem piscar console.
fn open_uri(uri: &str) -> Result<(), String> {
    Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", uri])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// O AppID vem do front-end: aceita só dígitos para não montar URIs arbitrários.
fn steam_uri(action: &str, app_id: &str) -> Result<String, String> {
    if app_id.is_empty() || !app_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("AppID inválido: {app_id:?}"));
    }
    Ok(format!("steam://{action}/{app_id}"))
}

// ───────── Ações na Steam (via protocolo steam://) ─────────

#[tauri::command]
fn steam_run(app_id: String) -> Result<(), String> {
    open_uri(&steam_uri("rungameid", &app_id)?)
}

/// Liga o gancho que esconde as janelas da Steam, dizendo-lhe como devolver o foco ao launcher.
fn init_hide(app: &AppHandle) {
    let app = app.clone();
    hide::init(move || {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    });
}

/// Manda um comando de console para a Steam em execução (`steam.exe +comando <id>`), sem diálogos.
/// Os `steam://...` abrem diálogos da Steam (escolha de pasta, confirmação); estes comandos não.
/// Testado com um jogo real: `app_install` baixa na biblioteca padrão, `app_uninstall` remove o jogo
/// (e também cancela um download em andamento), tudo sem perguntar nada.
/// A Steam traz a própria janela para a frente por alguns segundos; o launcher a minimiza e retoma o foco.
/// Se a Steam não for encontrada, usa o `fallback_uri`.
fn steam_console(app: AppHandle, command: &str, app_id: &str, fallback_uri: String) -> Result<(), String> {
    let Some(exe) = steam::steam_exe() else {
        return open_uri(&fallback_uri);
    };
    // A janela principal da Steam aparece ao receber o comando: o gancho a minimiza no mesmo instante.
    init_hide(&app);
    hide::arm(6000);
    Command::new(exe).args([&format!("+{command}"), app_id]).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Instala sem diálogo, na biblioteca padrão da Steam.
#[tauri::command]
fn steam_install(app: AppHandle, app_id: String) -> Result<(), String> {
    let uri = steam_uri("install", &app_id)?; // também valida que o AppID são só dígitos
    steam_console(app, "app_install", &app_id, uri)
}

/// Remove o jogo — ou cancela o download, se ele ainda estiver baixando — sem diálogo da Steam.
/// A confirmação ("Desinstalar X?") é do próprio launcher, antes de chamar este comando.
#[tauri::command]
fn steam_uninstall(app: AppHandle, app_id: String) -> Result<(), String> {
    let uri = steam_uri("uninstall", &app_id)?;
    steam_console(app, "app_uninstall", &app_id, uri)
}

#[tauri::command]
fn steam_validate(app_id: String) -> Result<(), String> {
    open_uri(&steam_uri("validate", &app_id)?)
}

#[tauri::command]
fn steam_store(app_id: String) -> Result<(), String> {
    open_uri(&steam_uri("store", &app_id)?)
}

// ───────── Leitura da Steam (arquivos locais e registro) ─────────

/// Steam encontrada? Conta logada, jogo em execução, SteamID64 e nome do perfil.
#[tauri::command]
fn steam_info() -> steam::SteamInfo {
    steam::info()
}

/// Jogos instalados (todas as bibliotecas), com estado e progresso de download.
#[tauri::command]
fn steam_installed() -> Vec<steam::InstalledApp> {
    steam::steam_root().map(|root| steam::scan_installed(&root)).unwrap_or_default()
}

/// Coleções da Steam da conta (Favoritos, Ocultos e as criadas pelo jogador). Só leitura de arquivo local.
#[tauri::command]
fn steam_collections(steam_id: String) -> Vec<steam::Collection> {
    steam::steam_root().map(|root| steam::read_collections(&root, &steam_id)).unwrap_or_default()
}

/// Dados de cada jogo guardados pela Steam (tipo, suporte a controle, categorias, tags): a base para avaliar
/// as coleções dinâmicas. Só leitura de arquivo local.
#[tauri::command]
fn steam_app_meta() -> Vec<appinfo::AppMeta> {
    steam::steam_root().map(|root| appinfo::read_appinfo(&root)).unwrap_or_default()
}

/// AppID do jogo em execução agora (0 = nenhum). Barato: lê só o registro.
#[tauri::command]
fn steam_running_app() -> u32 {
    steam::running_app_id()
}

/// Todos os jogos da conta, inclusive não instalados, usando a chave guardada para essa conta
/// (ou STEAM_API_KEY). Sem chave, tenta o perfil público — que hoje a Steam costuma recusar.
#[tauri::command]
async fn steam_fetch_owned(app: AppHandle, steam_id: String) -> Result<Vec<steam::OwnedGame>, String> {
    let key = steam::read_api_key(app.path().app_config_dir().ok(), &steam_id);
    steam::fetch_owned(&steam_id, key)
}

/// Total que a Steam já gravou em disco (para o progresso de instalação em tempo real, sem abrir janela).
#[tauri::command]
fn steam_bytes_written() -> Option<u64> {
    steam::steam_bytes_written()
}

/// Esconde (ou mostra) as notificações da Steam no canto da tela.
#[tauri::command]
fn steam_set_hide_toasts(app: AppHandle, hide: bool) {
    init_hide(&app);
    hide::set_hide_toasts(hide);
}

/// Impede (ou permite) que a Steam tome a tela do launcher quando o jogador aperta o botão Guia.
#[tauri::command]
fn steam_set_block_guide(app: AppHandle, block: bool) {
    init_hide(&app);
    hide::set_block_guide(block);
}

/// A conta tem chave guardada? (devolve só os 4 últimos caracteres, nunca a chave inteira)
#[tauri::command]
fn steam_key_status(app: AppHandle, steam_id: String) -> steam::KeyStatus {
    steam::key_status(app.path().app_config_dir().ok(), &steam_id)
}

/// Configura a conta: valida o formato, testa a chave buscando a biblioteca na Steam e, só se funcionar,
/// guarda a chave (em config.json, na pasta de configuração do app). Devolve os jogos da conta.
#[tauri::command]
async fn steam_setup_account(app: AppHandle, steam_id: String, api_key: String) -> Result<Vec<steam::OwnedGame>, String> {
    let key = api_key.trim().to_string();
    if !steam::is_valid_key(&key) {
        return Err("A chave deve ter 32 caracteres (números de 0 a 9 e letras de A a F).".into());
    }
    let games = steam::fetch_owned(&steam_id, Some(key.clone()))?;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    steam::save_api_key(&dir, &steam_id, &key)?;
    Ok(games)
}

#[tauri::command]
fn steam_clear_key(app: AppHandle, steam_id: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    steam::clear_api_key(&dir, &steam_id)
}

/// Abre a página de criação da chave dentro do navegador da própria Steam (que já está logada na conta).
#[tauri::command]
fn steam_open_key_page() -> Result<(), String> {
    // Aqui a Steam deve aparecer: é o jogador quem pediu.
    hide::allow(15_000);
    open_uri("steam://openurl/https://steamcommunity.com/dev/apikey")
}

/// Texto da área de transferência (para o botão "Colar" do teclado na tela).
#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(text.chars().take(512).collect())
}

// ───────── Sistema ─────────

/// Abre o Explorer (área de trabalho normal) e encerra o launcher.
/// Útil quando o launcher está configurado como shell do Windows.
#[tauri::command]
fn exit_to_desktop(app: AppHandle) -> Result<(), String> {
    Command::new("explorer.exe")
        .spawn()
        .map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            steam_run,
            steam_install,
            steam_uninstall,
            steam_validate,
            steam_store,
            steam_info,
            steam_installed,
            steam_collections,
            steam_app_meta,
            steam_running_app,
            steam_fetch_owned,
            steam_bytes_written,
            steam_set_hide_toasts,
            steam_set_block_guide,
            steam_key_status,
            steam_setup_account,
            steam_clear_key,
            steam_open_key_page,
            read_clipboard,
            exit_to_desktop
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o launcher");
}
