//! Captura dos quadros dos jogos pelo ETW (Event Tracing for Windows), o mesmo mecanismo do PresentMon e do Xbox Game Bar.
//!
//! O Windows avisa cada vez que um programa apresenta um quadro (DXGI para DirectX 10, 11 e 12; D3D9 para DirectX 9). Aqui só
//! se contam esses avisos por programa, sem injetar nada no jogo (nada de DLL no processo do jogo, então não mexe em
//! antitrapaça). Criar a sessão de captura exige ser administrador ou membro do grupo "Performance Log Users" do Windows:
//! sem isso o estado é `Denied` e a interface explica como liberar (um clique, com a confirmação do Windows).
//!
//! Limite conhecido: jogos em Vulkan e OpenGL não passam por esses avisos e não aparecem.

use crate::perf_stats::{FrameStats, FrameSummary};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use windows_sys::core::GUID;
use windows_sys::Win32::System::Diagnostics::Etw::{
    CloseTrace, ControlTraceW, EnableTraceEx2, OpenTraceW, ProcessTrace, StartTraceW, EVENT_CONTROL_CODE_ENABLE_PROVIDER, EVENT_RECORD, EVENT_TRACE_CONTROL_STOP,
    CONTROLTRACE_HANDLE, EVENT_TRACE_LOGFILEW, EVENT_TRACE_PROPERTIES, EVENT_TRACE_REAL_TIME_MODE, PROCESS_TRACE_MODE_EVENT_RECORD, PROCESS_TRACE_MODE_RAW_TIMESTAMP, PROCESS_TRACE_MODE_REAL_TIME,
    TRACE_LEVEL_VERBOSE, WNODE_FLAG_TRACED_GUID,
};
use windows_sys::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

const SESSION_NAME: &str = "LauncherFpsCapture";
const ERROR_ACCESS_DENIED: u32 = 5;
const ERROR_ALREADY_EXISTS: u32 = 183;
/// Microsoft-Windows-DXGI: evento 42 = Present_Start.
const DXGI: GUID = GUID::from_u128(0xCA11C036_0102_4A2D_A6AD_F03CFED5D3C9);
/// Microsoft-Windows-D3D9: evento 1 = Present_Start.
const D3D9: GUID = GUID::from_u128(0x783ACA0A_790E_4D7F_8451_AA850511C6B9);
const DXGI_PRESENT_START: u16 = 42;
const D3D9_PRESENT_START: u16 = 1;
/// Programas sem quadros há tanto tempo saem da lista.
const FORGET_AFTER: Duration = Duration::from_secs(15);
/// Depois que o jogo some das leituras, o contador espera isto antes de sair da tela.
const GAME_GRACE: Duration = Duration::from_secs(3);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state", content = "message")]
pub enum CaptureStatus {
    /// Desligada.
    Idle,
    Starting,
    /// Capturando.
    Running,
    /// Sem permissão do Windows para criar a sessão (falta o grupo "Performance Log Users" ou o administrador).
    Denied,
    Failed(String),
}

struct Pid {
    stats: FrameStats,
    last_frame: Instant,
}

struct State {
    status: CaptureStatus,
    /// Quadros por programa (PID do Windows).
    pids: HashMap<u32, Pid>,
    /// Nome (minúsculas) do programa de cada PID, lido uma vez.
    names: HashMap<u32, String>,
    /// Handle da sessão, para pará-la.
    session: u64,
    /// Número da execução: uma thread antiga não mexe no estado de uma nova.
    run: u64,
    /// Programa medido na última leitura: continua sendo o escolhido enquanto apresentar quadros (sem isso, dois programas
    /// com FPS parecido se revezavam a cada leitura e o contador "piscava" entre eles).
    chosen: u32,
    /// Último instante em que havia um jogo: o contador some só depois de uma pausa (carregamento, alt-tab), não num instante.
    last_game: Option<(GameFrames, Instant)>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State { status: CaptureStatus::Idle, pids: HashMap::new(), names: HashMap::new(), session: 0, run: 0, chosen: 0, last_game: None }));
static QPC_FREQ: AtomicU64 = AtomicU64::new(0);

fn same(a: &GUID, b: &GUID) -> bool {
    a.data1 == b.data1 && a.data2 == b.data2 && a.data3 == b.data3 && a.data4 == b.data4
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn qpc_freq() -> f64 {
    let mut freq = QPC_FREQ.load(Ordering::Relaxed);
    if freq == 0 {
        let mut value = 0i64;
        // SAFETY: ponteiro para uma variável local.
        unsafe { QueryPerformanceFrequency(&mut value) };
        freq = value.max(1) as u64;
        QPC_FREQ.store(freq, Ordering::Relaxed);
    }
    freq as f64
}

fn qpc_ms(ticks: i64) -> f64 {
    ticks as f64 * 1000.0 / qpc_freq()
}

fn now_ms() -> f64 {
    let mut ticks = 0i64;
    // SAFETY: ponteiro para uma variável local.
    unsafe { QueryPerformanceCounter(&mut ticks) };
    qpc_ms(ticks)
}

pub fn status() -> CaptureStatus {
    STATE.lock().unwrap().status.clone()
}

/// Um quadro apresentado pelo programa `pid` no instante `ticks` (QPC).
fn record_frame(pid: u32, ticks: i64) {
    let mut state = STATE.lock().unwrap();
    let entry = state.pids.entry(pid).or_insert_with(|| Pid { stats: FrameStats::default(), last_frame: Instant::now() });
    entry.stats.push(qpc_ms(ticks));
    entry.last_frame = Instant::now();
}

unsafe extern "system" fn on_event(record: *mut EVENT_RECORD) {
    let header = &(*record).EventHeader;
    let id = header.EventDescriptor.Id;
    let provider = header.ProviderId;
    if (id == DXGI_PRESENT_START && same(&provider, &DXGI)) || (id == D3D9_PRESENT_START && same(&provider, &D3D9)) {
        record_frame(header.ProcessId, header.TimeStamp);
    }
}

/// Liga a captura (em segundo plano). Sem efeito se já estiver ligada.
pub fn start() {
    let run = {
        let mut state = STATE.lock().unwrap();
        if matches!(state.status, CaptureStatus::Starting | CaptureStatus::Running) {
            return;
        }
        state.status = CaptureStatus::Starting;
        state.pids.clear();
        state.run += 1;
        state.run
    };
    std::thread::spawn(move || {
        let outcome = unsafe { capture(run) };
        let mut state = STATE.lock().unwrap();
        if state.run == run {
            state.session = 0;
            // Uma captura que terminou sozinha com erro mantém o erro; parada pelo jogador volta a "desligada".
            if matches!(state.status, CaptureStatus::Starting | CaptureStatus::Running) {
                state.status = match outcome {
                    Ok(()) => CaptureStatus::Idle,
                    Err(status) => status,
                };
            }
        }
    });
}

/// Desliga a captura e esquece os quadros.
pub fn stop() {
    let session = {
        let mut state = STATE.lock().unwrap();
        state.status = CaptureStatus::Idle;
        state.pids.clear();
        std::mem::take(&mut state.session)
    };
    if session != 0 {
        // SAFETY: handle da sessão criada por `capture`; as propriedades só precisam do tamanho certo.
        unsafe {
            let mut props = properties();
            ControlTraceW(CONTROLTRACE_HANDLE { Value: session }, std::ptr::null(), props.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES, EVENT_TRACE_CONTROL_STOP);
        }
    }
}

/// Buffer com as propriedades da sessão seguidas do nome dela (a API exige o nome logo depois da estrutura).
fn properties() -> Vec<u64> {
    let name = wide(SESSION_NAME);
    let header = std::mem::size_of::<EVENT_TRACE_PROPERTIES>();
    let total = header + name.len() * 2;
    let mut buffer = vec![0u64; total.div_ceil(8)];
    // SAFETY: o buffer tem o tamanho da estrutura mais o nome; os campos são só números.
    unsafe {
        let props = buffer.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES;
        (*props).Wnode.BufferSize = total as u32;
        (*props).Wnode.Flags = WNODE_FLAG_TRACED_GUID;
        // 1 = instantes em QPC, o mesmo relógio de `QueryPerformanceCounter`.
        (*props).Wnode.ClientContext = 1;
        (*props).LogFileMode = EVENT_TRACE_REAL_TIME_MODE;
        // Buffers pequenos enchem rápido e são entregues logo: com 64 KB os avisos chegavam em lotes de até 1 s e o FPS lido saía errado.
        (*props).BufferSize = 4;
        (*props).MinimumBuffers = 16;
        (*props).MaximumBuffers = 128;
        (*props).FlushTimer = 1;
        (*props).LoggerNameOffset = header as u32;
        std::ptr::copy_nonoverlapping(name.as_ptr(), (buffer.as_mut_ptr() as *mut u8).add(header) as *mut u16, name.len());
    }
    buffer
}

unsafe fn capture(run: u64) -> Result<(), CaptureStatus> {
    let name = wide(SESSION_NAME);
    let mut buffer = properties();
    let mut session = CONTROLTRACE_HANDLE { Value: 0 };
    let mut code = StartTraceW(&mut session, name.as_ptr(), buffer.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES);
    if code == ERROR_ALREADY_EXISTS {
        // Sobrou uma sessão de uma execução anterior (o launcher fechou à força): para e tenta de novo.
        let mut old = properties();
        ControlTraceW(CONTROLTRACE_HANDLE { Value: 0 }, name.as_ptr(), old.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES, EVENT_TRACE_CONTROL_STOP);
        buffer = properties();
        code = StartTraceW(&mut session, name.as_ptr(), buffer.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES);
    }
    match code {
        0 => {}
        ERROR_ACCESS_DENIED => return Err(CaptureStatus::Denied),
        other => return Err(CaptureStatus::Failed(format!("Não consegui iniciar a captura de quadros (erro {other}).")))
    }
    {
        let mut state = STATE.lock().unwrap();
        if state.run != run {
            // Desligada enquanto ainda começava.
            drop(state);
            ControlTraceW(session, std::ptr::null(), buffer.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES, EVENT_TRACE_CONTROL_STOP);
            return Ok(());
        }
        state.session = session.Value;
        state.status = CaptureStatus::Running;
    }
    for provider in [&DXGI, &D3D9] {
        let result = EnableTraceEx2(session, provider, EVENT_CONTROL_CODE_ENABLE_PROVIDER, TRACE_LEVEL_VERBOSE as u8, u64::MAX, 0, 0, std::ptr::null());
        if result != 0 {
            ControlTraceW(session, std::ptr::null(), buffer.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES, EVENT_TRACE_CONTROL_STOP);
            return Err(CaptureStatus::Failed(format!("Não consegui ligar os avisos de quadros (erro {result}).")));
        }
    }

    let mut logger = wide(SESSION_NAME);
    let mut logfile: EVENT_TRACE_LOGFILEW = std::mem::zeroed();
    logfile.LoggerName = logger.as_mut_ptr();
    logfile.Anonymous1.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD | PROCESS_TRACE_MODE_RAW_TIMESTAMP;
    logfile.Anonymous2.EventRecordCallback = Some(on_event);
    let handle = OpenTraceW(&mut logfile);
    if handle.Value == u64::MAX {
        ControlTraceW(session, std::ptr::null(), buffer.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES, EVENT_TRACE_CONTROL_STOP);
        return Err(CaptureStatus::Failed("Não consegui abrir a captura de quadros.".into()));
    }
    // Bloqueia até a sessão ser parada (`stop`).
    ProcessTrace(&handle, 1, std::ptr::null(), std::ptr::null());
    CloseTrace(handle);
    ControlTraceW(session, std::ptr::null(), buffer.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES, EVENT_TRACE_CONTROL_STOP);
    Ok(())
}

// ───────── Qual programa é o jogo ─────────

/// Programas que apresentam quadros mas não são o jogo (o próprio Windows, navegadores embutidos, o launcher).
fn is_ignored(name: &str) -> bool {
    matches!(
        name,
        "dwm.exe"
            | "explorer.exe"
            | "searchhost.exe"
            | "searchapp.exe"
            | "startmenuexperiencehost.exe"
            | "shellexperiencehost.exe"
            | "textinputhost.exe"
            | "applicationframehost.exe"
            | "widgets.exe"
            | "lockapp.exe"
            | "systemsettings.exe"
            | "msedgewebview2.exe"
            | "msedge.exe"
            | "chrome.exe"
            | "firefox.exe"
            | "steamwebhelper.exe"
            | "gameoverlayui.exe"
            | "discord.exe"
            | "obs64.exe"
            | "nvidia overlay.exe"
            | "nvidia share.exe"
            | "launcher.exe"
            | "taskmgr.exe"
            | "steam.exe"
            | "epicgameslauncher.exe"
            | "epicwebhelper.exe"
            | "eadesktop.exe"
            | "upc.exe"
    )
}

/// O programa está numa pasta onde as lojas instalam jogos?
fn in_game_folder(path: &str) -> bool {
    [
        "\\steamapps\\common\\",
        "\\epic games\\",
        "\\xboxgames\\",
        "\\gog galaxy\\games\\",
        "\\gog games\\",
        "\\ea games\\",
        "\\origin games\\",
        "\\ubisoft game launcher\\games\\",
        "\\riot games\\",
        "\\rockstar games\\",
    ]
    .iter()
    .any(|folder| path.contains(folder))
}

/// A janela da frente é deste programa e cobre o monitor inteiro (tela cheia ou janela sem bordas)? É o que distingue um jogo
/// instalado fora das pastas das lojas de um programa qualquer que também apresenta quadros (que não cobre a barra de tarefas).
fn fills_screen(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId};
    // SAFETY: só consulta a janela da frente e o monitor dela; as estruturas são locais.
    unsafe {
        let window = GetForegroundWindow();
        let mut owner = 0;
        GetWindowThreadProcessId(window, &mut owner);
        if owner != pid {
            return false;
        }
        let mut rect: RECT = std::mem::zeroed();
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetWindowRect(window, &mut rect) == 0 || GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &mut info) == 0 {
            return false;
        }
        let screen = info.rcMonitor;
        rect.left <= screen.left && rect.top <= screen.top && rect.right >= screen.right && rect.bottom >= screen.bottom
    }
}

fn file_name(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

/// Caminho completo do programa, em minúsculas (vazio se o Windows não informar).
fn process_path(pid: u32) -> String {
    crate::hide::process_image(pid).map(|image| image.to_string().to_lowercase()).unwrap_or_default()
}

/// O programa da janela da frente é o próprio launcher (o jogo está aberto, mas o jogador está no Início, nas Configurações ou no Guia)?
pub fn launcher_in_front() -> bool {
    foreground_pid() == std::process::id()
}

fn foreground_pid() -> u32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    let mut pid = 0;
    // SAFETY: só consulta a janela da frente.
    unsafe { GetWindowThreadProcessId(GetForegroundWindow(), &mut pid) };
    pid
}

/// O jogo medido agora: o programa em primeiro plano que apresenta quadros; senão o que mais apresenta.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameFrames {
    pub pid: u32,
    /// Nome do programa ("eldenring.exe").
    pub process: String,
    pub summary: FrameSummary,
}

pub fn current_game() -> Option<GameFrames> {
    let now = now_ms();
    let own = std::process::id();
    let foreground = foreground_pid();
    let mut state = STATE.lock().unwrap();
    state.pids.retain(|_, p| p.last_frame.elapsed() < FORGET_AFTER);
    let pids: Vec<u32> = state.pids.keys().cloned().collect();
    let mut best: Option<(u32, FrameSummary)> = None;
    for pid in pids {
        if pid == own || pid == 0 {
            continue;
        }
        let path = state.names.entry(pid).or_insert_with(|| process_path(pid)).clone();
        if is_ignored(file_name(&path)) {
            continue;
        }
        // Só jogos: um programa comum (o editor, um assistente...) também apresenta quadros e não pode ligar o contador.
        if !in_game_folder(&path) && !fills_screen(pid) {
            continue;
        }
        let summary = state.pids[&pid].stats.summary(now);
        // Só vale quem apresenta quadros de verdade agora (descarta um programa que só deu um ou outro quadro).
        if summary.fps < 5.0 {
            continue;
        }
        let better = match &best {
            None => true,
            Some((best_pid, best_summary)) => {
                if pid == foreground && *best_pid != foreground {
                    true
                } else if *best_pid == foreground || pid == *best_pid {
                    false
                } else if pid == state.chosen {
                    // Empate de quem não está na frente: fica com o que já vinha sendo medido.
                    summary.fps * 1.5 >= best_summary.fps
                } else if *best_pid == state.chosen {
                    summary.fps > best_summary.fps * 1.5
                } else {
                    summary.fps > best_summary.fps
                }
            }
        };
        if better {
            best = Some((pid, summary));
        }
    }
    let now_game = best.map(|(pid, summary)| GameFrames { process: state.names.get(&pid).map(|path| file_name(path).to_string()).unwrap_or_default(), pid, summary });
    match &now_game {
        Some(game) => {
            if state.chosen != game.pid {
                crate::guide::log(&format!("contador de FPS: medindo {} (pid {}, {:.0} FPS)", game.process, game.pid, game.summary.fps));
                state.chosen = game.pid;
            }
            state.last_game = Some((game.clone(), Instant::now()));
            now_game
        }
        None => {
            // Uma pausa curta nos quadros (tela de carregamento, alt-tab) não tira o contador da tela.
            match &state.last_game {
                Some((game, at)) if at.elapsed() < GAME_GRACE => Some(game.clone()),
                _ => {
                    if state.chosen != 0 {
                        crate::guide::log("contador de FPS: nenhum jogo medido");
                        state.chosen = 0;
                    }
                    None
                }
            }
        }
    }
}

// ───────── Permissão ─────────

/// O usuário atual já está no grupo "Performance Log Users"? (A associação só vale numa sessão nova do Windows.)
pub fn is_member() -> bool {
    use std::os::windows::process::CommandExt;
    let user = std::env::var("USERNAME").unwrap_or_default().to_lowercase();
    if user.is_empty() {
        return false;
    }
    // O nome do grupo é o mesmo em qualquer idioma do Windows? Não: pergunta pelo identificador (S-1-5-32-559).
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "(Get-LocalGroupMember -SID S-1-5-32-559 -ErrorAction SilentlyContinue).Name"])
        .creation_flags(0x0800_0000)
        .output();
    output.is_ok_and(|out| String::from_utf8_lossy(&out.stdout).lines().any(|line| line.trim().to_lowercase().ends_with(&format!("\\{user}"))))
}

/// Pede ao Windows (com a confirmação de administrador) para colocar o usuário no grupo "Performance Log Users".
pub fn grant_permission() -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;
    let user = std::env::var("USERNAME").map_err(|_| "Não descobri o nome do usuário.".to_string())?;
    let domain = std::env::var("USERDOMAIN").unwrap_or_default();
    let account = if domain.is_empty() { user } else { format!("{domain}\\{user}") };
    if !account.chars().all(|c| c.is_alphanumeric() || matches!(c, '\\' | '-' | '_' | '.' | ' ')) {
        return Err("O nome do usuário tem caracteres que não consigo repassar com segurança.".into());
    }
    // Pelo identificador do grupo (S-1-5-32-559), que não muda com o idioma do Windows.
    let parameters = format!("-NoProfile -NonInteractive -WindowStyle Hidden -Command \"Add-LocalGroupMember -SID S-1-5-32-559 -Member '{account}'\"");
    let (verb, file, params) = (wide("runas"), wide("powershell.exe"), wide(&parameters));
    // SAFETY: textos terminados em zero que vivem até o fim da chamada.
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), params.as_ptr(), std::ptr::null(), SW_HIDE) } as usize;
    if result > 32 {
        Ok(())
    } else {
        Err("O Windows não abriu a confirmação de administrador (ou ela foi recusada).".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconhece_pastas_de_jogos() {
        assert!(in_game_folder(r"d:\steamlibrary\steamapps\common\the witcher 3\bin\x64\witcher3.exe"));
        assert!(in_game_folder(r"c:\users\x\epic games\absolutedrift\absolutedrift.exe"));
        assert!(!in_game_folder(r"c:\users\x\appdata\local\anthropicclaude\claude.exe"));
        assert_eq!(file_name(r"c:\jogos\madmax.exe"), "madmax.exe");
    }

    #[test]
    fn ignora_o_que_nao_e_jogo() {
        assert!(is_ignored("dwm.exe"));
        assert!(is_ignored("msedgewebview2.exe"));
        assert!(!is_ignored("eldenring.exe"));
    }

    #[test]
    fn guids_dos_provedores() {
        assert!(same(&DXGI, &GUID::from_u128(0xca11c036_0102_4a2d_a6ad_f03cfed5d3c9)));
        assert_eq!(D3D9.data1, 0x783aca0a);
    }

    #[test]
    fn propriedades_da_sessao_tem_o_nome_depois_da_estrutura() {
        let buffer = properties();
        let header = std::mem::size_of::<EVENT_TRACE_PROPERTIES>();
        // SAFETY: lê dentro do buffer criado por `properties`.
        let (offset, name) = unsafe {
            let props = buffer.as_ptr() as *const EVENT_TRACE_PROPERTIES;
            let name = std::slice::from_raw_parts((buffer.as_ptr() as *const u8).add(header) as *const u16, SESSION_NAME.len());
            ((*props).LoggerNameOffset as usize, String::from_utf16_lossy(name))
        };
        assert_eq!(offset, header);
        assert_eq!(name, SESSION_NAME);
    }

    #[test]
    #[ignore = "tenta criar a sessão de captura (precisa de administrador ou do grupo Performance Log Users)"]
    fn captura_real() {
        start();
        std::thread::sleep(Duration::from_secs(3));
        println!("estado: {:?}", status());
        let game = current_game();
        println!("jogo: {game:?}");
        stop();
    }
}
