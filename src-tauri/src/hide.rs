//! Esconde as janelas da Steam que atrapalham o launcher: a janela principal que ela traz para a frente
//! quando recebe um comando, e as notificações (toasts) do canto da tela.
//!
//! Em vez de ficar conferindo a cada instante, usa um gancho de eventos do Windows (WinEvent): o sistema
//! avisa no momento em que a janela aparece, e a reação é imediata — o "pisca" some ou fica de poucos ms.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::Threading::GetCurrentProcessId;
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetClassNameW, GetForegroundWindow, GetMessageW, GetWindowTextW, GetWindowThreadProcessId, ShowWindow, TranslateMessage, EVENT_OBJECT_SHOW,
    EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND, MSG, OBJID_WINDOW, SW_HIDE, SW_SHOWMINNOACTIVE, WINEVENT_OUTOFCONTEXT,
};

/// Até quando (ms desde 1970) a janela principal da Steam deve ser minimizada assim que aparecer.
static ARMED_UNTIL: AtomicU64 = AtomicU64::new(0);
/// Esconder as notificações da Steam (padrão: sim).
static HIDE_TOASTS: AtomicBool = AtomicBool::new(true);
/// Impedir que a Steam tome a tela do launcher (botão Guia do controle). Padrão: sim.
static BLOCK_GUIDE: AtomicBool = AtomicBool::new(true);
/// Até quando a Steam pode aparecer porque o próprio launcher a abriu de propósito.
static ALLOWED_UNTIL: AtomicU64 = AtomicU64::new(0);
/// Última vez (ms desde 1970) em que o launcher estava em primeiro plano. Um amostrador anota isso a cada
/// 100 ms: os eventos do Windows só avisam de trocas e, na prática, não bastam para saber "quem estava na frente".
static LAST_OURS_MS: AtomicU64 = AtomicU64::new(0);
/// Quanto tempo depois de o launcher sair da frente a Steam ainda conta como "tomou o foco do launcher".
const GUIDE_GRACE_MS: u64 = 1500;
/// O que fazer para devolver o foco ao launcher. Vem de fora (lib.rs) para este módulo não depender do
/// Tauri: assim ele roda também nos testes, que não têm o manifesto do Windows exigido pelo motor de janelas.
static FOCUS: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();
static STARTED: OnceLock<()> = OnceLock::new();

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Guarda como devolver o foco ao launcher e liga o gancho. Só a primeira chamada vale.
pub fn init(focus_launcher: impl Fn() + Send + Sync + 'static) {
    let _ = FOCUS.set(Box::new(focus_launcher));
    start();
}

/// Nos próximos `ms` milissegundos, minimiza a janela principal da Steam assim que ela aparecer.
/// Chamado logo antes de mandar um comando para a Steam.
pub fn arm(ms: u64) {
    ARMED_UNTIL.store(now_ms() + ms, Ordering::Relaxed);
    start();
}

pub fn set_hide_toasts(hide: bool) {
    HIDE_TOASTS.store(hide, Ordering::Relaxed);
}

/// Liga ou desliga o bloqueio da Steam ao apertar o botão Guia.
pub fn set_block_guide(block: bool) {
    BLOCK_GUIDE.store(block, Ordering::Relaxed);
    start();
}

/// Nos próximos `ms` milissegundos a Steam pode aparecer (o launcher a abriu de propósito).
pub fn allow(ms: u64) {
    ALLOWED_UNTIL.store(now_ms() + ms, Ordering::Relaxed);
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
                for event in [EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND, EVENT_OBJECT_SHOW] {
                    SetWinEventHook(event, event, std::ptr::null_mut(), Some(on_event), 0, 0, WINEVENT_OUTOFCONTEXT);
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

/// Decide se a janela principal da Steam deve ser minimizada ao aparecer.
/// - `armed`: o próprio launcher acabou de mandar um comando para a Steam (instalar, desinstalar...).
/// - `allowed`: o launcher abriu a Steam de propósito (ex.: a página da chave de API).
/// - `after_launcher`: a janela que estava em primeiro plano antes era do launcher. É o caso do botão Guia:
///   a Steam toma o foco em cima do launcher. Se ela vem depois de um jogo ou de outro programa, é o jogador
///   que a abriu, e não mexemos.
pub fn should_hide_main(armed: bool, block_guide: bool, allowed: bool, after_launcher: bool) -> bool {
    armed || (block_guide && !allowed && after_launcher)
}

/// Vale a janela principal da Steam em modo normal ("Steam") ou modo Big Picture.
fn is_steam_main(title: &str) -> bool {
    title == "Steam" || title.starts_with("Steam Big Picture") || title == "Steam Big Picture Mode"
}

/// Anota se o launcher está em primeiro plano agora.
fn note_foreground() {
    // SAFETY: só consulta a janela em primeiro plano.
    let current = unsafe { GetForegroundWindow() };
    if (current as usize) != 0 && is_ours(current) {
        LAST_OURS_MS.store(now_ms(), Ordering::Relaxed);
    }
}

fn is_ours(hwnd: HWND) -> bool {
    let mut pid = 0u32;
    // SAFETY: `pid` é uma variável local válida para receber o resultado.
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid != 0 && pid == unsafe { GetCurrentProcessId() }
}

unsafe extern "system" fn on_event(_hook: HWINEVENTHOOK, event: u32, hwnd: HWND, id_object: i32, _id_child: i32, _thread: u32, _time: u32) {
    if id_object != OBJID_WINDOW || (hwnd as usize) == 0 {
        return;
    }
    // Todas as janelas da Steam têm a classe "SDL_app"; o título diz qual é.
    if window_text(hwnd, true) != "SDL_app" {
        if event == EVENT_SYSTEM_FOREGROUND && is_ours(hwnd) {
            LAST_OURS_MS.store(now_ms(), Ordering::Relaxed);
        }
        return;
    }
    let title = window_text(hwnd, false);

    if title.starts_with("notificationtoasts_") {
        if HIDE_TOASTS.load(Ordering::Relaxed) {
            ShowWindow(hwnd, SW_HIDE);
        }
    } else if is_steam_main(&title) {
        let after_launcher = now_ms().saturating_sub(LAST_OURS_MS.load(Ordering::Relaxed)) <= GUIDE_GRACE_MS;
        let armed = now_ms() < ARMED_UNTIL.load(Ordering::Relaxed);
        let allowed = now_ms() < ALLOWED_UNTIL.load(Ordering::Relaxed);
        // Só a troca de primeiro plano conta como "veio do launcher"; os outros eventos (mostrar, restaurar)
        // dependem de quem estava na frente quando a troca aconteceu.
        if should_hide_main(armed, BLOCK_GUIDE.load(Ordering::Relaxed), allowed, after_launcher) {
            ShowWindow(hwnd, SW_SHOWMINNOACTIVE);
            if let Some(focus) = FOCUS.get() {
                focus();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guia_com_o_launcher_na_frente_esconde_a_steam() {
        assert!(should_hide_main(false, true, false, true));
    }

    #[test]
    fn steam_aberta_por_jogo_ou_outro_programa_nao_e_mexida() {
        assert!(!should_hide_main(false, true, false, false));
    }

    #[test]
    fn opcao_desligada_ou_abertura_permitida_deixa_a_steam_aparecer() {
        assert!(!should_hide_main(false, false, false, true));
        assert!(!should_hide_main(false, true, true, true));
    }

    #[test]
    fn comando_do_launcher_sempre_minimiza() {
        assert!(should_hide_main(true, false, false, false));
    }

    #[test]
    fn reconhece_a_janela_principal() {
        assert!(is_steam_main("Steam"));
        assert!(is_steam_main("Steam Big Picture Mode"));
        assert!(!is_steam_main("Friends List"));
        assert!(!is_steam_main("notificationtoasts_1_desktop"));
    }
}
