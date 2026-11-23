use serde::Deserialize;
use std::ptr::null_mut;
use std::sync::Mutex;
use windows_sys::Win32::Media::Audio::{
    PlaySoundA, SND_ASYNC, SND_MEMORY, SND_NODEFAULT, SND_NOSTOP,
};

// As duas janelas compartilham a preferência. A principal a restaura antes de tocar qualquer efeito.
static ENABLED: Mutex<bool> = Mutex::new(false);

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cue {
    Move,
    Select,
    Back,
    Open,
    Operation,
    Launch,
    Success,
    Warning,
}

impl Cue {
    fn wav(self) -> &'static [u8] {
        match self {
            Self::Move => include_bytes!("../../src/audio/effects/move.wav"),
            Self::Select => include_bytes!("../../src/audio/effects/select.wav"),
            Self::Back => include_bytes!("../../src/audio/effects/back.wav"),
            Self::Open => include_bytes!("../../src/audio/effects/open.wav"),
            Self::Operation => include_bytes!("../../src/audio/effects/operation.wav"),
            Self::Launch => include_bytes!("../../src/audio/effects/launch.wav"),
            Self::Success => include_bytes!("../../src/audio/effects/success.wav"),
            Self::Warning => include_bytes!("../../src/audio/effects/warning.wav"),
        }
    }
}

#[tauri::command]
pub fn sound_set_enabled(enabled: bool) {
    *ENABLED.lock().unwrap() = enabled;
    if !enabled {
        // SAFETY: um ponteiro nulo interrompe o som assíncrono deste processo.
        unsafe { PlaySoundA(std::ptr::null(), null_mut(), 0) };
    }
}

#[tauri::command]
pub fn sound_play(window: tauri::WebviewWindow, cue: Cue) -> bool {
    if window.label() == "main" && !crate::window_is_foreground(&window) {
        return false;
    }

    let enabled = ENABLED.lock().unwrap();
    if !*enabled {
        return false;
    }

    let mut flags = SND_ASYNC | SND_MEMORY | SND_NODEFAULT;
    if matches!(cue, Cue::Move) {
        // A navegação rápida não corta o som de uma ação mais importante.
        flags |= SND_NOSTOP;
    }
    // SAFETY: o WAV embutido é válido e permanece em memória até o fim da reprodução.
    unsafe { PlaySoundA(cue.wav().as_ptr(), null_mut(), flags) != 0 }
}
