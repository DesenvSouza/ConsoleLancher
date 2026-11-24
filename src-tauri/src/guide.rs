//! Menu do botão Guia: uma janela lateral que aparece sobre o jogo em execução.
//!
//! O botão Guia só chega pelo XInput (a Gamepad API do navegador não o entrega e só funciona com a janela em
//! foco), então uma thread lê os controles direto do Windows e repassa os dados ao menu.

use crate::{guide_preferences::PowerOptions, hide, steam};
use serde::Serialize;
use std::os::windows::io::{FromRawHandle, OwnedHandle};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, HWND, RECT};
use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryW};
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, PROCESS_SET_INFORMATION, PROCESS_SUSPEND_RESUME, PROCESS_TERMINATE,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_MENU};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible, PostMessageW,
    SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_BOTTOM,
    HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SW_RESTORE, WM_CLOSE, WS_EX_TOOLWINDOW,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const GUIDE_LABEL: &str = "guide";
/// Mantém em tauri.conf.json (`additionalBrowserArgs` da janela principal) o mesmo texto.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required";

static APP: OnceLock<AppHandle> = OnceLock::new();
static START: OnceLock<Instant> = OnceLock::new();

/// Registro de depuração com o tempo (ms) desde a primeira chamada.
pub fn log(message: &str) {
    let ms = START.get_or_init(Instant::now).elapsed().as_millis();
    eprintln!("[guide {ms:>7} ms] {message}");
}
static OPEN: AtomicBool = AtomicBool::new(false);
/// Instante até o qual o launcher não recebe controle nenhum (logo depois de o menu fechar).
static QUIET_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
/// Botões que acabaram de ser soltos depois do menu, e até quando ainda valem como resto dele.
static RECENT_RELEASE: Mutex<(u16, Option<Instant>)> = Mutex::new((0, None));
/// Há algum controle conectado ao XInput.
static ANY_PAD: AtomicBool = AtomicBool::new(false);
/// Depois de fechar o menu, o launcher fica surdo por este tempo.
const QUIET_AFTER_MENU: Duration = Duration::from_millis(450);
/// E, ao soltar um botão preso, por mais este (o navegador demora um quadro a mostrar a soltura).
const RELEASE_LAG: Duration = Duration::from_millis(160);

/// Número da abertura atual do menu: a janela percebe uma abertura nova quando ele muda.
static GENERATION: AtomicU32 = AtomicU32::new(0);
/// Janela que estava na frente quando o menu abriu.
static PREV_FOREGROUND: Mutex<Option<GameWindow>> = Mutex::new(None);
static MENU_ACTIVATED: AtomicBool = AtomicBool::new(false);
/// Ao fechar o identificador, o próprio Windows retoma o jogo, inclusive se o launcher encerrar.
static GAME_PAUSE: Mutex<Option<OwnedHandle>> = Mutex::new(None);

fn pause_game(game: GameWindow) -> Option<OwnedHandle> {
    type CreateState = unsafe extern "system" fn(*mut HANDLE, u32, *const std::ffi::c_void, HANDLE, u64) -> i32;
    type ChangeState = unsafe extern "system" fn(HANDLE, HANDLE, u32, *const std::ffi::c_void, usize, u64) -> i32;
    const PROCESS_STATE_CHANGE_STATE: u32 = 1;
    const SUSPEND: u32 = 0;
    // SAFETY: resolve as funções do Windows 11 com suas assinaturas da API nativa. Cada HANDLE
    // retornado é adquirido uma única vez e fechado pelo OwnedHandle.
    unsafe {
        let ntdll = GetModuleHandleW(wide("ntdll.dll").as_ptr());
        if ntdll.is_null() {
            return None;
        }
        let create: CreateState = std::mem::transmute(GetProcAddress(ntdll, c"NtCreateProcessStateChange".as_ptr().cast())?);
        let change: ChangeState = std::mem::transmute(GetProcAddress(ntdll, c"NtChangeProcessState".as_ptr().cast())?);
        let process = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_SUSPEND_RESUME, 0, game.pid);
        if process.is_null() {
            return None;
        }
        let _process = OwnedHandle::from_raw_handle(process);
        game.hwnd()?;
        let mut state = std::ptr::null_mut();
        if create(&mut state, PROCESS_STATE_CHANGE_STATE, std::ptr::null(), process, 0) < 0 || state.is_null() {
            return None;
        }
        let pause = OwnedHandle::from_raw_handle(state);
        (change(state, process, SUSPEND, std::ptr::null(), 0, 0) >= 0).then_some(pause)
    }
}

// ───────────────────────── Janela do menu ─────────────────────────

/// Mantém o WebView pronto fora dos monitores, no mesmo tamanho em que será exibido.
fn park(window: &tauri::WebviewWindow) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        if !is_open() {
            let _ = target.set_focusable(false);
            if let Err(error) = position_panel(&target, false, None) {
                log(&format!("não foi possível recolher o painel: {error}"));
            }
        }
    });
}

fn panel_bounds(app: &AppHandle) -> (i32, i32, i32, i32, i32) {
    let (left, top, width, height) = match app.primary_monitor() {
        Ok(Some(monitor)) => (monitor.position().x, monitor.position().y, monitor.size().width as i32, monitor.size().height as i32),
        _ => (0, 0, 1920, 1080),
    };
    let parked_left = app.available_monitors().unwrap_or_default().iter()
        .map(|monitor| monitor.position().x + monitor.size().width as i32)
        .fold(left + width, i32::max);
    (left, top, (width * 35 / 100).max(1), height, parked_left)
}

fn position_panel(window: &tauri::WebviewWindow, visible: bool, anchor: Option<GameWindow>) -> Result<(), String> {
    let (mut left, mut top, mut width, mut height, parked_left) = panel_bounds(window.app_handle());
    if let Some(hwnd) = anchor.and_then(GameWindow::hwnd) {
        let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        // SAFETY: a janela foi revalidada e a estrutura tem o tamanho exigido pelo Windows.
        if unsafe { GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info) } != 0 {
            let monitor = info.rcMonitor;
            left = monitor.left;
            top = monitor.top;
            width = ((monitor.right - monitor.left) * 35 / 100).max(1);
            height = monitor.bottom - monitor.top;
        }
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    let (x, order) = if visible { (left, HWND_TOPMOST) } else { (parked_left, HWND_BOTTOM) };
    // SAFETY: o HWND pertence à janela do menu. A janela é movida e reordenada sem ativação.
    if unsafe { SetWindowPos(hwnd, order, x, top, width, height, SWP_NOACTIVATE | SWP_NOOWNERZORDER) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

/// Prepara a janela do menu na thread principal, no `setup` do app.
pub fn create_window(app: &AppHandle) -> tauri::Result<()> {
    // Pasta própria para o navegador embutido do menu: assim ele roda em processos separados dos do launcher.
    // Compartilhando o processo, a página do menu ficava parada enquanto a do launcher (a Biblioteca, com
    // centenas de capas) usava a thread de JavaScript, e o menu não respondia ao controle.
    let data_dir = app.path().app_local_data_dir()?.join("guide-webview");
    let _ = std::fs::create_dir_all(&data_dir);
    let (_, top, width, height, parked_left) = panel_bounds(app);
    let window = WebviewWindowBuilder::new(app, GUIDE_LABEL, WebviewUrl::App("index.html?guide=1".into()))
        .title("Menu do Guia")
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .visible(true)
        .focused(false)
        .focusable(false)
        .position(parked_left as f64, top as f64)
        // Os mesmos argumentos da janela principal (o WebView2 exige igualdade). Sem isso, o Chromium trata o menu
        // como "coberto" quando há um jogo em tela cheia e deixa a página em segundo plano: os apertos do
        // controle chegavam com segundos de atraso.
        .data_directory(data_dir)
        .additional_browser_args(BROWSER_ARGS)
        .inner_size(width as f64, height as f64)
        .build()?;
    // Fora da lista do Alt+Tab mesmo enquanto o WebView está preparado fora da tela.
    if let Ok(hwnd) = window.hwnd() {
        // SAFETY: só liga o estilo de janela de ferramenta na janela que acabamos de criar.
        unsafe {
            let hwnd = hwnd.0 as usize as HWND;
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_TOOLWINDOW as isize);
        }
    }
    park(&window);
    Ok(())
}

/// Restaura o foco quando necessário. O Alt só é usado se o Windows recusar a primeira tentativa.
pub(crate) fn force_foreground(hwnd: HWND) -> bool {
    // SAFETY: a janela foi consultada no Windows antes da chamada.
    unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        if GetForegroundWindow() == hwnd || SetForegroundWindow(hwnd) != 0 {
            return true;
        }
        keybd_event(VK_MENU as u8, 0, 0, 0);
        keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
        SetForegroundWindow(hwnd) != 0
    }
}

/// Avisa o launcher quando o menu abre ou fecha (a música de fundo continua com o menu aberto, mesmo sem o foco).
fn notify_visibility(app: &AppHandle, open: bool) {
    let _ = app.emit_to("main", "guide-visibility", open);
}

pub fn is_open() -> bool {
    OPEN.load(Ordering::Relaxed)
}

pub(crate) fn blocks_automatic_focus() -> bool {
    is_open() || QUIET_UNTIL.lock().unwrap().is_some_and(|until| Instant::now() < until)
}

fn open() {
    let Some(app) = APP.get() else { return };
    let Some(window) = app.get_webview_window(GUIDE_LABEL) else { return };
    let foreground = unsafe { GetForegroundWindow() };
    let previous = if foreground.is_null() || hide::is_steam_foreground(foreground) {
        hide::last_game_window().or_else(|| GameWindow::from_hwnd(foreground))
    } else {
        GameWindow::from_hwnd(foreground)
    };
    let game = previous.filter(|window| {
        crate::epic::game_for_process(window.pid).is_some() || hide::is_steam_game_process(window.pid)
    }).or_else(|| {
        hide::is_ours(foreground).then(|| running_game_window(previous)).flatten()
    });
    let mut pause = GAME_PAUSE.lock().unwrap();
    if is_open() {
        return;
    }
    *pause = game.and_then(pause_game);
    let game_paused = pause.is_some();
    let keep_game_focus = game_paused && game.and_then(GameWindow::hwnd) == Some(foreground);
    // Publica a abertura depois de suspender o jogo e antes de exibir o painel.
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
    MENU_ACTIVATED.store(false, Ordering::Relaxed);
    *PREV_FOREGROUND.lock().unwrap() = previous;
    OPEN.store(true, Ordering::Relaxed);
    drop(pause);
    if let Some(game) = game {
        log(&format!("Guia sobre o jogo {} (pausa: {game_paused})", game.pid));
    }
    hide::guide_opened();
    notify_visibility(app, true);

    let target = window.clone();
    if window.run_on_main_thread(move || {
        if !is_open() || GENERATION.load(Ordering::Relaxed) != generation {
            return;
        }
        let Ok(handle) = target.hwnd() else { close(false); return };
        let hwnd = handle.0 as HWND;
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_always_on_top(false);
            if let Some(game) = hide::last_game_window().and_then(GameWindow::hwnd) {
                crate::place_launcher_behind(&main, game as usize);
            }
        }
        // O jogo fica visível sem perder seu modo de tela cheia. O painel recebe os botões pelo leitor nativo.
        let _ = target.set_focusable(!keep_game_focus);
        if let Err(error) = position_panel(&target, true, previous) {
            log(&format!("não foi possível abrir o painel: {error}"));
            close(false);
            return;
        }
        if keep_game_focus {
            log("abrir (foco mantido no jogo)");
        } else if force_foreground(hwnd) {
            MENU_ACTIVATED.store(true, Ordering::Relaxed);
            log("abrir (foco no menu)");
        } else {
            log("abrir (Windows recusou o foco)");
        }
    }).is_err() {
        close(false);
    }
}

/// Fecha o menu. Com `restore`, devolve o foco à janela que estava na frente antes de ele abrir.
/// Para onde o foco vai quando o menu fecha.
#[derive(Clone, Copy, PartialEq)]
pub enum Restore {
    /// Para lugar nenhum (a ação já cuida disso).
    Nowhere,
    /// Para a janela que estava na frente quando o menu abriu (o launcher, se foi dele que se abriu; o jogo, se foi dele).
    Previous,
    /// Para o jogo em execução ("Voltar ao jogo").
    Game,
}

pub fn close(restore: bool) {
    close_to(if restore { Restore::Previous } else { Restore::Nowhere });
}

pub fn close_to(restore: Restore) {
    log(&format!("fechar (foco: {})", match restore { Restore::Nowhere => "nenhum", Restore::Previous => "janela anterior", Restore::Game => "jogo" }));
    let Some(app) = APP.get() else { return };
    let pause = GAME_PAUSE.lock().unwrap();
    let activated = MENU_ACTIVATED.swap(false, Ordering::Relaxed);
    *QUIET_UNTIL.lock().unwrap() = Some(Instant::now() + QUIET_AFTER_MENU);
    let was_open = OPEN.swap(false, Ordering::Relaxed);
    let previous = if was_open { *PREV_FOREGROUND.lock().unwrap() } else { None };
    let paused = pause.is_some();
    let generation = GENERATION.load(Ordering::Relaxed);
    drop(pause);
    notify_visibility(app, false);
    if let Some(window) = app.get_webview_window(GUIDE_LABEL) {
        park(&window);
    }
    let foreground = unsafe { GetForegroundWindow() };
    let focus_changed = previous.and_then(GameWindow::hwnd).is_some_and(|hwnd| hwnd != foreground);
    let restore_needed = restore == Restore::Game || (restore == Restore::Previous && (activated || focus_changed));
    if restore == Restore::Game || (was_open && (paused || restore_needed)) {
        // O jogo (e o launcher) só voltam a receber o foco com os botões soltos: um jogo que vê o A ainda apertado
        // ao ganhar o foco entende como um aperto dele ("Voltar ao jogo" também apertava A dentro do jogo).
        let app = app.clone();
        std::thread::spawn(move || {
            let still_closed = || !is_open() && GENERATION.load(Ordering::Relaxed) == generation;
            wait_pad_released((!paused).then_some(Duration::from_secs(3)), still_closed);
            let mut pause = GAME_PAUSE.lock().unwrap();
            if !still_closed() {
                return;
            }
            drop(pause.take());
            drop(pause);
            if restore_needed && still_closed() {
                restore_focus(&app, restore, previous);
            }
        });
    }
}

/// A Steam recebeu a resposta que pedia (o contrato do jogo, por exemplo): o controle deixa de ser mouse, a Steam volta
/// a ficar escondida e o foco vai para o jogo (se já abriu) ou para o launcher.
pub fn finish_steam_prompt() {
    crate::pointer::set_active(false);
    hide::allow(0);
    steam::minimize_steam_window();
    let Some(app) = APP.get().cloned() else { return };
    std::thread::spawn(move || {
        // O A que clicou em "Aceito" ainda pode estar apertado: o jogo ou o launcher não devem vê-lo.
        wait_pad_released(Some(Duration::from_secs(3)), || true);
        if !is_open() {
            restore_focus(&app, Restore::Nowhere, None);
        }
    });
}

/// Espera o controle ficar neutro por um instante. Uma nova abertura cancela a espera anterior.
fn wait_pad_released(timeout: Option<Duration>, still_waiting: impl Fn() -> bool) {
    let start = Instant::now();
    let mut released_since: Option<Instant> = None;
    while still_waiting() && timeout.is_none_or(|limit| start.elapsed() < limit) {
        if pad_released() {
            let since = *released_since.get_or_insert_with(Instant::now);
            if since.elapsed() >= Duration::from_millis(120) {
                return;
            }
        } else {
            released_since = None;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn pad_released() -> bool {
    #[allow(unused_mut)]
    let mut pad = *PAD.lock().unwrap();
    #[cfg(debug_assertions)]
    if let Some((until, injected)) = *INJECTED.lock().unwrap() {
        if Instant::now() < until {
            pad.buttons |= injected;
        }
    }
    pad.buttons == 0 && pad.lt < 30 && pad.rt < 30
        && pad.lx.unsigned_abs() < 10_000 && pad.ly.unsigned_abs() < 10_000
}

/// Põe o launcher na frente e confere que ele ficou: se outra janela tomou o foco logo depois (o jogo que acabou de
/// fechar, a Steam), tenta de novo, por até `seconds` segundos. Sem isso o launcher podia ficar visível mas sem o
/// foco, e então o controle não funciona nele (o navegador só entrega o controle à janela em foco).
pub(crate) fn ensure_launcher_front(app: &AppHandle, seconds: u64) {
    focus_launcher(app, seconds, false);
}

pub(crate) fn restore_launcher_after_game(app: &AppHandle) {
    focus_launcher(app, 3, true);
}

fn focus_launcher(app: &AppHandle, seconds: u64, automatic: bool) {
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(main) = app.get_webview_window("main") else { return };
        let may_focus = || {
            !is_open() && (!automatic || (!blocks_automatic_focus() && !hide::foreground_is_game()))
        };
        if !may_focus() {
            return;
        }
        let deadline = Instant::now() + Duration::from_secs(seconds);
        let mut confirmed = 0;
        crate::bring_to_front(&main);
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(300));
            // O menu aberto de novo é dono do foco.
            if !may_focus() {
                return;
            }
            if crate::window_is_foreground(&main) {
                confirmed += 1;
                if confirmed >= 2 {
                    return;
                }
            } else {
                confirmed = 0;
                crate::bring_to_front(&main);
            }
        }
    });
}

#[derive(Clone, Copy)]
pub(crate) struct GameWindow {
    handle: usize,
    pub pid: u32,
}

impl GameWindow {
    pub(crate) fn from_hwnd(hwnd: HWND) -> Option<Self> {
        let mut pid = 0;
        // SAFETY: consulta o PID dono de uma janela entregue pelo Windows.
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        (pid != 0).then_some(Self { handle: hwnd as usize, pid })
    }

    pub(crate) fn hwnd(self) -> Option<HWND> {
        let hwnd = self.handle as HWND;
        let mut owner = 0;
        // SAFETY: consulta o dono atual da janela antes de reutilizar o HWND.
        unsafe { GetWindowThreadProcessId(hwnd, &mut owner) };
        (owner == self.pid).then_some(hwnd)
    }
}

/// Maior janela normal de um executável da instalação do jogo.
pub(crate) fn find_game_window(dirs: &[std::path::PathBuf]) -> Option<GameWindow> {
    if dirs.is_empty() {
        return None;
    }
    find_game_window_by(|pid| steam::matches_game_installation(pid, dirs).then_some(())).map(|(window, ())| window)
}

pub(crate) fn find_game_window_by<T>(mut identify: impl FnMut(u32) -> Option<T>) -> Option<(GameWindow, T)> {
    find_game_window_where(|_, pid| identify(pid))
}

pub(crate) fn find_game_window_where<T>(mut identify: impl FnMut(HWND, u32) -> Option<T>) -> Option<(GameWindow, T)> {
    struct Best<'a, T> {
        identify: &'a mut dyn FnMut(HWND, u32) -> Option<T>,
        window: Option<(GameWindow, T)>,
        area: i64,
    }
    unsafe extern "system" fn visit<T>(hwnd: HWND, data: isize) -> i32 {
        let best = &mut *(data as *mut Best<'_, T>);
        if IsWindowVisible(hwnd) == 0
            || GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW as isize != 0
        {
            return 1;
        }
        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return 1;
        }
        let area = i64::from((rect.right - rect.left).max(0)) * i64::from((rect.bottom - rect.top).max(0));
        if area > best.area {
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid != 0 {
                if let Some(game) = (best.identify)(hwnd, pid) {
                    best.window = Some((GameWindow { handle: hwnd as usize, pid }, game));
                    best.area = area;
                }
            }
        }
        1
    }
    let mut best = Best { identify: &mut identify, window: None, area: 0 };
    // SAFETY: o retorno de chamada é síncrono e só escreve em best, que vive até o fim da chamada.
    unsafe { EnumWindows(Some(visit::<T>), &mut best as *mut Best<'_, T> as isize) };
    best.window
}

/// Devolve o foco depois que o menu fecha.
/// - `Game` ("Voltar ao jogo"): vai para a janela do jogo; sem jogo, cai no caso abaixo.
/// - `Previous` (B ou o Guia de novo): volta para onde o jogador estava. Se o menu foi aberto a partir do launcher,
///   o launcher continua na frente (o jogo segue aberto atrás); se foi a partir do jogo, é o jogo.
///
/// A janela anterior só vale se não for da Steam: o Guia também faz a Steam tomar a frente, e devolver o foco a ela
/// não leva a lugar nenhum. Nesse caso (ou sem janela anterior) vai para o jogo, se houver, ou para o launcher.
fn restore_focus(app: &AppHandle, mode: Restore, previous: Option<GameWindow>) {
    if mode == Restore::Previous {
        if let Some(hwnd) = previous.and_then(GameWindow::hwnd).filter(|&hwnd| !hide::is_steam_foreground(hwnd)) {
            if hide::is_ours(hwnd) {
                ensure_launcher_front(app, 3);
            } else {
                force_foreground(hwnd);
            }
            return;
        }
    }

    if let Some(hwnd) = running_game_window(previous).and_then(GameWindow::hwnd) {
        force_foreground(hwnd);
        return;
    }
    ensure_launcher_front(app, 3);
}

/// Último aperto do botão Guia de um controle (ver `toggle_from_pad`).
static LAST_PAD_TOGGLE: Mutex<Option<Instant>> = Mutex::new(None);

/// Abre ou fecha o menu a partir do botão Guia/PS de um controle. Se o mesmo controle chegar por dois caminhos
/// (XInput e HID), o segundo aperto, quase no mesmo instante, não desfaz o primeiro.
pub fn toggle_from_pad() {
    {
        let mut last = LAST_PAD_TOGGLE.lock().unwrap();
        let now = Instant::now();
        if last.is_some_and(|t| now.duration_since(t) < Duration::from_millis(350)) {
            return;
        }
        *last = Some(now);
    }
    toggle();
}

pub fn toggle() {
    if is_open() {
        close(true);
    } else {
        open();
    }
}

// ───────────────────────── Ações do menu ─────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideContext {
    /// Há um jogo rodando.
    pub running: bool,
    pub game_id: Option<String>,
    /// Nome do jogo (vazio se não achou).
    pub name: String,
    pub power: PowerOptions,
}

enum GuideGame {
    Steam(u32),
    Epic(crate::epic::EpicRunning),
}

fn selected_game(previous: Option<GameWindow>) -> Option<GuideGame> {
    if let Some(window) = previous.filter(|window| window.hwnd().is_some()) {
        if let Some(game) = crate::epic::game_for_process(window.pid) {
            return Some(GuideGame::Epic(game));
        }
    }
    steam::running_game().map(|(id, _)| GuideGame::Steam(id))
        .or_else(|| crate::epic::running().map(GuideGame::Epic))
}

fn running_game_window(previous: Option<GameWindow>) -> Option<GameWindow> {
    match selected_game(previous)? {
        GuideGame::Steam(id) => steam::running_game().filter(|(active, _)| *active == id).map(|(_, window)| window),
        GuideGame::Epic(game) => crate::epic::running_window(Some(&game.app_name)),
    }
}

pub fn context(power: PowerOptions) -> GuideContext {
    let previous = *PREV_FOREGROUND.lock().unwrap();
    let (game_id, name) = match selected_game(previous) {
        Some(GuideGame::Steam(id)) => (Some(id.to_string()), steam::steam_root()
            .map(|root| steam::scan_installed(&root))
            .and_then(|apps| apps.into_iter().find(|a| a.app_id == id.to_string()))
            .map(|a| a.name)
            .unwrap_or_default()),
        Some(GuideGame::Epic(game)) => (Some(format!("epic:{}", game.app_name)), game.title),
        None => (None, String::new()),
    };
    GuideContext { running: game_id.is_some(), game_id, name, power }
}

/// Encerra os processos com estes nomes de programa (sem diferenciar maiúsculas). Devolve quantos encerrou.
fn terminate_by_name(names: &[&str]) -> usize {
    let mut killed = 0;
    // SAFETY: percorre o instantâneo de processos com a estrutura corretamente dimensionada e o fecha ao final;
    // só encerra processos cujo nome está na lista.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() || snapshot as isize == -1 {
            return 0;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let exe = String::from_utf16_lossy(&entry.szExeFile[..len]);
            if names.iter().any(|n| exe.eq_ignore_ascii_case(n)) {
                let handle = OpenProcess(PROCESS_TERMINATE, 0, entry.th32ProcessID);
                if !handle.is_null() {
                    if TerminateProcess(handle, 0) != 0 {
                        killed += 1;
                    }
                    CloseHandle(handle);
                }
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    killed
}

/// A interface do overlay da Steam (o que aparece DENTRO do jogo ao apertar o Guia ou Shift+Tab, e as plaquinhas de
/// aviso) roda num programa à parte, `gameoverlayui`. Não é uma janela que se possa minimizar: o jeito de a Steam não
/// aparecer por cima do jogo e do menu do launcher é encerrar esse programa. A Steam o abre de novo a cada vez que
/// o overlay é pedido, e o launcher o encerra de novo.
pub(crate) fn kill_steam_overlay() {
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    {
        let mut last = LAST.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < Duration::from_millis(250)) {
            return;
        }
        *last = Some(Instant::now());
    }
    let killed = terminate_by_name(&["gameoverlayui64.exe", "gameoverlayui.exe"]);
    if killed > 0 {
        log(&format!("overlay da Steam encerrado ({killed} processo(s))"));
    }
}

/// Solicita à janela do título selecionado que feche pelo fluxo normal do jogo.
pub(crate) fn close_game(app_id: u32) -> Result<(), String> {
    if app_id == 0 || steam::running_app_id() != app_id {
        return Err("O jogo selecionado não está em execução.".into());
    }
    let dirs = steam::game_installation_dirs(app_id);
    let hwnd = find_game_window(&dirs).and_then(GameWindow::hwnd)
        .ok_or("A janela do jogo não está disponível para fechar.")?;

    // SAFETY: o HWND foi localizado e conferido para o AppID selecionado.
    if unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) } == 0 {
        return Err("Não foi possível pedir o fechamento do jogo.".into());
    }
    Ok(())
}

fn run_hidden(program: &str, args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    Command::new(program).args(args).creation_flags(CREATE_NO_WINDOW).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Executa as ações do menu de jogo e as opções de energia.
pub fn action(name: &str, game_id: Option<&str>) -> Result<(), String> {
    log(&format!("ação: {name}"));
    let app = APP.get().ok_or("Menu indisponível.")?.clone();
    match name {
        // "Voltar ao jogo": vai para o jogo, de onde quer que o menu tenha sido aberto.
        "resume" => close_to(Restore::Game),
        // B / "Fechar o menu": volta para onde o jogador estava (o launcher, se o menu abriu a partir dele).
        "close" => close_to(Restore::Previous),
        "home" | "library" => {
            let event = if name == "home" { "guide-open-home" } else { "guide-open-library" };
            app.emit_to("main", event, ()).map_err(|error| error.to_string())?;
            close(false);
            ensure_launcher_front(&app, 3);
        }
        "close_game" => {
            let id = game_id.ok_or("O jogo selecionado não está em execução.")?;
            if let Some(app_name) = id.strip_prefix("epic:") {
                crate::epic::close_game(Some(app_name))?;
            } else {
                close_game(id.parse().map_err(|_| "O jogo selecionado não está em execução.")?)?;
            }
            // O jogo ainda pode pedir para salvar antes de fechar. O monitor devolve o launcher depois que ele sair.
            close(true);
        }
        "suspend" => {
            close(false);
            run_hidden("rundll32.exe", &["powrprof.dll,SetSuspendState", "0,1,0"])?;
        }
        "restart" => run_hidden("shutdown.exe", &["/r", "/t", "0"])?,
        "shutdown" => run_hidden("shutdown.exe", &["/s", "/t", "0"])?,
        other => return Err(format!("Ação desconhecida: {other}")),
    }
    Ok(())
}

// ───────────────────────── XInput ─────────────────────────

#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq)]
struct Gamepad {
    buttons: u16,
    left_trigger: u8,
    right_trigger: u8,
    thumb_lx: i16,
    thumb_ly: i16,
    thumb_rx: i16,
    thumb_ry: i16,
}

#[repr(C)]
#[derive(Default)]
struct State {
    packet: u32,
    gamepad: Gamepad,
}

type GetStateFn = unsafe extern "system" fn(u32, *mut State) -> u32;

const BUTTON_GUIDE: u16 = 0x0400;
const BUTTON_START: u16 = 0x0010;
const BUTTON_BACK: u16 = 0x0020;

/// Estado do controle como a janela do menu o recebe.
#[derive(Serialize, Clone, Copy, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PadState {
    buttons: u16,
    lt: u8,
    rt: u8,
    lx: i16,
    ly: i16,
}

/// Botões que foram apertados com o menu aberto e continuam apertados (um B que fechou o menu, por exemplo). O
/// launcher ignora esses botões até serem soltos. Calculado aqui, a cada 8 ms, porque o menu fecha uns 30 ms depois
/// do aperto e a janela do launcher, que pergunta a cada 30 ms, poderia nem chegar a ver o aperto.
static LATCH: AtomicU16 = AtomicU16::new(0);

/// Último estado (somado) dos controles, atualizado pela thread do XInput.
static PAD: Mutex<PadState> = Mutex::new(PadState { buttons: 0, lt: 0, rt: 0, lx: 0, ly: 0 });
/// Aperto simulado (só em desenvolvimento): vale até o instante indicado.
#[cfg(debug_assertions)]
static INJECTED: Mutex<Option<(Instant, u16)>> = Mutex::new(None);

/// O que a janela do menu pergunta a cada instante: se está aberto, qual abertura é esta (o número muda a cada
/// abertura) e como está o controle. A janela PERGUNTA em vez de receber eventos: o envio de eventos do Rust para
/// uma janela escondida e mostrada de novo chegava com 1 a 3 segundos de atraso, e um aperto de botão atrasado
/// não serve para um menu.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Poll {
    open: bool,
    generation: u32,
    pad: PadState,
    /// Botões apertados durante o menu e ainda apertados (ver `LATCH`).
    latch: u16,
    /// Controle da janela principal, sem os botões que o menu deixou apertados.
    launcher: PadState,
    /// A janela principal está na frente e fora do intervalo de bloqueio do Guia.
    launcher_active: bool,
    /// Há controle XInput conectado (senão o launcher volta à Gamepad API do navegador, para controles de outro tipo).
    pads: bool,
}

pub fn poll(launcher_focused: bool) -> Poll {
    #[allow(unused_mut)]
    let mut pad = *PAD.lock().unwrap();
    #[cfg(debug_assertions)]
    if let Some((until, buttons)) = *INJECTED.lock().unwrap() {
        if Instant::now() < until {
            pad.buttons |= buttons;
        }
    }
    #[cfg(debug_assertions)]
    let injected = INJECTED.lock().unwrap().filter(|(until, _)| Instant::now() < *until).map_or(0, |(_, b)| b);
    #[cfg(not(debug_assertions))]
    let injected = 0u16;
    let open = is_open();
    let latch = LATCH.load(Ordering::Relaxed) | if open { injected } else { 0 };
    let now = Instant::now();
    let quiet = open || QUIET_UNTIL.lock().unwrap().is_some_and(|until| now < until);
    let launcher_active = launcher_focused && !quiet;
    let launcher = if !launcher_active {
        PadState::default()
    } else {
        let (recent, until) = *RECENT_RELEASE.lock().unwrap();
        let recent = if until.is_some_and(|u| now < u) { recent } else { 0 };
        PadState { buttons: pad.buttons & !(latch | recent), ..pad }
    };
    Poll { open, generation: GENERATION.load(Ordering::Relaxed), pad, latch, launcher, launcher_active, pads: ANY_PAD.load(Ordering::Relaxed) }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Carrega o XInput. O botão Guia só existe na função não documentada de número 100 (`XInputGetStateEx`);
/// sem ela, cai na função normal e o menu abre pelo atalho Start + Voltar.
fn load_xinput() -> Option<(GetStateFn, bool)> {
    // SAFETY: carrega a biblioteca do sistema e converte os endereços para a assinatura documentada do XInput.
    unsafe {
        for dll in ["xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll"] {
            let module = LoadLibraryW(wide(dll).as_ptr());
            if module.is_null() {
                continue;
            }
            if let Some(ex) = GetProcAddress(module, 100usize as *const u8) {
                return Some((std::mem::transmute::<_, GetStateFn>(ex), true));
            }
            if let Some(plain) = GetProcAddress(module, b"XInputGetState\0".as_ptr()) {
                return Some((std::mem::transmute::<_, GetStateFn>(plain), false));
            }
        }
    }
    None
}

/// Só em desenvolvimento: arquivos na pasta de configuração do app simulam o controle, para testar sem apertar
/// nada de verdade. `guide.trigger` abre/fecha o menu; `guide.key` (up, down, left, right, a, b) aperta um botão.
#[cfg(debug_assertions)]
fn start_debug_triggers(app: &AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(100));
        let trigger = dir.join("guide.trigger");
        if trigger.exists() {
            let _ = std::fs::remove_file(&trigger);
            toggle();
        }
        // `guide.eval`: executa o JavaScript do arquivo dentro da janela do menu (para inspecionar a página).
        let eval = dir.join("guide.eval");
        if let Ok(code) = std::fs::read_to_string(&eval) {
            let _ = std::fs::remove_file(&eval);
            if let Some(window) = APP.get().and_then(|a| a.get_webview_window(GUIDE_LABEL)) {
                log(&format!("eval na janela do menu: {}", code.trim()));
                let _ = window.eval(&code);
            }
        }
        // `guide.evalmain`: o mesmo, dentro da janela principal (o launcher).
        let eval_main = dir.join("guide.evalmain");
        if let Ok(code) = std::fs::read_to_string(&eval_main) {
            let _ = std::fs::remove_file(&eval_main);
            if let Some(window) = APP.get().and_then(|a| a.get_webview_window("main")) {
                log(&format!("eval no launcher: {}", code.trim()));
                let _ = window.eval(&code);
            }
        }
        let key = dir.join("guide.key");
        if let Ok(text) = std::fs::read_to_string(&key) {
            let _ = std::fs::remove_file(&key);
            let buttons = match text.trim() {
                "up" => 0x0001,
                "down" => 0x0002,
                "left" => 0x0004,
                "right" => 0x0008,
                "a" => 0x1000,
                "b" => 0x2000,
                _ => 0,
            };
            log(&format!("injetando botões {buttons:#06x}"));
            *INJECTED.lock().unwrap() = Some((Instant::now() + Duration::from_millis(150), buttons));
        }
    });
}

/// Liga a leitura dos controles. Chamar uma vez, depois de `create_window`.
pub fn start(app: AppHandle) {
    if APP.set(app).is_err() {
        return;
    }
    #[cfg(debug_assertions)]
    if let Some(app) = APP.get() {
        start_debug_triggers(app);
    }
    crate::playstation::start();
    std::thread::spawn(|| {
        let Some((get_state, has_guide)) = load_xinput() else {
            log("XInput indisponível");
            return;
        };
        log(&format!("XInput carregado (botão Guia direto: {has_guide})"));
        let mut connected = [false; 4];
        let mut guide_down = [false; 4];
        let mut last_scan = Instant::now() - Duration::from_secs(10);
        loop {
            std::thread::sleep(Duration::from_millis(8));
            // Perguntar por um controle desconectado é lento: só de tempos em tempos.
            let rescan = last_scan.elapsed() > Duration::from_millis(1500);
            if rescan {
                last_scan = Instant::now();
            }
            let mut merged = PadState::default();
            // Controle como mouse (janelas da Steam): lê o primeiro controle conectado.
            let mut first_pad: Option<Gamepad> = None;
            for pad in 0..4usize {
                if !connected[pad] && !rescan {
                    continue;
                }
                let mut state = State::default();
                // SAFETY: `state` é uma estrutura válida do tamanho que o XInput espera.
                let result = unsafe { get_state(pad as u32, &mut state) };
                connected[pad] = result == 0;
                if result != 0 {
                    guide_down[pad] = false;
                    continue;
                }
                let g = state.gamepad;
                let pressed = if has_guide { g.buttons & BUTTON_GUIDE != 0 } else { g.buttons & (BUTTON_START | BUTTON_BACK) == (BUTTON_START | BUTTON_BACK) };
                if pressed && !guide_down[pad] {
                    log(&format!("gatilho do controle {pad}: botões={:#06x} (Guia direto: {has_guide})", g.buttons));
                    toggle_from_pad();
                }
                guide_down[pad] = pressed;
                first_pad.get_or_insert(g);
                // O menu recebe a soma dos controles (o Guia e o atalho não viram botões do menu).
                merged.buttons |= g.buttons & !BUTTON_GUIDE;
                merged.lt = merged.lt.max(g.left_trigger);
                merged.rt = merged.rt.max(g.right_trigger);
                if g.thumb_lx.unsigned_abs() > merged.lx.unsigned_abs() {
                    merged.lx = g.thumb_lx;
                }
                if g.thumb_ly.unsigned_abs() > merged.ly.unsigned_abs() {
                    merged.ly = g.thumb_ly;
                }
            }
            // Controles PlayStation (lidos pelo HID) entram na soma como se fossem do XInput.
            let sony = crate::playstation::state();
            if let Some(ps) = sony {
                merged.buttons |= ps.buttons;
                merged.lt = merged.lt.max(ps.lt);
                merged.rt = merged.rt.max(ps.rt);
                if ps.lx.unsigned_abs() > merged.lx.unsigned_abs() {
                    merged.lx = ps.lx;
                }
                if ps.ly.unsigned_abs() > merged.ly.unsigned_abs() {
                    merged.ly = ps.ly;
                }
                first_pad.get_or_insert(Gamepad { buttons: ps.buttons, left_trigger: ps.lt, right_trigger: ps.rt, thumb_lx: ps.lx, thumb_ly: ps.ly, thumb_rx: ps.rx, thumb_ry: ps.ry });
            }
            // Aperto durante o menu fica "preso" até ser solto; fora do menu só se solta, nunca se prende.
            let held = merged.buttons;
            #[cfg(debug_assertions)]
            let held = held | INJECTED.lock().unwrap().filter(|(until, _)| Instant::now() < *until).map_or(0, |(_, b)| b);
            if is_open() {
                LATCH.fetch_or(held, Ordering::Relaxed);
            } else {
                let before = LATCH.fetch_and(held, Ordering::Relaxed);
                let released = before & !held;
                if released != 0 {
                    *RECENT_RELEASE.lock().unwrap() = (released, Some(Instant::now() + RELEASE_LAG));
                }
            }
            // Start no modo mouse: devolve o launcher à frente.
            let pad = first_pad.unwrap_or_default();
            if !is_open() && crate::pointer::feed(pad.buttons, pad.thumb_lx, pad.thumb_ly, pad.thumb_rx, pad.thumb_ry) {
                if let Some(app) = APP.get() {
                    crate::epic::close_login(app);
                    ensure_launcher_front(app, 3);
                }
            }
            ANY_PAD.store(connected.iter().any(|c| *c) || sony.is_some(), Ordering::Relaxed);
            *PAD.lock().unwrap() = merged;
        }
    });
}
