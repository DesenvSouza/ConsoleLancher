//! Jogo que não obedece ao pedido de fechar.
//!
//! O fechamento normal (WM_CLOSE) pode destruir a janela e deixar o processo vivo (o The Witcher 3 já fez isso): a loja
//! continua considerando o jogo aberto, não há janela para pedir de novo e nenhum outro jogo pode ser aberto. Aqui se
//! percebe esse caso e, com a confirmação do jogador, se encerram os processos do jogo.

use crate::{epic, guide, hide, steam};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::System::Threading::{GetCurrentProcessId, OpenProcess, TerminateProcess, PROCESS_TERMINATE};

/// Depois do pedido normal, quanto o jogo tem para sair antes de o menu oferecer o fechamento forçado.
const GRACE: Duration = Duration::from_secs(10);
/// Sem janela e ainda rodando por este tempo depois do pedido, o launcher avisa sozinho.
const STUCK: Duration = Duration::from_secs(8);
/// Até quando um pedido de fechar é acompanhado.
const WATCH: Duration = Duration::from_secs(90);
/// Quanto se espera o Windows terminar os processos.
const KILL_WAIT: Duration = Duration::from_secs(5);

/// Último pedido normal de fechamento: qual jogo e quando.
static REQUEST: Mutex<Option<(String, Instant)>> = Mutex::new(None);

#[derive(Serialize, Debug, Clone, Copy, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloseState {
    /// Há processo do jogo vivo.
    pub running: bool,
    /// O jogo tem janela (dá para voltar a ele ou pedir que feche).
    pub window: bool,
    /// O pedido normal não basta: oferecer o fechamento forçado.
    pub force: bool,
}

/// Processos vivos que `belongs` reconhece como do jogo. O próprio launcher, o Windows, o Explorer e a Steam ficam
/// sempre de fora, mesmo que um registro antigo os aponte.
pub(crate) fn collect(mut belongs: impl FnMut(u32, &Path) -> bool) -> Vec<u32> {
    // SAFETY: só consulta o identificador do próprio processo.
    let own = unsafe { GetCurrentProcessId() };
    let windows = std::env::var("SystemRoot").ok().map(|root| steam::windows_path(&root));
    let mut found = Vec::new();
    hide::find_process(|pid, name| {
        let protected = pid == own
            || ["explorer.exe", "steam.exe", "steamwebhelper.exe", "steamservice.exe"].iter().any(|p| name.eq_ignore_ascii_case(p));
        if !protected {
            if let Some(image) = hide::process_image(pid).map(|image| steam::windows_path(&image)) {
                if !windows.as_ref().is_some_and(|root| image.starts_with(root)) && belongs(pid, &image) && hide::process_alive(pid) {
                    found.push(pid);
                }
            }
        }
        false
    });
    found
}

/// Processos do jogo: `epic:<nome>` ou o AppID da Steam.
fn processes(id: &str) -> Vec<u32> {
    match id.strip_prefix("epic:") {
        Some(app_name) => epic::game_process_ids(app_name),
        None => id.parse().ok().filter(|&app| app != 0).map(steam::game_process_ids).unwrap_or_default(),
    }
}

fn has_window(pids: &[u32]) -> bool {
    guide::find_game_window_by(|pid| pids.contains(&pid).then_some(())).is_some()
}

fn offers_force(running: bool, window: bool, asked: Option<Duration>) -> bool {
    running && (!window || asked.is_some_and(|elapsed| elapsed >= GRACE))
}

pub fn state(id: &str) -> CloseState {
    let pids = processes(id);
    let running = !pids.is_empty();
    let window = running && has_window(&pids);
    let asked = REQUEST.lock().unwrap().as_ref().filter(|(game, _)| game == id).map(|(_, at)| at.elapsed());
    CloseState { running, window, force: offers_force(running, window, asked) }
}

/// Um jogo que continua rodando sem janela nenhuma: é o que impede abrir outro sem que dê para fechá-lo.
pub fn stuck() -> Option<String> {
    let steam = steam::pending_app_id().map(|app| app.to_string());
    steam.into_iter().chain(epic::installed_ids()).find(|id| {
        let pids = processes(id);
        !pids.is_empty() && !has_window(&pids)
    })
}

/// O pedido normal de fechar foi enviado: acompanha o jogo e avisa o launcher se ele ficar rodando sem janela.
pub(crate) fn requested(id: String) {
    let at = Instant::now();
    *REQUEST.lock().unwrap() = Some((id.clone(), at));
    let Some(app) = guide::app_handle() else { return };
    std::thread::spawn(move || watch(app, id, at));
}

fn watch(app: AppHandle, id: String, at: Instant) {
    let mut windowless: Option<Instant> = None;
    while at.elapsed() < WATCH {
        std::thread::sleep(Duration::from_secs(1));
        // Um pedido mais novo tem o próprio acompanhamento.
        if REQUEST.lock().unwrap().as_ref().is_none_or(|(_, latest)| *latest != at) {
            return;
        }
        let now = state(&id);
        if !now.running {
            return;
        }
        if now.window {
            // Pode estar perguntando se é para salvar: o jogador responde no próprio jogo.
            windowless = None;
        } else if windowless.get_or_insert_with(Instant::now).elapsed() >= STUCK {
            guide::log(&format!("o jogo {id} não terminou de fechar"));
            if app.emit_to("main", "game-close-stuck", &id).is_ok() {
                guide::ensure_launcher_front(&app, 3);
            }
            return;
        }
    }
}

fn terminate(pids: &[u32]) {
    for &pid in pids {
        // SAFETY: abre o processo só para encerrá-lo e fecha o identificador em seguida.
        unsafe {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !handle.is_null() {
                TerminateProcess(handle, 1);
                CloseHandle(handle);
            }
        }
    }
}

/// Encerra os processos do jogo e confere que saíram. Se ele já tinha saído, não há o que fazer.
pub fn force(id: &str) -> Result<(), String> {
    let pids = processes(id);
    if pids.is_empty() {
        return Ok(());
    }
    // Um jogo congelado sai do congelamento antes de ser encerrado.
    guide::release_pause();
    guide::log(&format!("fechamento forçado de {id}: {} processo(s)", pids.len()));
    terminate(&pids);
    let deadline = Instant::now() + KILL_WAIT;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
        let left = processes(id);
        if left.is_empty() {
            return Ok(());
        }
        // Um iniciador pode ter aberto outro processo nesse meio-tempo.
        terminate(&left);
    }
    Err("O Windows não conseguiu encerrar o jogo. Reinicie o PC.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oferece_forcar_sem_janela_ou_depois_do_prazo() {
        assert!(!offers_force(false, false, Some(GRACE)));
        assert!(offers_force(true, false, None));
        assert!(!offers_force(true, true, None));
        assert!(!offers_force(true, true, Some(Duration::from_secs(1))));
        assert!(offers_force(true, true, Some(GRACE)));
    }

    #[test]
    fn nunca_alcanca_o_proprio_processo_nem_o_windows() {
        let all = collect(|_, _| true);
        // SAFETY: só consulta o identificador do próprio processo.
        assert!(!all.contains(&unsafe { GetCurrentProcessId() }));
        let windows = steam::windows_path(&std::env::var("SystemRoot").unwrap());
        assert!(all.iter().all(|&pid| hide::process_image(pid).is_none_or(|image| !steam::windows_path(&image).starts_with(&windows))));
    }

    /// Abre um programa de mentira que, como o jogo travado, destrói a janela ao ser fechado e continua rodando.
    /// Roda à parte (precisa do PowerShell do Windows e de uma área de trabalho):
    /// `cargo test --lib jogo_travado -- --ignored`
    #[test]
    #[ignore]
    fn jogo_travado_sem_janela_e_encerrado() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};
        let dir = std::env::temp_dir().join(format!("launcher-jogo-travado-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("JogoTravado.exe");
        let source = "using System.Windows.Forms; public static class P { [System.STAThread] public static void Main() { \
            var f = new Form(); f.Text = \"Jogo travado (teste)\"; f.Width = 640; f.Height = 360; Application.Run(f); \
            System.Threading.Thread.Sleep(120000); } }";
        let script = format!(
            "Add-Type -TypeDefinition '{source}' -ReferencedAssemblies System.Windows.Forms -OutputType WindowsApplication -OutputAssembly '{}'",
            exe.display()
        );
        let built = std::process::Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &script]).status().unwrap();
        assert!(built.success() && exe.exists(), "não compilou o programa de mentira");
        let mut child = std::process::Command::new(&exe).spawn().unwrap();
        let folder = steam::windows_path(&dir.canonicalize().unwrap().to_string_lossy());
        let long = steam::windows_path(&dir.to_string_lossy());
        let game = || collect(|_, image| image.starts_with(&folder) || image.starts_with(&long));
        let wait = |ready: &dyn Fn() -> bool| {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline && !ready() {
                std::thread::sleep(Duration::from_millis(100));
            }
            ready()
        };

        let opened = wait(&|| has_window(&game()));
        let window = guide::find_game_window_by(|pid| (pid == child.id()).then_some(())).and_then(|(window, ())| window.hwnd());
        if let Some(hwnd) = window {
            // SAFETY: a janela pertence ao programa de mentira que acabou de ser aberto.
            unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
        }
        let windowless = wait(&|| !has_window(&game()));
        let alive = game();
        terminate(&alive);
        let gone = wait(&|| game().is_empty());
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(&dir);

        assert!(opened, "a janela não apareceu");
        assert!(windowless, "a janela não sumiu com o pedido de fechar");
        assert_eq!(alive, vec![child.id()], "o processo devia continuar vivo sem janela");
        assert!(offers_force(true, false, None));
        assert!(gone, "o processo não foi encerrado");
    }
}
