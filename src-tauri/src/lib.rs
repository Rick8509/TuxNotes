mod attachments;
mod backup_service;
mod commands;
mod credentials;
mod export;
mod files;
mod google_client;
mod identity;
mod legacy_id;
mod settings;
mod spelling;

use std::sync::Mutex;
use std::time::Duration;

use backup_service::BackupService;
use tauri::{AppHandle, Emitter, Manager};
use tuxnotes_core::Store;

/// Shared application state. SQLite connections are not `Sync`, so the store
/// lives behind a mutex; every command holds it only for one short operation.
pub struct AppState {
    pub store: Mutex<Store>,
    pub backup: BackupService,
    /// `<data dir>/attachments`: one folder per attachment, named by its id.
    pub attachments_dir: std::path::PathBuf,
}

/// How often the scheduler checks whether an automatic backup is due.
const AUTO_BACKUP_CHECK: Duration = Duration::from_secs(15 * 60);
/// Give the app time to settle before the first automatic backup.
const AUTO_BACKUP_INITIAL_DELAY: Duration = Duration::from_secs(90);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let context = tauri::generate_context!();
    // Before anything opens the data folders: bring them over from the old app ID.
    if !legacy_id::migrate(&context.config().identifier) {
        #[cfg(target_os = "linux")]
        legacy_id::ask_to_close_old_version();
        return;
    }

    // Files given on the command line ("Open With TuxNotes", `tuxnotes notes.txt`) open in
    // the Files window; the notes window then stays hidden until asked for.
    let cwd = std::env::current_dir().unwrap_or_default();
    let startup_files = files::paths_from_args(&std::env::args().collect::<Vec<_>>(), &cwd);
    let started_for_files = !startup_files.is_empty();

    tauri::Builder::default()
        // Must be first: a second launch opens its files here, or shows the notes window.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = files::paths_from_args(&args, std::path::Path::new(&cwd));
            if paths.is_empty() {
                files::show_notes_window(app);
            } else {
                files::open_paths(app, paths);
            }
        }))
        // Remember window size, position and maximized state between launches. Not whether
        // a window was visible: the notes window starts hidden and is shown in RunEvent::Ready.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Serves note images/files to the editor by id (see attachments.rs).
        .register_asynchronous_uri_scheme_protocol("attachment", attachments::handle_protocol)
        .on_window_event(files::on_window_event)
        .setup(move |app| {
            app.manage(files::OpenFiles::default());
            if started_for_files {
                files::open_paths(app.handle(), startup_files.clone());
            }
            // ~/.local/share/<identifier>/notes.db and ~/.config/<identifier>/settings.json
            let data_dir = app.path().app_data_dir()?;
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("notes.db");
            log::info!("opening database at {}", db_path.display());

            let store = Store::open(&db_path)?;
            match store.purge_expired_trash() {
                Ok(0) => {}
                Ok(n) => log::info!("purged {n} expired note(s) from Recently Deleted"),
                Err(e) => log::warn!("could not purge expired trash: {e}"),
            }
            match store.discard_blank_notes() {
                Ok(0) => {}
                Ok(n) => log::info!("removed {n} empty note(s) left from last session"),
                Err(e) => log::warn!("could not clean up empty notes: {e}"),
            }
            let attachments_dir = data_dir.join("attachments");
            match store.collect_unused_attachments(
                &attachments_dir,
                backup_service::now_ms(),
                tuxnotes_core::attachments::UNUSED_GRACE_MS,
            ) {
                Ok(0) => {}
                Ok(n) => log::info!("removed {n} attachment(s) no note uses any more"),
                Err(e) => log::warn!("could not clean up attachments: {e}"),
            }
            let backup = BackupService::new(
                &app.config().identifier,
                data_dir,
                config_dir,
                db_path,
                app.package_info().version.to_string(),
            );
            backup.clean_tmp();
            backup.set_change_baseline(store.change_count());
            app.manage(AppState {
                store: Mutex::new(store),
                backup,
                attachments_dir,
            });
            app.manage(export::ImportSession::default());
            spawn_auto_backup(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_folders,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_folder,
            commands::list_notes,
            commands::get_note,
            commands::create_note,
            commands::update_note_content,
            commands::set_note_pinned,
            commands::duplicate_note,
            commands::lock_status,
            commands::set_lock_password,
            commands::change_lock_password,
            commands::unlock_notes,
            commands::lock_notes,
            commands::lock_note,
            commands::remove_note_lock,
            commands::move_note,
            commands::trash_note,
            commands::restore_note,
            commands::delete_note_permanently,
            commands::empty_trash,
            commands::trash_count,
            commands::data_version,
            commands::search_notes,
            commands::discard_note_if_blank,
            commands::backup_status,
            commands::set_backup_preferences,
            commands::set_backup_password,
            commands::backup_on_close_needed,
            commands::backup_before_exit,
            commands::google_sign_in,
            commands::google_cancel_sign_in,
            commands::google_sign_out,
            commands::backup_now,
            commands::list_backups,
            commands::restore_backup,
            commands::app_info,
            files::take_pending_files,
            files::read_text_file,
            files::open_file_dialog,
            files::file_status,
            files::save_text_file,
            files::save_text_file_as,
            spelling::spelling_info,
            spelling::set_spelling,
            attachments::add_attachment,
            attachments::attach_files,
            attachments::paste_from_clipboard,
            attachments::open_attachment,
            attachments::attachment_image,
            attachments::save_attachment_as,
            export::export_markdown,
            export::pick_markdown_files,
            export::import_image,
            export::print_note,
            export::export_pdf,
        ])
        .build(context)
        .expect("error while starting TuxNotes")
        .run(move |app, event| {
            // The notes window starts hidden (tauri.conf.json) so that opening a file shows
            // only the Files window.
            if let tauri::RunEvent::Ready = event
                && !started_for_files
            {
                files::show_notes_window(app);
            }
        });
}

/// Background loop that runs automatic backups when they're due.
fn spawn_auto_backup(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(AUTO_BACKUP_INITIAL_DELAY).await;
        loop {
            let state = app.state::<AppState>();
            let due = match state.store.lock() {
                Ok(store) => state
                    .backup
                    .auto_backup_due(&store, backup_service::now_ms()),
                Err(_) => false,
            };
            if due {
                log::info!("starting automatic backup");
                let result = state.backup.backup_now(&app).await;
                state
                    .backup
                    .auto_backup_finished(result.is_ok(), backup_service::now_ms());
                match result {
                    Ok(info) => log::info!("automatic backup finished: {}", info.name),
                    Err(e) => log::warn!("automatic backup failed: {e}"),
                }
                let _ = app.emit("backup-status-changed", ());
            }
            tokio::time::sleep(AUTO_BACKUP_CHECK).await;
        }
    });
}
