//! Esconde as janelas da Steam que atrapalham o launcher: a janela principal que ela traz para a frente
//! quando recebe um comando, e as notificações (toasts) do canto da tela.
//!
//! O launcher fica acima da janela da Steam enquanto está em uso em tela cheia. O gancho WinEvent
//! minimiza a Steam quando ela tenta aparecer e libera o topo quando outro aplicativo assume o foco.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EnumWindows, GetClassNameW, GetForegroundWindow, GetMessageW,
    GetWindowRect, GetWindowThreadProcessId, SetWindowPos, InternalGetWindowText, IsIconic, IsWindowVisible, SetCursorPos, SetForegroundWindow, ShowWindow,
    ShowWindowAsync, TranslateMessage,
    EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND,
    MSG, OBJID_WINDOW, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_RESTORE, SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE, WINEVENT_OUTOFCONTEXT,
};

static STEAM_WINDOWS: Mutex<SteamWindows> = Mutex::new(SteamWindows::new());

struct SteamWindows {
    fullscreen: bool,
    keep_above_steam: bool,
    hide_toasts: bool,
    allowed_until: u64,
    /// O launcher cedeu o foco a um jogo e deve recuperá-lo quando ele terminar.
    yielded: bool,
    /// Janela do jogo que está em primeiro plano e deve ficar acima do launcher.
    game_window: Option<usize>,
    /// O jogo rastreado estava rodando na última leitura.
    game_running: bool,
    game_source: GameSource,
    /// Processo da última janela de jogo que assumiu a frente: se ele morre, o jogo fechou (a Steam só avisa
    /// uns 2 s depois, pelo registro).
    game_pid: u32,
    /// Desde quando esse processo está morto.
    game_dead_since: Option<u64>,
    /// O jogo fechou com o launcher em segundo plano: ele deve voltar à frente na hora.
    restore_pending: bool,
    // HWND e PID das janelas que o launcher minimizou nesta sessão em tela cheia.
    minimized: BTreeMap<usize, u32>,
}

#[derive(Clone, Copy)]
enum Foreground {
    Launcher,
    Steam,
    Other,
}

#[derive(Clone, Copy, PartialEq)]
enum GameSource {
    Steam,
    Epic,
}

impl SteamWindows {
    const fn new() -> Self {
        Self {
            fullscreen: false,
            keep_above_steam: false,
            hide_toasts: true,
            allowed_until: 0,
            yielded: false,
            game_window: None,
            game_running: false,
            game_source: GameSource::Steam,
            game_pid: 0,
            game_dead_since: None,
            restore_pending: false,
            minimized: BTreeMap::new(),
        }
    }

    fn set_fullscreen(&mut self, fullscreen: bool) -> BTreeMap<usize, u32> {
        if self.fullscreen == fullscreen {
            return BTreeMap::new();
        }
        self.fullscreen = fullscreen;
        self.allowed_until = 0;
        self.yielded = false;
        self.game_window = None;
        self.restore_pending = false;
        self.game_pid = 0;
        self.game_source = GameSource::Steam;
        self.game_dead_since = None;
        std::mem::take(&mut self.minimized)
    }

    /// Com o launcher em tela cheia, nenhuma janela da Steam pode aparecer (Guia, avisos, ofertas, login...),
    /// exceto durante uma abertura que o próprio jogador pediu (`allowed_until`).
    fn should_minimize_main(&self, now: u64) -> bool {
        self.fullscreen && now >= self.allowed_until
    }

    /// O jogo assume a frente e mantém o launcher visível logo atrás dele.
    fn yield_to_game(&mut self, window: usize) -> bool {
        if !self.fullscreen {
            return false;
        }
        self.yielded = true;
        self.restore_pending = false;
        self.game_window.replace(window) != Some(window)
    }

    /// Informa o estado do jogo: `running` (a Steam diz que há um jogo rodando) e `pid_alive` (o processo da janela
    /// do jogo continua vivo). Devolve true no instante em que o jogo fecha com o launcher atrás: ele precisa
    /// voltar à frente imediatamente. O processo morto vale na hora quando a Steam já diz que não há jogo; se a Steam
    /// ainda diz que há (um jogo com programa de abertura que sai antes da janela principal), espera um pouco.
    fn game_state(&mut self, running: bool, pid_alive: bool, now: u64) -> bool {
        let was_running = std::mem::replace(&mut self.game_running, running);
        let dead = self.game_pid != 0 && !pid_alive;
        if dead {
            self.game_dead_since.get_or_insert(now);
        } else {
            self.game_dead_since = None;
        }
        let dead_long_enough = dead && now.saturating_sub(self.game_dead_since.unwrap_or(now)) >= PID_GRACE_MS;
        let closed = (was_running && !running) || (dead && !running) || dead_long_enough;
        if closed && self.fullscreen && self.yielded {
            self.restore_pending = true;
            self.game_window = None;
            self.game_pid = 0;
            self.game_dead_since = None;
            return true;
        }
        false
    }

    fn update_foreground(&mut self, foreground: Foreground, now: u64) -> bool {
        let keep_above_steam = match foreground {
            Foreground::Launcher if self.fullscreen => {
                // O jogador trouxe o launcher de volta: ele volta a valer como tela principal.
                self.yielded = false;
                now >= self.allowed_until
            }
            Foreground::Steam if self.should_minimize_main(now) => self.keep_above_steam,
            _ => false,
        };
        std::mem::replace(&mut self.keep_above_steam, keep_above_steam) != keep_above_steam
    }

    fn launcher_state(&mut self, foreground: usize, focus_from: Option<usize>, focus_blocked: bool) -> LauncherWindowState {
        let behind_game = self.game_window.filter(|&hwnd| hwnd == foreground);
        let keep_above_steam = !focus_blocked && self.keep_above_steam;
        let restore = !focus_blocked && std::mem::take(&mut self.restore_pending) && behind_game.is_none();
        let refocus = keep_above_steam && focus_from.is_some_and(|hwnd| foreground == 0 || hwnd == foreground);
        LauncherWindowState { keep_above_steam, refocus, behind_game, restore }
    }
}

/// Quanto esperar, com a Steam ainda dizendo que há jogo, antes de considerar que o processo morto era o jogo todo.
const PID_GRACE_MS: u64 = 300;
/// Pede à thread da janela para atualizar a prioridade e, se necessário, recuperar o foco da Steam.
static UPDATE_LAUNCHER: OnceLock<Box<dyn Fn(Option<usize>) + Send + Sync>> = OnceLock::new();
static STARTED: OnceLock<()> = OnceLock::new();

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn init(update_launcher: impl Fn(Option<usize>) + Send + Sync + 'static) {
    let _ = UPDATE_LAUNCHER.set(Box::new(update_launcher));
    start();
}

fn update_launcher(focus_from: Option<usize>) {
    if let Some(update) = UPDATE_LAUNCHER.get() {
        update(focus_from);
    }
}

/// O launcher deve impedir o overlay da Steam (em tela cheia e com as notificações da Steam ocultas)?
pub fn blocks_steam_overlay() -> bool {
    let state = STEAM_WINDOWS.lock().unwrap();
    state.fullscreen && state.hide_toasts
}

pub fn set_hide_toasts(hide: bool) {
    STEAM_WINDOWS.lock().unwrap().hide_toasts = hide;
    apply_current_policy();
}

/// Nos próximos `ms` milissegundos a Steam pode aparecer (o launcher a abriu de propósito).
pub fn allow(ms: u64) {
    let mut state = STEAM_WINDOWS.lock().unwrap();
    if state.fullscreen {
        state.allowed_until = now_ms() + ms;
    }
    drop(state);
    apply_current_policy();
}

/// A Steam espera uma resposta do jogador (o contrato de um jogo, por exemplo) numa janela dela. Libera a Steam por
/// alguns minutos e traz essa janela para a frente (as janelas de diálogo antes da principal). Devolve se achou alguma.
pub fn show_steam_prompt() -> bool {
    allow(180_000);
    // A janela da Steam abre no meio da tela em que o jogador está (a do launcher, em primeiro plano agora).
    // SAFETY: só consulta a janela em primeiro plano.
    let reference = unsafe { GetForegroundWindow() };
    struct Found {
        dialogs: Vec<HWND>,
        main: Vec<HWND>,
    }
    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> i32 {
        // SAFETY: `lparam` é o ponteiro para o `Found` de `show_steam_prompt`, que vive até o fim da enumeração.
        let found = unsafe { &mut *(lparam as *mut Found) };
        let class = window_text(hwnd, true);
        if class != "SDL_app" && class != "vguiPopupWindow" {
            return 1;
        }
        let title = window_text(hwnd, false);
        // SAFETY: consulta simples do estado da janela.
        let shown = unsafe { IsWindowVisible(hwnd) != 0 || IsIconic(hwnd) != 0 };
        // A janela principal conta mesmo escondida: a Steam aberta em silêncio (`-silent`) a cria sem mostrá-la, e é
        // dentro dela que a caixa de contrato aparece.
        if (!shown && !is_steam_main(&title)) || title.is_empty() || title == "SteamWebhelper" || title.starts_with("notificationtoasts_") {
            return 1;
        }
        if !is_steam_process(window_process_id(hwnd)) && !is_steam_main(&title) {
            return 1;
        }
        if is_steam_main(&title) { found.main.push(hwnd) } else { found.dialogs.push(hwnd) }
        1
    }
    let mut found = Found { dialogs: Vec::new(), main: Vec::new() };
    // SAFETY: o ponteiro passado vale durante toda a chamada, que é síncrona.
    unsafe { EnumWindows(Some(collect), &mut found as *mut Found as LPARAM) };
    // Os diálogos primeiro e a janela principal por último (fica na frente): a caixa de contrato da Steam é desenhada
    // dentro da janela principal, então restaurá-la é sempre necessário.
    let targets: Vec<HWND> = found.dialogs.iter().chain(found.main.iter()).copied().collect();
    for &hwnd in &targets {
        // SAFETY: as janelas acabaram de ser enumeradas; se sumirem, as chamadas só falham.
        unsafe {
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
        }
    }
    // O cursor começa no meio da janela que ficou na frente (o controle vai movê-lo dali).
    if let Some(&hwnd) = targets.last() {
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        // SAFETY: `rect` é uma estrutura válida; a janela pode ter sumido, e então a chamada só falha.
        unsafe {
            if GetWindowRect(hwnd, &mut rect) != 0 {
                SetCursorPos((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
            }
        }
    }
    // A janela principal aparece inteira e normal (sem recorte), centralizada na tela do launcher.
    if let Some(&main) = found.main.last() {
        center_on_monitor_of(main, reference);
    }
    !targets.is_empty()
}

/// Põe o centro da janela da Steam no centro do monitor onde está a janela `reference` (a do launcher).
fn center_on_monitor_of(hwnd: HWND, reference: HWND) {
    let anchor = if reference.is_null() { hwnd } else { reference };
    let mut window = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    // SAFETY: estruturas válidas e janelas que acabaram de ser enumeradas; se sumirem, as chamadas só falham.
    unsafe {
        if GetWindowRect(hwnd, &mut window) == 0 || GetMonitorInfoW(MonitorFromWindow(anchor, MONITOR_DEFAULTTONEAREST), &mut info) == 0 {
            return;
        }
        let (w, h) = (window.right - window.left, window.bottom - window.top);
        let m = info.rcMonitor;
        let (x, y) = ((m.left + m.right - w) / 2, (m.top + m.bottom - h) / 2);
        SetWindowPos(hwnd, std::ptr::null_mut(), x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
}

/// A janela em primeiro plano é da Steam (a principal, um diálogo ou o motor web dela)?
pub fn foreground_is_steam() -> bool {
    // SAFETY: só consulta a janela em primeiro plano.
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return false;
    }
    let pid = window_process_id(hwnd);
    pid != 0 && is_steam_process(pid)
}

pub struct LauncherWindowState {
    pub keep_above_steam: bool,
    pub refocus: bool,
    pub behind_game: Option<usize>,
    pub restore: bool,
}

/// Lê o estado na hora de aplicá-lo para descartar pedidos de foco ou de ordem que ficaram na fila.
pub fn launcher_window_state(focus_from: Option<usize>) -> LauncherWindowState {
    let mut state = STEAM_WINDOWS.lock().unwrap();
    // SAFETY: só consulta a janela que está efetivamente na frente.
    let foreground = unsafe { GetForegroundWindow() } as usize;
    state.launcher_state(foreground, focus_from, crate::guide::blocks_automatic_focus())
}

pub(crate) fn last_game_window() -> Option<crate::guide::GameWindow> {
    let state = STEAM_WINDOWS.lock().unwrap();
    let window = crate::guide::GameWindow::from_hwnd(state.game_window? as HWND)?;
    (state.yielded && state.game_pid == window.pid).then_some(window)
}

pub(crate) fn guide_opened() {
    STEAM_WINDOWS.lock().unwrap().keep_above_steam = false;
}

/// Desativa a interceptação antes de restaurar as janelas, inclusive durante o fechamento do app.
pub fn set_fullscreen(fullscreen: bool) {
    let mut state = STEAM_WINDOWS.lock().unwrap();
    for (handle, pid) in state.set_fullscreen(fullscreen) {
        let hwnd = handle as HWND;
        // SAFETY: revalida a identidade da janela antes de enviar a restauração.
        unsafe {
            if IsWindowVisible(hwnd) != 0
                && window_process_id(hwnd) == pid
                && window_text(hwnd, true) == "SDL_app"
                && is_steam_main(&window_text(hwnd, false))
            {
                // Usa a mesma fila da minimização para restaurar também uma solicitação ainda pendente.
                ShowWindowAsync(hwnd, SW_SHOWNOACTIVATE);
            }
        }
    }
    drop(state);
    apply_current_policy();
}

pub fn launcher_focused() {
    if crate::guide::blocks_automatic_focus() {
        return;
    }
    let changed = STEAM_WINDOWS
        .lock()
        .unwrap()
        .update_foreground(Foreground::Launcher, now_ms());
    if changed {
        apply_current_policy();
    }
}

fn start() {
    STARTED.get_or_init(|| {
        let (hooks_ready, wait_for_hooks) = mpsc::channel();
        std::thread::spawn(move || {
            // SAFETY: instala ganchos de eventos e roda o laço de mensagens que eles exigem, em uma thread só deles.
            unsafe {
                for event in [
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_MINIMIZEEND,
                    EVENT_OBJECT_SHOW,
                    EVENT_OBJECT_NAMECHANGE,
                ] {
                    SetWinEventHook(
                        event,
                        event,
                        std::ptr::null_mut(),
                        Some(on_event),
                        0,
                        0,
                        WINEVENT_OUTOFCONTEXT,
                    );
                }
                let _ = hooks_ready.send(());
                let mut msg: MSG = std::mem::zeroed();
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        });
        let _ = wait_for_hooks.recv();
        std::thread::spawn(|| loop {
            note_foreground();
            note_game();
            std::thread::sleep(std::time::Duration::from_millis(100));
        });
    });
}

/// Classe ou título da janela. O título vem de `InternalGetWindowText`, que lê o texto guardado no sistema em vez de
/// perguntar à janela (o `GetWindowText` de outro programa manda uma mensagem a ele e fica esperando): um jogo que
/// parou de responder por instantes (ao perder o foco, por exemplo) travava o gancho e, com ele, a janela principal.
fn window_text(hwnd: HWND, class: bool) -> String {
    let mut buf = [0u16; 128];
    // SAFETY: o buffer tem 128 posições e o tamanho informado é o do buffer.
    let n = unsafe {
        if class {
            GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32)
        } else {
            InternalGetWindowText(hwnd, buf.as_mut_ptr(), buf.len() as i32)
        }
    };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

/// Vale a janela principal da Steam em modo normal ("Steam") ou modo Big Picture.
fn is_steam_main(title: &str) -> bool {
    title == "Steam"
        || title.starts_with("Steam Big Picture")
        || ["Steam — ", "Steam – ", "Steam - "]
            .into_iter()
            .any(|prefix| {
                title.strip_prefix(prefix).is_some_and(|mode| {
                    mode.contains("Big Picture") || mode.contains("Big-Picture")
                })
            })
}

fn apply_current_policy() {
    let (_, refocus) = update_foreground();
    update_launcher(refocus);
    suppress_existing_windows();
}

/// Confere a cada 100 ms se o jogo ainda está rodando: quando fecha, o launcher volta à frente na hora
/// (sem esperar a leitura periódica da interface).
fn note_game() {
    let steam_running = crate::steam::running_app_id() != 0;
    // Com um jogo rodando, nada do overlay da Steam pode aparecer (nem sobre o jogo, nem sobre o menu do Guia).
    if steam_running && blocks_steam_overlay() {
        crate::guide::kill_steam_overlay();
    }
    let mut state = STEAM_WINDOWS.lock().unwrap();
    let pid_alive = state.game_pid == 0 || process_alive(state.game_pid);
    // Para a Epic, o processo da janela em jogo é a referência, mesmo se ela for recriada ao trocar o modo de vídeo.
    let running = match state.game_source {
        GameSource::Epic => state.game_pid != 0 && pid_alive,
        GameSource::Steam => steam_running,
    };
    let closed = state.game_state(running, pid_alive, now_ms());
    let restore_pending = state.restore_pending;
    drop(state);
    if closed || (restore_pending && !crate::guide::blocks_automatic_focus()) {
        update_launcher(None);
    }
}

/// Primeiro processo que satisfaz o filtro, com nome e PID do instantâneo do Windows.
pub(crate) fn find_process(mut predicate: impl FnMut(u32, &str) -> bool) -> Option<u32> {
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    // SAFETY: percorre o instantâneo com a estrutura dimensionada e fecha o identificador ao final.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() || snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let end = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
            if predicate(entry.th32ProcessID, &name) {
                found = Some(entry.th32ProcessID);
                break;
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        found
    }
}

/// O processo ainda está vivo?
pub(crate) fn process_alive(pid: u32) -> bool {
    // SAFETY: abre o processo só para consultar o código de saída e fecha o identificador.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        ok != 0 && code == 259 // STILL_ACTIVE
    }
}

fn note_foreground() {
    let (changed, refocus) = update_foreground();
    if changed || refocus.is_some() {
        update_launcher(refocus);
    }
    if changed {
        suppress_existing_windows();
    }
}

fn suppress_existing_windows() {
    let keep_above_steam = STEAM_WINDOWS.lock().unwrap().keep_above_steam;
    if keep_above_steam {
        // SAFETY: o callback é síncrono e só usa os HWNDs entregues pelo Windows.
        unsafe { EnumWindows(Some(suppress_existing_window), 0) };
    }
}

unsafe extern "system" fn suppress_existing_window(hwnd: HWND, _data: LPARAM) -> i32 {
    apply_to_steam_window(hwnd, None);
    1
}

/// Atualiza a prioridade do launcher conforme a janela que está em primeiro plano.
fn update_foreground() -> (bool, Option<usize>) {
    let mut state = STEAM_WINDOWS.lock().unwrap();
    let current = unsafe { GetForegroundWindow() };
    let now = now_ms();
    if state.fullscreen && current.is_null() && now >= state.allowed_until {
        return (false, None);
    }
    // Ao trocar o foco, a Steam e o próprio launcher podem aparecer entre o jogo e a janela do Guia.
    if crate::guide::blocks_automatic_focus() {
        return (false, None);
    }
    let foreground = if !state.fullscreen || current.is_null() {
        Foreground::Other
    } else if is_ours(current) {
        Foreground::Launcher
    } else if is_steam_foreground(current) {
        Foreground::Steam
    } else {
        Foreground::Other
    };
    let game = if state.fullscreen && matches!(foreground, Foreground::Other) && !current.is_null() {
        let pid = window_process_id(current);
        if state.game_pid == pid && state.game_window == Some(current as usize) {
            Some((pid, state.game_source))
        } else {
            game_provider(pid).map(|source| (pid, source))
        }
    } else {
        None
    };
    let yielded_now = if let Some((pid, source)) = game {
        if state.game_pid != pid {
            state.game_running = false;
        }
        state.game_pid = pid;
        state.game_source = source;
        state.game_dead_since = None;
        state.yield_to_game(current as usize)
    } else {
        if !matches!(foreground, Foreground::Steam) {
            state.game_window = None;
        }
        false
    };
    let changed = state.update_foreground(foreground, now) || yielded_now;
    // A Steam pode voltar a pedir foco durante a minimização. Se outro app já o ganhou,
    // `launcher_window_state` descarta este pedido quando a thread da janela o recebe.
    let refocus = (state.keep_above_steam
        && matches!(foreground, Foreground::Steam)
        && unsafe { IsIconic(current) } != 0)
        .then_some(current as usize);
    (changed, refocus)
}

fn game_provider(pid: u32) -> Option<GameSource> {
    if crate::epic::game_for_process(pid).is_some() {
        Some(GameSource::Epic)
    } else {
        is_steam_game_process(pid).then_some(GameSource::Steam)
    }
}

pub(crate) fn foreground_is_game() -> bool {
    let hwnd = unsafe { GetForegroundWindow() };
    !hwnd.is_null() && game_provider(window_process_id(hwnd)).is_some()
}

fn window_process_id(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    // SAFETY: `pid` é uma variável local válida para receber o resultado.
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid
}

pub(crate) fn is_ours(hwnd: HWND) -> bool {
    window_process_id(hwnd) == unsafe { GetCurrentProcessId() }
}

pub(crate) fn is_steam_foreground(hwnd: HWND) -> bool {
    let class = window_text(hwnd, true);
    // A Steam usa SDL_app nas janelas e vguiPopupWindow nos popups; um jogo também pode usar SDL_app, então
    // o que vale é o programa dono da janela.
    if class != "SDL_app" && class != "vguiPopupWindow" {
        return false;
    }
    is_steam_main(&window_text(hwnd, false)) || is_steam_process(window_process_id(hwnd))
}

/// Caminho do programa dono do processo.
pub(crate) fn process_image(pid: u32) -> Option<String> {
    let mut image = [0u16; 1024];
    let mut len = image.len() as u32;
    // SAFETY: o tamanho passado à API é o do buffer e o handle é fechado após a consulta.
    let found = unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let found = QueryFullProcessImageNameW(process, 0, image.as_mut_ptr(), &mut len);
        CloseHandle(process);
        found
    };
    (found != 0).then(|| String::from_utf16_lossy(&image[..len as usize]))
}

fn is_steam_process(pid: u32) -> bool {
    process_image(pid).is_some_and(|image| {
        Path::new(&image)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("steam.exe") || name.eq_ignore_ascii_case("steamwebhelper.exe"))
    })
}

/// O programa está instalado numa biblioteca da Steam (`...\steamapps\common\...`)? É o que distingue a janela do
/// jogo de qualquer outra janela que o jogador abra enquanto joga.
pub(crate) fn is_steam_game_process(pid: u32) -> bool {
    crate::steam::is_tracked_game_pid(pid)
        || process_image(pid).is_some_and(|image| image.to_lowercase().replace('/', "\\").contains("\\steamapps\\common\\"))
}

unsafe extern "system" fn on_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if id_object != OBJID_WINDOW || id_child != 0 || hwnd.is_null() {
        return;
    }
    if event == EVENT_SYSTEM_FOREGROUND {
        note_foreground();
    }
    apply_to_steam_window(hwnd, Some(event));
}

fn apply_to_steam_window(hwnd: HWND, event: Option<u32>) {
    let mut state = STEAM_WINDOWS.lock().unwrap();
    if !state.fullscreen {
        return;
    }
    let class = window_text(hwnd, true);
    if class != "SDL_app" && class != "vguiPopupWindow" {
        return;
    }
    let title = window_text(hwnd, false);

    if title.starts_with("notificationtoasts_") {
        if state.hide_toasts && unsafe { IsWindowVisible(hwnd) } != 0 {
            unsafe { ShowWindowAsync(hwnd, SW_HIDE) };
        }
        return;
    }
    // "SteamWebhelper" é a janela escondida do motor web da Steam.
    if title == "SteamWebhelper" || unsafe { IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 } {
        return;
    }
    let main = is_steam_main(&title);
    let pid = window_process_id(hwnd);
    // Janelas de outros programas (um jogo que também usa SDL_app) não são da Steam: ficam como estão.
    if pid == 0 || (!main && !is_steam_process(pid)) {
        return;
    }
    if !state.should_minimize_main(now_ms()) {
        if event == Some(EVENT_SYSTEM_MINIMIZEEND) {
            state.minimized.remove(&(hwnd as usize));
        }
        return;
    }

    if unsafe { ShowWindowAsync(hwnd, SW_SHOWMINNOACTIVE) } != 0 {
        // Só a janela principal é restaurada ao fechar o launcher; ofertas e avisos ficam quietos.
        if main {
            state.minimized.insert(hwnd as usize, pid);
        }
        drop(state);
        update_launcher(Some(hwnd as usize));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guia_bloqueia_foco_sem_perder_retorno_pendente() {
        let mut state = SteamWindows::new();
        state.keep_above_steam = true;
        state.restore_pending = true;
        let blocked = state.launcher_state(42, Some(42), true);
        assert!(!blocked.keep_above_steam && !blocked.restore && !blocked.refocus);
        assert!(state.restore_pending);
        assert!(state.launcher_state(42, None, false).restore);
        assert!(!state.launcher_state(42, None, false).restore);
    }

    #[test]
    fn outro_jogo_na_frente_descarta_retorno_do_jogo_anterior() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.restore_pending = true;
        assert!(state.yield_to_game(10));
        let window = state.launcher_state(10, None, false);
        assert_eq!(window.behind_game, Some(10));
        assert!(!window.restore);
    }

    #[test]
    fn em_tela_cheia_nenhuma_janela_da_steam_pode_aparecer() {
        let mut state = SteamWindows::new();
        assert!(!state.should_minimize_main(100), "fora da tela cheia a Steam fica livre");
        state.set_fullscreen(true);
        assert!(state.should_minimize_main(100));
        assert!(state.should_minimize_main(1_000_000), "vale sempre, não só logo depois de um comando");
    }

    #[test]
    fn abertura_intencional_deixa_a_steam_aparecer_por_um_tempo() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.allowed_until = 200;
        assert!(!state.should_minimize_main(101));
        assert!(state.should_minimize_main(200));
    }

    #[test]
    fn mantem_o_launcher_acima_da_steam_mas_libera_outros_aplicativos() {
        let mut state = SteamWindows::new();
        assert!(!state.update_foreground(Foreground::Launcher, 100));
        state.set_fullscreen(true);
        assert!(state.update_foreground(Foreground::Launcher, 101));
        assert!(!state.update_foreground(Foreground::Steam, 102));
        assert!(state.keep_above_steam);

        assert!(state.update_foreground(Foreground::Other, 103));
        assert!(!state.keep_above_steam);
        assert!(state.update_foreground(Foreground::Launcher, 105));
        state.set_fullscreen(false);
        assert!(state.update_foreground(Foreground::Launcher, 106));
        assert!(!state.keep_above_steam);
    }

    #[test]
    fn topo_independe_das_notificacoes_e_respeita_abertura_intencional() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.hide_toasts = false;
        assert!(state.update_foreground(Foreground::Launcher, 100));
        assert!(state.should_minimize_main(102));

        state.allowed_until = 300;
        assert!(state.update_foreground(Foreground::Launcher, 103));
        assert!(!state.keep_above_steam);
        assert!(!state.should_minimize_main(104));
        assert!(state.update_foreground(Foreground::Launcher, 301));
        assert!(!state.update_foreground(Foreground::Steam, 302));
        assert!(state.keep_above_steam);
        assert!(state.should_minimize_main(302));
    }

    #[test]
    fn launcher_fica_atras_do_jogo_e_volta_quando_chamado() {
        let mut state = SteamWindows::new();
        assert!(!state.yield_to_game(1), "fora da tela cheia não mexe em nada");
        state.set_fullscreen(true);
        assert!(state.update_foreground(Foreground::Launcher, 100));
        assert!(state.keep_above_steam);

        assert!(state.yield_to_game(1));
        assert_eq!(state.game_window, Some(1));
        assert!(!state.yield_to_game(1), "a posição do launcher já foi atualizada para essa janela");
        assert!(state.update_foreground(Foreground::Other, 101));
        assert!(!state.keep_above_steam);

        // O jogo recria a janela. O launcher acompanha a nova janela sem pedir foco.
        assert!(state.yield_to_game(2));
        assert_eq!(state.game_window, Some(2));
        assert!(!state.update_foreground(Foreground::Steam, 102));
        assert!(!state.keep_above_steam);

        // O jogador volta ao launcher: ele volta a valer.
        assert!(state.update_foreground(Foreground::Launcher, 200));
        assert!(!state.yielded);
        assert!(state.keep_above_steam);
        assert!(state.yield_to_game(3), "cede o foco para o próximo jogo");
    }

    #[test]
    fn launcher_volta_na_hora_quando_o_jogo_fecha() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        assert!(!state.game_state(true, true, 0), "jogo abriu: nada a fazer");
        assert!(!state.game_state(false, true, 10), "o launcher não havia cedido o foco");

        assert!(!state.game_state(true, true, 20));
        assert!(state.yield_to_game(1));
        assert!(!state.game_state(true, true, 30), "ainda rodando");
        assert!(state.game_state(false, true, 40), "a Steam avisou que fechou: volta já");
        assert!(state.restore_pending);
        assert!(state.game_window.is_none());
        assert!(!state.game_state(false, true, 50), "só avisa uma vez");
    }

    #[test]
    fn launcher_volta_assim_que_o_processo_do_jogo_morre() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.game_pid = 4242;
        state.yield_to_game(1);
        assert!(!state.game_state(true, true, 100));
        // Morreu e a Steam já diz que não há jogo: volta na hora (a Steam costuma demorar ~2 s a avisar).
        assert!(state.game_state(false, false, 200));
        assert_eq!(state.game_pid, 0);
    }

    #[test]
    fn programa_de_abertura_que_sai_antes_da_janela_principal_nao_traz_o_launcher() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.game_pid = 1;
        state.yield_to_game(1);
        // O processo morreu, mas a Steam ainda diz que o jogo roda: espera.
        assert!(!state.game_state(true, false, 1_000));
        assert!(!state.game_state(true, false, 1_000 + PID_GRACE_MS - 1));
        // A janela principal aparece com outro processo antes do prazo: o jogo continua.
        state.game_pid = 2;
        assert!(!state.game_state(true, true, 1_000 + PID_GRACE_MS));
        assert!(state.game_dead_since.is_none());
        // Mas se ninguém assume depois do prazo, o jogo fechou.
        state.game_pid = 3;
        assert!(!state.game_state(true, false, 5_000));
        assert!(state.game_state(true, false, 5_000 + PID_GRACE_MS));
    }

    #[test]
    fn sair_da_tela_cheia_libera_as_janelas_e_limpa_os_prazos() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.minimized.insert(1, 10);
        state.minimized.insert(2, 20);
        state.allowed_until = 300;

        assert!(state.set_fullscreen(true).is_empty());
        assert_eq!(state.set_fullscreen(false), BTreeMap::from([(1, 10), (2, 20)]));
        assert_eq!(state.allowed_until, 0);
        assert!(state.set_fullscreen(false).is_empty());
        state.set_fullscreen(true);
        assert!(state.should_minimize_main(101));
    }

    #[test]
    fn reconhece_a_janela_principal() {
        assert!(is_steam_main("Steam"));
        assert!(is_steam_main("Steam Big Picture Mode"));
        assert!(is_steam_main("Steam — Modo Big Picture"));
        assert!(is_steam_main("Steam - Big-Picture-Modus"));
        assert!(!is_steam_main("Steam Community - Big Picture"));
        assert!(!is_steam_main("Friends List"));
        assert!(!is_steam_main("notificationtoasts_1_desktop"));
    }
}
