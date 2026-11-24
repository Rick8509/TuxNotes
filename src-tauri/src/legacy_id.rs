//! Moving data from the app ID used before 0.1.0 was published.
//!
//! The app ID decides where TuxNotes keeps its files (`~/.local/share/<id>`,
//! `~/.config/<id>`, `~/.cache/<id>`). It changed from `io.github.tuxnotes.TuxNotes`
//! to `io.github.Rick8509.TuxNotes`; on start, folders under the old name are renamed
//! to the new one. A rename keeps everything (notes, attachments, safety copies,
//! settings, preferences, window size) and either happens completely or not at all.
//!
//! This must run before Tauri starts: the window and WebKit open these folders as
//! soon as they're created.

use std::fs;
use std::path::{Path, PathBuf};

/// The app ID before 0.1.0 was published.
pub const LEGACY_ID: &str = "io.github.tuxnotes.TuxNotes";
/// The app ID of TuxNotes releases. Only this app takes over the old folders: other
/// builds (TuxNotes Dev, `io.github.Rick8509.TuxNotes.Dev`) keep their own.
pub const CURRENT_ID: &str = "io.github.Rick8509.TuxNotes";

/// Whether the app with this ID should take over data from [`LEGACY_ID`].
pub fn takes_over_legacy_data(app_id: &str) -> bool {
    app_id == CURRENT_ID
}

/// What happened to one folder.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Nothing under the old name.
    NothingToMove,
    /// Renamed to the new name.
    Moved,
    /// Both names exist; the new one is used and the old one left alone.
    BothExist,
}

/// Rename `<base>/<LEGACY_ID>` to `<base>/<new_id>` when only the old one exists.
pub fn move_folder(base: &Path, new_id: &str) -> std::io::Result<Outcome> {
    let old = base.join(LEGACY_ID);
    let new = base.join(new_id);
    if new_id == LEGACY_ID || !old.is_dir() {
        return Ok(Outcome::NothingToMove);
    }
    if new.exists() {
        return Ok(Outcome::BothExist);
    }
    fs::rename(&old, &new)?;
    Ok(Outcome::Moved)
}

/// The base folders Tauri puts `<id>` folders in (same rules as Tauri: the `dirs` crate).
fn bases() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = [dirs::data_dir(), dirs::config_dir(), dirs::cache_dir()]
        .into_iter()
        .flatten()
        .collect();
    if let Some(local) = dirs::data_local_dir()
        && !out.contains(&local)
    {
        out.push(local);
    }
    out
}

/// True if a process has `file` open (for example a TuxNotes from before the update
/// that is still running, which has its notes database open).
pub fn file_in_use(file: &Path) -> bool {
    let Ok(procs) = fs::read_dir("/proc") else {
        return false;
    };
    for proc in procs.flatten() {
        let name = proc.file_name();
        if !name.to_string_lossy().bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let Ok(fds) = fs::read_dir(proc.path().join("fd")) else {
            continue; // another user's process, or it just ended
        };
        if fds
            .flatten()
            .any(|fd| fs::read_link(fd.path()).is_ok_and(|target| target == file))
        {
            return true;
        }
    }
    false
}

/// Move all folders from the old app ID. Returns `false` if TuxNotes from before the
/// update is still running: nothing is moved, and the caller should ask the user to
/// close it first (otherwise this TuxNotes would start without the notes).
pub fn migrate(new_id: &str) -> bool {
    if !takes_over_legacy_data(new_id) {
        return true;
    }
    let Some(data) = dirs::data_dir() else {
        return true;
    };
    let old_db = data.join(LEGACY_ID).join("notes.db");
    if old_db.exists() && !data.join(new_id).exists() && file_in_use(&old_db) {
        return false;
    }
    for base in bases() {
        match move_folder(&base, new_id) {
            Ok(Outcome::NothingToMove) => {}
            Ok(Outcome::Moved) => log::info!(
                "moved {} to {}",
                base.join(LEGACY_ID).display(),
                base.join(new_id).display()
            ),
            Ok(Outcome::BothExist) => log::warn!(
                "both {} and {} exist; using the second",
                base.join(LEGACY_ID).display(),
                base.join(new_id).display()
            ),
            Err(e) => log::error!("could not move {}: {e}", base.join(LEGACY_ID).display()),
        }
    }
    true
}

/// Tell the user to close the TuxNotes that's still running from before the update.
#[cfg(target_os = "linux")]
pub fn ask_to_close_old_version() {
    use gtk::prelude::*;
    if gtk::init().is_err() {
        eprintln!(
            "TuxNotes was updated: close the TuxNotes that is still open, then start it again."
        );
        return;
    }
    let dialog = gtk::MessageDialog::new(
        None::<&gtk::Window>,
        gtk::DialogFlags::MODAL,
        gtk::MessageType::Info,
        gtk::ButtonsType::Ok,
        "TuxNotes was updated",
    );
    dialog.set_secondary_text(Some(
        "The previous version is still open. Close that TuxNotes window, then start TuxNotes again. \
         Your notes move to the new version the first time it starts.",
    ));
    dialog.set_title("TuxNotes");
    dialog.run();
    dialog.close();
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEW_ID: &str = "io.github.Rick8509.TuxNotes";

    fn temp_base(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tuxnotes-legacy-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn moves_the_old_folder_with_everything_in_it() {
        let base = temp_base("move");
        let old = base.join(LEGACY_ID);
        fs::create_dir_all(old.join("attachments/a1")).unwrap();
        fs::write(old.join("notes.db"), b"db").unwrap();
        fs::write(old.join("attachments/a1/pic.png"), b"png").unwrap();

        assert_eq!(move_folder(&base, NEW_ID).unwrap(), Outcome::Moved);
        assert!(!old.exists());
        let new = base.join(NEW_ID);
        assert_eq!(fs::read(new.join("notes.db")).unwrap(), b"db");
        assert_eq!(
            fs::read(new.join("attachments/a1/pic.png")).unwrap(),
            b"png"
        );
        // A second start has nothing left to move.
        assert_eq!(move_folder(&base, NEW_ID).unwrap(), Outcome::NothingToMove);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn never_overwrites_the_new_folder() {
        let base = temp_base("both");
        fs::create_dir_all(base.join(LEGACY_ID)).unwrap();
        fs::write(base.join(LEGACY_ID).join("notes.db"), b"old").unwrap();
        fs::create_dir_all(base.join(NEW_ID)).unwrap();
        fs::write(base.join(NEW_ID).join("notes.db"), b"new").unwrap();

        assert_eq!(move_folder(&base, NEW_ID).unwrap(), Outcome::BothExist);
        assert_eq!(
            fs::read(base.join(LEGACY_ID).join("notes.db")).unwrap(),
            b"old"
        );
        assert_eq!(
            fs::read(base.join(NEW_ID).join("notes.db")).unwrap(),
            b"new"
        );
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn nothing_to_do_without_an_old_folder_or_with_the_same_id() {
        let base = temp_base("none");
        assert_eq!(move_folder(&base, NEW_ID).unwrap(), Outcome::NothingToMove);
        fs::create_dir_all(base.join(LEGACY_ID)).unwrap();
        assert_eq!(
            move_folder(&base, LEGACY_ID).unwrap(),
            Outcome::NothingToMove
        );
        assert!(base.join(LEGACY_ID).exists());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn sees_a_file_that_a_process_has_open() {
        let base = temp_base("open");
        let file = base.join("notes.db");
        fs::write(&file, b"db").unwrap();
        assert!(!file_in_use(&file));
        let handle = fs::File::open(&file).unwrap();
        assert!(file_in_use(&file));
        drop(handle);
        assert!(!file_in_use(&file));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_app_uses_the_new_id() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], NEW_ID);
        assert_eq!(CURRENT_ID, NEW_ID);
    }

    #[test]
    fn only_the_real_app_takes_over_the_old_folders() {
        let dev: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.dev.conf.json")).unwrap();
        let dev_id = dev["identifier"].as_str().unwrap();
        assert_eq!(dev_id, "io.github.Rick8509.TuxNotes.Dev");
        assert!(takes_over_legacy_data(NEW_ID));
        assert!(!takes_over_legacy_data(dev_id));
        assert!(!takes_over_legacy_data(LEGACY_ID));
        // migrate() returns before looking at any folder for other apps.
        assert!(migrate(dev_id));
    }
}
