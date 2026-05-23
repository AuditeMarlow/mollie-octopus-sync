use tauri_plugin_opener::OpenerExt;

use crate::config::{self, AppConfig};
use crate::logger;
use crate::secrets::{self, Credentials};

#[tauri::command]
pub fn get_credentials() -> Result<Credentials, String> {
    secrets::load()
}

#[tauri::command]
pub fn set_credentials(credentials: Credentials) -> Result<(), String> {
    secrets::store(&credentials)
}

#[tauri::command]
pub fn clear_credentials() -> Result<(), String> {
    secrets::clear()
}

#[tauri::command]
pub fn has_credentials() -> Result<bool, String> {
    let c = secrets::load()?;
    Ok(c.mollie_api_key.is_some() && c.emailoctopus_api_key.is_some())
}

#[tauri::command]
pub fn load_config() -> Result<AppConfig, String> {
    config::load()
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    config::save(&config)
}

#[tauri::command]
pub fn log_line(level: String, message: String) -> Result<(), String> {
    logger::append(&level, &message)
}

#[tauri::command]
pub fn app_data_dir() -> Result<String, String> {
    Ok(config::app_data_dir()?.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn open_logs_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = logger::logs_dir()?;
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| format!("open logs folder: {e}"))
}

#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        w.show().map_err(|e| format!("show: {e}"))?;
        w.unminimize().map_err(|e| format!("unminimize: {e}"))?;
        w.set_focus().map_err(|e| format!("focus: {e}"))?;
    }
    Ok(())
}
