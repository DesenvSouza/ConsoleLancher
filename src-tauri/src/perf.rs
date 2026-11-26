//! Contador de desempenho (FPS, frametime, temperatura, hardware) por cima dos jogos.
//!
//! O Rust é dono de tudo o que precisa existir com o launcher fora de foco: a configuração (um arquivo JSON), a captura dos
//! quadros (`perf_etw`), as leituras do hardware (`perf_hw`) e a janela transparente que desenha o contador por cima do jogo.
//! A interface (a janela do contador e a tela de configurações) só pergunta o estado e pede mudanças.
//!
//! A janela do contador é pequena, num canto, transparente e sem foco nem cliques: o jogo continua recebendo tudo.
//! Funciona com jogos em janela e em tela cheia sem bordas (o modo padrão dos jogos modernos no Windows 11); em tela cheia
//! exclusiva antiga o Windows esconde qualquer janela por cima.

use crate::perf_etw::{self, CaptureStatus, GameFrames};
use crate::perf_hw::{HwSampler, HwSnapshot};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const WINDOW_LABEL: &str = "perf";
const FILE: &str = "perf.json";
/// Depois de um pedido de leitura (a tela de configurações), o hardware continua sendo lido por este tempo.
const READ_FOR: Duration = Duration::from_secs(6);

static APP: OnceLock<AppHandle> = OnceLock::new();
static CONFIG: Mutex<Option<Value>> = Mutex::new(None);
static HW: Mutex<Option<HwSnapshot>> = Mutex::new(None);
static LAST_READ: Mutex<Option<Instant>> = Mutex::new(None);
static MEMBER: Mutex<Option<(Instant, bool)>> = Mutex::new(None);

/// Valores que o Rust precisa conhecer mesmo que o arquivo não os tenha.
fn defaults() -> Value {
    json!({ "enabled": false, "onlyInGame": true, "position": "top-left", "scale": 1.0 })
}

/// Mescla `patch` em `base` (objetos por campo; o resto é substituído).
pub fn merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(base), Value::Object(patch)) => {
            for (key, value) in patch {
                merge(base.entry(key.clone()).or_insert(Value::Null), value);
            }
        }
        (base, patch) => *base = patch.clone(),
    }
}

/// Faixas sempre em ordem (FPS "aceitável" abaixo do "bom"; temperatura de "atenção" abaixo da "crítica"), venha o valor da
/// interface ou de um arquivo antigo. Quem foi mudado por último (`patch`) fica; a vizinha se ajusta.
pub fn order_limits(config: &mut Value, patch: &Value) {
    for (low, high, gap) in [("fpsWarn", "fpsGood", 15i64), ("tempWarn", "tempHot", 5)] {
        let (Some(a), Some(b)) = (config.get(low).and_then(|v| v.as_i64()), config.get(high).and_then(|v| v.as_i64())) else { continue };
        if a < b {
            continue;
        }
        if patch.get(low).is_some() && patch.get(high).is_none() {
            config[high] = json!(a + gap);
        } else {
            config[low] = json!((b - gap).max(1));
        }
    }
}

fn path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

pub fn config() -> Value {
    let mut guard = CONFIG.lock().unwrap();
    guard.get_or_insert_with(defaults).clone()
}

fn flag(config: &Value, key: &str) -> bool {
    config.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

pub fn is_enabled() -> bool {
    flag(&config(), "enabled")
}

/// Grava num arquivo ao lado e troca de uma vez: uma queda no meio não deixa a configuração pela metade.
fn write_atomically(file: &std::path::Path, config: &Value) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let temporary = file.with_extension("json.tmp");
    let text = serde_json::to_vec_pretty(config).map_err(std::io::Error::other)?;
    let mut out = std::fs::File::create(&temporary)?;
    std::io::Write::write_all(&mut out, &text)?;
    out.sync_all()?;
    drop(out);
    std::fs::rename(&temporary, file)
}

/// Muda a configuração, grava no disco e aplica (liga ou desliga a captura e a janela). Se não der para gravar, nada muda.
pub fn set_config(patch: &Value) -> Result<Value, String> {
    // Um pedido por vez, do começo ao fim: dois pedidos próximos (Guia e Configurações) não gravam fora de ordem.
    static WRITING: Mutex<()> = Mutex::new(());
    let _turn = WRITING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut updated = config();
    let before = flag(&updated, "enabled");
    merge(&mut updated, patch);
    order_limits(&mut updated, patch);
    if let Some(file) = APP.get().and_then(path) {
        write_atomically(&file, &updated).map_err(|error| {
            crate::guide::log(&format!("contador de desempenho: não gravou a configuração: {error}"));
            "Não foi possível salvar o contador de FPS. A mudança foi desfeita.".to_string()
        })?;
    }
    *CONFIG.lock().unwrap() = Some(updated.clone());
    if before != flag(&updated, "enabled") {
        crate::guide::log(&format!("contador de desempenho: {}", if before { "desligado" } else { "ligado" }));
    }
    if let Some(app) = APP.get() {
        let app = app.clone();
        // A janela é criada fora da thread principal (criar uma janela dela mesma trava o Tauri).
        std::thread::spawn(move || apply(&app));
    }
    Ok(updated)
}

// ───────── Janela do contador ─────────

/// (esquerda, topo, largura, altura) da janela, em pixels, para a posição pedida.
pub fn placement(position: &str, monitor: (i32, i32, u32, u32), scale: f64) -> (i32, i32, u32, u32) {
    let (mx, my, mw, mh) = monitor;
    // A janela cresce com o tamanho escolhido (o contador maior não pode ser cortado), sem passar do monitor.
    let grow = scale.clamp(1.0, 3.0);
    let width = (((f64::from(mw) * 0.34 * grow) as u32).max(420)).min(mw);
    let height = (((f64::from(mh) * 0.56 * grow) as u32).max(320)).min(mh);
    let (w, h) = (width as i32, height as i32);
    let left = |side: &str| match side {
        "left" => mx,
        "right" => mx + mw as i32 - w,
        _ => mx + (mw as i32 - w) / 2,
    };
    let top = |side: &str| match side {
        "top" => my,
        "bottom" => my + mh as i32 - h,
        _ => my + (mh as i32 - h) / 2,
    };
    let (vertical, horizontal) = match position {
        "top-center" => ("top", "center"),
        "top-right" => ("top", "right"),
        "middle-left" => ("middle", "left"),
        "middle-right" => ("middle", "right"),
        "bottom-left" => ("bottom", "left"),
        "bottom-center" => ("bottom", "center"),
        "bottom-right" => ("bottom", "right"),
        _ => ("top", "left"),
    };
    (left(horizontal), top(vertical), width, height)
}

/// Monitor em que o jogo medido está (esquerda, topo, largura, altura), guardado pela última vez que ele estava na frente.
static GAME_MONITOR: Mutex<Option<(i32, i32, u32, u32)>> = Mutex::new(None);

/// O monitor da janela da frente, se ela for do programa `pid`.
fn foreground_monitor_of(pid: u32) -> Option<(i32, i32, u32, u32)> {
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    // SAFETY: só consulta a janela da frente e o monitor dela; as estruturas são locais.
    unsafe {
        let window = GetForegroundWindow();
        let mut owner = 0;
        GetWindowThreadProcessId(window, &mut owner);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if owner != pid || GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &mut info) == 0 {
            return None;
        }
        let m = info.rcMonitor;
        Some((m.left, m.top, (m.right - m.left).max(1) as u32, (m.bottom - m.top).max(1) as u32))
    }
}

/// O contador deve aparecer? Nunca por cima do launcher; só com jogo, salvo se o jogador quiser sempre ou houver um aviso.
fn should_show(launcher_in_front: bool, has_game: bool, only_in_game: bool, broken: bool) -> bool {
    !launcher_in_front && (has_game || !only_in_game || broken)
}

/// Esconde a janela quando não há o que mostrar (em vez de deixá-la transparente por cima de tudo) e a leva para o monitor do jogo.
fn follow_game(app: &AppHandle) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindowVisible, ShowWindowAsync, SW_HIDE, SW_SHOWNOACTIVATE};
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else { return };
    let Ok(handle) = window.hwnd() else { return };
    let hwnd = handle.0 as usize as windows_sys::Win32::Foundation::HWND;
    let config = config();
    let game = perf_etw::current_game();
    let broken = matches!(perf_etw::status(), CaptureStatus::Denied | CaptureStatus::Failed(_));
    let show = should_show(perf_etw::launcher_in_front(), game.is_some(), flag(&config, "onlyInGame"), broken);
    if let Some(monitor) = game.and_then(|game| foreground_monitor_of(game.pid)) {
        let changed = GAME_MONITOR.lock().unwrap().replace(monitor) != Some(monitor);
        if changed {
            let position = config.get("position").and_then(|v| v.as_str()).unwrap_or("top-left").to_string();
            let scale = config.get("scale").and_then(|v| v.as_f64()).unwrap_or(1.0);
            let (x, y, w, h) = placement(&position, monitor, scale);
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
            let _ = window.set_size(tauri::PhysicalSize::new(w, h));
        }
    }
    // SAFETY: mostra ou esconde a própria janela do contador, sem ativá-la.
    unsafe {
        if (IsWindowVisible(hwnd) != 0) != show {
            ShowWindowAsync(hwnd, if show { SW_SHOWNOACTIVATE } else { SW_HIDE });
        }
    }
}

fn monitor_bounds(app: &AppHandle) -> (i32, i32, u32, u32) {
    if let Some(game) = *GAME_MONITOR.lock().unwrap() {
        return game;
    }
    app.primary_monitor().ok().flatten().map(|m| (m.position().x, m.position().y, m.size().width, m.size().height)).unwrap_or((0, 0, 1920, 1080))
}

fn apply(app: &AppHandle) {
    // Uma aplicação por vez: ligar e desligar rápido criava duas janelas ao mesmo tempo ("já existe") ou reaproveitava a que
    // ainda estava fechando, e o contador ficava ligado sem janela. Quem entra por último lê a configuração mais nova.
    static APPLYING: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _turn = APPLYING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let config = config();
    if !flag(&config, "enabled") {
        perf_etw::stop();
        if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
            let _ = window.destroy();
            for _ in 0..100 {
                if app.get_webview_window(WINDOW_LABEL).is_none() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        return;
    }
    if !matches!(perf_etw::status(), CaptureStatus::Running | CaptureStatus::Starting) {
        perf_etw::start();
    }
    let position = config.get("position").and_then(|v| v.as_str()).unwrap_or("top-left").to_string();
    let scale = config.get("scale").and_then(|v| v.as_f64()).unwrap_or(1.0);
    let (x, y, w, h) = placement(&position, monitor_bounds(app), scale);
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        let _ = window.set_size(tauri::PhysicalSize::new(w, h));
        return;
    }
    let data_dir = app.path().app_local_data_dir().map(|d| d.join("perf-webview"));
    let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html?perf=1".into()))
        .title("Contador de desempenho")
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .skip_taskbar(true)
        .resizable(false)
        .always_on_top(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .position(f64::from(x), f64::from(y))
        .inner_size(f64::from(w), f64::from(h))
        // Sem isso o Chromium trata a janela como "coberta" por um jogo em tela cheia e a congela.
        .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows");
    if let Ok(dir) = data_dir {
        let _ = std::fs::create_dir_all(&dir);
        builder = builder.data_directory(dir);
    }
    // Criar a janela do contador não pode tirar o foco de quem estava usando o launcher (o controle pararia de responder).
    // SAFETY: só consulta a janela da frente.
    let in_front = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() } as usize;
    match builder.build() {
        Ok(window) => {
            // A janela é só desenho: o clique passa direto para o jogo, e ela não pega o foco nem aparece no Alt+Tab.
            let _ = window.set_ignore_cursor_events(true);
            if let Ok(hwnd) = window.hwnd() {
                use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT};
                // SAFETY: só liga estilos de janela na janela que acabamos de criar.
                unsafe {
                    let hwnd = hwnd.0 as usize as windows_sys::Win32::Foundation::HWND;
                    let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT) as isize);
                }
            }
            let _ = window.show();
            if let Some(main) = app.get_webview_window("main") {
                if main.hwnd().is_ok_and(|hwnd| hwnd.0 as usize == in_front) {
                    let _ = main.set_focus();
                }
            }
        }
        Err(error) => crate::guide::log(&format!("contador de desempenho: não criou a janela: {error}")),
    }
}

/// Mantém a janela por cima de jogos em tela cheia sem bordas (que também se declaram "no topo").
fn keep_on_top(app: &AppHandle) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindow, SetWindowPos, GW_HWNDPREV, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE};
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        if let Ok(hwnd) = window.hwnd() {
            let hwnd = hwnd.0 as usize as windows_sys::Win32::Foundation::HWND;
            // SAFETY: só consulta a ordem das janelas e, se outra passou por cima, reafirma a de uma janela nossa, sem
            // ativá-la, mexê-la ou redimensioná-la. Já estando por cima não mexe em nada: reafirmar a cada volta fazia a
            // janela brigar com jogos que também se declaram "no topo", e o contador piscava.
            unsafe {
                if GetWindow(hwnd, GW_HWNDPREV).is_null() {
                    return;
                }
                SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
        }
    }
}

// ───────── Estado para a interface ─────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerfSnapshot {
    pub config: Value,
    pub capture: CaptureStatus,
    /// O usuário já está no grupo que libera a captura (vale a partir de uma nova sessão do Windows).
    pub member: bool,
    pub game: Option<GameFrames>,
    pub hw: HwSnapshot,
    /// Largura do monitor em pixels: a interface escala o contador a partir dela.
    pub screen_width: u32,
    /// O launcher está na frente: o contador da janela de cima se esconde (é para ficar por cima do jogo, não do launcher).
    pub launcher_in_front: bool,
}

pub fn snapshot() -> PerfSnapshot {
    *LAST_READ.lock().unwrap() = Some(Instant::now());
    let capture = perf_etw::status();
    let member = if capture == CaptureStatus::Denied {
        let mut cache = MEMBER.lock().unwrap();
        match *cache {
            Some((at, value)) if at.elapsed() < Duration::from_secs(20) => value,
            _ => {
                let value = perf_etw::is_member();
                *cache = Some((Instant::now(), value));
                value
            }
        }
    } else {
        false
    };
    let screen_width = APP.get().map(|app| monitor_bounds(app).2).unwrap_or(1920);
    PerfSnapshot { config: config(), capture, member, game: perf_etw::current_game(), hw: HW.lock().unwrap().clone().unwrap_or_default(), screen_width, launcher_in_front: perf_etw::launcher_in_front() }
}

#[derive(Serialize, Clone)]
pub struct PerfStatus {
    pub enabled: bool,
    pub capture: CaptureStatus,
}

pub fn status() -> PerfStatus {
    PerfStatus { enabled: is_enabled(), capture: perf_etw::status() }
}

pub fn grant_permission() -> Result<(), String> {
    *MEMBER.lock().unwrap() = None;
    perf_etw::grant_permission()
}

/// Liga o contador: lê a configuração guardada, aplica e começa a ler o hardware. Chamar uma vez, ao abrir o app.
pub fn init(app: AppHandle) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    if let Some(saved) = path(&app).and_then(|file| std::fs::read(file).ok()).and_then(|raw| serde_json::from_slice::<Value>(&raw).ok()) {
        let mut base = defaults();
        merge(&mut base, &saved);
        order_limits(&mut base, &Value::Null);
        *CONFIG.lock().unwrap() = Some(base);
    }
    let initial = app.clone();
    std::thread::spawn(move || apply(&initial));
    let follower = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        if is_enabled() {
            follow_game(&follower);
        }
    });
    std::thread::spawn(move || {
        let mut sampler = HwSampler::new();
        let mut tick = 0u32;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            tick += 1;
            let wanted = is_enabled() || LAST_READ.lock().unwrap().is_some_and(|at| at.elapsed() < READ_FOR);
            if !wanted {
                continue;
            }
            *HW.lock().unwrap() = Some(sampler.sample());
            if tick % 2 == 0 && is_enabled() {
                keep_on_top(&app);
            }
            // De tempos em tempos, uma linha no registro: ajuda a conferir a medição sem olhar a tela do jogo.
            if tick % 20 == 0 && is_enabled() {
                if let Some(game) = perf_etw::current_game() {
                    let s = &game.summary;
                    let n = |value: Option<f32>| value.map_or("-".to_string(), |v| format!("{v:.1}"));
                    crate::guide::log(&format!("contador de FPS: {} a {} FPS (média {}, 1% low {}, {} ms)", game.process, n(s.fps), n(s.average), n(s.low1), n(s.frametime)));
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quando_o_contador_aparece() {
        assert!(!should_show(true, true, true, false), "nunca por cima do launcher");
        assert!(should_show(false, true, true, false));
        assert!(!should_show(false, false, true, false));
        assert!(should_show(false, false, false, false));
        assert!(should_show(false, false, true, true), "o aviso de erro aparece mesmo sem jogo");
    }

    #[test]
    fn grava_a_configuracao_de_uma_vez() {
        let dir = std::env::temp_dir().join(format!("launcher-perf-{}", std::process::id()));
        let file = dir.join("perf.json");
        write_atomically(&file, &json!({ "enabled": true })).unwrap();
        write_atomically(&file, &json!({ "enabled": false })).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap().contains("false"), true);
        assert!(!file.with_extension("json.tmp").exists());
        // Sem onde gravar, o erro aparece.
        assert!(write_atomically(&file.join("dentro-de-um-arquivo.json"), &json!({})).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn faixas_nunca_ficam_invertidas() {
        let mut config = json!({ "fpsGood": 60, "fpsWarn": 90, "tempWarn": 80, "tempHot": 75 });
        order_limits(&mut config, &json!({ "fpsWarn": 90 }));
        assert_eq!((config["fpsWarn"].as_i64(), config["fpsGood"].as_i64()), (Some(90), Some(105)));
        assert_eq!((config["tempWarn"].as_i64(), config["tempHot"].as_i64()), (Some(70), Some(75)));
        let mut ok = json!({ "fpsGood": 60, "fpsWarn": 30 });
        order_limits(&mut ok, &Value::Null);
        assert_eq!(ok, json!({ "fpsGood": 60, "fpsWarn": 30 }));
    }

    #[test]
    fn mescla_configuracao_por_campo() {
        let mut base = json!({ "enabled": false, "items": { "fps": true, "graph": true }, "scale": 1.0 });
        merge(&mut base, &json!({ "enabled": true, "items": { "graph": false } }));
        assert_eq!(base, json!({ "enabled": true, "items": { "fps": true, "graph": false }, "scale": 1.0 }));
    }

    #[test]
    fn posicao_da_janela_em_cada_canto() {
        let monitor = (0, 0, 1920, 1080);
        let (x, y, w, h) = placement("top-left", monitor, 1.0);
        assert_eq!((x, y), (0, 0));
        assert!(w >= 420 && h >= 320);
        let (x, y, ..) = placement("bottom-right", monitor, 1.0);
        assert_eq!((x + w as i32, y + h as i32), (1920, 1080));
        let (x, ..) = placement("top-center", monitor, 1.0);
        assert_eq!(x, (1920 - w as i32) / 2);
        // Segundo monitor, à direita do primeiro.
        let (x, _, w, _) = placement("top-right", (1920, 0, 2560, 1440), 1.0);
        assert_eq!(x + w as i32, 1920 + 2560);
        // Tamanho maior: janela maior, sem passar do monitor.
        let (_, _, wide, _) = placement("top-left", monitor, 2.0);
        assert!(wide > w && wide <= 1920);
        // Posição desconhecida: canto superior esquerdo.
        assert_eq!(placement("nada", monitor, 1.0).0, 0);
    }

    #[test]
    fn padroes() {
        let config = defaults();
        assert!(!flag(&config, "enabled"));
        assert!(flag(&config, "onlyInGame"));
    }
}
