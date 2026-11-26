mod appinfo;
mod bluetooth;
mod downloads;
mod epic;
mod epic_install;
mod guide;
mod guide_preferences;
mod hide;
mod hltb;
mod legendary;
mod launch;
mod playstation;
mod perf;
mod perf_etw;
mod perf_hw;
mod perf_stats;
mod pointer;
mod steam_auth;
mod steam_lookup;
mod sound;
mod steam;
mod startup;
mod shell;
mod system;
mod update;
mod wifi;

use std::os::windows::process::CommandExt;
use std::process::Command;
use guide_preferences::GuidePreferences;
use tauri::{AppHandle, Manager, RunEvent, State, WebviewWindow, WindowEvent};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use shell::open_uri;

/// Abre uma tela da Steam que o jogador pediu para ver.
fn open_steam_ui(uri: &str) -> Result<(), String> {
    hide::allow(15_000);
    open_uri(uri)
}

/// O AppID vem do front-end: aceita só dígitos para não montar URIs arbitrários.
fn steam_uri(action: &str, app_id: &str) -> Result<String, String> {
    if app_id.is_empty() || !app_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("AppID inválido: {app_id:?}"));
    }
    Ok(format!("steam://{action}/{app_id}"))
}

// ───────── Ações na Steam (via protocolo steam://) ─────────
//
// Os comandos abaixo são `#[tauri::command(async)]`: sem isso o Tauri roda comandos síncronos na thread principal,
// a mesma que desenha as janelas e entrega os eventos. Ler arquivos da Steam, o registro ou chamar o PowerShell
// leva de milissegundos a mais de um segundo (antivírus, disco frio) e, nesse tempo, o menu do Guia e a
// interface inteira ficavam parados.

/// Roda um trabalho que pode demorar (esperar a Steam abrir) fora da thread da interface.
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn steam_run(app_id: String, retry: Option<bool>) -> Result<(), String> {
    let uri = steam_uri("rungameid", &app_id)?;
    blocking(move || {
        launch::start_game(app_id, retry.unwrap_or(false), || {
            steam::ensure_running()?;
            steam::leave_big_picture();
            open_uri(&uri)
        })
    })
    .await
}

#[tauri::command]
async fn steam_close_game(app_id: String) -> Result<(), String> {
    let app_id = app_id.parse::<u32>().map_err(|_| "AppID inválido.")?;
    blocking(move || guide::close_game(app_id)).await
}

/// Manda um comando de console para a Steam em execução (`steam.exe +comando <id>`), sem diálogos.
/// Os `steam://...` abrem diálogos da Steam (escolha de pasta, confirmação); estes comandos não.
/// Testado com um jogo real: `app_install` baixa na biblioteca padrão, `app_uninstall` remove o jogo
/// (e também cancela um download em andamento), tudo sem perguntar nada.
/// Em tela cheia, o launcher minimiza a janela da Steam e retoma o foco.
/// Se a Steam não for encontrada, usa o `fallback_uri`.
fn steam_console(command: &str, app_id: &str, fallback_uri: String) -> Result<(), String> {
    let Some(exe) = steam::steam_exe() else {
        return open_steam_ui(&fallback_uri);
    };
    // Com a Steam fechada, o comando abriria a Steam do jeito normal (login, ofertas, janela principal).
    steam::ensure_running()?;
    Command::new(exe)
        .args([&format!("+{command}"), app_id])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Instala sem diálogo, na biblioteca padrão da Steam.
#[tauri::command]
async fn steam_install(app_id: String) -> Result<(), String> {
    let uri = steam_uri("install", &app_id)?; // também valida que o AppID são só dígitos
    blocking(move || steam_console("app_install", &app_id, uri)).await
}

/// Remove o jogo — ou cancela o download, se ele ainda estiver baixando — sem diálogo da Steam.
/// A confirmação ("Desinstalar X?") é do próprio launcher, antes de chamar este comando.
#[tauri::command]
async fn steam_uninstall(app_id: String) -> Result<(), String> {
    let uri = steam_uri("uninstall", &app_id)?;
    blocking(move || steam_console("app_uninstall", &app_id, uri)).await
}

#[tauri::command(async)]
fn steam_validate(app_id: String) -> Result<(), String> {
    open_steam_ui(&steam_uri("validate", &app_id)?)
}

#[tauri::command(async)]
fn steam_store(app_id: String) -> Result<(), String> {
    open_steam_ui(&steam_uri("store", &app_id)?)
}

// ───────── Leitura da Steam (arquivos locais e registro) ─────────

/// Steam encontrada? Conta logada, jogo em execução, SteamID64 e nome do perfil.
#[tauri::command(async)]
fn steam_info() -> steam::SteamInfo {
    steam::info()
}

/// Jogos instalados (todas as bibliotecas), com estado e progresso de download.
#[tauri::command(async)]
fn steam_installed() -> Vec<steam::InstalledApp> {
    steam::steam_root().map(|root| steam::scan_installed(&root)).unwrap_or_default()
}

/// Confirma a remoção mesmo quando a varredura não conseguiu ler um disco.
#[tauri::command]
async fn steam_manifests_removed(
    app_id: String,
    library_paths: Vec<std::path::PathBuf>,
) -> Result<bool, String> {
    if app_id.is_empty() || !app_id.bytes().all(|byte| byte.is_ascii_digit()) || library_paths.is_empty() {
        return Err("Instalação da Steam inválida.".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let root = steam::steam_root().ok_or("Biblioteca da Steam indisponível.")?;
        let libraries = steam::library_paths(&root);
        let manifest = format!("appmanifest_{app_id}.acf");
        for path in library_paths {
            if !libraries.contains(&path) {
                return Err("A biblioteca de origem da Steam está indisponível.".into());
            }
            let dir = path.join("steamapps");
            std::fs::read_dir(&dir).map_err(|err| err.to_string())?;
            if dir.join(&manifest).try_exists().map_err(|err| err.to_string())? {
                return Ok(false);
            }
        }
        Ok(true)
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Coleções da Steam da conta (Favoritos, Ocultos e as criadas pelo jogador). Só leitura de arquivo local.
#[tauri::command(async)]
fn steam_collections(steam_id: String) -> Vec<steam::Collection> {
    steam::steam_root().map(|root| steam::read_collections(&root, &steam_id)).unwrap_or_default()
}

/// Dados para montar o menu do Guia: há jogo rodando e qual.
#[tauri::command(async)]
fn guide_context(preferences: State<'_, GuidePreferences>) -> guide::GuideContext {
    guide::context(preferences.options())
}

/// A janela do menu pergunta, a cada instante: aberto?, qual abertura e como está o controle.
#[tauri::command(async)]
fn guide_poll(window: WebviewWindow) -> guide::Poll {
    guide::poll(window.label() == "main" && window_is_foreground(&window))
}

pub(crate) fn window_is_foreground(window: &WebviewWindow) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    // SAFETY: apenas consulta o HWND em primeiro plano.
    window.hwnd().is_ok_and(|hwnd| hwnd.0 == unsafe { GetForegroundWindow() })
}

/// Depuração: a janela do menu escreve aqui o que recebeu (só aparece no terminal do `tauri dev`).
#[tauri::command(async)]
fn guide_log(message: String) {
    guide::log(&format!("(js) {message}"));
}

/// Ação escolhida no menu do Guia (resume, library, close_game, suspend, restart, shutdown, desktop).
#[tauri::command]
async fn guide_action(app: AppHandle, preferences: State<'_, GuidePreferences>, action: String, game_id: Option<String>) -> Result<(), String> {
    if !preferences.options().allows(&action) {
        return Err("Esta opção de energia está oculta nas configurações do Guia.".into());
    }
    if action == "desktop" {
        return exit_to_desktop(app).await;
    }
    guide::action(&action, game_id.as_deref())
}

/// A janela está à frente, mas a página perdeu o foco: devolve o foco a ela.
#[tauri::command]
fn focus_launcher_view(window: WebviewWindow) {
    if window.label() == "main" && window_is_foreground(&window) {
        let view: &tauri::Webview = window.as_ref();
        let _ = view.set_focus();
    }
}

#[tauri::command(async)]
fn restore_launcher_after_game(app: AppHandle) {
    guide::restore_launcher_after_game(&app);
}

/// Descrição, gêneros e data de lançamento da loja, no idioma pedido (com cache no disco).
#[tauri::command]
async fn steam_store_details(app: AppHandle, app_id: String, lang: String) -> Result<steam::StoreDetails, String> {
    let dir = app.path().app_config_dir().ok();
    blocking(move || steam::store_details(dir, &app_id, &lang)).await
}

/// Duração do jogo na HowLongToBeat (extra opcional; sem API oficial, pode falhar). `None` = o site não conhece o jogo.
#[tauri::command]
async fn hltb_lookup(name: String, app_id: Option<String>) -> Result<Option<hltb::HltbInfo>, String> {
    blocking(move || hltb::lookup(&name, app_id.as_deref())).await
}

/// Dados de cada jogo guardados pela Steam (tipo, suporte a controle, categorias, tags): a base para avaliar
/// as coleções dinâmicas. Só leitura de arquivo local.
#[tauri::command(async)]
fn steam_app_meta() -> Vec<appinfo::AppMeta> {
    let Some(root) = steam::steam_root() else { return Vec::new() };
    // A Steam reescreve o `appinfo.vdf` de tempos em tempos (ao atualizar, ao abrir um jogo...): uma leitura no meio
    // da gravação vem vazia ou truncada. Tenta de novo algumas vezes antes de desistir.
    for attempt in 0..4 {
        let apps = appinfo::read_appinfo(&root);
        if !apps.is_empty() {
            return apps;
        }
        if attempt < 3 {
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
    }
    Vec::new()
}

/// AppID do jogo em execução agora (0 = nenhum).
#[tauri::command(async)]
fn steam_running_app() -> u32 {
    steam::running_app_id()
}

#[tauri::command(async)]
fn launch_confirm_foreground(window: WebviewWindow, ids: Vec<String>) -> Option<String> {
    if window.label() != "main" {
        return None;
    }
    launch::confirm_foreground(window.hwnd().ok()?.0, &ids)
}

/// Ponto do log da Steam de agora: a abertura de um jogo só olha o que vier depois dele.
#[tauri::command(async)]
fn steam_launch_mark() -> launch::LaunchMark {
    launch::log_mark()
}

/// Em que etapa está a abertura do jogo (contrato a aceitar, componentes, nuvem, criação do processo...).
#[tauri::command(async)]
fn steam_launch_status(app_id: String, from: launch::LaunchMark) -> launch::LaunchStatus {
    launch::status(&app_id, from)
}

/// A Steam está esperando uma resposta (contrato do jogo, por exemplo) numa janela que o launcher esconde:
/// libera a Steam e traz essa janela para a frente.
#[tauri::command(async)]
fn steam_show_prompt(app_id: String) -> Result<(), String> {
    steam_uri("nav/games/details", &app_id)?; // só valida o número do app
    // Restaura a janela da Steam (recortada na caixa de pedido, se houver uma) e a traz para a frente.
    hide::show_steam_prompt();
    // A janela da Steam não obedece ao controle: enquanto ela estiver na frente, o controle vira mouse e teclado.
    pointer::set_active(true);
    // Deixa o cursor em cima do botão "Aceitar": o jogador só precisa apertar A.
    launch::aim_at_accept_button();
    Ok(())
}

/// Texto do contrato que a Steam pede (página pública da loja), no idioma pedido.
#[tauri::command(async)]
fn steam_eula_text(eula_id: String, lang: String) -> Result<String, String> {
    launch::eula_text(&eula_id, &lang)
}

/// O jogador aceitou o contrato no launcher: clica em "Aceitar" na Steam, por um instante, e a esconde de novo.
#[tauri::command(async)]
fn steam_accept_eula() -> Result<(), String> {
    launch::accept_in_steam()?;
    // Dá um instante para a Steam registrar o aceite antes de escondê-la.
    std::thread::sleep(std::time::Duration::from_millis(400));
    guide::finish_steam_prompt();
    Ok(())
}

/// A Steam recebeu a resposta que pedia: devolve o controle ao launcher, esconde a Steam de novo e traz o jogo
/// (ou o launcher) para a frente.
#[tauri::command(async)]
fn steam_prompt_done() {
    guide::finish_steam_prompt();
}

/// Todos os jogos da conta, inclusive não instalados, usando a chave guardada para essa conta
/// (ou STEAM_API_KEY). Sem chave, tenta o perfil público — que hoje a Steam costuma recusar.
#[tauri::command]
async fn steam_fetch_owned(app: AppHandle, steam_id: String) -> Result<Vec<steam::OwnedGame>, String> {
    let dir = app.path().app_config_dir().ok();
    let key = steam::read_api_key(dir.clone(), &steam_id);
    // O login por QR vale primeiro; a chave é o caminho de reserva.
    if let Some(dir) = &dir {
        if steam_auth::session_info(dir).is_some_and(|s| s.steam_id == steam_id) {
            match steam_auth::fetch_owned(dir, &steam_id) {
                Ok(games) => return Ok(games),
                Err(e) if key.is_none() => return Err(e),
                Err(_) => {}
            }
        }
    }
    steam::fetch_owned(&steam_id, key)
}

/// Pede um QR de login (o jogador o lê com o app da Steam no celular).
#[tauri::command]
async fn steam_auth_begin() -> Result<steam_auth::QrChallenge, String> {
    blocking(steam_auth::begin).await
}

/// Pergunta à Steam se o QR já foi aprovado. Aprovado: a sessão fica guardada (cifrada) neste PC.
#[tauri::command]
async fn steam_auth_poll(app: AppHandle, client_id: String, request_id: String) -> Result<steam_auth::QrPoll, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    blocking(move || steam_auth::poll(&dir, &client_id, &request_id)).await
}

/// Esquece o login por QR neste PC.
#[tauri::command(async)]
fn steam_auth_logout(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    steam_auth::logout(&dir)
}

// ───────── Epic Games ─────────

#[tauri::command(async)]
fn epic_status(app: AppHandle) -> Result<epic::EpicStatus, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(epic::status(&dir))
}

#[tauri::command(async)]
fn epic_open_login() -> Result<(), String> {
    epic::open_login()
}

/// Abre a página de login da Epic numa janela do launcher; o resultado chega pelo evento `epic-login`.
#[tauri::command(async)]
fn epic_login_window(app: AppHandle) -> Result<(), String> {
    epic::open_login_window(app)
}

#[tauri::command]
async fn epic_sign_in(app: AppHandle, code: String) -> Result<epic::EpicStatus, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    blocking(move || epic::sign_in(&dir, &code)).await
}

#[tauri::command(async)]
fn epic_sign_out(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    epic::sign_out(&dir)
}

/// Todos os jogos da conta da Epic, instalados ou não.
#[tauri::command]
async fn epic_library(app: AppHandle) -> Result<Vec<epic::EpicGame>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    blocking(move || epic::fetch_library(&dir)).await
}

// ───────── Contador de desempenho (FPS) ─────────

#[tauri::command(async)]
fn perf_get_config() -> serde_json::Value {
    perf::config()
}

/// Muda a configuração do contador (só os campos enviados) e devolve a configuração completa.
#[tauri::command(async)]
fn perf_set_config(patch: serde_json::Value) -> Result<serde_json::Value, String> {
    perf::set_config(&patch)
}

/// Estado leve do contador (para o menu Guia): ligado? e a captura de quadros.
#[tauri::command(async)]
fn perf_status() -> perf::PerfStatus {
    perf::status()
}

#[tauri::command(async)]
fn perf_snapshot() -> perf::PerfSnapshot {
    perf::snapshot()
}

/// Pede ao Windows (com a confirmação de administrador) para liberar a captura de quadros.
#[tauri::command(async)]
fn perf_grant_permission() -> Result<(), String> {
    perf::grant_permission()
}

/// Suporte a controle pelo nome do jogo, na loja da Steam ("full", "partial", "none" ou "nomatch" por título).
#[tauri::command]
async fn steam_controller_lookup(titles: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    blocking(move || Ok(steam_lookup::controller_support(titles))).await
}

#[tauri::command]
async fn epic_controller_support(games: Vec<epic::CatalogGame>) -> Result<std::collections::HashMap<String, bool>, String> {
    blocking(move || epic::controller_support(games)).await
}

#[tauri::command(async)]
fn epic_installed() -> Vec<epic::EpicInstalled> {
    epic::installed()
}

#[tauri::command]
async fn epic_launch(app_name: String) -> Result<(), String> {
    blocking(move || launch::start_game(format!("epic:{app_name}"), false, || epic::launch(&app_name))).await
}

/// O Legendary está disponível (instalar sem a janela da Epic Games Launcher)? E o andamento do download dele.
#[tauri::command(async)]
fn epic_legendary_status(app: AppHandle) -> Result<legendary::LegendaryStatus, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(legendary::status(&dir))
}

/// Baixa o Legendary da publicação oficial (só quando o jogador pede) e confere o arquivo.
#[tauri::command]
async fn epic_legendary_download(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    blocking(move || legendary::download(&dir)).await
}

/// Começa a instalar pelo Legendary, em segundo plano; o andamento vem de `epic_install_states`.
#[tauri::command(async)]
fn epic_install_start(app: AppHandle, app_name: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    epic_install::start_install(&dir, &app_name)
}

#[tauri::command(async)]
fn epic_install_states() -> std::collections::HashMap<String, epic_install::InstallState> {
    epic_install::states()
}

#[tauri::command(async)]
fn epic_install_cancel(app_name: String) {
    epic_install::cancel_install(&app_name);
}

#[tauri::command(async)]
fn epic_install_forget(app_name: String) {
    epic_install::forget(&app_name);
}

/// Desinstala um jogo instalado pelo Legendary.
#[tauri::command]
async fn epic_uninstall(app: AppHandle, app_name: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    blocking(move || epic_install::uninstall(&dir, &app_name)).await
}

#[tauri::command(async)]
fn epic_install(namespace: String, catalog_item_id: String, app_name: String) -> Result<(), String> {
    epic::install(&namespace, &catalog_item_id, &app_name)
}

#[tauri::command(async)]
fn epic_open_library() -> Result<(), String> {
    epic::open_library()
}

#[tauri::command(async)]
fn epic_running() -> Option<epic::EpicRunning> {
    epic::running()
}

#[tauri::command(async)]
fn epic_close_game() -> Result<(), String> {
    // Um jogo congelado não conseguiria atender ao pedido de fechar.
    guide::release_pause();
    epic::close_running()
}

/// Total que a Steam já gravou em disco (para o progresso de instalação em tempo real, sem abrir janela).
#[tauri::command(async)]
fn steam_bytes_written() -> Option<u64> {
    steam::steam_bytes_written()
}

/// Esconde (ou mostra) as notificações da Steam no canto da tela.
#[tauri::command(async)]
fn steam_set_hide_toasts(hide: bool) {
    hide::set_hide_toasts(hide);
}

/// A conta tem chave guardada? (devolve só os 4 últimos caracteres, nunca a chave inteira)
#[tauri::command(async)]
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

#[tauri::command(async)]
fn steam_clear_key(app: AppHandle, steam_id: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    steam::clear_api_key(&dir, &steam_id)
}

/// Abre a página de criação da chave dentro do navegador da própria Steam (que já está logada na conta).
#[tauri::command(async)]
fn steam_open_key_page() -> Result<(), String> {
    open_steam_ui("steam://openurl/https://steamcommunity.com/dev/apikey")
}

/// Texto da área de transferência (para o botão "Colar" do teclado na tela).
#[tauri::command(async)]
fn read_clipboard() -> Result<String, String> {
    Ok(shell::clipboard_text().trim().chars().take(512).collect())
}

// ───────── Sistema ─────────

#[tauri::command]
fn toggle_fullscreen(window: WebviewWindow) -> Result<(), String> {
    let fullscreen = !window.is_fullscreen().map_err(|e| e.to_string())?;
    window
        .set_fullscreen(fullscreen)
        .map_err(|e| e.to_string())?;
    hide::set_fullscreen(fullscreen);
    Ok(())
}

#[tauri::command]
async fn exit_to_desktop(app: AppHandle) -> Result<(), String> {
    blocking(|| {
        // Primeiro o Explorer: no modo console ele não está aberto, e sem ele o launcher não teria para onde sair.
        startup::ensure_explorer(std::time::Duration::from_secs(15))?;

        // Minimiza as janelas pelo Shell, inclusive a do jogo, sem encerrar seus processos.
        shell::minimize_all_windows()
    }).await?;

    guide::close(false);
    guide::release_pause();
    hide::set_fullscreen(false);
    // Sob o vigia do modo console, o código de saída diz a ele que foi o jogador quem pediu a área de trabalho.
    app.exit(if startup::supervised() { startup::EXIT_TO_DESKTOP_CODE } else { 0 });
    Ok(())
}

// ───────── Tema e idioma para o menu Guia ─────────
// O menu Guia tem a própria pasta de dados (não enxerga o localStorage do launcher): o launcher publica aqui o tema e o idioma
// e o menu os lê.

static SYNCED_SETTINGS: std::sync::Mutex<Option<serde_json::Value>> = std::sync::Mutex::new(None);

#[tauri::command]
fn sync_settings(app: AppHandle, settings: serde_json::Value) {
    use tauri::Emitter;
    *SYNCED_SETTINGS.lock().unwrap() = Some(settings.clone());
    let _ = app.emit_to("guide", "settings-sync", settings);
}

#[tauri::command]
fn get_synced_settings() -> Option<serde_json::Value> {
    SYNCED_SETTINGS.lock().unwrap().clone()
}

// ───────── Controles do sistema (volume, saída de áudio, rede, bateria do controle) ─────────

#[tauri::command(async)]
fn system_status() -> system::SystemStatus {
    system::status()
}

// O volume e a saída de áudio mudam por dois lugares (o painel do launcher e o menu Guia, que são janelas separadas):
// quem mudou avisa as duas, para o indicador do topo e as linhas do menu mostrarem sempre o mesmo valor.
#[tauri::command(async)]
fn system_set_volume(app: AppHandle, percent: u32) -> Result<system::Volume, String> {
    use tauri::Emitter;
    let volume = system::set_volume(percent).map_err(|detail| format!("Não foi possível ajustar o volume: {detail}"))?;
    let _ = app.emit("system-volume", &volume);
    Ok(volume)
}

#[tauri::command(async)]
fn system_set_mute(app: AppHandle, muted: bool) -> Result<system::Volume, String> {
    use tauri::Emitter;
    let volume = system::set_mute(muted).map_err(|detail| format!("Não foi possível ajustar o volume: {detail}"))?;
    let _ = app.emit("system-volume", &volume);
    Ok(volume)
}

#[tauri::command(async)]
fn system_set_output(app: AppHandle, id: String) -> Result<system::SystemStatus, String> {
    use tauri::Emitter;
    system::set_output(&id).map_err(|detail| format!("Não foi possível trocar a saída de áudio: {detail}"))?;
    let status = system::status();
    let _ = app.emit("system-status", &status);
    Ok(status)
}

// ───────── Wi-Fi e Bluetooth ─────────

#[tauri::command(async)]
fn wifi_list(rescan: bool) -> wifi::WifiList {
    wifi::list(rescan)
}

#[tauri::command(async)]
fn wifi_connect(ssid: String, password: Option<String>) -> Result<(), String> {
    wifi::connect(&ssid, password.as_deref())
}

#[tauri::command(async)]
fn wifi_disconnect() -> Result<(), String> {
    wifi::disconnect().map_err(|detail| format!("Não foi possível desconectar do Wi-Fi: {detail}"))
}

#[tauri::command(async)]
fn wifi_forget(ssid: String) -> Result<(), String> {
    wifi::forget(&ssid).map_err(|detail| format!("Não foi possível esquecer a rede: {detail}"))
}

#[tauri::command(async)]
fn bluetooth_paired() -> bluetooth::BtList {
    bluetooth::paired()
}

#[tauri::command(async)]
fn bluetooth_discover() -> bluetooth::BtList {
    bluetooth::discover()
}

#[tauri::command(async)]
fn bluetooth_pair(id: String) -> Result<(), String> {
    bluetooth::pair(&id)
}

#[tauri::command(async)]
fn bluetooth_set_connected(id: String, connect: bool) -> Result<(), String> {
    bluetooth::set_connected(&id, connect)
}

#[tauri::command(async)]
fn bluetooth_forget(id: String) -> Result<(), String> {
    bluetooth::forget(&id)
}

// ───────── Início com o Windows e modo console ─────────

fn config_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn startup_status(app: AppHandle) -> Result<startup::StartupStatus, String> {
    startup::status(&config_dir(&app)?)
}

#[tauri::command(async)]
fn startup_set_autostart(app: AppHandle, enabled: bool) -> Result<startup::StartupStatus, String> {
    startup::set_autostart(enabled)?;
    startup::status(&config_dir(&app)?)
}

#[tauri::command(async)]
fn startup_set_console(app: AppHandle, enabled: bool) -> Result<startup::StartupStatus, String> {
    let dir = config_dir(&app)?;
    startup::set_console(&dir, enabled)?;
    startup::status(&dir)
}

/// Traz a janela existente para a frente, preservando o tamanho e o modo de tela.
pub(crate) fn bring_to_front(window: &WebviewWindow) {
    if matches!(window.is_visible(), Ok(false)) {
        let _ = window.show();
    }
    if !window.hwnd().is_ok_and(|hwnd| guide::force_foreground(hwnd.0)) {
        let _ = window.set_focus();
    }
}

/// Posiciona a janela principal por trás do jogo sem ativá-la ou alterar seu tamanho.
fn place_launcher_behind(window: &WebviewWindow, game: usize) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_NOTOPMOST,
        HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, WS_EX_TOPMOST,
    };

    let Ok(hwnd) = window.hwnd() else { return };
    let game = game as HWND;
    // SAFETY: revalida a janela do jogo antes de reordenar a janela do launcher.
    unsafe {
        if game != GetForegroundWindow() {
            return;
        }
        let after = if GetWindowLongPtrW(game, GWL_EXSTYLE) & WS_EX_TOPMOST as isize == 0 {
            game
        } else if GetWindowLongPtrW(hwnd.0, GWL_EXSTYLE) & WS_EX_TOPMOST as isize != 0 {
            HWND_NOTOPMOST
        } else {
            // Quando o jogo está no grupo de janelas sempre no topo, basta ser a primeira janela normal.
            HWND_TOP
        };
        SetWindowPos(hwnd.0, after, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    // O desinstalador chama assim antes de apagar o programa: desfaz o que foi registrado no Windows e sai.
    if args.iter().any(|a| a == startup::UNINSTALL_ARG) {
        startup::uninstall_cleanup();
        return;
    }
    // Modo console: este processo é só o vigia, que abre o launcher de verdade e o reabre se ele cair.
    if args.iter().any(|a| a == startup::SHELL_ARG) {
        startup::supervise();
    }
    // O Windows abriu o launcher ao entrar, mas ele já estava aberto: sai em silêncio.
    if !startup::claim_instance(args.iter().any(|a| a == startup::AUTOSTART_ARG)) {
        return;
    }
    // Se o launcher mudou de pasta, o registro (início com o Windows / modo console) volta a apontar para ele.
    startup::repair();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let guide_preferences_path = app.path().app_config_dir()?.join("guide-power.json");
            app.manage(GuidePreferences::load(guide_preferences_path));
            let window = app
                .get_webview_window("main")
                .expect("janela principal ausente");
            let launcher_window = window.clone();
            hide::init(move |focus_from| {
                let target = launcher_window.clone();
                let _ = launcher_window.run_on_main_thread(move || {
                    let state = hide::launcher_window_state(focus_from);
                    if let Some(game) = state.behind_game {
                        place_launcher_behind(&target, game);
                    }
                    let _ = target.set_always_on_top(state.keep_above_steam);
                    if state.restore {
                        // O jogo acabou de fechar: o launcher volta à frente e insiste até ficar com o foco.
                        guide::restore_launcher_after_game(target.app_handle());
                    } else if state.refocus {
                        let _ = target.set_focus();
                    }
                });
            });
            // Menu do botão Guia: janela transparente por cima do jogo + leitura do controle pelo XInput.
            epic::init(app.path().app_config_dir()?);
            perf::init(app.handle().clone());
            guide::create_window(app.handle())?;
            guide::start(app.handle().clone());
            hide::set_fullscreen(window.is_fullscreen()?);
            window.show()?;
            window.set_focus()?;
            guide::keep_launcher_focused(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::Focused(true) => hide::launcher_focused(),
                WindowEvent::Destroyed => hide::set_fullscreen(false),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            steam_run,
            steam_close_game,
            epic_status,
            epic_open_login,
            epic_login_window,
            epic_sign_in,
            epic_sign_out,
            epic_library,
            epic_controller_support,
            steam_controller_lookup,
            perf_get_config,
            perf_set_config,
            perf_snapshot,
            perf_status,
            perf_grant_permission,
            epic_installed,
            epic_launch,
            epic_install,
            epic_legendary_status,
            epic_legendary_download,
            epic_install_start,
            epic_install_states,
            epic_install_cancel,
            epic_install_forget,
            epic_uninstall,
            epic_open_library,
            epic_running,
            epic_close_game,
            downloads::disk_usage,
            downloads::power_schedule,
            downloads::power_cancel,
            downloads::power_restart,
            steam_install,
            steam_uninstall,
            steam_validate,
            steam_store,
            steam_info,
            steam_launch_mark,
            steam_launch_status,
            steam_show_prompt,
            steam_prompt_done,
            steam_eula_text,
            steam_accept_eula,
            steam_installed,
            steam_manifests_removed,
            steam_collections,
            steam_app_meta,
            guide_context,
            guide_action,
            restore_launcher_after_game,
            focus_launcher_view,
            guide_log,
            guide_poll,
            guide_preferences::guide_power_options,
            guide_preferences::guide_set_power_option,
            sound::sound_set_enabled,
            sound::sound_play,
            steam_store_details,
            hltb_lookup,
            steam_running_app,
            launch_confirm_foreground,
            steam_fetch_owned,
            steam_bytes_written,
            steam_set_hide_toasts,
            steam_key_status,
            steam_auth_begin,
            steam_auth_poll,
            steam_auth_logout,
            steam_setup_account,
            steam_clear_key,
            steam_open_key_page,
            read_clipboard,
            toggle_fullscreen,
            exit_to_desktop,
            update::update_status,
            update::update_check,
            update::update_download,
            update::update_apply,
            startup_status,
            startup_set_autostart,
            startup_set_console,
            sync_settings,
            get_synced_settings,
            system_status,
            system_set_volume,
            system_set_mute,
            system_set_output,
            wifi_list,
            wifi_connect,
            wifi_disconnect,
            wifi_forget,
            bluetooth_paired,
            bluetooth_discover,
            bluetooth_pair,
            bluetooth_set_connected,
            bluetooth_forget
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o launcher")
        .run(|_, event| {
            if matches!(event, RunEvent::Exit) {
                hide::set_fullscreen(false);
            }
        });
}
