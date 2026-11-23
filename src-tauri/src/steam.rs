//! Leitura da instalação local da Steam: bibliotecas, jogos instalados, conta logada, jogo em
//! execução e lista de jogos da conta. Tudo somente leitura — a Steam continua dona dos arquivos.

use serde::Serialize;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
use windows_sys::Win32::System::Threading::{GetExitCodeProcess, GetProcessIoCounters, GetProcessTimes, OpenProcess, IO_COUNTERS, PROCESS_QUERY_LIMITED_INFORMATION};
use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, IsIconic, IsWindowVisible, ShowWindow, SW_SHOWMINNOACTIVE};
#[cfg(test)]
use windows_sys::Win32::UI::WindowsAndMessaging::SW_RESTORE;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ───────────────────────── Parser de VDF/ACF ─────────────────────────
// Formato de texto da Valve: "chave" "valor" ou "chave" { ... }.

#[derive(Debug, Clone, PartialEq)]
pub enum Vdf {
    Str(String),
    Map(Vec<(String, Vdf)>),
}

impl Vdf {
    /// Busca um filho pelo nome (sem diferenciar maiúsculas de minúsculas).
    pub fn get(&self, key: &str) -> Option<&Vdf> {
        match self {
            Vdf::Map(items) => items.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v),
            Vdf::Str(_) => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Vdf::Str(s) => Some(s),
            Vdf::Map(_) => None,
        }
    }

    pub fn str_of(&self, key: &str) -> Option<&str> {
        self.get(key)?.as_str()
    }

    /// Valor numérico do filho `key` (0 se não existir ou não for número).
    pub fn num_of(&self, key: &str) -> u64 {
        self.str_of(key).and_then(|s| s.trim().parse().ok()).unwrap_or(0)
    }

    pub fn entries(&self) -> &[(String, Vdf)] {
        match self {
            Vdf::Map(items) => items,
            Vdf::Str(_) => &[],
        }
    }
}

enum Tok {
    Str(String),
    Open,
    Close,
}

fn tokenize(text: &str) -> Vec<Tok> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '{' {
            out.push(Tok::Open);
            i += 1;
        } else if c == '}' {
            out.push(Tok::Close);
            i += 1;
        } else if c == '"' {
            i += 1;
            let mut s = String::new();
            while i < chars.len() && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    i += 1;
                    s.push(match chars[i] {
                        'n' => '\n',
                        't' => '\t',
                        other => other, // \\ e \" viram \ e "
                    });
                } else {
                    s.push(chars[i]);
                }
                i += 1;
            }
            i += 1;
            out.push(Tok::Str(s));
        } else {
            i += 1;
        }
    }
    out
}

fn parse_map(toks: &[Tok], pos: &mut usize) -> Vec<(String, Vdf)> {
    let mut items = Vec::new();
    while *pos < toks.len() {
        match &toks[*pos] {
            Tok::Close => {
                *pos += 1;
                return items;
            }
            Tok::Open => *pos += 1, // bloco sem nome: ignora
            Tok::Str(key) => {
                *pos += 1;
                match toks.get(*pos) {
                    Some(Tok::Str(value)) => {
                        items.push((key.clone(), Vdf::Str(value.clone())));
                        *pos += 1;
                    }
                    Some(Tok::Open) => {
                        *pos += 1;
                        let sub = parse_map(toks, pos);
                        items.push((key.clone(), Vdf::Map(sub)));
                    }
                    _ => {}
                }
            }
        }
    }
    items
}

pub fn parse_vdf(text: &str) -> Vdf {
    let toks = tokenize(text);
    let mut pos = 0;
    Vdf::Map(parse_map(&toks, &mut pos))
}

// ───────────────────────── Localização da Steam ─────────────────────────

fn steam_key() -> Option<RegKey> {
    RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam").ok()
}

pub fn steam_root() -> Option<PathBuf> {
    let path: String = steam_key()?.get_value("SteamPath").ok()?;
    let path = PathBuf::from(path.replace('/', "\\"));
    path.exists().then_some(path)
}

pub fn steam_exe() -> Option<PathBuf> {
    let exe = steam_root()?.join("steam.exe");
    exe.exists().then_some(exe)
}

// ───────────────────────── Progresso em tempo real ─────────────────────────
// O manifesto do jogo só mostra os bytes baixados no fim, e a Steam reserva a pasta de download
// inteira de uma vez. O que cresce de forma contínua é o total que o processo steam.exe já gravou
// em disco (medido: termina igual ao tamanho a gravar, `BytesToStage`). Não abre janela nenhuma.

/// PID do steam.exe em execução (a própria Steam o registra).
pub fn steam_pid() -> Option<u32> {
    let registered: Option<u32> = steam_key().and_then(|k| k.open_subkey("ActiveProcess").ok()).and_then(|k| k.get_value("pid").ok());
    // O registro pode guardar o PID de outro programa que carregou a Steam (um jogo, por exemplo) ou de um processo
    // que já morreu: só vale se for mesmo o steam.exe. Senão, procura o steam.exe pelo nome.
    if let Some(pid) = registered.filter(|&p| p != 0) {
        if crate::hide::process_image(pid).is_some_and(|image| is_steam_exe(&image)) {
            return Some(pid);
        }
    }
    find_process_by_name("steam.exe")
}

fn is_steam_exe(image: &str) -> bool {
    Path::new(image).file_name().and_then(|n| n.to_str()).is_some_and(|n| n.eq_ignore_ascii_case("steam.exe"))
}

/// PID do primeiro processo com este nome de programa.
fn find_process_by_name(name: &str) -> Option<u32> {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    // SAFETY: percorre o instantâneo de processos com a estrutura corretamente dimensionada e o fecha ao final.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() || snapshot as isize == -1 {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more && found.is_none() {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..len]).eq_ignore_ascii_case(name) {
                found = Some(entry.th32ProcessID);
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        found
    }
}

/// Há quantos segundos o steam.exe está aberto (None = não está).
fn steam_process_age_secs() -> Option<u64> {
    let pid = find_process_by_name("steam.exe")?;
    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    // SAFETY: abre o processo só para consultar os tempos, usa estruturas válidas e fecha o identificador.
    let ok = unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if (handle as usize) == 0 {
            return None;
        }
        let ok = GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user);
        CloseHandle(handle);
        ok
    };
    if ok == 0 {
        return None;
    }
    // FILETIME conta intervalos de 100 ns desde 1601; o Unix, segundos desde 1970.
    let ticks = ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64;
    let created_unix = (ticks / 10_000_000).saturating_sub(11_644_473_600);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(now.saturating_sub(created_unix))
}

/// O processo da Steam registrado em `ActiveProcess\pid` ainda está vivo?
fn steam_alive() -> bool {
    let Some(pid) = steam_pid() else { return false };
    // SAFETY: abre o processo só para consultar o código de saída e fecha o identificador.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if (handle as usize) == 0 {
            return false;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        ok != 0 && code == 259 // STILL_ACTIVE
    }
}

/// Total de bytes que o steam.exe já gravou em disco desde que abriu (contador do Windows, só leitura).
pub fn steam_bytes_written() -> Option<u64> {
    let pid = steam_pid()?;
    // SAFETY: abre o processo só para consultar contadores, lê a estrutura e fecha o identificador.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if (handle as usize) == 0 {
            return None;
        }
        let mut io: IO_COUNTERS = std::mem::zeroed();
        let ok = GetProcessIoCounters(handle, &mut io);
        CloseHandle(handle);
        (ok != 0).then_some(io.WriteTransferCount)
    }
}

// ───────────────────────── Janela da Steam ─────────────────────────
// Ao receber um comando (instalar etc.) a Steam traz a própria janela para a frente. O launcher a
// minimiza em seguida para o jogador não perder o foco. A janela principal tem classe "SDL_app" e título "Steam".

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub(crate) fn main_window() -> usize {
    // SAFETY: chamada simples da API do Windows com strings terminadas em zero que vivem até o fim da chamada.
    unsafe { FindWindowW(wide("SDL_app").as_ptr(), wide("Steam").as_ptr()) as usize }
}

/// Estado da janela principal da Steam: (existe e está visível, está minimizada). Só os testes usam.
#[cfg(test)]
pub fn steam_window_state() -> (bool, bool) {
    let hwnd = main_window();
    if hwnd == 0 {
        return (false, false);
    }
    // SAFETY: o identificador veio de FindWindowW agora há pouco.
    unsafe { (IsWindowVisible(hwnd as _) != 0, IsIconic(hwnd as _) != 0) }
}

/// Minimiza a janela da Steam (sem ativá-la) se ela estiver aberta e visível. Devolve true se minimizou agora.
pub fn minimize_steam_window() -> bool {
    let hwnd = main_window();
    if hwnd == 0 {
        return false;
    }
    // SAFETY: idem acima.
    unsafe {
        if IsWindowVisible(hwnd as _) == 0 || IsIconic(hwnd as _) != 0 {
            return false;
        }
        ShowWindow(hwnd as _, SW_SHOWMINNOACTIVE);
    }
    true
}

/// Restaura a janela da Steam (usado só nos testes, para devolvê-la como estava).
#[cfg(test)]
pub fn restore_steam_window() {
    let hwnd = main_window();
    if hwnd != 0 {
        // SAFETY: idem acima.
        unsafe {
            ShowWindow(hwnd as _, SW_RESTORE);
        }
    }
}

/// Pastas de biblioteca (a da Steam + as adicionadas em outros discos).
pub fn library_paths(root: &Path) -> Vec<PathBuf> {
    let mut paths = vec![root.to_path_buf()];
    if let Ok(text) = fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
        let vdf = parse_vdf(&text);
        if let Some(folders) = vdf.get("libraryfolders") {
            for (_, entry) in folders.entries() {
                if let Some(p) = entry.str_of("path") {
                    let candidate = PathBuf::from(p);
                    let already = paths.iter().any(|x| x.to_string_lossy().eq_ignore_ascii_case(&candidate.to_string_lossy()));
                    if !already {
                        paths.push(candidate);
                    }
                }
            }
        }
    }
    paths
}

// ───────────────────────── Jogos instalados ─────────────────────────

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub app_id: String,
    pub name: String,
    pub size_on_disk: u64,
    /// Bits do estado do app (4 = instalado, 2 = precisa atualizar, 256/512 = baixando...).
    pub state_flags: u64,
    pub bytes_to_download: u64,
    pub bytes_downloaded: u64,
    /// Tamanho total a gravar em disco (descompactado). É a base do progresso em tempo real.
    pub bytes_to_stage: u64,
    pub bytes_staged: u64,
    pub last_updated: u64,
    pub library_path: String,
}

/// Ferramentas que a Steam instala junto e que não são jogos.
fn is_tool(app_id: &str, name: &str) -> bool {
    app_id == "228980"
        || name.starts_with("Proton")
        || name.starts_with("Steam Linux Runtime")
        || name.starts_with("Steamworks Common")
}

pub fn parse_manifest(text: &str, library: &Path) -> Option<InstalledApp> {
    let root = parse_vdf(text);
    let state = root.get("AppState")?;
    let app_id = state.str_of("appid")?.to_string();
    let name = state.str_of("name").unwrap_or("").to_string();
    if app_id.is_empty() || is_tool(&app_id, &name) {
        return None;
    }
    Some(InstalledApp {
        name: if name.is_empty() { format!("App {app_id}") } else { name },
        app_id,
        size_on_disk: state.num_of("SizeOnDisk"),
        state_flags: state.num_of("StateFlags"),
        bytes_to_download: state.num_of("BytesToDownload"),
        bytes_downloaded: state.num_of("BytesDownloaded"),
        bytes_to_stage: state.num_of("BytesToStage"),
        bytes_staged: state.num_of("BytesStaged"),
        last_updated: state.num_of("LastUpdated"),
        library_path: library.to_string_lossy().into_owned(),
    })
}

pub fn scan_installed(root: &Path) -> Vec<InstalledApp> {
    let mut apps = Vec::new();
    for library in library_paths(root) {
        let Ok(dir) = fs::read_dir(library.join("steamapps")) else { continue };
        for entry in dir.flatten() {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !(file_name.starts_with("appmanifest_") && file_name.ends_with(".acf")) {
                continue;
            }
            if let Ok(text) = fs::read_to_string(entry.path()) {
                if let Some(app) = parse_manifest(&text, &library) {
                    apps.push(app);
                }
            }
        }
    }
    apps
}

// ───────────────────────── Conta e estado ─────────────────────────

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SteamInfo {
    pub found: bool,
    pub path: Option<String>,
    /// A Steam está aberta com uma conta logada.
    pub logged_in: bool,
    /// AppID do jogo em execução (0 = nenhum).
    pub running_app_id: u32,
    pub steam_id: Option<String>,
    pub persona_name: Option<String>,
    pub account_name: Option<String>,
}

/// Valor cru de `RunningAppID`. A Steam só o zera quando fecha o jogo com calma: se o PC desliga, trava ou a Steam
/// cai com o jogo aberto, o número fica no registro para sempre e o launcher achava que o jogo ainda rodava.
fn raw_running_app_id() -> u32 {
    let registry = steam_key().and_then(|k| k.get_value::<u32, _>("RunningAppID").ok()).unwrap_or(0);
    if registry != 0 {
        return registry;
    }
    tracked_running_app_id()
}

/// Jogo que a Steam ainda acompanha pelo log de processos, para quando o registro (`RunningAppID`) fica em 0 mesmo com o
/// jogo (ou o iniciador dele, como o REDlauncher do Witcher 3) aberto. Só vale com algum processo acompanhado ainda vivo.
fn tracked_running_app_id() -> u32 {
    use std::io::{Read, Seek, SeekFrom};
    use std::time::{Duration, Instant};
    static CACHE: std::sync::Mutex<Option<(Instant, u32)>> = std::sync::Mutex::new(None);
    if let Some((at, id)) = *CACHE.lock().unwrap() {
        if at.elapsed() < Duration::from_millis(500) {
            return id;
        }
    }
    let id = (|| {
        let root = steam_root()?;
        let mut file = fs::File::open(root.join("logs").join("gameprocess_log.txt")).ok()?;
        let len = file.metadata().ok()?.len();
        let mut bytes = Vec::new();
        file.seek(SeekFrom::Start(len.saturating_sub(64 * 1024))).ok()?;
        file.read_to_end(&mut bytes).ok()?;
        parse_tracked_app(&String::from_utf8_lossy(&bytes), crate::hide::process_alive)
    })()
    .unwrap_or(0);
    *CACHE.lock().unwrap() = Some((Instant::now(), id));
    id
}

/// AppID com algum processo ainda acompanhado e vivo, segundo o final do `gameprocess_log.txt` (o mais recente vence).
fn parse_tracked_app(text: &str, alive: impl Fn(u32) -> bool) -> Option<u32> {
    let number = |rest: &str| rest.split(|c: char| !c.is_ascii_digit()).next().and_then(|n| n.parse::<u32>().ok());
    let mut tracked: Vec<(u32, u32)> = Vec::new(); // (appid, pid), na ordem em que apareceram
    for line in text.lines() {
        if let Some(at) = line.find("AppID ") {
            let rest = &line[at + "AppID ".len()..];
            let Some(app) = number(rest) else { continue };
            let after = &rest[app.to_string().len()..];
            if let Some(pid) = after.strip_prefix(" adding PID ").and_then(number) {
                if !tracked.contains(&(app, pid)) {
                    tracked.push((app, pid));
                }
            } else if let Some(pid) = after.strip_prefix(" no longer tracking PID ").and_then(number) {
                tracked.retain(|t| *t != (app, pid));
            }
        } else if let Some(at) = line.find("Remove ") {
            if let Some(app) = number(&line[at + "Remove ".len()..]).filter(|_| line.contains(" from running list")) {
                tracked.retain(|t| t.0 != app);
            }
        }
    }
    tracked.iter().rev().find(|(_, pid)| alive(*pid)).map(|(app, _)| *app)
}

/// Diretórios do AppID, lidos nos manifestos das bibliotecas da Steam.
pub(crate) fn game_installation_dirs(app_id: u32) -> Vec<PathBuf> {
    let Some(root) = steam_root() else { return Vec::new() };
    let id = app_id.to_string();
    let manifest = format!("appmanifest_{id}.acf");
    let mut paths = Vec::new();
    for library in library_paths(&root) {
        let apps = library.join("steamapps");
        let Ok(text) = fs::read_to_string(apps.join(&manifest)) else { continue };
        let info = parse_vdf(&text);
        let Some(state) = info.get("AppState") else { continue };
        let Some(dir) = state.str_of("installdir").filter(|_| state.str_of("appid") == Some(id.as_str())) else { continue };
        if dir.is_empty() || !Path::new(dir).components().all(|part| matches!(part, std::path::Component::Normal(_))) {
            continue;
        }
        let path = apps.join("common").join(dir);
        if let Ok(resolved) = path.canonicalize() {
            paths.push(windows_path(&resolved.to_string_lossy()));
        }
        paths.push(windows_path(&path.to_string_lossy()));
    }
    paths
}

fn windows_path(path: &str) -> PathBuf {
    let path = path.replace('/', "\\").to_lowercase();
    if let Some(unc) = path.strip_prefix(r"\\?\unc\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    PathBuf::from(path.strip_prefix(r"\\?\").unwrap_or(&path))
}

/// PIDs que a própria Steam acompanha como sendo do jogo em execução (de `logs\gameprocess_log.txt`). Jogos com um
/// iniciador próprio (o REDlauncher do Witcher 3, por exemplo) abrem um programa que fica FORA da pasta do jogo: a Steam
/// o acompanha mesmo assim, e é por ela que o launcher o reconhece.
static TRACKED_PIDS: std::sync::Mutex<Vec<u32>> = std::sync::Mutex::new(Vec::new());

/// Relê o final do log e guarda os PIDs do jogo `app_id` que a Steam ainda acompanha.
fn refresh_tracked_pids(app_id: u32) {
    use std::io::{Read, Seek, SeekFrom};
    let Some(root) = steam_root() else { return };
    let Ok(mut file) = fs::File::open(root.join("logs").join("gameprocess_log.txt")) else { return };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut bytes = Vec::new();
    if file.seek(SeekFrom::Start(len.saturating_sub(64 * 1024))).is_err() || file.read_to_end(&mut bytes).is_err() {
        return;
    }
    *TRACKED_PIDS.lock().unwrap() = parse_tracked_pids(&String::from_utf8_lossy(&bytes), app_id);
}

fn parse_tracked_pids(text: &str, app_id: u32) -> Vec<u32> {
    let adding = format!("AppID {app_id} adding PID ");
    let leaving = format!("AppID {app_id} no longer tracking PID ");
    let number = |rest: &str| rest.split(|c: char| !c.is_ascii_digit()).next().and_then(|n| n.parse::<u32>().ok());
    let mut pids: Vec<u32> = Vec::new();
    for line in text.lines() {
        if let Some(at) = line.find(&adding) {
            if let Some(pid) = number(&line[at + adding.len()..]) {
                if !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
        } else if let Some(at) = line.find(&leaving) {
            if let Some(pid) = number(&line[at + leaving.len()..]) {
                pids.retain(|p| *p != pid);
            }
        }
    }
    pids
}

/// A Steam acompanha este processo como parte do jogo em execução (e ele ainda está vivo)?
pub(crate) fn is_tracked_game_pid(pid: u32) -> bool {
    TRACKED_PIDS.lock().unwrap().contains(&pid) && crate::hide::process_alive(pid)
}

pub(crate) fn matches_game_installation(pid: u32, dirs: &[PathBuf]) -> bool {
    is_tracked_game_pid(pid)
        || crate::hide::process_image(pid).is_some_and(|image| {
            let image = windows_path(&image);
            dirs.iter().any(|dir| image.starts_with(dir))
        })
}

struct RunningCheck {
    id: u32,
    dirs: Vec<PathBuf>,
    dirs_checked: std::time::Instant,
    checked: Option<std::time::Instant>,
    confirmed: Option<crate::guide::GameWindow>,
    /// Processo do jogo que já recebeu o foco ao aparecer (uma vez por janela nova).
    focused_window: usize,
}

static RUNNING_CHECK: std::sync::Mutex<Option<RunningCheck>> = std::sync::Mutex::new(None);

/// O registro pode mudar antes de o jogo abrir. A primeira confirmação exige uma janela do AppID.
pub(crate) fn running_game() -> Option<(u32, crate::guide::GameWindow)> {
    use std::time::{Duration, Instant};

    let raw = raw_running_app_id();
    let now = Instant::now();
    let mut guard = RUNNING_CHECK.lock().unwrap();
    if raw == 0 {
        *guard = None;
        return None;
    }

    if guard.as_ref().is_none_or(|check| check.id != raw) {
        *guard = Some(RunningCheck {
            id: raw,
            dirs: game_installation_dirs(raw),
            dirs_checked: now,
            checked: None,
            confirmed: None,
            focused_window: 0,
        });
    }
    let check = guard.as_mut().unwrap();
    if check.checked.is_none_or(|checked| now.duration_since(checked) >= Duration::from_millis(250)) {
        refresh_tracked_pids(raw);
        if check.dirs.is_empty() && now.duration_since(check.dirs_checked) >= Duration::from_secs(2) {
            check.dirs = game_installation_dirs(raw);
            check.dirs_checked = now;
        }
        // Durante uma troca de modo de vídeo, o processo já confirmado pode recriar sua janela.
        check.confirmed = crate::guide::find_game_window(&check.dirs).or_else(|| {
            check.confirmed.filter(|previous| {
                crate::hide::process_alive(previous.pid) && matches_game_installation(previous.pid, &check.dirs)
            })
        });
        check.checked = Some(now);
        // Uma janela de jogo que acabou de aparecer atrás do launcher (o iniciador de um jogo, por exemplo) vai para a frente.
        if let Some(window) = check.confirmed {
            // Uma vez por janela (não por processo): o iniciador de um jogo costuma abrir uma janela de abertura que ganha
            // o foco sozinha e, depois, a janela principal, que pode nascer atrás do launcher.
            let handle = window.hwnd().map_or(0, |hwnd| hwnd as usize);
            if handle != 0 && handle != check.focused_window {
                check.focused_window = handle;
                bring_game_to_front(window);
            }
        }
    }
    check.confirmed.map(|window| (raw, window))
}

/// Traz a janela do jogo para a frente se quem está na frente é o launcher ou a Steam (um jogo que já ganhou o foco sozinho
/// não é mexido).
fn bring_game_to_front(window: crate::guide::GameWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindow, IsWindowVisible, SetWindowPos, GW_HWNDPREV, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE,
    };
    let Some(hwnd) = window.hwnd() else { return };
    // SAFETY: só consulta a janela em primeiro plano e percorre a ordem das janelas acima da do jogo.
    let (foreground_covers, launcher_above) = unsafe {
        let foreground = GetForegroundWindow();
        let foreground_covers =
            !foreground.is_null() && (crate::hide::is_ours(foreground) || crate::hide::is_steam_foreground(foreground));
        let mut above = GetWindow(hwnd, GW_HWNDPREV);
        let mut launcher_above = false;
        while !above.is_null() {
            if IsWindowVisible(above) != 0 && crate::hide::is_ours(above) {
                launcher_above = true;
                break;
            }
            above = GetWindow(above, GW_HWNDPREV);
        }
        (foreground_covers, launcher_above)
    };
    // O jogo que já ganhou o foco e está acima do launcher não é mexido.
    if !foreground_covers && !launcher_above {
        return;
    }
    let ok = crate::guide::force_foreground(hwnd);
    if !ok {
        // O Windows recusou o foco (outro app está ativo): ao menos põe a janela do jogo acima do launcher.
        // SAFETY: só muda a posição na ordem das janelas, sem mover, redimensionar nem ativar.
        unsafe { SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
    }
}

/// AppID do jogo com abertura confirmada.
pub fn running_app_id() -> u32 {
    running_game().map_or(0, |(app_id, _)| app_id)
}

fn active_user() -> u32 {
    steam_key()
        .and_then(|k| k.open_subkey("ActiveProcess").ok())
        .and_then(|k| k.get_value::<u32, _>("ActiveUser").ok())
        .unwrap_or(0)
}

/// Lê `config/loginusers.vdf` e devolve (steamid64, nome do perfil, nome da conta) da conta mais recente.
pub fn parse_login_user(text: &str) -> Option<(String, String, String)> {
    let vdf = parse_vdf(text);
    let users = vdf.get("users")?;
    let pick = users
        .entries()
        .iter()
        .find(|(_, u)| u.str_of("MostRecent") == Some("1"))
        .or_else(|| users.entries().first())?;
    Some((
        pick.0.clone(),
        pick.1.str_of("PersonaName").unwrap_or("").to_string(),
        pick.1.str_of("AccountName").unwrap_or("").to_string(),
    ))
}

fn process_running(image: &str) -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {image}"), "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains(&image.to_lowercase()))
        .unwrap_or(false)
}

/// Garante que a Steam está rodando e com a conta logada. Se estiver fechada, abre em silêncio (`-silent`: sem
/// janela principal, sem ofertas, sem tela de login), em vez de deixar um `steam://...` abri-la do jeito normal,
/// que mostra o login, as "Ofertas especiais" e a janela principal por cima do launcher.
/// Bloqueia até a Steam ficar pronta (ou o tempo acabar): chame fora da thread da interface.
pub fn ensure_running() -> Result<(), String> {
    // Caminho rápido (o normal): a Steam está logada e o processo dela está vivo. Sem lançar nenhum programa.
    if active_user() != 0 && steam_alive() {
        return Ok(());
    }
    // O registro às vezes fica sem conta (`ActiveUser` 0) com a Steam já aberta e logada: uma Steam aberta há mais de
    // um minuto não precisa ser esperada.
    if steam_process_age_secs().is_some_and(|age| age > 60) {
        return Ok(());
    }
    if !process_running("steam.exe") {
        let exe = steam_exe().ok_or("Steam não encontrada.")?;
        Command::new(exe).arg("-silent").spawn().map_err(|e| format!("Não consegui abrir a Steam: {e}"))?;
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
    while active_user() == 0 {
        if std::time::Instant::now() > deadline {
            return Err("A Steam demorou para abrir. Tente de novo em instantes.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    Ok(())
}

pub fn info() -> SteamInfo {
    let Some(root) = steam_root() else { return SteamInfo::default() };
    let user = fs::read_to_string(root.join("config").join("loginusers.vdf"))
        .ok()
        .and_then(|t| parse_login_user(&t));
    SteamInfo {
        found: true,
        path: Some(root.to_string_lossy().into_owned()),
        // O registro às vezes fica sem conta (`ActiveUser` 0) com a Steam aberta e logada: uma Steam aberta há mais de um
        // minuto conta como logada (o mesmo critério de `ensure_running`).
        logged_in: active_user() != 0 || steam_process_age_secs().is_some_and(|age| age > 60),
        running_app_id: running_app_id(),
        steam_id: user.as_ref().map(|u| u.0.clone()),
        persona_name: user.as_ref().map(|u| u.1.clone()),
        account_name: user.map(|u| u.2),
    }
}

// ───────────────────────── Coleções da Steam ─────────────────────────
// As coleções (Favoritos, Ocultos e as criadas pelo jogador) ficam em
// `userdata/<accountid>/config/cloudstorage/cloud-storage-namespace-1.json`.

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    /// "favorite", "hidden" ou "uc-...".
    pub id: String,
    pub name: String,
    pub app_ids: Vec<String>,
    /// Coleção dinâmica (definida por filtros da Steam, como "suporte a controle"): o arquivo não traz a lista
    /// de jogos, só o filtro (`filter`), que o front-end avalia com os dados de cada jogo (appinfo).
    pub dynamic: bool,
    pub filter: Option<FilterSpec>,
}

/// Um grupo de filtro da Steam: as opções escolhidas e se basta uma delas (união) ou todas (interseção).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilterGroup {
    pub options: Vec<i64>,
    pub accept_union: bool,
}

/// `filterSpec` de uma coleção dinâmica. Grupos: 0 tipo, 1 situação, 2 recursos, 3-4 tags, 5 assinatura, 6 amigos,
/// 7 idiomas, 8 categorias da loja (mesma ordem do cliente da Steam).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilterSpec {
    pub search_text: String,
    pub groups: Vec<FilterGroup>,
}

fn parse_filter_spec(spec: &serde_json::Value) -> FilterSpec {
    let groups = spec
        .get("filterGroups")
        .and_then(|g| g.as_array())
        .map(|groups| {
            groups
                .iter()
                .map(|g| FilterGroup {
                    options: g.get("rgOptions").and_then(|o| o.as_array()).map(|o| o.iter().filter_map(|v| v.as_i64()).collect()).unwrap_or_default(),
                    accept_union: g.get("bAcceptUnion").and_then(|b| b.as_bool()).unwrap_or(false),
                })
                .collect()
        })
        .unwrap_or_default();
    FilterSpec { search_text: spec.get("strSearchText").and_then(|s| s.as_str()).unwrap_or("").to_string(), groups }
}

/// SteamID64 → número da conta (nome da pasta em `userdata`).
pub fn account_id(steam_id: &str) -> Option<u64> {
    steam_id.parse::<u64>().ok()?.checked_sub(76_561_197_960_265_728)
}

/// Lê as coleções do JSON da Steam: uma lista de pares `["user-collections.<id>", { value: "<json>", is_deleted? }]`.
pub fn parse_collections(text: &str) -> Vec<Collection> {
    let Ok(root) = serde_json::from_str::<serde_json::Value>(text) else { return Vec::new() };
    let Some(entries) = root.as_array() else { return Vec::new() };

    let mut out = Vec::new();
    for entry in entries {
        let Some(pair) = entry.as_array() else { continue };
        let Some(key) = pair.first().and_then(|k| k.as_str()) else { continue };
        if !key.starts_with("user-collections.") {
            continue;
        }
        let Some(meta) = pair.get(1) else { continue };
        if meta.get("is_deleted").and_then(|d| d.as_bool()).unwrap_or(false) {
            continue;
        }
        let Some(value) = meta.get("value").and_then(|v| v.as_str()) else { continue };
        let Ok(col) = serde_json::from_str::<serde_json::Value>(value) else { continue };

        let id = col.get("id").and_then(|i| i.as_str()).unwrap_or(&key["user-collections.".len()..]).to_string();
        let name = col.get("name").and_then(|n| n.as_str()).unwrap_or(&id).to_string();
        let ids = |field: &str| -> Vec<String> {
            col.get(field)
                .and_then(|a| a.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_u64().map(|n| n.to_string()).or_else(|| v.as_str().map(String::from))).collect())
                .unwrap_or_default()
        };
        let removed = ids("removed");
        let app_ids = ids("added").into_iter().filter(|a| !removed.contains(a)).collect();
        let filter = col.get("filterSpec").map(parse_filter_spec);
        out.push(Collection { id, name, app_ids, dynamic: filter.is_some(), filter });
    }
    out
}

pub fn read_collections(root: &Path, steam_id: &str) -> Vec<Collection> {
    let Some(account) = account_id(steam_id) else { return Vec::new() };
    let file = root.join("userdata").join(account.to_string()).join("config").join("cloudstorage").join("cloud-storage-namespace-1.json");
    fs::read_to_string(file).map(|t| parse_collections(&t)).unwrap_or_default()
}

// ───────────────────────── Jogos da conta (inclui não instalados) ─────────────────────────

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OwnedGame {
    pub app_id: String,
    pub name: String,
    pub playtime_min: u64,
    /// Unix (segundos). 0 = desconhecido.
    pub last_played: u64,
}

// ───────── Chave da Web API (uma por conta Steam) ─────────
// Fica em `config.json` na pasta de configuração do app: { "accounts": { "<steamid64>": { "apiKey": "..." } } }.
// A variável de ambiente STEAM_API_KEY, se existir, vale para qualquer conta (útil em desenvolvimento).

/// Uma chave da Web API tem 32 caracteres hexadecimais.
pub fn is_valid_key(key: &str) -> bool {
    key.len() == 32 && key.chars().all(|c| c.is_ascii_hexdigit())
}

fn load_config(dir: &Path) -> serde_json::Value {
    fs::read_to_string(dir.join("config.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn save_config(dir: &Path, config: &serde_json::Value) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(dir.join("config.json"), text).map_err(|e| e.to_string())
}

pub fn read_api_key(config_dir: Option<PathBuf>, steam_id: &str) -> Option<String> {
    if let Ok(k) = std::env::var("STEAM_API_KEY") {
        if !k.trim().is_empty() {
            return Some(k.trim().to_string());
        }
    }
    let config = load_config(&config_dir?);
    let key = config.get("accounts")?.get(steam_id)?.get("apiKey")?.as_str()?.trim().to_string();
    (!key.is_empty()).then_some(key)
}

pub fn save_api_key(dir: &Path, steam_id: &str, key: &str) -> Result<(), String> {
    let mut config = load_config(dir);
    if !config.is_object() {
        config = serde_json::json!({});
    }
    config["accounts"][steam_id]["apiKey"] = serde_json::Value::String(key.to_string());
    save_config(dir, &config)
}

pub fn clear_api_key(dir: &Path, steam_id: &str) -> Result<(), String> {
    let mut config = load_config(dir);
    if let Some(accounts) = config.get_mut("accounts").and_then(|a| a.as_object_mut()) {
        accounts.remove(steam_id);
    }
    save_config(dir, &config)
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub configured: bool,
    /// Últimos 4 caracteres, para o jogador reconhecer a chave sem expô-la.
    pub last4: Option<String>,
    /// A chave vem da variável de ambiente (não dá para removê-la pelo app).
    pub from_env: bool,
    /// Quem está logado pelo QR code neste PC (nunca o token). Com sessão, `configured` também é verdadeiro.
    pub session: Option<crate::steam_auth::SessionInfo>,
}

/// Situação da conta: chave de API guardada e/ou login por QR code. A sessão do QR só vale para a conta `steam_id`.
pub fn key_status(config_dir: Option<PathBuf>, steam_id: &str) -> KeyStatus {
    let from_env = std::env::var("STEAM_API_KEY").map(|k| !k.trim().is_empty()).unwrap_or(false);
    let session = config_dir
        .as_deref()
        .and_then(crate::steam_auth::session_info)
        .filter(|s| s.steam_id == steam_id);
    let key = read_api_key(config_dir, steam_id);
    KeyStatus {
        configured: key.is_some() || session.is_some(),
        last4: key.map(|k| k.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect()),
        from_env,
        session,
    }
}

/// Resposta de `IPlayerService/GetOwnedGames` (precisa de chave).
pub fn parse_owned_json(text: &str) -> Result<Vec<OwnedGame>, String> {
    // Chave errada: a Steam responde 403 com uma página HTML ("Forbidden"), não JSON.
    let v: serde_json::Value = serde_json::from_str(text).map_err(|_| "A Steam recusou a chave. Confira se copiou os 32 caracteres inteiros.".to_string())?;
    let games = v
        .get("response")
        .and_then(|r| r.get("games"))
        .and_then(|g| g.as_array())
        .ok_or_else(|| "A Steam não retornou jogos para esta conta. Se o perfil for privado, deixe \"Detalhes do jogo\" como público em Privacidade na Steam e tente de novo.".to_string())?;
    Ok(games
        .iter()
        .filter_map(|g| {
            Some(OwnedGame {
                app_id: g.get("appid")?.as_u64()?.to_string(),
                name: g.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                playtime_min: g.get("playtime_forever").and_then(|p| p.as_u64()).unwrap_or(0),
                last_played: g.get("rtime_last_played").and_then(|p| p.as_u64()).unwrap_or(0),
            })
        })
        .collect())
}

fn tag<'a>(block: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let start = block.find(&open)? + open.len();
    let end = block[start..].find(&close)? + start;
    Some(block[start..end].trim())
}

fn strip_cdata(s: &str) -> &str {
    s.strip_prefix("<![CDATA[").and_then(|x| x.strip_suffix("]]>")).unwrap_or(s)
}

pub const NEEDS_KEY_MESSAGE: &str =
    "A Steam não mostra a lista sem login. Em Configurações › Conta Steam, adicione a chave gratuita da Web API para ler a biblioteca completa.";

/// Perfil público: `steamcommunity.com/profiles/<id>/games?xml=1` (sem chave).
pub fn parse_games_xml(xml: &str) -> Result<Vec<OwnedGame>, String> {
    let mut games = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<game>") {
        let after = &rest[start + "<game>".len()..];
        let Some(end) = after.find("</game>") else { break };
        let block = &after[..end];
        if let Some(app_id) = tag(block, "appID") {
            let hours: f64 = tag(block, "hoursOnRecord").map(|h| h.replace(',', "")).and_then(|h| h.parse().ok()).unwrap_or(0.0);
            games.push(OwnedGame {
                app_id: app_id.to_string(),
                name: tag(block, "name").map(|n| strip_cdata(n).to_string()).unwrap_or_default(),
                playtime_min: (hours * 60.0).round() as u64,
                last_played: 0,
            });
        }
        rest = &after[end + "</game>".len()..];
    }
    if games.is_empty() {
        let reason = tag(xml, "error").map(|e| strip_cdata(e).to_string());
        return Err(match reason {
            Some(r) => format!("A Steam recusou: {r}"),
            // A Steam passou a devolver uma página de login (HTML) quando não pode mostrar a lista.
            None if xml.trim_start().starts_with("<!DOCTYPE html") || xml.contains("Sign In") => NEEDS_KEY_MESSAGE.to_string(),
            None => "Nenhum jogo encontrado no perfil. Use uma chave da Web API para ler a biblioteca completa.".to_string(),
        });
    }
    Ok(games)
}

/// HTTP GET usando o curl.exe que já vem com o Windows 10/11 (evita embutir uma pilha TLS).
pub(crate) fn http_get(url: &str) -> Result<String, String> {
    let out = Command::new("curl.exe")
        .args(["-sS", "-L", "--max-time", "25", url])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Não consegui executar o curl: {e}"))?;
    if !out.status.success() {
        return Err(format!("Falha de rede: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// ───────── Detalhes da loja (descrição, gêneros) ─────────
// O appinfo local não traz o texto de apresentação do jogo; ele vem da API pública da loja (sem chave de conta,
// só o número do app e o idioma). O resultado fica em cache no disco para a página do jogo abrir na hora.

#[derive(Serialize, serde::Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreDetails {
    /// Descrição curta, no idioma pedido, sem HTML.
    pub short_description: String,
    /// Gêneros no idioma pedido ("Indie", "RPG", "Simulação").
    pub genres: Vec<String>,
    /// Data de lançamento como a loja mostra ("26/fev./2016").
    pub release_date: String,
    /// Quando foi buscado (ms desde 1970), para o cache.
    pub fetched_at: u64,
}

/// Tira as etiquetas HTML e converte as entidades mais comuns.
fn clean_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn parse_store_details(json: &str, app_id: &str) -> Result<StoreDetails, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("Resposta da loja ilegível: {e}"))?;
    let entry = v.get(app_id).ok_or("Resposta inesperada da loja.")?;
    if entry.get("success").and_then(|s| s.as_bool()) != Some(true) {
        return Err("A loja não tem dados deste jogo.".into());
    }
    let d = entry.get("data").ok_or("Resposta inesperada da loja.")?;
    let text = |key: &str| d.get(key).and_then(|s| s.as_str()).map(clean_html).unwrap_or_default();
    Ok(StoreDetails {
        short_description: text("short_description"),
        genres: d
            .get("genres")
            .and_then(|g| g.as_array())
            .map(|g| g.iter().filter_map(|x| x.get("description").and_then(|s| s.as_str()).map(String::from)).collect())
            .unwrap_or_default(),
        release_date: d.get("release_date").and_then(|r| r.get("date")).and_then(|s| s.as_str()).unwrap_or("").to_string(),
        fetched_at: 0,
    })
}

const STORE_CACHE_MS: u64 = 14 * 24 * 3600 * 1000;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Detalhes da loja de um jogo, com cache de 14 dias na pasta de configuração do app. Se a rede falhar, usa o
/// cache mesmo vencido.
pub fn store_details(cache_dir: Option<PathBuf>, app_id: &str, lang: &str) -> Result<StoreDetails, String> {
    if app_id.is_empty() || !app_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("AppID inválido.".into());
    }
    if lang.is_empty() || !lang.chars().all(|c| c.is_ascii_lowercase()) {
        return Err("Idioma inválido.".into());
    }
    let file = cache_dir.map(|d| d.join("store").join(format!("{app_id}_{lang}.json")));
    let cached = file.as_ref().and_then(|f| fs::read_to_string(f).ok()).and_then(|t| serde_json::from_str::<StoreDetails>(&t).ok());
    if let Some(c) = &cached {
        if now_ms().saturating_sub(c.fetched_at) < STORE_CACHE_MS {
            return Ok(c.clone());
        }
    }
    let url = format!("https://store.steampowered.com/api/appdetails?appids={app_id}&l={lang}");
    match http_get(&url).and_then(|body| parse_store_details(&body, app_id)) {
        Ok(mut fresh) => {
            fresh.fetched_at = now_ms();
            if let Some(f) = &file {
                if let Some(dir) = f.parent() {
                    let _ = fs::create_dir_all(dir);
                }
                let _ = fs::write(f, serde_json::to_string(&fresh).unwrap_or_default());
            }
            Ok(fresh)
        }
        Err(e) => cached.ok_or(e),
    }
}

pub fn fetch_owned(steam_id: &str, api_key: Option<String>) -> Result<Vec<OwnedGame>, String> {
    if steam_id.is_empty() || !steam_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("SteamID inválido.".into());
    }
    match api_key {
        Some(key) => {
            let url = format!(
                "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={key}&steamid={steam_id}&include_appinfo=1&include_played_free_games=1&format=json"
            );
            parse_owned_json(&http_get(&url)?)
        }
        None => parse_games_xml(&http_get(&format!("https://steamcommunity.com/profiles/{steam_id}/games?xml=1"))?),
    }
}

// ───────────────────────── Testes ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pids_acompanhados_pela_steam() {
        let log = "[2026-11-22 23:51:10] AppID 292030 adding PID 20032 as a tracked process \"REDlauncher.exe\"
[2026-11-22 23:51:30] AppID 111 adding PID 7 as a tracked process \"x\"
[2026-11-22 23:52:00] AppID 292030 adding PID 555 as a tracked process \"witcher3.exe\"
[2026-11-22 23:52:10] AppID 292030 no longer tracking PID 20032, exit code 0
";
        assert_eq!(parse_tracked_pids(log, 292030), vec![555]);
        assert_eq!(parse_tracked_pids(log, 111), vec![7]);
        assert!(parse_tracked_pids(log, 5).is_empty());
    }

    #[test]
    fn jogo_em_execucao_vem_do_log_de_processos_quando_o_registro_esta_zerado() {
        let log = "\
[2026-11-23 09:08:49] AppID 292030 adding PID 23728 as a tracked process \"redprelauncher.exe\"
[2026-11-23 09:11:15] AppID 292030 no longer tracking PID 23728, exit code 0
[2026-11-23 09:11:15] Remove 292030 from running list
[2026-11-23 11:00:49] AppID 292030 adding PID 3836 as a tracked process \"redprelauncher.exe\"
[2026-11-23 11:00:49] AppID 292030 adding PID 5828 as a tracked process \"REDlauncher.exe\"
";
        assert_eq!(parse_tracked_app(log, |pid| pid == 5828), Some(292030));
        assert_eq!(parse_tracked_app(log, |_| false), None);
        let closed = format!("{log}[2026-11-23 11:05:00] Remove 292030 from running list\n");
        assert_eq!(parse_tracked_app(&closed, |_| true), None);
    }

    #[test]
    fn processos_de_jogos_com_prefixos_iguais_ficam_em_instalacoes_distintas() {
        let game = windows_path(r"C:\SteamLibrary\steamapps\common\Stardew Valley");
        let same_game = windows_path(r"\\?\c:\steamlibrary\STEAMAPPS\COMMON\stardew valley\Stardew Valley.exe");
        let other_game = windows_path(r"C:\SteamLibrary\steamapps\common\Stardew Valley Example\other.exe");

        assert!(same_game.starts_with(&game));
        assert!(!other_game.starts_with(&game));
    }

    #[test]
    fn detalhes_da_loja_sem_html() {
        let json = r#"{"413150":{"success":true,"data":{"short_description":"Voc&ecirc; herdou <b>uma fazenda</b> &amp; mais &quot;coisas&quot;.","genres":[{"id":"23","description":"Indie"},{"id":"3","description":"RPG"}],"release_date":{"coming_soon":false,"date":"26/fev./2016"}}}}"#;
        let d = parse_store_details(json, "413150").unwrap();
        assert_eq!(d.short_description, "Voc&ecirc; herdou uma fazenda & mais \"coisas\".");
        assert_eq!(d.genres, vec!["Indie", "RPG"]);
        assert_eq!(d.release_date, "26/fev./2016");
        assert!(parse_store_details(r#"{"1":{"success":false}}"#, "1").is_err());
        assert!(parse_store_details("não é json", "1").is_err());
        assert!(store_details(None, "12a", "english").is_err(), "AppID só com dígitos");
        assert!(store_details(None, "12", "../x").is_err(), "idioma só com letras");
    }

    /// Busca de verdade (rede): só roda com `--ignored`.
    #[test]
    #[ignore]
    fn detalhes_reais_do_stardew() {
        let d = store_details(None, "413150", "brazilian").expect("loja");
        println!("{d:?}");
        assert!(!d.short_description.is_empty());
    }

    const LIBRARY_VDF: &str = r#"
"libraryfolders"
{
    "0"
    {
        "path"      "C:\\Program Files (x86)\\Steam"
        "apps" { "228980" "1234" }
    }
    "1"
    {
        "path"      "D:\\Jogos\\SteamLibrary"
    }
}"#;

    const MANIFEST: &str = r#"
"AppState"
{
    "appid"     "1245620"
    "name"      "ELDEN RING"
    "StateFlags"        "4"
    "SizeOnDisk"        "62914560000"
    "BytesToDownload"   "0"
    "BytesDownloaded"   "0"
    "LastUpdated"       "1700000000"
}"#;

    #[test]
    fn vdf_le_aninhado_e_escapes() {
        let v = parse_vdf(LIBRARY_VDF);
        let lf = v.get("libraryfolders").unwrap();
        assert_eq!(lf.get("0").unwrap().str_of("path"), Some("C:\\Program Files (x86)\\Steam"));
        assert_eq!(lf.get("1").unwrap().str_of("path"), Some("D:\\Jogos\\SteamLibrary"));
    }

    #[test]
    fn manifest_vira_app_instalado() {
        let app = parse_manifest(MANIFEST, Path::new("D:\\Lib")).unwrap();
        assert_eq!(app.app_id, "1245620");
        assert_eq!(app.name, "ELDEN RING");
        assert_eq!(app.state_flags, 4);
        assert_eq!(app.size_on_disk, 62_914_560_000);
    }

    #[test]
    fn ferramentas_da_steam_sao_ignoradas() {
        let redist = "\"AppState\" { \"appid\" \"228980\" \"name\" \"Steamworks Common Redistributables\" }";
        assert!(parse_manifest(redist, Path::new("C:\\")).is_none());
    }

    #[test]
    fn scanner_le_varias_bibliotecas() {
        let base = std::env::temp_dir().join(format!("launcher-test-{}", std::process::id()));
        let main = base.join("steam");
        let extra = base.join("extra");
        fs::create_dir_all(main.join("steamapps")).unwrap();
        fs::create_dir_all(extra.join("steamapps")).unwrap();
        let vdf = format!(
            "\"libraryfolders\" {{ \"0\" {{ \"path\" \"{}\" }} \"1\" {{ \"path\" \"{}\" }} }}",
            main.to_string_lossy().replace('\\', "\\\\"),
            extra.to_string_lossy().replace('\\', "\\\\")
        );
        fs::write(main.join("steamapps").join("libraryfolders.vdf"), vdf).unwrap();
        fs::write(main.join("steamapps").join("appmanifest_1245620.acf"), MANIFEST).unwrap();
        fs::write(
            extra.join("steamapps").join("appmanifest_620.acf"),
            "\"AppState\" { \"appid\" \"620\" \"name\" \"Portal 2\" \"StateFlags\" \"1026\" \"BytesToDownload\" \"1000\" \"BytesDownloaded\" \"250\" }",
        )
        .unwrap();

        let mut apps = scan_installed(&main);
        apps.sort_by(|a, b| a.app_id.cmp(&b.app_id));
        let _ = fs::remove_dir_all(&base);

        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].app_id, "1245620");
        assert_eq!(apps[1].name, "Portal 2");
        assert_eq!((apps[1].bytes_downloaded, apps[1].bytes_to_download), (250, 1000));
    }

    #[test]
    fn usuario_mais_recente_do_loginusers() {
        let text = r#""users" {
            "76561198000000001" { "AccountName" "antiga" "PersonaName" "Antiga" "MostRecent" "0" }
            "76561198000000002" { "AccountName" "atual" "PersonaName" "Atual" "MostRecent" "1" }
        }"#;
        let (id, persona, account) = parse_login_user(text).unwrap();
        assert_eq!((id.as_str(), persona.as_str(), account.as_str()), ("76561198000000002", "Atual", "atual"));
    }

    #[test]
    fn jogos_da_web_api() {
        let json = r#"{"response":{"game_count":2,"games":[
            {"appid":620,"name":"Portal 2","playtime_forever":125,"rtime_last_played":1700000000},
            {"appid":220,"playtime_forever":0}]}}"#;
        let games = parse_owned_json(json).unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!((games[0].app_id.as_str(), games[0].playtime_min), ("620", 125));
        assert!(parse_owned_json(r#"{"response":{}}"#).is_err());
    }

    #[test]
    fn jogos_do_perfil_publico_xml() {
        let xml = r#"<gamesList><steamID64>1</steamID64><games>
            <game><appID>620</appID><name><![CDATA[Portal 2]]></name><hoursOnRecord>1,234.5</hoursOnRecord></game>
            <game><appID>220</appID><name><![CDATA[Half-Life 2]]></name></game>
        </games></gamesList>"#;
        let games = parse_games_xml(xml).unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].name, "Portal 2");
        assert_eq!(games[0].playtime_min, 74_070);
        assert_eq!(games[1].playtime_min, 0);
        assert!(parse_games_xml("<response><error><![CDATA[Perfil privado]]></error></response>").is_err());
        // Página de login (HTML) vira a orientação de usar a chave da Web API.
        let html = "<!DOCTYPE html><html><head><title>Steam Community :: Sign In</title></head></html>";
        assert_eq!(parse_games_xml(html).unwrap_err(), NEEDS_KEY_MESSAGE);
    }

    #[test]
    fn colecoes_da_steam_sao_lidas_sem_as_deletadas() {
        let json = r#"[
          ["user-collections.favorite", {"key":"user-collections.favorite","value":"{\"id\":\"favorite\",\"name\":\"Favoritos\",\"added\":[620,\"220\"],\"removed\":[]}"}],
          ["user-collections.hidden",   {"value":"{\"id\":\"hidden\",\"name\":\"Ocultos\",\"added\":[1,2,3],\"removed\":[2]}"}],
          ["user-collections.uc-apagada", {"is_deleted":true}],
          ["user-collections.uc-dinamica", {"value":"{\"id\":\"uc-dinamica\",\"name\":\"Console\",\"added\":[],\"removed\":[],\"filterSpec\":{\"nFormatVersion\":2,\"strSearchText\":\"\",\"filterGroups\":[{\"rgOptions\":[],\"bAcceptUnion\":true},{\"rgOptions\":[],\"bAcceptUnion\":false},{\"rgOptions\":[2],\"bAcceptUnion\":false}]}}"}],
          ["GameReleased", {"value":"x"}]
        ]"#;
        let cols = parse_collections(json);
        assert_eq!(cols.len(), 3);
        assert_eq!(cols[0], Collection { id: "favorite".into(), name: "Favoritos".into(), app_ids: vec!["620".into(), "220".into()], dynamic: false, filter: None });
        assert_eq!(cols[1].app_ids, vec!["1", "3"], "removidos saem da lista");
        assert!(cols[2].dynamic);
        // O filtro da coleção dinâmica chega inteiro: grupo 2 (recursos) com a opção 2 (suporte a controle).
        let spec = cols[2].filter.as_ref().unwrap();
        assert_eq!(spec.groups.len(), 3);
        assert_eq!(spec.groups[2], FilterGroup { options: vec![2], accept_union: false });
        assert!(spec.groups[0].accept_union);
        assert!(parse_collections("não é json").is_empty());
        assert_eq!(account_id("76561197960265770"), Some(42));
    }

    #[test]
    fn chave_por_conta_salva_le_e_remove() {
        let dir = std::env::temp_dir().join(format!("launcher-cfg-{}", std::process::id()));
        let key = "0123456789abcdef0123456789ABCDEF";
        assert!(is_valid_key(key));
        assert!(!is_valid_key("curta") && !is_valid_key("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));

        // Sem arquivo: nada configurado.
        assert!(!key_status(Some(dir.clone()), "111").configured);

        save_api_key(&dir, "111", key).unwrap();
        save_api_key(&dir, "222", "ffffffffffffffffffffffffffffffff").unwrap();
        let st = key_status(Some(dir.clone()), "111");
        // (se STEAM_API_KEY estiver definida no ambiente, ela tem prioridade; o teste só vale sem ela)
        if !st.from_env {
            assert_eq!(read_api_key(Some(dir.clone()), "111").as_deref(), Some(key));
            assert_eq!(st.last4.as_deref(), Some("CDEF"));
            // Cada conta tem a sua chave; remover uma não afeta a outra.
            clear_api_key(&dir, "111").unwrap();
            assert!(read_api_key(Some(dir.clone()), "111").is_none());
            assert!(read_api_key(Some(dir.clone()), "222").is_some());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn contador_de_escrita_da_steam_so_cresce() {
        let (Some(a), _) = (steam_bytes_written(), ()) else {
            println!("(Steam fechada: nada a testar)");
            return;
        };
        std::thread::sleep(std::time::Duration::from_millis(300));
        let b = steam_bytes_written().unwrap();
        println!("steam.exe gravou {} MB até agora (+{} bytes em 0,3 s)", a / 1_048_576, b - a);
        assert!(b >= a);
    }

    struct SteamFullscreenTest;

    impl SteamFullscreenTest {
        fn begin() -> Self {
            crate::hide::init(|_| {});
            crate::hide::set_fullscreen(true);
            Self
        }
    }

    impl Drop for SteamFullscreenTest {
        fn drop(&mut self) {
            crate::hide::set_fullscreen(false);
        }
    }

    /// Mede por quantos ms a janela da Steam fica na tela depois de um comando, sem e com o gancho.
    /// Usa `+app_update_status` (não altera nada). Só roda com `--ignored`: mexe na janela da Steam por alguns segundos.
    #[test]
    #[ignore]
    fn mede_o_pisca_da_janela_da_steam() {
        let Some(exe) = steam_exe() else { return };
        let exposure = |label: &str| {
            minimize_steam_window();
            std::thread::sleep(std::time::Duration::from_millis(800));
            let start = std::time::Instant::now();
            let _ = Command::new(&exe).args(["+app_update_status", "606150"]).spawn();
            let mut exposed_ms = 0u128;
            let mut last = start.elapsed().as_millis();
            while start.elapsed().as_millis() < 2500 {
                let (visible, minimized) = steam_window_state();
                let now = start.elapsed().as_millis();
                if visible && !minimized {
                    exposed_ms += now - last;
                }
                last = now;
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            println!("{label}: janela da Steam ficou na tela por {exposed_ms} ms (em 2,5 s)");
            exposed_ms
        };
        // sem o gancho: a janela fica na tela até alguém minimizar
        let sem = exposure("SEM gancho");
        // com o gancho armado
        let com = {
            let _fullscreen = SteamFullscreenTest::begin();
            std::thread::sleep(std::time::Duration::from_millis(300));
            exposure("COM gancho")
        };
        restore_steam_window();
        println!("resumo: sem={sem} ms, com={com} ms");
        assert!(com < sem);
    }

    /// Ciclo real de instalação: observa notificações da Steam e o progresso pelo contador de escrita.
    /// Desinstala e instala o Moonlighter (606150). Só roda com `--ignored`.
    #[test]
    #[ignore]
    fn instalacao_real_sem_notificacoes_e_com_progresso() {
        let Some(exe) = steam_exe() else { return };
        let root = steam_root().unwrap();
        let manifest = root.join("steamapps").join("appmanifest_606150.acf");
        let toast_visible = || unsafe {
            let h = FindWindowW(wide("SDL_app").as_ptr(), wide("notificationtoasts_8_desktop").as_ptr());
            (h as usize) != 0 && IsWindowVisible(h) != 0
        };

        let _fullscreen = SteamFullscreenTest::begin();
        crate::hide::set_hide_toasts(true);
        let _ = Command::new(&exe).args(["+app_uninstall", "606150"]).spawn();
        for _ in 0..40 {
            std::thread::sleep(std::time::Duration::from_millis(250));
            if !manifest.exists() {
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(2));

        let base = steam_bytes_written().unwrap();
        let start = std::time::Instant::now();
        let _ = Command::new(&exe).args(["+app_install", "606150"]).spawn();

        let (mut samples, mut toast_samples, mut done_at) = (0u32, 0u32, None);
        let mut total_stage = 0u64;
        let mut last_print = 0u128;
        let mut series: Vec<(u128, f64)> = Vec::new();
        while start.elapsed().as_secs() < 40 {
            samples += 1;
            if toast_visible() {
                toast_samples += 1;
            }
            if let Ok(text) = fs::read_to_string(&manifest) {
                if let Some(app) = parse_manifest(&text, &root) {
                    if app.bytes_to_stage > 0 {
                        total_stage = app.bytes_to_stage;
                    }
                    if app.state_flags & 4 != 0 && done_at.is_none() {
                        done_at = Some(start.elapsed().as_millis());
                    }
                }
            }
            let ms = start.elapsed().as_millis();
            if total_stage > 0 && ms - last_print >= 500 {
                last_print = ms;
                let written = steam_bytes_written().unwrap().saturating_sub(base);
                let fraction = (written as f64 / total_stage as f64).min(0.99);
                series.push((ms, fraction));
                println!("{:>6} ms  progresso estimado {:>5.1}%", ms, fraction * 100.0);
            }
            // continua alguns segundos depois de terminar, para pegar a notificação de "instalado"
            if let Some(d) = done_at {
                if ms > d + 9000 {
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        println!("instalou em {:?} ms; amostras={samples}; amostras com notificação visível={toast_samples}", done_at);
        let distinct = series.windows(2).filter(|w| (w[1].1 - w[0].1).abs() > 0.001).count();
        println!("leituras de progresso: {} (mudanças entre leituras consecutivas: {distinct})", series.len());
        assert_eq!(toast_samples, 0, "uma notificação da Steam apareceu na tela");
    }

    /// Minimiza a janela da Steam deste PC e a restaura em seguida. Só roda com `--ignored` (mexe na janela do jogador por ~1 s).
    #[test]
    #[ignore]
    fn minimiza_a_janela_da_steam_e_restaura() {
        let (visivel, minimizada) = steam_window_state();
        println!("janela da Steam: visível={visivel} minimizada={minimizada}");
        if !visivel || minimizada {
            println!("(nada a testar: a janela não está visível)");
            return;
        }
        assert!(minimize_steam_window(), "deveria ter minimizado");
        std::thread::sleep(std::time::Duration::from_millis(600));
        let (_, depois) = steam_window_state();
        println!("depois de minimizar: minimizada={depois}");
        assert!(depois);
        assert!(!minimize_steam_window(), "já minimizada: não deve minimizar de novo");
        restore_steam_window();
        std::thread::sleep(std::time::Duration::from_millis(600));
        println!("depois de restaurar: {:?}", steam_window_state());
    }

    /// Consulta de rede à conta logada neste PC (a mesma do botão "Sincronizar"). Só roda com `--ignored`.
    #[test]
    #[ignore]
    fn conta_real_via_rede() {
        let id = info().steam_id.expect("sem conta Steam logada");
        let key = read_api_key(None, &id);
        println!("usando chave de API: {}", key.is_some());
        match fetch_owned(&id, key) {
            Ok(games) => {
                let played = games.iter().filter(|g| g.playtime_min > 0).count();
                println!("OK: {} jogos na conta ({} com tempo de jogo)", games.len(), played);
                let mut top: Vec<_> = games.iter().collect();
                top.sort_by_key(|g| std::cmp::Reverse(g.playtime_min));
                for g in top.iter().take(8) {
                    println!("  {:>6} min  {}  ({})", g.playtime_min, g.name, g.app_id);
                }
            }
            Err(e) => println!("ERRO: {e}"),
        }
    }

    /// Leitura real (somente leitura) da Steam deste PC — só imprime, não falha se não houver Steam.
    /// Com a Steam FECHADA (feche antes), abre em silêncio e espera ficar pronta. Só roda com `--ignored`.
    #[test]
    #[ignore]
    fn abre_a_steam_em_silencio() {
        assert!(!process_running("steam.exe"), "feche a Steam antes");
        let inicio = std::time::Instant::now();
        ensure_running().expect("Steam pronta");
        println!("Steam pronta em {} ms; logada: {}", inicio.elapsed().as_millis(), info().logged_in);
        assert!(info().logged_in);
    }

    #[test]
    fn steam_real_somente_leitura() {
        let i = info();
        println!("info: {i:?}");
        if let Some(root) = steam_root() {
            let apps = scan_installed(&root);
            println!("bibliotecas: {:?}", library_paths(&root));
            println!("{} jogos instalados: {:?}", apps.len(), apps.iter().map(|a| &a.name).collect::<Vec<_>>());
            if let Some(id) = i.steam_id.as_deref() {
                let cols = read_collections(&root, id);
                println!("coleções: {:?}", cols.iter().map(|c| (&c.name, c.app_ids.len(), c.dynamic)).collect::<Vec<_>>());
            }
        }
    }
}
