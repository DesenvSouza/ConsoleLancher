//! Coordena a abertura de jogos e acompanha as etapas entre o "Jogar" e a janela do jogo.
//!
//! A Steam registra cada etapa em `logs\console_log.txt` (contrato a aceitar, componentes a instalar, nuvem,
//! criação do processo...). Aqui só se lê esse arquivo, sem mexer em nada da Steam.

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindow, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindowAsync, GW_OWNER, SW_RESTORE,
};

use crate::guide::GameWindow;

/// Quanto do final do log se lê no máximo (uma abertura inteira cabe com folga).
const MAX_TAIL: u64 = 512 * 1024;

const GAME_OPEN: &str = "Feche o jogo em execução antes de abrir outro.";
const GAME_OPENING: &str = "Aguarde a abertura do jogo atual.";
/// Cobre o intervalo em que o comando já foi aceito, mas a loja ainda não criou o processo.
const DISPATCH_GRACE: Duration = Duration::from_secs(10);
static LAST_DISPATCH: Mutex<Option<(String, Instant)>> = Mutex::new(None);

pub(crate) fn start_game(id: String, retry: bool, start: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    let mut last = LAST_DISPATCH.lock().unwrap();
    if crate::steam::has_game_process() || crate::epic::has_game_process() {
        return Err(GAME_OPEN.into());
    }
    if last.as_ref().is_some_and(|(game, at)| at.elapsed() < DISPATCH_GRACE && (!retry || game != &id)) {
        return Err(GAME_OPENING.into());
    }
    start()?;
    *last = Some((id, Instant::now()));
    Ok(())
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchStatus {
    /// A Steam já registrou alguma etapa desta abertura.
    pub found: bool,
    /// Etapa atual (nome interno da Steam: ShowEula, RunningInstallScript, CreatingProcess...).
    pub task: String,
    /// A Steam espera uma resposta do jogador (janela de contrato, opções de inicialização...).
    pub waiting_user: bool,
    /// A abertura terminou: o processo do jogo foi criado.
    pub completed: bool,
    /// Erro da Steam, quando a abertura falhou.
    pub failed: Option<String>,
    /// O jogador aceitou o contrato do jogo na janela da Steam (a abertura que o pediu pode não continuar sozinha).
    pub eula_accepted: bool,
    /// Contrato que a Steam está pedindo (por exemplo "292030_eula_0"), se houver.
    pub eula: Option<String>,
}

/// Ponto dos logs da Steam no momento do "Jogar": tudo o que vier depois é desta abertura.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchMark {
    console: u64,
    ui: u64,
}

fn log_len(name: &str) -> u64 {
    crate::steam::steam_root()
        .and_then(|root| std::fs::metadata(root.join("logs").join(name)).ok())
        .map(|m| m.len())
        .unwrap_or(0)
}

pub fn log_mark() -> LaunchMark {
    LaunchMark { console: log_len("console_log.txt"), ui: log_len("webhelper_js.txt") }
}

/// O que a Steam escreveu em `logs\<name>` depois de `from` (no máximo o final de `MAX_TAIL` bytes).
fn read_new(name: &str, from: u64) -> String {
    let Some(root) = crate::steam::steam_root() else { return String::new() };
    let Ok(mut file) = File::open(root.join("logs").join(name)) else { return String::new() };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    // O log recomeça quando a Steam reinicia: se encolheu, tudo nele é novo.
    let start = if len < from { 0 } else { from };
    let start = start.max(len.saturating_sub(MAX_TAIL));
    let mut bytes = Vec::new();
    if file.seek(SeekFrom::Start(start)).is_err() || file.read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Estado da abertura do `app_id`, lendo só o que a Steam escreveu depois de `from` (de `log_mark`).
pub fn status(app_id: &str, from: LaunchMark) -> LaunchStatus {
    let mut status = parse(&read_new("console_log.txt", from.console), app_id);
    // A janela de contrato é da interface web da Steam: quando o jogador aceita, ela registra "eulas complete".
    let ui = read_new("webhelper_js.txt", from.ui);
    status.eula_accepted = ui.contains(&format!("eulas complete {app_id}_eula"));
    status.eula = ui
        .lines()
        .filter_map(|line| line.split("prompt for eula ").nth(1))
        .map(|id| id.trim().to_string())
        .rfind(|id| id.starts_with(&format!("{app_id}_eula")));
    status
}

pub(crate) fn find_launch_window(mut identify: impl FnMut(u32) -> Option<()>) -> Option<GameWindow> {
    let foreground = unsafe { GetForegroundWindow() };
    if is_launch_window(foreground) && unsafe { IsIconic(foreground) } == 0 {
        if let Some(window) = GameWindow::from_hwnd(foreground).filter(|w| identify(w.pid).is_some()) {
            return Some(window);
        }
    }
    crate::guide::find_game_window_where(|hwnd, pid| is_launch_window(hwnd).then(|| identify(pid)).flatten())
        .map(|(window, ())| window)
}

fn is_launch_window(hwnd: HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW};
    // Uma caixa pertencente a outra janela ou uma janela auxiliar de splash não confirma o jogo.
    unsafe {
        !hwnd.is_null()
            && IsWindowVisible(hwnd) != 0
            && GetWindow(hwnd, GW_OWNER).is_null()
            && GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) as isize == 0
    }
}

/// Confirma a abertura apenas depois que o Windows deu o primeiro plano à janela do jogo.
pub fn confirm_foreground(main: HWND, ids: &[String]) -> Option<String> {
    for id in ids {
        let window = if let Some(name) = id.strip_prefix("epic:") {
            crate::epic::launch_window(name)
        } else {
            id.parse().ok().and_then(crate::steam::launch_window)
        };
        let Some(window) = window else { continue };
        let Some(hwnd) = window.hwnd() else { continue };
        if !is_launch_window(hwnd) {
            continue;
        }
        // Só pede foco para o jogo quando o próprio launcher está à frente. Respeita outras
        // janelas escolhidas pelo jogador e deixa os pedidos da Steam receberem resposta.
        unsafe {
            let foreground = GetForegroundWindow();
            if foreground == main && !main.is_null() && !crate::guide::blocks_automatic_focus() {
                if IsIconic(hwnd) != 0 {
                    ShowWindowAsync(hwnd, SW_RESTORE);
                }
                SetForegroundWindow(hwnd);
            }
            if GetForegroundWindow() == hwnd && IsIconic(hwnd) == 0 && is_launch_window(hwnd) {
                if id.starts_with("epic:") {
                    crate::epic::launch_confirmed(window.pid);
                }
                let mut last = LAST_DISPATCH.lock().unwrap();
                if last.as_ref().is_some_and(|(game, _)| game == id) {
                    *last = None;
                }
                return Some(id.clone());
            }
        }
    }
    None
}

// ───────── Contrato do jogo ─────────

/// Texto do contrato (a página pública da loja da Steam), no idioma pedido, em texto simples com quebras de linha.
pub fn eula_text(eula_id: &str, lang: &str) -> Result<String, String> {
    let (app, number) = eula_id.split_once("_eula_").ok_or("Contrato inválido.")?;
    let digits = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    if !digits(app) || !digits(number) {
        return Err("Contrato inválido.".into());
    }
    if lang.is_empty() || !lang.chars().all(|c| c.is_ascii_lowercase()) {
        return Err("Idioma inválido.".into());
    }
    let html = crate::steam::http_get(&format!("https://store.steampowered.com/eula/{eula_id}?l={lang}"))?;
    extract_eula(&html).ok_or_else(|| "Não achei o texto do contrato.".to_string())
}

fn extract_eula(html: &str) -> Option<String> {
    let start = html.find("id=\"eula_content\"")?;
    let body = &html[start..];
    let body = &body[body.find('>')? + 1..];
    let body = &body[..body.find("</div>")?];
    let mut text = String::new();
    let mut rest = body;
    while let Some(open) = rest.find('<') {
        text.push_str(&rest[..open]);
        let Some(close) = rest[open..].find('>') else { break };
        let tag = rest[open + 1..open + close].trim().to_ascii_lowercase();
        if tag.starts_with("br") || tag.starts_with("/p") || tag.starts_with("/li") || tag.starts_with("/h") {
            text.push('\n');
        }
        rest = &rest[open + close + 1..];
    }
    text.push_str(rest);
    let text = text
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    // No máximo uma linha em branco seguida.
    let mut out = String::new();
    let mut blank = 0;
    for line in text.lines().map(str::trim) {
        if line.is_empty() {
            blank += 1;
            if blank == 1 && !out.is_empty() {
                out.push('\n');
            }
        } else {
            blank = 0;
            out.push_str(line);
            out.push('\n');
        }
    }
    let out = out.trim().to_string();
    (!out.is_empty()).then_some(out)
}

/// Onde está o botão azul "Aceitar" na janela da Steam (coordenadas da tela), se o contrato estiver aberto nela.
fn find_accept_button() -> Result<(i32, i32), String> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let hwnd = crate::steam::main_window();
    if hwnd == 0 {
        return Err("Não achei a janela da Steam.".into());
    }
    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    // SAFETY: a janela foi encontrada agora há pouco e o retângulo é uma estrutura válida.
    if unsafe { GetWindowRect(hwnd as _, &mut rect) } == 0 {
        return Err("Não consegui medir a janela da Steam.".into());
    }

    // Procura o botão azul "Aceitar" na metade de baixo, do lado direito do centro da janela (onde a caixa do contrato
    // o deixa), sem depender da escala da tela, e clica no meio dele. Só o botão é azul vivo: o resto da janela está
    // escurecido atrás do contrato.
    let (cx, cy) = ((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
    let (mut sum_x, mut sum_y, mut count) = (0i64, 0i64, 0i64);
    // SAFETY: lê pixels da tela com o contexto de dispositivo da área de trabalho e o libera em seguida.
    unsafe {
        let dc = GetDC(std::ptr::null_mut());
        let mut py = cy;
        while py < rect.bottom {
            let mut px = cx;
            while px < rect.right {
                let color = GetPixel(dc, px, py);
                if color != 0xFFFF_FFFF {
                    let (r, g, b) = ((color & 0xFF) as i32, ((color >> 8) & 0xFF) as i32, ((color >> 16) & 0xFF) as i32);
                    // O azul do botão: pouco vermelho, verde médio, azul alto.
                    if b >= 200 && r <= 90 && (90..=200).contains(&g) && b >= r + 100 {
                        sum_x += px as i64;
                        sum_y += py as i64;
                        count += 1;
                    }
                }
                px += 3;
            }
            py += 3;
        }
        ReleaseDC(std::ptr::null_mut(), dc);
    }
    // Um botão de uns 120x32 px lido de 3 em 3 dá centenas de amostras: poucas não é o botão.
    if count < 60 {
        return Err("Não achei o botão Aceitar na janela da Steam.".into());
    }
    Ok(((sum_x / count) as i32, (sum_y / count) as i32))
}

/// Coloca o cursor sobre o botão azul "Aceitar" da janela da Steam (espera a caixa aparecer por alguns instantes).
/// Não clica: quem aceita é o jogador, com o botão A do controle.
pub fn aim_at_accept_button() {
    use windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos;
    for _ in 0..8 {
        std::thread::sleep(std::time::Duration::from_millis(350));
        if let Ok((x, y)) = find_accept_button() {
            // SAFETY: coordenadas de tela válidas.
            unsafe { SetCursorPos(x, y) };
            return;
        }
    }
}

/// O jogador aceitou o contrato na tela do launcher: traz a janela da Steam à frente por um instante, clica em "Aceitar"
/// e devolve o cursor ao lugar. Só vale com o contrato aberto na Steam.
pub fn accept_in_steam() -> Result<(), String> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

    crate::hide::show_steam_prompt();
    std::thread::sleep(std::time::Duration::from_millis(900));
    let (x, y) = find_accept_button()?;

    let mut previous = POINT { x: 0, y: 0 };
    // SAFETY: estruturas e coordenadas válidas; o cursor volta ao lugar depois do clique.
    unsafe {
        GetCursorPos(&mut previous);
        SetCursorPos(x, y);
    }
    std::thread::sleep(std::time::Duration::from_millis(80));
    crate::pointer::click_left();
    std::thread::sleep(std::time::Duration::from_millis(150));
    // SAFETY: idem acima.
    unsafe { SetCursorPos(previous.x, previous.y) };
    Ok(())
}

/// Lê as linhas `GameAction [AppID n, ActionID m] : LaunchApp ...` do jogo e resume a abertura mais recente.
fn parse(text: &str, app_id: &str) -> LaunchStatus {
    let marker = format!("GameAction [AppID {app_id}, ActionID ");
    let mut status = LaunchStatus::default();
    let mut action: Option<&str> = None;
    for line in text.lines() {
        let Some(at) = line.find(&marker) else { continue };
        let rest = &line[at + marker.len()..];
        let Some((id, event)) = rest.split_once("] : LaunchApp ") else { continue };
        // Outra abertura (mais nova) do mesmo jogo: recomeça.
        if action != Some(id) {
            action = Some(id);
            status = LaunchStatus { found: true, ..LaunchStatus::default() };
        }
        if let Some(task) = event.strip_prefix("changed task to ") {
            let task = task.split(' ').next().unwrap_or("").to_string();
            status.completed = task == "Completed";
            status.waiting_user = false;
            status.task = task;
        } else if event.starts_with("waiting for user response to ") {
            status.waiting_user = true;
        } else if event.starts_with("continues with user response") {
            status.waiting_user = false;
        } else if let Some(error) = event.strip_prefix("failed with ") {
            status.failed = Some(error.split(' ').next().unwrap_or("").to_string());
            status.waiting_user = false;
        }
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requer um jogo Steam ou Epic já em execução; o teste nunca inicia um processo"]
    fn recusa_abertura_com_jogo_em_execucao() {
        assert!(crate::steam::has_game_process() || crate::epic::has_game_process());
        for id in ["0", "epic:test"] {
            let result = start_game(id.to_string(), false, || panic!("o comando deveria ser bloqueado"));
            assert_eq!(result.unwrap_err(), GAME_OPEN);
        }
    }

    const LOG: &str = r#"[2026-11-22 22:31:31] GameAction [AppID 413150, ActionID 13] : LaunchApp changed task to ShowInterstitials with ""
[2026-11-22 22:31:32] GameAction [AppID 413150, ActionID 13] : LaunchApp changed task to Completed with ""
[2026-11-22 23:05:51] GameAction [AppID 292030, ActionID 14] : LaunchApp changed task to ShowEula with ""
[2026-11-22 23:05:51] GameAction [AppID 292030, ActionID 14] : LaunchApp waiting for user response to ShowEula ""
"#;

    #[test]
    fn extrai_o_texto_do_contrato() {
        let html = r#"<div class="x"><div class="block_content" id="eula_content"><b>CONTRATO</b><br><br>Ola 1 &amp; 2<br>Fim</div></div>"#;
        let text = extract_eula(html).unwrap();
        assert!(text.starts_with("CONTRATO\n\nOla") && text.ends_with("Fim"), "{text:?}");
        assert!(text.contains("1 & 2"));
    }

    #[test]
    fn recusa_contrato_invalido() {
        assert!(eula_text("abc", "brazilian").is_err());
        assert!(eula_text("292030_eula_0&x=1", "brazilian").is_err());
        assert!(eula_text("292030_eula_0", "pt-br").is_err());
    }

    /// Com o contrato aberto na Steam e a janela dela visível: mostra onde o botão Aceitar foi achado (não clica).
    #[test]
    #[ignore]
    fn acha_o_botao_aceitar_sem_clicar() {
        println!("botão Aceitar: {:?}", find_accept_button());
    }

    #[test]
    fn espera_o_contrato() {
        let s = parse(LOG, "292030");
        assert!(s.found && s.waiting_user && !s.completed);
        assert_eq!(s.task, "ShowEula");
    }

    #[test]
    fn jogo_aberto_com_sucesso() {
        let s = parse(LOG, "413150");
        assert!(s.completed && !s.waiting_user);
    }

    #[test]
    fn resposta_do_jogador_libera_a_etapa() {
        let log = format!("{LOG}[x] GameAction [AppID 292030, ActionID 14] : LaunchApp continues with user response \"ShowEula\"\n");
        assert!(!parse(&log, "292030").waiting_user);
    }

    #[test]
    fn nova_abertura_substitui_a_anterior_e_erro_e_lido() {
        let log = format!(
            "{LOG}[x] GameAction [AppID 292030, ActionID 15] : LaunchApp changed task to RunningInstallScript with \"\"\n[x] GameAction [AppID 292030, ActionID 15] : LaunchApp failed with AppError_16 with \"\"\n"
        );
        let s = parse(&log, "292030");
        assert_eq!(s.task, "RunningInstallScript");
        assert_eq!(s.failed.as_deref(), Some("AppError_16"));
        assert!(!s.waiting_user);
    }

    #[test]
    fn jogo_sem_registro() {
        assert!(!parse(LOG, "999").found);
    }
}
