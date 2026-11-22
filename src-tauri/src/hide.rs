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
    GetCurrentProcessId, GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EnumWindows, GetClassNameW, GetForegroundWindow, GetMessageW,
    GetWindowThreadProcessId, InternalGetWindowText, IsIconic, IsWindowVisible, ShowWindowAsync, TranslateMessage,
    EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND,
    MSG, OBJID_WINDOW, SW_HIDE, SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE, WINEVENT_OUTOFCONTEXT,
};

static STEAM_WINDOWS: Mutex<SteamWindows> = Mutex::new(SteamWindows::new());

struct SteamWindows {
    fullscreen: bool,
    keep_above_steam: bool,
    hide_toasts: bool,
    allowed_until: u64,
    /// O launcher se recolheu porque um jogo assumiu a frente: não pode ficar acima dele nem voltar sozinho.
    yielded: bool,
    /// Pedido de minimizar o launcher, entregue à thread da janela por `launcher_window_state`.
    minimize_pending: bool,
    /// Havia um jogo da Steam rodando na última leitura.
    game_running: bool,
    /// Processo da última janela de jogo que assumiu a frente: se ele morre, o jogo fechou (a Steam só avisa
    /// uns 2 s depois, pelo registro).
    game_pid: u32,
    /// Desde quando esse processo está morto.
    game_dead_since: Option<u64>,
    /// O jogo fechou com o launcher recolhido: ele deve voltar à frente na hora.
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

impl SteamWindows {
    const fn new() -> Self {
        Self {
            fullscreen: false,
            keep_above_steam: false,
            hide_toasts: true,
            allowed_until: 0,
            yielded: false,
            minimize_pending: false,
            game_running: false,
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
        self.minimize_pending = false;
        self.restore_pending = false;
        self.game_pid = 0;
        self.game_dead_since = None;
        std::mem::take(&mut self.minimized)
    }

    /// Com o launcher em tela cheia, nenhuma janela da Steam pode aparecer (Guia, avisos, ofertas, login...),
    /// exceto durante uma abertura que o próprio jogador pediu (`allowed_until`).
    fn should_minimize_main(&self, now: u64) -> bool {
        self.fullscreen && now >= self.allowed_until
    }

    /// Um programa que não é do launcher nem da Steam assumiu a frente com um jogo da Steam rodando: o launcher se
    /// recolhe (minimiza). Assim ele não fica entre o jogador e o jogo e, quando o jogo recria a janela
    /// (troca de tela cheia, carregamento), o foco não cai de volta no launcher deixando o jogo por trás.
    fn yield_to_game(&mut self) -> bool {
        if !self.fullscreen || self.yielded {
            return false;
        }
        self.yielded = true;
        self.minimize_pending = true;
        true
    }

    /// Informa o estado do jogo: `running` (a Steam diz que há um jogo rodando) e `pid_alive` (o processo da janela
    /// do jogo continua vivo). Devolve true no instante em que o jogo fecha com o launcher recolhido: ele precisa
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

/// Lê o estado na hora de aplicá-lo para descartar pedidos de foco que ficaram na fila.
/// Devolve (ficar acima da Steam, tomar o foco, minimizar, voltar à frente porque o jogo fechou).
pub fn launcher_window_state(focus_from: Option<usize>) -> (bool, bool, bool, bool) {
    let mut state = STEAM_WINDOWS.lock().unwrap();
    let minimize = std::mem::take(&mut state.minimize_pending);
    let restore = std::mem::take(&mut state.restore_pending);
    let refocus = !minimize
        && state.keep_above_steam
        && focus_from.is_some_and(|hwnd| {
            let foreground = unsafe { GetForegroundWindow() };
            foreground.is_null() || hwnd == foreground as usize
        });
    (state.keep_above_steam, refocus, minimize, restore)
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
    let running = crate::steam::running_app_id() != 0;
    // Com um jogo rodando, nada do overlay da Steam pode aparecer (nem sobre o jogo, nem sobre o menu do Guia).
    if running && blocks_steam_overlay() {
        crate::guide::kill_steam_overlay();
    }
    let mut state = STEAM_WINDOWS.lock().unwrap();
    let pid_alive = state.game_pid == 0 || process_alive(state.game_pid);
    let closed = state.game_state(running, pid_alive, now_ms());
    drop(state);
    if closed {
        update_launcher(None);
    }
}

/// O processo ainda está vivo?
fn process_alive(pid: u32) -> bool {
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
    // Com o menu do Guia aberto (uma janela do próprio app, por cima do jogo), nada muda: o launcher continua
    // recolhido e o jogo continua sendo a "janela de trás" que recebe o foco quando o menu fechar.
    if !current.is_null() && crate::guide::is_open() && is_ours(current) {
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
    // Um jogo da Steam está rodando e outro programa (o próprio jogo) assumiu a frente: o launcher se recolhe.
    let game_up = matches!(foreground, Foreground::Other) && !current.is_null() && crate::steam::running_app_id() != 0;
    if game_up {
        // A janela do jogo que está na frente: o processo dela é quem precisa morrer para o jogo ter fechado.
        let pid = window_process_id(current);
        if is_steam_game_process(pid) {
            state.game_pid = pid;
            state.game_dead_since = None;
        }
    }
    let yielded_now = game_up && state.yield_to_game();
    let changed = state.update_foreground(foreground, now) || yielded_now;
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
fn process_image(pid: u32) -> Option<String> {
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
    process_image(pid).is_some_and(|image| image.to_lowercase().replace('/', "\\").contains("\\steamapps\\common\\"))
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
    fn launcher_se_recolhe_quando_o_jogo_assume_a_frente_e_volta_quando_chamado() {
        let mut state = SteamWindows::new();
        assert!(!state.yield_to_game(), "fora da tela cheia não mexe em nada");
        state.set_fullscreen(true);
        assert!(state.update_foreground(Foreground::Launcher, 100));
        assert!(state.keep_above_steam);

        assert!(state.yield_to_game());
        assert!(state.minimize_pending);
        assert!(!state.yield_to_game(), "só pede uma vez");
        assert!(state.update_foreground(Foreground::Other, 101));
        assert!(!state.keep_above_steam, "recolhido, não fica acima do jogo");

        // O jogo recria a janela e o foco passa por uma janela da Steam: o launcher continua recolhido.
        assert!(!state.update_foreground(Foreground::Steam, 102));
        assert!(!state.keep_above_steam);

        // O jogador volta ao launcher: ele volta a valer.
        assert!(state.update_foreground(Foreground::Launcher, 200));
        assert!(!state.yielded);
        assert!(state.keep_above_steam);
        assert!(state.yield_to_game(), "um novo jogo recolhe de novo");
    }

    #[test]
    fn launcher_volta_na_hora_quando_o_jogo_fecha() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        assert!(!state.game_state(true, true, 0), "jogo abriu: nada a fazer");
        assert!(!state.game_state(false, true, 10), "fechou, mas o launcher não tinha se recolhido");

        assert!(!state.game_state(true, true, 20));
        assert!(state.yield_to_game());
        assert!(!state.game_state(true, true, 30), "ainda rodando");
        assert!(state.game_state(false, true, 40), "a Steam avisou que fechou: volta já");
        assert!(state.restore_pending);
        assert!(!state.game_state(false, true, 50), "só avisa uma vez");
    }

    #[test]
    fn launcher_volta_assim_que_o_processo_do_jogo_morre() {
        let mut state = SteamWindows::new();
        state.set_fullscreen(true);
        state.game_pid = 4242;
        state.yield_to_game();
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
        state.yield_to_game();
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
