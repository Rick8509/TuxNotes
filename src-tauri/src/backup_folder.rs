//! Backups in a folder: on a USB drive, or in a folder that Nextcloud, Dropbox or
//! Syncthing keeps in sync. Each backup is one file (the same archive that goes to Google
//! Drive), named `tuxnotes-backup-<UTC time>.zip`, or `.zip.enc` when encrypted, inside a
//! "TuxNotes Backups" folder in the folder the user picked.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tuxnotes_core::backup;
use tuxnotes_core::encrypted_backup;

/// A backup file in the folder, with what can be read from it without a password.
#[derive(Debug, Clone, PartialEq)]
pub struct FolderBackup {
    pub name: String,
    /// From the file name (to the second), like the order backups are kept in.
    pub created_at: i64,
    pub size: u64,
    pub note_count: Option<i64>,
    pub app_version: Option<String>,
    pub encrypted: bool,
    /// Hex salt of the password an encrypted backup was made with.
    pub key_salt: Option<String>,
}

/// Unfinished copies left by an interrupted backup are removed after this long.
const PARTIAL_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

pub fn missing_message(dir: &Path) -> String {
    format!(
        "The backup folder isn't available: {}. If it's on a USB drive, plug the drive in; \
         or choose another folder in Settings → Backup.",
        dir.display()
    )
}

/// Where backups go when the user picks `picked`: the folder itself when it already has
/// TuxNotes backups in it (or is the backups folder), otherwise a `folder_name` folder
/// inside it (e.g. "TuxNotes Backups").
pub fn backups_dir_in(picked: &Path, folder_name: &str) -> PathBuf {
    let is_backups_folder = picked
        .file_name()
        .is_some_and(|n| n == folder_name || n == "TuxNotes Backups");
    if is_backups_folder || has_backups(picked) {
        picked.to_path_buf()
    } else {
        picked.join(folder_name)
    }
}

fn has_backups(dir: &Path) -> bool {
    fs::read_dir(dir)
        .is_ok_and(|entries| entries.flatten().any(|e| backup_name(&e.path()).is_some()))
}

/// The file name, when `path` is named like a backup.
fn backup_name(path: &Path) -> Option<&str> {
    let name = path.file_name()?.to_str()?;
    backup::backup_name_time(name).map(|_| name)
}

/// Get the backups folder for `picked` ready: create it if needed and make sure TuxNotes
/// can write there. Returns it.
pub fn prepare(picked: &Path, folder_name: &str) -> Result<PathBuf, String> {
    if !picked.is_dir() {
        return Err(format!("This folder doesn't exist: {}", picked.display()));
    }
    let dir = backups_dir_in(picked, folder_name);
    if dir.to_str().is_none() {
        return Err(
            "TuxNotes can't use this folder: its name has characters it can't read.".into(),
        );
    }
    if !dir.exists() {
        fs::create_dir(&dir).map_err(|e| {
            format!(
                "TuxNotes can't create a folder in {}: {}",
                picked.display(),
                describe(&e)
            )
        })?;
    }
    let probe = dir.join(format!(".tuxnotes-write-test-{}", std::process::id()));
    File::create(&probe)
        .and_then(|f| f.sync_all())
        .map_err(|e| {
            format!(
                "TuxNotes can't save files in {}: {}",
                dir.display(),
                describe(&e)
            )
        })?;
    let _ = fs::remove_file(&probe);
    Ok(dir)
}

/// Copy the finished backup `src` into `dir` as `name`. It's written under a hidden
/// temporary name, flushed to the disk and then renamed, so the folder (and anything
/// syncing it) only ever sees complete backups, even if the drive is pulled out midway.
/// Returns its size.
pub fn save(src: &Path, dir: &Path, name: &str) -> Result<u64, String> {
    if !dir.is_dir() {
        return Err(missing_message(dir));
    }
    let partial = dir.join(format!(".{name}.partial"));
    let result = (|| {
        let mut from = File::open(src)?;
        let mut to = File::create(&partial)?;
        let size = io::copy(&mut from, &mut to)?;
        to.sync_all()?;
        drop(to);
        fs::rename(&partial, dir.join(name))?;
        // Make the rename itself survive a sudden unplug.
        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
        Ok::<_, io::Error>(size)
    })();
    result.map_err(|e| {
        let _ = fs::remove_file(&partial);
        format!(
            "Couldn't save the backup in {}: {}",
            dir.display(),
            describe(&e)
        )
    })
}

/// Keep the `keep` newest backups in `dir` and remove the older ones (only files named
/// like TuxNotes backups; nothing else in the folder is touched). Also removes unfinished
/// copies from interrupted backups. Returns how many backups were removed.
pub fn prune(dir: &Path, keep: usize) -> Result<usize, String> {
    let mut backups: Vec<(i64, PathBuf)> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| describe(&e))?.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if let Some(time) = backup::backup_name_time(name) {
            if path.is_file() {
                backups.push((time, path));
            }
        } else if let Some(inner) = name
            .strip_prefix('.')
            .and_then(|n| n.strip_suffix(".partial"))
            && backup::backup_name_time(inner).is_some()
            && entry.metadata().and_then(|m| m.modified()).is_ok_and(|t| {
                SystemTime::now().duration_since(t).unwrap_or_default() > PARTIAL_MAX_AGE
            })
        {
            let _ = fs::remove_file(&path);
        }
    }
    // Newest first; the same time sorts encrypted and plain copies by name.
    backups.sort_by(|a, b| b.cmp(a));
    let mut removed = 0;
    for (_, old) in backups.into_iter().skip(keep) {
        fs::remove_file(&old).map_err(|e| describe(&e))?;
        log::info!("removed old backup {}", old.display());
        removed += 1;
    }
    Ok(removed)
}

/// The backups in `dir`, newest first.
pub fn list(dir: &Path) -> Result<Vec<FolderBackup>, String> {
    if !dir.is_dir() {
        return Err(missing_message(dir));
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| describe(&e))?.flatten() {
        let path = entry.path();
        let Some(name) = backup_name(&path) else {
            continue;
        };
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let mut item = FolderBackup {
            name: name.to_string(),
            created_at: backup::backup_name_time(name).unwrap_or(0),
            size: meta.len(),
            note_count: None,
            app_version: None,
            encrypted: name.ends_with(".enc"),
            key_salt: None,
        };
        match encrypted_backup::read_header(&path) {
            Ok(Some(header)) => {
                item.encrypted = true;
                item.key_salt = Some(header.salt.iter().map(|b| format!("{b:02x}")).collect());
            }
            // Encrypted backups don't say how many notes they hold.
            Ok(None) if !item.encrypted => {
                if let Ok(manifest) = backup::read_manifest(&path) {
                    item.note_count = Some(manifest.note_count);
                    item.app_version = Some(manifest.app_version);
                }
            }
            // Damaged: still listed, restoring it explains what's wrong.
            _ => {}
        }
        out.push(item);
    }
    out.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.name.cmp(&a.name))
    });
    Ok(out)
}

/// Copy the backup `name` from `dir` to `dest` for restoring. Returns whether it should
/// be encrypted (named `.enc`): such a file without encryption isn't restored.
pub fn fetch(dir: &Path, name: &str, dest: &Path) -> Result<bool, String> {
    // Only names TuxNotes gives its backups: never a path to somewhere else.
    if backup::backup_name_time(name).is_none() {
        return Err("That isn't a TuxNotes backup.".into());
    }
    if !dir.is_dir() {
        return Err(missing_message(dir));
    }
    let path = dir.join(name);
    if !path.is_file() {
        return Err("This backup isn't in the folder any more.".into());
    }
    fs::copy(&path, dest).map_err(|e| format!("Couldn't read the backup: {}", describe(&e)))?;
    Ok(name.ends_with(".enc"))
}

/// An I/O error in plain words.
fn describe(e: &io::Error) -> String {
    match e.raw_os_error() {
        Some(28) => "there isn't enough free space".into(), // ENOSPC
        Some(30) => "it's read-only".into(),                // EROFS
        Some(13) | Some(1) => "permission denied".into(),   // EACCES, EPERM
        _ => e.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, data: &[u8]) {
        fs::write(path, data).unwrap();
    }

    #[test]
    fn backs_up_into_a_tuxnotes_backups_folder_unless_picked_directly() {
        let tmp = tempfile::tempdir().unwrap();
        let nextcloud = tmp.path().join("Nextcloud");
        fs::create_dir(&nextcloud).unwrap();
        assert_eq!(
            backups_dir_in(&nextcloud, "TuxNotes Backups"),
            nextcloud.join("TuxNotes Backups")
        );
        // Picking the backups folder itself, or any folder that already has backups.
        let own = nextcloud.join("TuxNotes Backups");
        assert_eq!(backups_dir_in(&own, "TuxNotes Backups"), own);
        assert_eq!(
            backups_dir_in(&own, "TuxNotes Dev Backups"),
            own,
            "the dev app can restore TuxNotes backups"
        );
        let usb = tmp.path().join("USB");
        fs::create_dir(&usb).unwrap();
        write(&usb.join("tuxnotes-backup-20261119-140533.zip"), b"x");
        assert_eq!(backups_dir_in(&usb, "TuxNotes Backups"), usb);
        // The dev app keeps its own backups apart.
        assert_eq!(
            backups_dir_in(&nextcloud, "TuxNotes Dev Backups"),
            nextcloud.join("TuxNotes Dev Backups")
        );
    }

    #[test]
    fn prepare_creates_the_folder_and_checks_it_can_write() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = prepare(tmp.path(), "TuxNotes Backups").unwrap();
        assert_eq!(dir, tmp.path().join("TuxNotes Backups"));
        assert!(dir.is_dir());
        assert_eq!(
            fs::read_dir(&dir).unwrap().count(),
            0,
            "the write test leaves nothing behind"
        );
        assert_eq!(
            prepare(tmp.path(), "TuxNotes Backups").unwrap(),
            dir,
            "choosing it again is fine"
        );
        let gone = tmp.path().join("unplugged");
        assert!(
            prepare(&gone, "TuxNotes Backups")
                .unwrap_err()
                .contains("doesn't exist")
        );
    }

    #[test]
    fn saves_complete_files_only() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archive.zip");
        write(&src, b"backup bytes");
        let dir = tmp.path().join("TuxNotes Backups");
        fs::create_dir(&dir).unwrap();
        let name = "tuxnotes-backup-20261119-140533.zip";
        assert_eq!(save(&src, &dir, name).unwrap(), 12);
        assert_eq!(fs::read(dir.join(name)).unwrap(), b"backup bytes");
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(
            names,
            vec![std::ffi::OsString::from(name)],
            "no temporary file left"
        );
        // The folder is gone (drive unplugged): a clear message, nothing written elsewhere.
        let unplugged = tmp.path().join("USB/TuxNotes Backups");
        let e = save(&src, &unplugged, name).unwrap_err();
        assert!(
            e.contains("isn't available") && e.contains("plug the drive in"),
            "{e}"
        );
        assert!(!unplugged.exists());
        // A source that can't be read leaves no partial file.
        assert!(
            save(
                &tmp.path().join("missing.zip"),
                &dir,
                "tuxnotes-backup-20261119-140534.zip"
            )
            .is_err()
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn prune_keeps_the_newest_and_touches_nothing_else() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        for name in [
            "tuxnotes-backup-20261101-090000.zip",
            "tuxnotes-backup-20261102-090000.zip.enc",
            "tuxnotes-backup-20261103-090000.zip",
            "tuxnotes-backup-20261104-090000.zip.enc",
            "holiday.jpg",
            "tuxnotes-backup-notes.zip",
            "tuxnotes-before-restore-20261101-090000.zip",
        ] {
            write(&dir.join(name), b"x");
        }
        // An unfinished copy from just now (another backup may be writing it) stays.
        write(
            &dir.join(".tuxnotes-backup-20261105-090000.zip.partial"),
            b"x",
        );
        assert_eq!(prune(dir, 2).unwrap(), 2);
        let mut left: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(
            left,
            [
                ".tuxnotes-backup-20261105-090000.zip.partial",
                "holiday.jpg",
                "tuxnotes-backup-20261103-090000.zip",
                "tuxnotes-backup-20261104-090000.zip.enc",
                "tuxnotes-backup-notes.zip",
                "tuxnotes-before-restore-20261101-090000.zip",
            ]
        );
        // An old unfinished copy is cleaned up.
        let old = File::options()
            .write(true)
            .open(dir.join(".tuxnotes-backup-20261105-090000.zip.partial"))
            .unwrap();
        old.set_modified(SystemTime::now() - Duration::from_secs(2 * 24 * 3600))
            .unwrap();
        prune(dir, 2).unwrap();
        assert!(
            !dir.join(".tuxnotes-backup-20261105-090000.zip.partial")
                .exists()
        );
    }

    #[test]
    fn lists_what_each_backup_holds() {
        use tuxnotes_core::Store;
        use tuxnotes_core::crypto::KdfParams;
        use tuxnotes_core::encrypted_backup::BackupKey;
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::open(tmp.path().join("notes.db")).unwrap();
        store.create_note(None).unwrap();
        store.create_note(None).unwrap();
        let dir = tmp.path().join("TuxNotes Backups");
        fs::create_dir(&dir).unwrap();
        let plain = dir.join("tuxnotes-backup-20261101-090000.zip");
        let manifest = backup::create_backup(&store, None, &plain, "0.2.0").unwrap();
        let fast = KdfParams {
            m_kib: 8 * 1024,
            t: 1,
            p: 1,
        };
        let key = BackupKey::create_with("correct horse battery", fast).unwrap();
        encrypted_backup::encrypt_file(
            &plain,
            &dir.join("tuxnotes-backup-20261102-090000.zip.enc"),
            &key,
        )
        .unwrap();
        // Damaged or not a backup at all: listed (restoring says what's wrong) or ignored.
        write(
            &dir.join("tuxnotes-backup-20261103-090000.zip"),
            b"not a zip",
        );
        write(&dir.join("notes.txt"), b"hello");

        let found = list(&dir).unwrap();
        let names: Vec<&str> = found.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "tuxnotes-backup-20261103-090000.zip",
                "tuxnotes-backup-20261102-090000.zip.enc",
                "tuxnotes-backup-20261101-090000.zip"
            ],
            "newest first"
        );
        let (damaged, sealed, open) = (&found[0], &found[1], &found[2]);
        assert_eq!((damaged.note_count, damaged.encrypted), (None, false));
        assert!(
            sealed.encrypted && sealed.note_count.is_none(),
            "encrypted backups don't say what they hold"
        );
        assert_eq!(sealed.key_salt.as_deref().map(str::len), Some(32));
        assert_eq!(
            sealed.created_at,
            backup::backup_name_time(&sealed.name).unwrap()
        );
        assert!(!open.encrypted && open.key_salt.is_none());
        assert_eq!(open.note_count, Some(manifest.note_count));
        assert_eq!(open.note_count, Some(2));
        assert_eq!(
            open.created_at,
            backup::backup_name_time(&open.name).unwrap()
        );
        assert_eq!(open.app_version.as_deref(), Some("0.2.0"));
        assert_eq!(open.size, fs::metadata(&plain).unwrap().len());

        let e = list(&tmp.path().join("unplugged")).unwrap_err();
        assert!(e.contains("isn't available"), "{e}");
    }

    /// The whole round trip with real files: a backup saved in the folder, listed,
    /// fetched for restoring, decrypted and unpacked gives back the notes.
    #[test]
    fn a_folder_backup_restores_the_notes() {
        use tuxnotes_core::Store;
        use tuxnotes_core::crypto::KdfParams;
        use tuxnotes_core::encrypted_backup::BackupKey;
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::open(tmp.path().join("notes.db")).unwrap();
        let note = store.create_note(None).unwrap();
        let attachments = tmp.path().join("attachments");
        fs::create_dir(&attachments).unwrap();
        let usb = tmp.path().join("USB");
        fs::create_dir(&usb).unwrap();
        let dir = prepare(&usb, "TuxNotes Backups").unwrap();

        let work = tmp.path().join("work");
        fs::create_dir(&work).unwrap();
        let archive = work.join(backup::backup_file_name(1_795_097_133_000));
        backup::create_backup(&store, Some(&attachments), &archive, "0.2.0").unwrap();
        let key = BackupKey::create_with(
            "correct horse battery",
            KdfParams {
                m_kib: 8 * 1024,
                t: 1,
                p: 1,
            },
        )
        .unwrap();
        let sealed = archive.with_extension("zip.enc");
        encrypted_backup::encrypt_file(&archive, &sealed, &key).unwrap();
        let name = sealed.file_name().unwrap().to_str().unwrap();
        save(&sealed, &dir, name).unwrap();

        let found = list(&dir).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, name);
        assert_eq!(found[0].created_at, 1_795_097_133_000);

        let download = work.join("restore.download");
        assert!(fetch(&dir, name, &download).unwrap(), "must be encrypted");
        let header = encrypted_backup::read_header(&download)
            .unwrap()
            .expect("encrypted");
        assert!(key.fits(&header));
        let opened = work.join("restore.zip");
        encrypted_backup::decrypt_file(&download, &opened, &key).unwrap();
        let staged_db = work.join("restored.db");
        let manifest = backup::extract_backup(
            &opened,
            &staged_db,
            Some(&work.join("restored-attachments")),
        )
        .unwrap();
        assert_eq!(manifest.note_count, 1);
        let restored = Store::open(&staged_db).unwrap();
        assert_eq!(restored.get_note(&note.id).unwrap().id, note.id);
    }

    #[test]
    fn fetch_only_takes_backup_names() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("b");
        fs::create_dir(&dir).unwrap();
        write(&tmp.path().join("secret.txt"), b"no");
        let dest = tmp.path().join("restore.download");
        for bad in [
            "../secret.txt",
            "secret.txt",
            "/etc/passwd",
            "tuxnotes-backup-x.zip",
        ] {
            assert!(fetch(&dir, bad, &dest).is_err(), "{bad}");
        }
        assert!(!dest.exists());
        write(
            &dir.join("tuxnotes-backup-20261119-140533.zip.enc"),
            b"sealed",
        );
        assert!(
            fetch(&dir, "tuxnotes-backup-20261119-140533.zip.enc", &dest).unwrap(),
            "must be encrypted"
        );
        assert_eq!(fs::read(&dest).unwrap(), b"sealed");
        let e = fetch(&dir, "tuxnotes-backup-20261119-140534.zip", &dest).unwrap_err();
        assert!(e.contains("isn't in the folder"), "{e}");
    }
}
