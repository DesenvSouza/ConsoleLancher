use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::State;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(default)]
pub struct PowerOptions {
    suspend: bool,
    restart: bool,
    shutdown: bool,
}

impl Default for PowerOptions {
    fn default() -> Self {
        Self {
            suspend: true,
            restart: true,
            shutdown: true,
        }
    }
}

impl PowerOptions {
    pub fn allows(self, action: &str) -> bool {
        match action {
            "suspend" => self.suspend,
            "restart" => self.restart,
            "shutdown" => self.shutdown,
            _ => true,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PowerOption {
    Suspend,
    Restart,
    Shutdown,
}

pub struct GuidePreferences {
    path: PathBuf,
    options: Mutex<PowerOptions>,
}

impl GuidePreferences {
    pub fn load(path: PathBuf) -> Self {
        let options = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            options: Mutex::new(options),
        }
    }

    pub fn options(&self) -> PowerOptions {
        *self.options.lock().unwrap()
    }
}

#[tauri::command]
pub fn guide_power_options(preferences: State<'_, GuidePreferences>) -> PowerOptions {
    preferences.options()
}

#[tauri::command(async)]
pub fn guide_set_power_option(
    preferences: State<'_, GuidePreferences>,
    option: PowerOption,
    enabled: bool,
) -> Result<PowerOptions, String> {
    let mut current = preferences.options.lock().unwrap();
    let mut next = *current;
    match option {
        PowerOption::Suspend => next.suspend = enabled,
        PowerOption::Restart => next.restart = enabled,
        PowerOption::Shutdown => next.shutdown = enabled,
    }

    let parent = preferences
        .path
        .parent()
        .ok_or("Pasta de configuração indisponível.")?;
    let temporary = preferences.path.with_extension("tmp");
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let contents = serde_json::to_vec(&next).map_err(|error| error.to_string())?;
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    fs::rename(temporary, &preferences.path).map_err(|error| error.to_string())?;
    *current = next;
    Ok(next)
}
