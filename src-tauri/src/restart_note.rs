//! O aviso "reinicie o PC" que aparece depois de uma atualização: quando ele vale e quando já foi resolvido.
//!
//! Fica num arquivo gravado na hora. O armazenamento da janela (localStorage) leva até um minuto para ir ao disco, e o
//! reinício encerra o launcher antes disso: o aviso voltava depois de o PC já ter reiniciado.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use windows_sys::Win32::System::SystemInformation::GetTickCount64;

pub const FILE: &str = "update-restart.json";

/// O que está guardado. A memória vale durante a abertura; o arquivo, entre uma abertura e outra.
static NOTE: Mutex<Option<Note>> = Mutex::new(None);

#[derive(Serialize, Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
struct Note {
    /// A versão que rodou da última vez.
    last_run: Option<String>,
    /// Versão recém-instalada cuja sugestão de reiniciar ainda vale.
    suggestion: Option<String>,
    /// Quando a sugestão surgiu, em milissegundos desde 1970.
    suggested_at: u64,
}

/// O estado depois desta abertura. `previous` é a versão anterior guardada pela janela, usada só enquanto o arquivo não
/// existe (as versões até a 0.1.7 não o criavam).
fn advance(note: &Note, current: &str, previous: Option<&str>, now: u64, booted_at: u64) -> Note {
    let before = note.last_run.as_deref().or(previous);
    if before != Some(current) {
        // A primeira execução não é atualização.
        return Note { last_run: Some(current.into()), suggestion: before.map(|_| current.into()), suggested_at: now };
    }
    let mut next = Note { last_run: Some(current.into()), ..note.clone() };
    // O Windows iniciou depois de a sugestão surgir: o PC já reiniciou.
    if booted_at > next.suggested_at {
        next.suggestion = None;
    }
    next
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// O instante em que o Windows iniciou. `GetTickCount64` conta também o tempo suspenso; "Reiniciar" zera a contagem.
fn booted_at() -> u64 {
    // SAFETY: não recebe parâmetros e só lê um contador do sistema.
    let uptime = unsafe { GetTickCount64() };
    now().saturating_sub(uptime)
}

fn load(file: &Path) -> Note {
    std::fs::read(file).ok().and_then(|raw| serde_json::from_slice(&raw).ok()).unwrap_or_default()
}

/// Grava num arquivo ao lado, manda para o disco e só então troca pelo definitivo.
fn save(file: &Path, note: &Note) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let temporary: PathBuf = file.with_extension("tmp");
    let mut out = std::fs::File::create(&temporary)?;
    out.write_all(&serde_json::to_vec_pretty(note).map_err(std::io::Error::other)?)?;
    out.sync_all()?;
    drop(out);
    std::fs::rename(&temporary, file)
}

fn change(file: &Path, update: impl FnOnce(&Note) -> Note) -> Option<String> {
    let mut slot = NOTE.lock().unwrap();
    let old = slot.clone().unwrap_or_else(|| load(file));
    let new = update(&old);
    if new != old {
        if let Err(error) = save(file, &new) {
            eprintln!("aviso de reinício não gravado: {error}");
        }
    }
    let suggestion = new.suggestion.clone();
    *slot = Some(new);
    suggestion
}

/// A versão cuja sugestão de reiniciar o PC vale agora.
pub fn suggestion(dir: &Path, current: &str, previous: Option<&str>) -> Option<String> {
    change(&dir.join(FILE), |note| advance(note, current, previous, now(), booted_at()))
}

/// O jogador respondeu ao aviso.
pub fn answer(dir: &Path) {
    change(&dir.join(FILE), |note| Note { suggestion: None, ..note.clone() });
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOOT: u64 = 1_000_000;

    fn note(last: &str, suggestion: Option<&str>, at: u64) -> Note {
        Note { last_run: Some(last.into()), suggestion: suggestion.map(Into::into), suggested_at: at }
    }

    #[test]
    fn primeira_execucao_nao_sugere() {
        assert_eq!(advance(&Note::default(), "0.1.8", None, BOOT + 10, BOOT).suggestion, None);
    }

    #[test]
    fn atualizacao_sugere_reiniciar() {
        // Vindo de uma versão que não criava o arquivo, e depois por ele.
        let migrated = advance(&Note::default(), "0.1.8", Some("0.1.7"), BOOT + 10, BOOT);
        assert_eq!(migrated, note("0.1.8", Some("0.1.8"), BOOT + 10));
        assert_eq!(advance(&migrated, "0.1.9", None, BOOT + 20, BOOT).suggestion.as_deref(), Some("0.1.9"));
    }

    #[test]
    fn sem_reiniciar_a_sugestao_continua() {
        let pending = note("0.1.8", Some("0.1.8"), BOOT + 10);
        assert_eq!(advance(&pending, "0.1.8", None, BOOT + 500, BOOT), pending);
    }

    #[test]
    fn depois_de_reiniciar_a_sugestao_some() {
        let pending = note("0.1.8", Some("0.1.8"), BOOT + 10);
        let after = advance(&pending, "0.1.8", Some("0.1.7"), BOOT + 90_000, BOOT + 60_000);
        assert_eq!(after.suggestion, None);
        // A versão antiga ainda guardada pela janela não faz o aviso voltar.
        assert_eq!(advance(&after, "0.1.8", Some("0.1.7"), BOOT + 95_000, BOOT + 60_000).suggestion, None);
    }

    #[test]
    fn inicio_do_windows_fica_no_passado_e_nao_muda() {
        let first = booted_at();
        assert!(first > 0 && first < now());
        // Duas leituras seguidas dão o mesmo instante (a menos da resolução do contador).
        assert!(booted_at().abs_diff(first) < 1000);
    }

    #[test]
    fn o_arquivo_guarda_e_devolve() {
        let dir = std::env::temp_dir().join(format!("launcher-reinicio-{}", std::process::id()));
        let file = dir.join(FILE);
        assert_eq!(load(&file), Note::default());
        let saved = note("0.1.8", Some("0.1.8"), 42);
        save(&file, &saved).unwrap();
        assert_eq!(load(&file), saved);
        std::fs::write(&file, b"lixo").unwrap();
        assert_eq!(load(&file), Note::default());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
