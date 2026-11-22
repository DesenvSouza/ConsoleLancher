//! Esconde as janelas da Steam que atrapalham o launcher: a janela principal que ela traz para a frente
//! quando recebe um comando, e as notificações (toasts) do canto da tela.
//!
//! O launcher fica acima da janela da Steam enquanto está em uso em tela cheia. O gancho WinEvent
//! minimiza a Steam quando ela tenta aparecer e libera o topo quando outro aplicativo assume o foco.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EnumWindows, GetClassNameW, GetForegroundWindow, GetMessageW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, ShowWindowAsync, TranslateMessage,
    EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND,
    MSG, OBJID_WINDOW, SW_HIDE, SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE, WINEVENT_OUTOFCONTEXT,
};

static STEAM_WINDOWS: Mutex<SteamWindows> = Mutex::new(SteamWindows::new());

struct SteamWindows {
    fullscreen: bool,
    keep_above_steam: bool,
    hide_toasts: bool,
    armed_until: u64,
    allowed_until: u64,
    last_launcher_foreground: Option<u64>,
    // HWND e PID das janelas que o launcher minimizou nesta sessão em tela cheia.
    minimized: BTreeMap<usize, u32>,
}

#[derive(Clone, Copy)]
enum Foreground {
    Launcher,
    Steam,
    Other,
}

impl SteamWindows {
    const fn new() -> Self {
        Self {
            fullscreen: false,
            keep_above_steam: false,
            hide_toasts: true,
            armed_until: 0,
            allowed_until: 0,
            last_launcher_foreground: None,
            minimized: BTreeMap::new(),
        }
    }

    fn set_fullscreen(&mut self, fullscreen: bool) -> BTreeMap<usize, u32> {
        if self.fullscreen == fullscreen {
            return BTreeMap::new();
        }
        self.fullscreen = fullscreen;
        self.armed_until = 0;
        self.allowed_until = 0;
        self.last_launcher_foreground = None;
        std::mem::take(&mut self.minimized)
    }

    fn should_minimize_main(&self, now: u64) -> bool {
        let after_launcher = self
            .last_launcher_foreground
            .is_some_and(|last| now.saturating_sub(last) <= GUIDE_GRACE_MS);
        self.fullscreen && now >= self.allowed_until && (now < self.armed_until || after_launcher)
    }

    fn update_foreground(&mut self, foreground: Foreground, now: u64) -> bool {
        let keep_above_steam = match foreground {
            Foreground::Launcher if self.fullscreen => {
                self.last_launcher_foreground = Some(now);
                now >= self.allowed_until
            }
            Foreground::Steam if self.should_minimize_main(now) => self.keep_above_steam,
            _ => {
                self.last_launcher_foreground = None;
                false
            }
        };
        std::mem::replace(&mut self.keep_above_steam, keep_above_steam) != keep_above_steam
    }
}

/// Quanto tempo depois de o launcher sair da frente a Steam ainda conta como "tomou o foco do launcher".
const GUIDE_GRACE_MS: u64 = 1500;
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

/// Nos próximos `ms` milissegundos, minimiza a janela principal da Steam assim que ela aparecer.
/// Chamado logo antes de mandar um comando para a Steam.
pub fn arm(ms: u64) {
    let mut state = STEAM_WINDOWS.lock().unwrap();
    if state.fullscreen {
        state.armed_until = now_ms() + ms;
        state.allowed_until = 0;
    }
    drop(state);
    apply_current_policy();
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
        state.armed_until = 0;
    }
    drop(state);
    apply_current_policy();
}

/// Lê o estado na hora de aplicá-lo para descartar pedidos de foco que ficaram na fila.
pub fn launcher_window_state(focus_from: Option<usize>) -> (bool, bool) {
    let state = STEAM_WINDOWS.lock().unwrap();
    let refocus = state.keep_above_steam
        && focus_from.is_some_and(|hwnd| {
            let foreground = unsafe { GetForegroundWindow() };
            foreground.is_null() || hwnd == foreground as usize
        });
    (state.keep_above_steam, refocus)
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
            std::thread::sleep(std::time::Duration::from_millis(100));
        });
    });
}

fn window_text(hwnd: HWND, class: bool) -> String {
    let mut buf = [0u16; 128];
    // SAFETY: o buffer tem 128 posições e o tamanho informado é o do buffer.
    let n = unsafe {
        if class {
            GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32)
        } else {
            GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32)
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
    let foreground = if !state.fullscreen || current.is_null() {
        Foreground::Other
    } else if is_ours(current) {
        Foreground::Launcher
    } else if is_steam_foreground(current) {
        Foreground::Steam
    } else {
        Foreground::Other
    };
    let changed = state.update_foreground(foreground, now);
    // A Steam pode voltar a pedir foco durante a minimização. Se outro app já o ganhou,
    // `launcher_window_state` descarta este pedido quando a thread da janela o recebe.
    let refocus = (state.keep_above_steam
        && matches!(foreground, Foreground::Steam)
        && unsafe { IsIconic(current) } != 0)
        .then_some(current as usize);
    (changed, refocus)
}

fn window_process_id(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    // SAFETY: `pid` é uma variável local válida para receber o resultado.
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid
}

fn is_ours(hwnd: HWND) -> bool {
    window_process_id(hwnd) == unsafe { GetCurrentProcessId() }
}

fn is_steam_foreground(hwnd: HWND) -> bool {
    if window_text(hwnd, true) != "SDL_app" {
        return false;
    }
    let title = window_text(hwnd, false);
    // Uma janela nova da Steam pode tomar o foco antes de ganhar o título do Big Picture.
    is_steam_main(&title) || (title.is_empty() && is_steam_process(window_process_id(hwnd)))
}

fn is_steam_process(pid: u32) -> bool {
    let mut image = [0u16; 1024];
    let mut len = image.len() as u32;
    // SAFETY: o tamanho passado à API é o do buffer e o handle é fechado após a consulta.
    let found = unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let found = QueryFullProcessImageNameW(process, 0, image.as_mut_ptr(), &mut len);
        CloseHandle(process);
        found
    };
    if found == 0 {
        return false;
    }
    let image = String::from_utf16_lossy(&image[..len as usize]);
    Path::new(&image)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.eq_ignore_ascii_case("steam.exe")
                || name.eq_ignore_ascii_case("steamwebhelper.exe")
        })
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
    // Todas as janelas da Steam têm a classe "SDL_app"; o título diz qual é.
    if window_text(hwnd, true) != "SDL_app" {
        return;
    }
    let title = window_text(hwnd, false);

    if title.starts_with("notificationtoasts_") {
        if state.hide_toasts && unsafe { IsWindowVisible(hwnd) } != 0 {
            unsafe { ShowWindowAsync(hwnd, SW_HIDE) };
        }
        return;
    }
    if !is_steam_main(&title) || unsafe { IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 } {
        return;
    }
    if !state.should_minimize_main(now_ms()) {
        if event == Some(EVENT_SYSTEM_MINIMIZEEND) {
            state.minimized.remove(&(hwnd as usize));
        }
        return;
    }

    let pid = window_process_id(hwnd);
    if pid != 0 && unsafe { ShowWindowAsync(hwnd, SW_SHOWMINNOACTIVE) } != 0 {
        state.minimized.insert(hwnd as usize, pid);
        drop(state);
        update_launcher(Some(hwnd as usize));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guia_com_o_launcher_na_frente_esconde_a_steam() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.last_launcher_foreground = Some(100);
        assert!(state.should_minimize_main(101));
    }

    #[test]
    fn steam_aberta_por_jogo_ou_outro_programa_nao_e_mexida() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.last_launcher_foreground = Some(100);
        assert!(!state.should_minimize_main(101 + GUIDE_GRACE_MS));
    }

    #[test]
    fn abertura_intencional_deixa_a_steam_aparecer() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.last_launcher_foreground = Some(100);
        state.allowed_until = 200;
        assert!(!state.should_minimize_main(101));
    }

    #[test]
    fn comando_do_launcher_so_minimiza_em_tela_cheia() {
        let mut state = SteamWindows::new();
        state.armed_until = 200;
        assert!(!state.should_minimize_main(101));
        state.set_fullscreen(true);
        state.armed_until = 200;
        assert!(state.should_minimize_main(101));
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
        assert!(!state.should_minimize_main(104));
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
        state.armed_until = 200;
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
    fn sair_da_tela_cheia_libera_as_janelas_e_limpa_os_prazos() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.minimized.insert(1, 10);
        state.minimized.insert(2, 20);
        state.last_launcher_foreground = Some(100);
        state.armed_until = 200;
        state.allowed_until = 300;

        assert!(state.set_fullscreen(true).is_empty());
        assert_eq!(
            state.set_fullscreen(false),
            BTreeMap::from([(1, 10), (2, 20)])
        );
        assert_eq!(state.last_launcher_foreground, None);
        assert_eq!(state.armed_until, 0);
        assert_eq!(state.allowed_until, 0);
        assert!(state.set_fullscreen(false).is_empty());
        state.set_fullscreen(true);
        assert!(!state.should_minimize_main(101));
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
