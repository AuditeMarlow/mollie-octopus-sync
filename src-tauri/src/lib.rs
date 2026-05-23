mod commands;
mod config;
mod logger;
mod secrets;

use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Register single-instance first so a second launch is short-circuited
        // before any other plugin touches the data dir. Otherwise two
        // processes would race on credentials.json / config.json and run
        // parallel sync timers.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_window(app);
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::get_credentials,
            commands::set_credentials,
            commands::clear_credentials,
            commands::has_credentials,
            commands::load_config,
            commands::save_config,
            commands::log_line,
            commands::open_logs_folder,
            commands::app_data_dir,
            commands::show_main_window,
        ])
        .on_window_event(|window, event| {
            // Close (X) hides the window instead of quitting. The app keeps
            // running in the tray so the periodic sync timer keeps firing.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "tray.open", "Open window", true, None::<&str>)?;
            let sync_item = MenuItem::with_id(app, "tray.sync", "Sync now", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray.quit", "Quit", true, None::<&str>)?;

            let menu = MenuBuilder::new(app)
                .item(&open_item)
                .item(&sync_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let icon = app
                .default_window_icon()
                .ok_or("missing default window icon")?
                .clone();

            TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("Mollie → EmailOctopus Sync")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray.open" => show_window(app),
                    "tray.sync" => {
                        // The JS side owns the sync engine. We just emit an event
                        // for it to react to; whether the window is visible or
                        // hidden, the JS context is alive and listening.
                        show_window(app);
                        let _ = app.emit("tray://sync-now", ());
                    }
                    "tray.quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click on the tray icon itself opens the window.
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
