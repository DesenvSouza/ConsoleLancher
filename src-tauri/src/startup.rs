//! Iniciar com o Windows e "modo console" (o launcher no lugar da área de trabalho).
//!
//! - **Iniciar com o Windows**: um valor em `HKCU\...\Run` (só deste usuário, sem administrador).
//! - **Modo console**: o valor `Shell` em `HKCU\...\Winlogon` aponta para `launcher.exe --shell`. O Windows então entra
//!   direto no launcher, sem Explorer (sem barra de tarefas, menu Iniciar nem bandeja). Vale só para este usuário.
//!
//! As duas opções são excludentes: ligar uma desliga a outra (no modo console o próprio Windows já abre o launcher).
//!
//! Proteções do modo console:
//! 1. `--shell` não abre a interface: é um **vigia** que abre o launcher de verdade (`--supervised`) e o reabre se ele
//!    fechar ou travar. Se falhar 3 vezes seguidas em pouco tempo, ou se o jogador pedir a área de trabalho, o vigia abre o
//!    Explorer e sai.
//! 2. "Sair para a área de trabalho" abre o Explorer **antes** de fechar o launcher.
//! 3. Se o Explorer for aberto por fora (Ctrl+Alt+Del › Executar nova tarefa › explorer), o vigia para de reabrir o launcher.
//! 4. Um script `Voltar-ao-Explorer.bat` fica na pasta de configuração, para desfazer tudo se algo der errado.
//!
//! Nada aqui roda no modo de desenvolvimento (`tauri dev`): lá o executável depende do servidor do Vite.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use serde::Serialize;
use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
use winreg::RegKey;

/// Argumento do vigia (é o que vai no valor `Shell`).
pub const SHELL_ARG: &str = "--shell";
/// Argumento do launcher aberto pelo vigia.
pub const SUPERVISED_ARG: &str = "--supervised";
/// Argumento do launcher aberto pelo Windows ao entrar.
pub const AUTOSTART_ARG: &str = "--autostart";
/// Código de saída com que o launcher avisa o vigia: "o jogador pediu a área de trabalho".
pub const EXIT_TO_DESKTOP_CODE: i32 = 42;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const RESTORE_SCRIPT: &str = "Voltar-ao-Explorer.bat";

/// Onde cada coisa fica no registro (separado para os testes usarem outra chave, sem tocar nas do Windows).
struct Paths {
    run: String,
    winlogon: String,
    backup: String,
}

impl Paths {
    fn real() -> Self {
        Paths {
            run: r"Software\Microsoft\Windows\CurrentVersion\Run".into(),
            winlogon: r"Software\Microsoft\Windows NT\CurrentVersion\Winlogon".into(),
            backup: r"Software\GameLauncher".into(),
        }
    }
}

const RUN_NAME: &str = "GameLauncher";
const SHELL_NAME: &str = "Shell";
const BACKUP_NAME: &str = "ShellBackup";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    /// false no modo de desenvolvimento (não faz sentido registrar o executável de teste).
    pub available: bool,
    /// O launcher abre sozinho quando o jogador entra no Windows.
    pub autostart: bool,
    /// O modo console está registrado (vale a partir da próxima entrada no Windows).
    pub console: bool,
    /// Este launcher está rodando agora como a "área de trabalho" (sem Explorer).
    pub console_active: bool,
    /// Caminho do script que desfaz o modo console por fora do launcher.
    pub restore_script: String,
}

fn hkcu() -> RegKey {
    RegKey::predef(HKEY_CURRENT_USER)
}

fn read_value(path: &str, name: &str) -> Option<String> {
    hkcu().open_subkey(path).ok()?.get_value::<String, _>(name).ok()
}

fn write_value(path: &str, name: &str, value: &str) -> Result<(), String> {
    let (key, _) = hkcu().create_subkey(path).map_err(|e| e.to_string())?;
    key.set_value(name, &value).map_err(|e| e.to_string())
}

fn delete_value(path: &str, name: &str) -> Result<(), String> {
    use std::io::ErrorKind::NotFound;
    match hkcu().open_subkey_with_flags(path, KEY_SET_VALUE) {
        Ok(key) => match key.delete_value(name) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        },
        Err(e) if e.kind() == NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// O executável deste launcher, sem o prefixo `\\?\` que alguns caminhos trazem.
fn current_exe() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let text = exe.to_string_lossy();
    Ok(PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()))
}

fn command_for(exe: &Path, arg: &str) -> String {
    format!("\"{}\" {arg}", exe.display())
}

/// Tira as aspas e os argumentos de um comando do registro e devolve só o caminho do executável.
fn exe_of(command: &str) -> PathBuf {
    let command = command.trim();
    if let Some(rest) = command.strip_prefix('"') {
        return PathBuf::from(rest.split('"').next().unwrap_or(rest));
    }
    let end = command.to_lowercase().find(".exe").map_or(command.len(), |i| i + 4);
    PathBuf::from(&command[..end])
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy())
}

/// Só no launcher instalado: no `tauri dev` o executável precisa do servidor do Vite e ficaria preso numa tela vazia.
pub fn available() -> bool {
    !cfg!(debug_assertions)
}

fn ensure_available() -> Result<(), String> {
    if available() {
        Ok(())
    } else {
        Err("Disponível só no launcher instalado, não no modo de desenvolvimento.".into())
    }
}

pub fn supervised() -> bool {
    std::env::args().any(|a| a == SUPERVISED_ARG)
}

// ───────── Estado e ajustes ─────────

fn status_with(paths: &Paths, config_dir: &Path, exe: &Path) -> StartupStatus {
    let autostart = read_value(&paths.run, RUN_NAME).is_some_and(|v| same_path(&exe_of(&v), exe));
    let console = read_value(&paths.winlogon, SHELL_NAME).is_some_and(|v| v.contains(SHELL_ARG) && same_path(&exe_of(&v), exe));
    StartupStatus {
        available: available(),
        autostart,
        console,
        console_active: supervised() && shell_window_missing(),
        restore_script: config_dir.join(RESTORE_SCRIPT).to_string_lossy().into_owned(),
    }
}

pub fn status(config_dir: &Path) -> Result<StartupStatus, String> {
    Ok(status_with(&Paths::real(), config_dir, &current_exe()?))
}

fn set_autostart_with(paths: &Paths, exe: &Path, enabled: bool) -> Result<(), String> {
    if enabled {
        // Só desfaz o modo console se o shell registrado for o do launcher: um shell de outro programa não é tocado.
        if read_value(&paths.winlogon, SHELL_NAME).is_some_and(|v| v.contains(SHELL_ARG)) {
            restore_shell(paths)?;
        }
        write_value(&paths.run, RUN_NAME, &command_for(exe, AUTOSTART_ARG))
    } else {
        delete_value(&paths.run, RUN_NAME)
    }
}

pub fn set_autostart(enabled: bool) -> Result<(), String> {
    ensure_available()?;
    set_autostart_with(&Paths::real(), &current_exe()?, enabled).map_err(registry_error)
}

fn restore_script_text() -> String {
    // CRLF e sem acentos: abre em qualquer página de código do prompt.
    [
        "@echo off",
        "rem Desfaz o modo console do launcher e volta para a area de trabalho do Windows.",
        r#"reg delete "HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /f"#,
        r#"start "" explorer.exe"#,
        "",
    ]
    .join("\r\n")
}

fn set_console_with(paths: &Paths, config_dir: &Path, exe: &Path, enabled: bool) -> Result<(), String> {
    if enabled {
        // O script de socorro vem primeiro: sem ele, o modo console não é ativado.
        std::fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
        std::fs::write(config_dir.join(RESTORE_SCRIPT), restore_script_text()).map_err(|e| e.to_string())?;
        // Se o jogador já tinha outro shell personalizado, guarda para devolver depois.
        let current = read_value(&paths.winlogon, SHELL_NAME);
        if let Some(current) = current.filter(|v| !v.contains(SHELL_ARG)) {
            write_value(&paths.backup, BACKUP_NAME, &current)?;
        }
        write_value(&paths.winlogon, SHELL_NAME, &command_for(exe, SHELL_ARG))?;
        delete_value(&paths.run, RUN_NAME)
    } else {
        restore_shell(paths)
    }
}

/// Devolve o shell de antes do modo console.
fn restore_shell(paths: &Paths) -> Result<(), String> {
    match read_value(&paths.backup, BACKUP_NAME) {
        Some(original) => {
            write_value(&paths.winlogon, SHELL_NAME, &original)?;
            delete_value(&paths.backup, BACKUP_NAME)
        }
        // O normal é não ter o valor: sem ele, o Windows usa o Explorer.
        None => delete_value(&paths.winlogon, SHELL_NAME),
    }
}

pub fn set_console(config_dir: &Path, enabled: bool) -> Result<(), String> {
    ensure_available()?;
    set_console_with(&Paths::real(), config_dir, &current_exe()?, enabled).map_err(registry_error)
}

fn registry_error(detail: String) -> String {
    format!("Não foi possível alterar o registro do Windows: {detail}")
}

/// Se o launcher foi movido ou reinstalado em outra pasta, o registro ainda aponta para o caminho antigo (que não existe
/// mais). Aponta de novo para este, para o início com o Windows e o modo console não quebrarem. Nunca mexe quando o
/// caminho registrado ainda existe (uma cópia de teste não "sequestra" o registro).
fn repair_with(paths: &Paths, exe: &Path) {
    for (path, name, arg) in [(&paths.run, RUN_NAME, AUTOSTART_ARG), (&paths.winlogon, SHELL_NAME, SHELL_ARG)] {
        let Some(value) = read_value(path, name) else { continue };
        if !value.contains(arg) {
            continue;
        }
        let registered = exe_of(&value);
        if !same_path(&registered, exe) && !registered.exists() {
            let _ = write_value(path, name, &command_for(exe, arg));
        }
    }
}

pub fn repair() {
    if available() {
        if let Ok(exe) = current_exe() {
            repair_with(&Paths::real(), &exe);
        }
    }
}

// ───────── Explorer ─────────

fn shell_window_missing() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetShellWindow;
    // SAFETY: só consulta se a área de trabalho do Windows (Explorer) existe.
    unsafe { GetShellWindow() }.is_null()
}

/// Garante que a área de trabalho do Windows está de pé: se não estiver, abre o Explorer (que, sem outro shell rodando,
/// vira a área de trabalho) e espera ela aparecer.
pub fn ensure_explorer(timeout: Duration) -> Result<(), String> {
    if !shell_window_missing() {
        return Ok(());
    }
    Command::new("explorer.exe").creation_flags(CREATE_NO_WINDOW).spawn().map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    while shell_window_missing() {
        if Instant::now() >= deadline {
            return Err("O Explorer ainda não disponibilizou a área de trabalho.".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(())
}

// ───────── Vigia do modo console ─────────

/// Quantas quedas rápidas seguidas o vigia aguenta antes de desistir e devolver o Explorer.
const MAX_QUICK_FAILURES: u32 = 3;
/// Um launcher que fecha antes disso conta como queda rápida.
const QUICK_FAILURE_SECS: u64 = 20;

#[derive(Debug, PartialEq, Eq)]
enum Next {
    /// Abrir o launcher de novo.
    Restart,
    /// Entregar a área de trabalho do Windows e sair.
    GiveDesktop,
    /// O Explorer já está de pé (aberto por fora): o vigia só sai.
    Leave,
}

/// Decisão do vigia depois que o launcher fechou. `quick_failures` já inclui esta queda, se ela foi rápida.
fn next_step(exit_code: Option<i32>, shell_present: bool, quick_failures: u32) -> Next {
    if exit_code == Some(EXIT_TO_DESKTOP_CODE) {
        Next::GiveDesktop
    } else if shell_present {
        Next::Leave
    } else if quick_failures >= MAX_QUICK_FAILURES {
        Next::GiveDesktop
    } else {
        Next::Restart
    }
}

/// Roda no lugar da interface quando o Windows abre `launcher.exe --shell`. Nunca volta.
pub fn supervise() -> ! {
    let exe = match current_exe() {
        Ok(exe) => exe,
        Err(_) => {
            let _ = ensure_explorer(Duration::from_secs(20));
            std::process::exit(1);
        }
    };
    let mut quick_failures = 0;
    loop {
        let started = Instant::now();
        let code = match Command::new(&exe).arg(SUPERVISED_ARG).spawn() {
            Ok(mut child) => child.wait().ok().and_then(|status| status.code()),
            Err(_) => {
                // Nem abrir o launcher deu: devolve a área de trabalho para o jogador não ficar numa tela preta.
                let _ = ensure_explorer(Duration::from_secs(20));
                std::process::exit(1);
            }
        };
        quick_failures = if started.elapsed() < Duration::from_secs(QUICK_FAILURE_SECS) { quick_failures + 1 } else { 0 };
        match next_step(code, !shell_window_missing(), quick_failures) {
            Next::Restart => std::thread::sleep(Duration::from_secs(1)),
            Next::GiveDesktop => {
                let _ = ensure_explorer(Duration::from_secs(20));
                std::process::exit(0);
            }
            Next::Leave => std::process::exit(0),
        }
    }
}

// ───────── Uma instância só ─────────

/// Marca esta execução como "o launcher aberto". Devolve false quando o Windows abriu o launcher sozinho (`--autostart`)
/// mas ele já está aberto (por exemplo, o jogador já o abriu ou voltou do modo console): nesse caso é para sair em silêncio.
pub fn claim_instance(autostart: bool) -> bool {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    let name: Vec<u16> = "Local\\GameLauncherInstance\0".encode_utf16().collect();
    // SAFETY: nome terminado em zero; o identificador fica aberto até o processo terminar (é a ideia do mutex).
    let exists = unsafe {
        CreateMutexW(std::ptr::null(), 0, name.as_ptr());
        GetLastError() == ERROR_ALREADY_EXISTS
    };
    !(exists && autostart)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_paths(name: &str) -> Paths {
        // Cada teste tem a sua chave inteira (os testes rodam em paralelo e não podem disputar uma chave-mãe).
        let base = format!(r"Software\GameLauncherTest-{name}");
        Paths { run: format!(r"{base}\Run"), winlogon: format!(r"{base}\Winlogon"), backup: format!(r"{base}\Backup") }
    }

    fn cleanup(name: &str) {
        let _ = hkcu().delete_subkey_all(format!(r"Software\GameLauncherTest-{name}"));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("launcher-startup-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn extrai_o_executavel_do_comando() {
        assert_eq!(exe_of(r#""C:\Program Files\Launcher\launcher.exe" --shell"#), PathBuf::from(r"C:\Program Files\Launcher\launcher.exe"));
        assert_eq!(exe_of(r"C:\Jogos\launcher.exe --autostart"), PathBuf::from(r"C:\Jogos\launcher.exe"));
        assert_eq!(exe_of(r"explorer.exe"), PathBuf::from("explorer.exe"));
    }

    #[test]
    fn comando_usa_aspas_por_causa_dos_espacos() {
        assert_eq!(command_for(Path::new(r"C:\Meus Jogos\launcher.exe"), SHELL_ARG), r#""C:\Meus Jogos\launcher.exe" --shell"#);
    }

    #[test]
    fn vigia_decide_o_que_fazer() {
        // O jogador pediu a área de trabalho: entrega.
        assert_eq!(next_step(Some(EXIT_TO_DESKTOP_CODE), false, 0), Next::GiveDesktop);
        // Fechou ou travou uma vez: reabre.
        assert_eq!(next_step(Some(0), false, 1), Next::Restart);
        assert_eq!(next_step(Some(-1073740791), false, 2), Next::Restart);
        assert_eq!(next_step(None, false, 1), Next::Restart);
        // Três quedas rápidas: desiste e devolve o Explorer.
        assert_eq!(next_step(Some(1), false, MAX_QUICK_FAILURES), Next::GiveDesktop);
        // Explorer aberto por fora (Gerenciador de Tarefas): o vigia sai sem reabrir.
        assert_eq!(next_step(Some(1), true, 1), Next::Leave);
    }

    #[test]
    fn inicio_com_o_windows_liga_e_desliga() {
        let name = "autostart";
        cleanup(name);
        let paths = test_paths(name);
        let exe = Path::new(r"C:\Meus Jogos\launcher.exe");
        let dir = temp_dir(name);

        assert!(!status_with(&paths, &dir, exe).autostart);
        set_autostart_with(&paths, exe, true).unwrap();
        assert!(status_with(&paths, &dir, exe).autostart);
        assert_eq!(read_value(&paths.run, RUN_NAME).unwrap(), r#""C:\Meus Jogos\launcher.exe" --autostart"#);
        // Outro executável registrado não conta como "este launcher".
        assert!(!status_with(&paths, &dir, Path::new(r"C:\Outro\launcher.exe")).autostart);
        set_autostart_with(&paths, exe, false).unwrap();
        assert!(!status_with(&paths, &dir, exe).autostart);
        // Desligar de novo (sem a chave) não é erro.
        set_autostart_with(&paths, exe, false).unwrap();
        cleanup(name);
    }

    #[test]
    fn modo_console_grava_o_script_e_desfaz_sem_deixar_rastro() {
        let name = "console";
        cleanup(name);
        let paths = test_paths(name);
        let exe = Path::new(r"C:\Meus Jogos\launcher.exe");
        let dir = temp_dir(name);

        set_console_with(&paths, &dir, exe, true).unwrap();
        let status = status_with(&paths, &dir, exe);
        assert!(status.console);
        assert_eq!(read_value(&paths.winlogon, SHELL_NAME).unwrap(), r#""C:\Meus Jogos\launcher.exe" --shell"#);
        let script = std::fs::read_to_string(dir.join(RESTORE_SCRIPT)).unwrap();
        assert!(script.contains("reg delete") && script.contains("explorer.exe") && script.contains("\r\n"));
        // Sem shell anterior, não há o que guardar.
        assert!(read_value(&paths.backup, BACKUP_NAME).is_none());

        set_console_with(&paths, &dir, exe, false).unwrap();
        assert!(!status_with(&paths, &dir, exe).console);
        assert!(read_value(&paths.winlogon, SHELL_NAME).is_none());
        cleanup(name);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn modo_console_devolve_o_shell_personalizado_de_antes() {
        let name = "backup";
        cleanup(name);
        let paths = test_paths(name);
        let exe = Path::new(r"C:\Meus Jogos\launcher.exe");
        let dir = temp_dir(name);

        write_value(&paths.winlogon, SHELL_NAME, r"C:\Outro\shell.exe").unwrap();
        set_console_with(&paths, &dir, exe, true).unwrap();
        // Ligar de novo não pode guardar o nosso próprio comando como se fosse o original.
        set_console_with(&paths, &dir, exe, true).unwrap();
        assert_eq!(read_value(&paths.backup, BACKUP_NAME).unwrap(), r"C:\Outro\shell.exe");
        set_console_with(&paths, &dir, exe, false).unwrap();
        assert_eq!(read_value(&paths.winlogon, SHELL_NAME).unwrap(), r"C:\Outro\shell.exe");
        assert!(read_value(&paths.backup, BACKUP_NAME).is_none());
        cleanup(name);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn inicio_com_o_windows_e_modo_console_nunca_ficam_juntos() {
        let name = "exclusive";
        cleanup(name);
        let paths = test_paths(name);
        let exe = Path::new(r"C:\Meus Jogos\launcher.exe");
        let dir = temp_dir(name);

        set_autostart_with(&paths, exe, true).unwrap();
        set_console_with(&paths, &dir, exe, true).unwrap();
        let status = status_with(&paths, &dir, exe);
        assert!(status.console && !status.autostart);

        set_autostart_with(&paths, exe, true).unwrap();
        let status = status_with(&paths, &dir, exe);
        assert!(status.autostart && !status.console);

        // Um shell personalizado de outro programa não é mexido ao ligar o início com o Windows.
        write_value(&paths.winlogon, SHELL_NAME, r"C:\Outro\shell.exe").unwrap();
        set_autostart_with(&paths, exe, true).unwrap();
        assert_eq!(read_value(&paths.winlogon, SHELL_NAME).unwrap(), r"C:\Outro\shell.exe");
        cleanup(name);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reparo_so_mexe_quando_o_caminho_antigo_sumiu() {
        let name = "repair";
        cleanup(name);
        let paths = test_paths(name);
        let dir = temp_dir(name);
        std::fs::create_dir_all(&dir).unwrap();
        let existing = dir.join("antigo.exe");
        std::fs::write(&existing, b"").unwrap();
        let current = Path::new(r"C:\Novo\launcher.exe");

        // O caminho registrado ainda existe: não mexe (uma cópia de teste não sequestra o registro).
        write_value(&paths.winlogon, SHELL_NAME, &command_for(&existing, SHELL_ARG)).unwrap();
        repair_with(&paths, current);
        assert_eq!(read_value(&paths.winlogon, SHELL_NAME).unwrap(), command_for(&existing, SHELL_ARG));

        // O caminho registrado sumiu: aponta para o launcher atual.
        write_value(&paths.run, RUN_NAME, &command_for(Path::new(r"C:\Que\Sumiu\launcher.exe"), AUTOSTART_ARG)).unwrap();
        repair_with(&paths, current);
        assert_eq!(read_value(&paths.run, RUN_NAME).unwrap(), command_for(current, AUTOSTART_ARG));

        // Um valor que não é nosso (sem o argumento) nunca é tocado.
        write_value(&paths.run, "Outro", r"C:\Que\Sumiu\outro.exe").unwrap();
        repair_with(&paths, current);
        assert_eq!(read_value(&paths.run, "Outro").unwrap(), r"C:\Que\Sumiu\outro.exe");
        cleanup(name);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn so_o_autostart_repetido_sai_em_silencio() {
        assert!(claim_instance(false));
        // Já existe (esta própria execução): o autostart sai, a abertura normal segue.
        assert!(!claim_instance(true));
        assert!(claim_instance(false));
    }
}
