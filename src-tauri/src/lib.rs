mod audio;
pub mod commands;
mod config;
pub mod library;
pub mod logs;
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            logs::init(&app_data_dir);
            logs::install_panic_hook();
            logs::info(format!(
                "--- transcriptor {} starting ({}) ---",
                app.package_info().version,
                std::env::consts::OS
            ));
            let conn = library::open(&app_data_dir).map_err(std::io::Error::other)?;
            // A run interrupted by a quit/crash is stuck as "running" with no
            // way back — requeue it, then kick the worker so it resumes (and so
            // anything still queued from last session gets picked up at all).
            let orphans = library::requeue_orphans(&conn).map_err(std::io::Error::other)?;
            if orphans > 0 {
                logs::info(format!("requeued {orphans} work(s) interrupted by the last shutdown"));
            }
            app.manage(Library(std::sync::Mutex::new(conn)));
            app.manage(commands::QueueState::default());
            // Unconditional: works left `queued` from last session need the
            // worker started too, and it self-exits immediately when the queue
            // is empty.
            commands::start_queue_worker(app.handle().clone());

            // On macOS the first submenu becomes the application (about/quit) menu
            // regardless of its label — see Tauri's window-menu docs. The edit
            // items live in it rather than their own "Edit" menu: the menu bar
            // stays to one entry, but the items still register Cmd+C/V/X/Z/A for
            // the webview, which stop working entirely if they're not in a menu.
            let app_menu = SubmenuBuilder::new(app, "Transcriptor")
                .about(None)
                .separator()
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .quit()
                .build()?;
            let menu = MenuBuilder::new(app).items(&[&app_menu]).build()?;
            app.set_menu(menu)?;

            // Built here rather than in tauri.conf.json because the traffic-light
            // inset is builder-only. The window has no OS title bar on any
            // platform — Header.tsx draws the 28px strip that stands in for it.
            let win = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::default(),
            )
            .title("Transcriptor")
            .inner_size(1180.0, 780.0)
            .min_inner_size(860.0, 560.0);
            // Windows/Linux draw their own controls in that strip; macOS keeps
            // the real traffic lights, so it needs decorations left on.
            #[cfg(not(target_os = "macos"))]
            let win = win.decorations(false);
            #[cfg(target_os = "macos")]
            let win = win
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                // tao reads y as the gap *below* the buttons and sizes the
                // title-bar container to `button_height + y`, so y must exceed
                // the 12px button height or the corner radius clips them:
                // 16 gives a 28px container with the buttons centred in it.
                .traffic_light_position(tauri::LogicalPosition::new(20.0, 16.0));
            win.build()?;

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
            commands::import_subtitle,
            commands::write_subtitle,
            commands::preview_export,
            commands::export_transcript,
            commands::read_log,
            commands::log_path,
            commands::reveal_log,
            commands::log_ui_error,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
