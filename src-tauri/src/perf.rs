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

/// Muda a configuração, grava no disco e aplica (liga ou desliga a captura e a janela).
pub fn set_config(patch: &Value) -> Value {
    let updated = {
        let mut guard = CONFIG.lock().unwrap();
        let current = guard.get_or_insert_with(defaults);
        let before = flag(current, "enabled");
        merge(current, patch);
        if before != flag(current, "enabled") {
            crate::guide::log(&format!("contador de desempenho: {}", if before { "desligado" } else { "ligado" }));
        }
        current.clone()
    };
    if let Some(app) = APP.get() {
        if let Some(file) = path(app) {
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(file, serde_json::to_vec_pretty(&updated).unwrap_or_default());
        }
        let app = app.clone();
        // A janela é criada fora da thread principal (criar uma janela dela mesma trava o Tauri).
        std::thread::spawn(move || apply(&app));
    }
    updated
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

fn monitor_bounds(app: &AppHandle) -> (i32, i32, u32, u32) {
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
        *CONFIG.lock().unwrap() = Some(base);
    }
    let initial = app.clone();
    std::thread::spawn(move || apply(&initial));
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
                    crate::guide::log(&format!("contador de FPS: {} a {:.0} FPS (média {:.0}, 1% low {:.0}, {:.1} ms)", game.process, s.fps, s.average, s.low1, s.frametime));
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

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
