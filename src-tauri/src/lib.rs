pub mod commands;
use commands::fs::{VaultState, VaultWatchState};
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultState(Mutex::new(None)))
        .manage(VaultWatchState(Mutex::new(None)))
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_file,
            commands::fs::write_file_atomic,
            commands::fs::write_binary_atomic,
            commands::fs::set_vault_root,
            commands::fs::read_vault_dir,
            commands::fs::start_vault_watch,
            commands::fs::stop_vault_watch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
