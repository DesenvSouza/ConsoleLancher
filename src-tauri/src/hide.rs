//! Esconde as janelas da Steam que atrapalham o launcher: a janela principal que ela traz para a frente
//! quando recebe um comando, e as notificações (toasts) do canto da tela.
//!
//! Em vez de ficar conferindo a cada instante, usa um gancho de eventos do Windows (WinEvent): o sistema
//! avisa no momento em que a janela aparece, e a reação é imediata — o "pisca" some ou fica de poucos ms.

use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::Threading::GetCurrentProcessId;
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetClassNameW, GetForegroundWindow, GetMessageW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, ShowWindowAsync, TranslateMessage,
    EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND, MSG, OBJID_WINDOW,
    SW_HIDE, SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE, WINEVENT_OUTOFCONTEXT,
};

static STEAM_WINDOWS: Mutex<SteamWindows> = Mutex::new(SteamWindows::new());

struct SteamWindows {
    fullscreen: bool,
    hide_toasts: bool,
    block_guide: bool,
    armed_until: u64,
    allowed_until: u64,
    last_launcher_foreground: Option<u64>,
    // HWND e PID das janelas que o launcher minimizou nesta sessão em tela cheia.
    minimized: BTreeMap<usize, u32>,
}

impl SteamWindows {
    const fn new() -> Self {
        Self {
            fullscreen: false,
            hide_toasts: true,
            block_guide: true,
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
        self.fullscreen
            && (now < self.armed_until
                || (self.block_guide && now >= self.allowed_until && after_launcher))
    }
}

/// Quanto tempo depois de o launcher sair da frente a Steam ainda conta como "tomou o foco do launcher".
const GUIDE_GRACE_MS: u64 = 1500;
/// O que fazer para devolver o foco ao launcher. Vem de fora (lib.rs) para este módulo não depender do
/// Tauri: assim ele roda também nos testes, que não têm o manifesto do Windows exigido pelo motor de janelas.
static FOCUS: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();
static STARTED: OnceLock<()> = OnceLock::new();

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Guarda como devolver o foco ao launcher e liga o gancho. Só a primeira chamada vale.
pub fn init(focus_launcher: impl Fn() + Send + Sync + 'static) {
    let _ = FOCUS.set(Box::new(focus_launcher));
    start();
}

/// Nos próximos `ms` milissegundos, minimiza a janela principal da Steam assim que ela aparecer.
/// Chamado logo antes de mandar um comando para a Steam.
pub fn arm(ms: u64) {
    let mut state = STEAM_WINDOWS.lock().unwrap();
    if state.fullscreen {
        state.armed_until = now_ms() + ms;
    }
}

pub fn set_hide_toasts(hide: bool) {
    STEAM_WINDOWS.lock().unwrap().hide_toasts = hide;
}

/// Liga ou desliga o bloqueio da Steam ao apertar o botão Guia.
pub fn set_block_guide(block: bool) {
    STEAM_WINDOWS.lock().unwrap().block_guide = block;
}

/// Nos próximos `ms` milissegundos a Steam pode aparecer (o launcher a abriu de propósito).
pub fn allow(ms: u64) {
    let mut state = STEAM_WINDOWS.lock().unwrap();
    if state.fullscreen {
        state.allowed_until = now_ms() + ms;
    }
}

pub fn is_fullscreen() -> bool {
    STEAM_WINDOWS.lock().unwrap().fullscreen
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
}

fn start() {
    STARTED.get_or_init(|| {
        std::thread::spawn(|| loop {
            note_foreground();
            std::thread::sleep(std::time::Duration::from_millis(100));
        });
        std::thread::spawn(|| {
            // SAFETY: instala ganchos de eventos e roda o laço de mensagens que eles exigem, em uma thread só deles.
            unsafe {
                for event in [
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_MINIMIZEEND,
                    EVENT_OBJECT_SHOW,
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
                let mut msg: MSG = std::mem::zeroed();
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
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
    title == "Steam" || title.starts_with("Steam Big Picture") || title == "Steam Big Picture Mode"
}

/// Anota se o launcher está em primeiro plano agora.
fn note_foreground() {
    let mut state = STEAM_WINDOWS.lock().unwrap();
    if !state.fullscreen {
        return;
    }
    // SAFETY: só consulta a janela em primeiro plano.
    let current = unsafe { GetForegroundWindow() };
    if !current.is_null() && is_ours(current) {
        state.last_launcher_foreground = Some(now_ms());
    }
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

unsafe extern "system" fn on_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if id_object != OBJID_WINDOW || hwnd.is_null() {
        return;
    }
    let mut state = STEAM_WINDOWS.lock().unwrap();
    if !state.fullscreen {
        return;
    }
    // Todas as janelas da Steam têm a classe "SDL_app"; o título diz qual é.
    if window_text(hwnd, true) != "SDL_app" {
        if event == EVENT_SYSTEM_FOREGROUND && is_ours(hwnd) {
            state.last_launcher_foreground = Some(now_ms());
        }
        return;
    }
    let title = window_text(hwnd, false);

    if title.starts_with("notificationtoasts_") {
        if state.hide_toasts {
            ShowWindowAsync(hwnd, SW_HIDE);
        }
        return;
    }
    if !is_steam_main(&title) || IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
        return;
    }
    if !state.should_minimize_main(now_ms()) {
        if event == EVENT_SYSTEM_MINIMIZEEND {
            state.minimized.remove(&(hwnd as usize));
        }
        return;
    }

    let pid = window_process_id(hwnd);
    if pid != 0 && ShowWindowAsync(hwnd, SW_SHOWMINNOACTIVE) != 0 {
        state.minimized.insert(hwnd as usize, pid);
        drop(state);
        if let Some(focus) = FOCUS.get() {
            focus();
        }
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
    fn opcao_desligada_ou_abertura_permitida_deixa_a_steam_aparecer() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.last_launcher_foreground = Some(100);
        state.block_guide = false;
        assert!(!state.should_minimize_main(101));
        state.block_guide = true;
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
        assert!(!is_steam_main("Friends List"));
        assert!(!is_steam_main("notificationtoasts_1_desktop"));
    }
}
