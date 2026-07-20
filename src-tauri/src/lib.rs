mod audio;
pub mod commands;
mod config;
pub mod library;
pub mod models;
mod whisper;

use library::Library;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let conn = library::open(&app_data_dir).map_err(std::io::Error::other)?;
            app.manage(Library(std::sync::Mutex::new(conn)));
            app.manage(commands::QueueState::default());

            // On macOS the first submenu becomes the application (about/quit) menu
            // regardless of its label — see Tauri's window-menu docs.
            let app_menu = SubmenuBuilder::new(app, "Transcriptor")
                .about(None)
                .separator()
                .quit()
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let menu = MenuBuilder::new(app).items(&[&app_menu, &edit_menu]).build()?;
            app.set_menu(menu)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_models,
            commands::download_model,
            commands::delete_model,
            commands::add_custom_model,
            commands::get_settings,
            commands::save_settings,
            commands::list_recent,
            commands::list_library,
            commands::search_library,
            commands::get_work,
            commands::delete_work,
            commands::rename_work,
            commands::update_transcript,
            commands::enqueue_files,
            commands::retry_work,
            commands::rerun_work,
            commands::rerun_segment,
            commands::cancel_work,
            commands::preview_export,
            commands::export_transcript,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
