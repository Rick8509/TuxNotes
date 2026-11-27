//! Text and code files opened in TuxNotes' Files window (they stay files on disk; they
//! aren't notes).
//!
//! Paths only come from places the user chose: the command line / "Open With"
//! (`tuxnotes file.txt`), the Open dialog, and files dropped on the Files window. Each
//! gets an id, and the page refers to files only by id, so it can't read (or later save)
//! anything the user didn't open.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

/// Label of the Files window.
pub const FILES_WINDOW: &str = "files";
/// Bigger files aren't opened (the editor would get slow).
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// A NUL byte in this many first bytes means "not a text file".
const BINARY_SNIFF_BYTES: usize = 8000;

type CmdResult<T> = std::result::Result<T, String>;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub id: String,
    pub path: String,
    pub name: String,
}

#[derive(Default)]
struct Registry {
    next: u64,
    by_id: HashMap<String, PathBuf>,
    /// Opened but not yet picked up by the Files window.
    pending: Vec<String>,
}

/// Files the user opened (app state).
#[derive(Default)]
pub struct OpenFiles(Mutex<Registry>);

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

impl OpenFiles {
    /// The id for `path` (the same one if it was opened before).
    pub fn register(&self, path: PathBuf) -> FileEntry {
        let mut reg = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let id = match reg.by_id.iter().find(|(_, p)| **p == path) {
            Some((id, _)) => id.clone(),
            None => {
                reg.next += 1;
                let id = format!("f{}", reg.next);
                reg.by_id.insert(id.clone(), path.clone());
                id
            }
        };
        FileEntry {
            id,
            name: file_name(&path),
            path: path.display().to_string(),
        }
    }

    /// Register `path` and have the Files window open it.
    pub fn queue(&self, path: PathBuf) {
        let entry = self.register(path);
        let mut reg = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if !reg.pending.contains(&entry.id) {
            reg.pending.push(entry.id);
        }
    }

    pub fn path(&self, id: &str) -> Option<PathBuf> {
        self.0.lock().ok()?.by_id.get(id).cloned()
    }

    fn take_pending(&self) -> Vec<FileEntry> {
        let mut reg = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let ids = std::mem::take(&mut reg.pending);
        ids.into_iter()
            .filter_map(|id| {
                let path = reg.by_id.get(&id)?;
                Some(FileEntry {
                    name: file_name(path),
                    path: path.display().to_string(),
                    id,
                })
            })
            .collect()
    }
}

/// File paths among command-line arguments (from "Open With" or a terminal): options are
/// skipped, `file://` URLs and relative paths are resolved, only existing files are kept.
pub fn paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for arg in args.iter().skip(1) {
        if arg.is_empty() || arg.starts_with('-') {
            continue;
        }
        let path = if arg.starts_with("file://") {
            match tauri::Url::parse(arg)
                .ok()
                .and_then(|u| u.to_file_path().ok())
            {
                Some(p) => p,
                None => continue,
            }
        } else {
            let p = PathBuf::from(arg);
            if p.is_absolute() { p } else { cwd.join(p) }
        };
        let Ok(path) = std::fs::canonicalize(&path) else {
            continue;
        };
        if path.is_file() && !out.contains(&path) {
            out.push(path);
        }
    }
    out
}

// ------------------------------------------------------------------ reading

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub id: String,
    pub path: String,
    pub name: String,
    pub text: String,
    /// "UTF-8", "UTF-8 with BOM", "UTF-16 LE", "UTF-16 BE" or "Windows-1252".
    pub encoding: &'static str,
    /// "LF", "CRLF", "CR", or "LF" for files without line breaks.
    pub line_ending: &'static str,
    /// The file can't be saved (no write permission).
    pub read_only: bool,
    pub size: u64,
    /// Last modified, Unix milliseconds.
    pub modified: i64,
}

#[derive(Debug, PartialEq)]
pub enum DecodeError {
    Binary,
}

/// Bytes → text and the encoding it was in. Byte order marks are recognized; otherwise
/// UTF-8, and Windows-1252 (which covers Latin-1) when the bytes aren't valid UTF-8.
pub fn decode(bytes: &[u8]) -> Result<(String, &'static str), DecodeError> {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return Ok((String::from_utf8_lossy(rest).into_owned(), "UTF-8 with BOM"));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let (text, _) = encoding_rs::UTF_16LE.decode_without_bom_handling(rest);
        return Ok((text.into_owned(), "UTF-16 LE"));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let (text, _) = encoding_rs::UTF_16BE.decode_without_bom_handling(rest);
        return Ok((text.into_owned(), "UTF-16 BE"));
    }
    if bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
        return Err(DecodeError::Binary);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Ok((text.to_string(), "UTF-8")),
        Err(_) => {
            let (text, _) = encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes);
            Ok((text.into_owned(), "Windows-1252"))
        }
    }
}

/// The line ending most lines use.
pub fn line_ending(text: &str) -> &'static str {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count() - crlf;
    let cr = text.matches('\r').count() - crlf;
    if crlf > lf && crlf >= cr {
        "CRLF"
    } else if cr > lf && cr > crlf {
        "CR"
    } else {
        "LF"
    }
}

/// Whether we may write the file (opening for appending changes nothing).
fn writable(path: &Path) -> bool {
    std::fs::OpenOptions::new().append(true).open(path).is_ok()
}

fn read_text(id: &str, path: &Path) -> CmdResult<TextFile> {
    let name = file_name(path);
    let meta = std::fs::metadata(path)
        .map_err(|e| format!("Couldn't open “{name}”: {}", io_reason(&e)))?;
    if !meta.is_file() {
        return Err(format!("“{name}” isn't a file."));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "“{name}” is too large to open ({:.0} MB). TuxNotes opens text files up to {} MB.",
            meta.len() as f64 / 1024.0 / 1024.0,
            MAX_FILE_BYTES / 1024 / 1024
        ));
    }
    let bytes =
        std::fs::read(path).map_err(|e| format!("Couldn't open “{name}”: {}", io_reason(&e)))?;
    let (text, encoding) = decode(&bytes)
        .map_err(|_| format!("“{name}” isn't a text file, so TuxNotes can't show it."))?;
    let modified = modified_ms(&meta);
    Ok(TextFile {
        id: id.to_string(),
        path: path.display().to_string(),
        name,
        line_ending: line_ending(&text),
        text,
        encoding,
        read_only: !writable(path),
        size: meta.len(),
        modified,
    })
}

/// A short, plain reason for a file error.
fn io_reason(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => "it no longer exists".into(),
        std::io::ErrorKind::PermissionDenied => "you don't have permission to read it".into(),
        _ => e.to_string(),
    }
}

// ------------------------------------------------------------------ writing

/// Saving was refused because the file changed on disk since it was opened or saved.
pub const CHANGED_ON_DISK: &str = "CHANGED_ON_DISK";
/// The text has characters the file's encoding (Windows-1252) can't store.
pub const UNMAPPABLE: &str = "UNMAPPABLE";

/// Text → bytes in the file's encoding, with its line endings (the editor uses "\n").
pub fn encode(text: &str, encoding: &str, line_ending: &str) -> Result<Vec<u8>, &'static str> {
    let text = match line_ending {
        "CRLF" => text.replace("\r\n", "\n").replace('\n', "\r\n"),
        "CR" => text.replace("\r\n", "\n").replace('\n', "\r"),
        _ => text.to_string(),
    };
    Ok(match encoding {
        "UTF-8 with BOM" => [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat(),
        "UTF-16 LE" => [0xFF, 0xFE]
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_le_bytes))
            .collect(),
        "UTF-16 BE" => [0xFE, 0xFF]
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_be_bytes))
            .collect(),
        "Windows-1252" => {
            let (bytes, _, had_errors) = encoding_rs::WINDOWS_1252.encode(&text);
            if had_errors {
                return Err(UNMAPPABLE);
            }
            bytes.into_owned()
        }
        _ => text.into_bytes(),
    })
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Replace the file's contents safely: write a temporary file next to it, flush it to
/// disk, give it the original's permissions, then rename it over the original (so a
/// crash or full disk never leaves half a file). Symlinks are followed, so the link
/// stays a link. Falls back to writing in place when the folder isn't writable.
pub fn write_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let dir = target.parent().unwrap_or(Path::new("/"));
    let permissions = std::fs::metadata(&target).ok().map(|m| m.permissions());
    let tmp = dir.join(format!(
        ".{}.tuxnotes-{}.tmp",
        target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        std::process::id()
    ));
    let atomic = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        if let Some(p) = &permissions {
            std::fs::set_permissions(&tmp, p.clone())?;
        }
        std::fs::rename(&tmp, &target)
    })();
    match atomic {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            // The folder may not be writable while the file is: write in place.
            if e.kind() == std::io::ErrorKind::PermissionDenied && target.exists() {
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .truncate(true)
                    .open(&target)?;
                file.write_all(bytes)?;
                file.sync_all()
            } else {
                Err(e)
            }
        }
    }
}

/// Where the file stands on disk now, to notice changes made by other programs.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub exists: bool,
    pub modified: i64,
    pub size: u64,
}

fn status_of(path: &Path) -> FileStatus {
    match std::fs::metadata(path) {
        Ok(meta) => FileStatus {
            exists: true,
            modified: modified_ms(&meta),
            size: meta.len(),
        },
        Err(_) => FileStatus {
            exists: false,
            modified: 0,
            size: 0,
        },
    }
}

/// Save `text` to `path`. Unless `force`, refuses (CHANGED_ON_DISK) when the file changed
/// on disk since `expected_modified`. Returns the file as saved.
pub fn save_text(
    id: &str,
    path: &Path,
    text: &str,
    encoding: &str,
    line_ending: &str,
    expected_modified: Option<i64>,
    force: bool,
) -> CmdResult<TextFile> {
    let name = file_name(path);
    let now = status_of(path);
    if !force
        && let Some(expected) = expected_modified
        && now.exists
        && now.modified != expected
    {
        return Err(CHANGED_ON_DISK.into());
    }
    let bytes = encode(text, encoding, line_ending).map_err(String::from)?;
    write_file(path, &bytes)
        .map_err(|e| format!("Couldn't save “{name}”: {}", write_reason(&e)))?;
    read_text(id, path)
}

fn write_reason(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => "you don't have permission to change it".into(),
        std::io::ErrorKind::NotFound => "its folder no longer exists".into(),
        _ if e.raw_os_error() == Some(28) => "the disk is full".into(),
        _ => e.to_string(),
    }
}

// ----------------------------------------------------------------- windows

/// Show the Files window (creating it if needed) and have it open what's queued.
pub fn show_files_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(FILES_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("files-pending", ());
        return;
    }
    let title = crate::identity::display_name(&app.config().identifier);
    let built = WebviewWindowBuilder::new(app, FILES_WINDOW, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(980.0, 700.0)
        .min_inner_size(520.0, 360.0)
        .decorations(false)
        .transparent(true)
        .zoom_hotkeys_enabled(true)
        .build();
    if let Err(e) = built {
        log::error!("couldn't open the Files window: {e}");
    }
}

/// Open these files in the Files window.
pub fn open_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let files = app.state::<OpenFiles>();
    for path in paths {
        files.queue(path);
    }
    show_files_window(app);
}

/// Show the notes window (it may be hidden, or closed while files stayed open).
pub fn show_notes_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
    else {
        return;
    };
    match WebviewWindowBuilder::from_config(app, &config) {
        Ok(builder) => {
            if let Err(e) = builder.visible(true).build() {
                log::error!("couldn't open the notes window: {e}");
            }
        }
        Err(e) => log::error!("couldn't open the notes window: {e}"),
    }
}

/// Files dropped on the Files window open there. When the Files window closes and the
/// notes window was never shown (TuxNotes was started for a file), TuxNotes quits.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != FILES_WINDOW {
        return;
    }
    let app = window.app_handle();
    match event {
        WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
            let files: Vec<PathBuf> = paths.iter().filter(|p| p.is_file()).cloned().collect();
            open_paths(app, files);
        }
        WindowEvent::Destroyed => {
            if let Some(main) = app.get_webview_window("main")
                && !main.is_visible().unwrap_or(true)
            {
                // Runs the notes window's own closing steps (save, lock, backup).
                let _ = main.close();
            }
        }
        _ => {}
    }
}

// ----------------------------------------------------------------- commands

/// Files the Files window should open (new since it last asked).
#[tauri::command]
pub fn take_pending_files(files: tauri::State<'_, OpenFiles>) -> Vec<FileEntry> {
    files.take_pending()
}

#[tauri::command]
pub async fn read_text_file(app: AppHandle, id: String) -> CmdResult<TextFile> {
    let path = app
        .state::<OpenFiles>()
        .path(&id)
        .ok_or_else(|| "That file isn't open.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || read_text(&id, &path))
        .await
        .map_err(|e| e.to_string())?
}

/// Ctrl+O (or ⋯ → Open File…): pick files and open them in the Files window.
#[tauri::command]
pub async fn open_file_dialog(app: AppHandle) -> CmdResult<usize> {
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .set_title("Open File")
        .pick_files(move |files| {
            let _ = tx.send(files);
        });
    let Some(files) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(0);
    };
    let paths: Vec<PathBuf> = files
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .filter(|p| p.is_file())
        .collect();
    let count = paths.len();
    open_paths(&app, paths);
    Ok(count)
}

/// Where an open file stands on disk (changed or deleted by another program?).
#[tauri::command]
pub fn file_status(files: tauri::State<'_, OpenFiles>, id: String) -> CmdResult<FileStatus> {
    let path = files
        .path(&id)
        .ok_or_else(|| "That file isn't open.".to_string())?;
    Ok(status_of(&path))
}

/// Ctrl+S: save an open file in its encoding and line endings.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_text_file(
    app: AppHandle,
    id: String,
    text: String,
    encoding: String,
    line_ending: String,
    expected_modified: Option<i64>,
    force: bool,
) -> CmdResult<TextFile> {
    let path = app
        .state::<OpenFiles>()
        .path(&id)
        .ok_or_else(|| "That file isn't open.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        save_text(
            &id,
            &path,
            &text,
            &encoding,
            &line_ending,
            expected_modified,
            force,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ctrl+Shift+S: save under a new name (chosen in the save dialog). The tab then shows
/// the new file. Returns None when the dialog was cancelled.
#[tauri::command]
pub async fn save_text_file_as(
    app: AppHandle,
    id: String,
    text: String,
    encoding: String,
    line_ending: String,
) -> CmdResult<Option<TextFile>> {
    let files = app.state::<OpenFiles>();
    let current = files
        .path(&id)
        .ok_or_else(|| "That file isn't open.".to_string())?;
    let (tx, rx) = oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save As")
        .set_file_name(file_name(&current));
    if let Some(dir) = current.parent() {
        dialog = dialog.set_directory(dir);
    }
    dialog.save_file(move |path| {
        let _ = tx.send(path);
    });
    let Some(chosen) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    let entry = files.register(path.clone());
    let saved = tauri::async_runtime::spawn_blocking(move || {
        save_text(&entry.id, &path, &text, &encoding, &line_ending, None, true)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Some(saved))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tuxnotes-files-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn decodes_common_encodings() {
        assert_eq!(
            decode(b"hello\n").unwrap(),
            ("hello\n".to_string(), "UTF-8")
        );
        assert_eq!(
            decode("héllo".as_bytes()).unwrap(),
            ("héllo".to_string(), "UTF-8")
        );
        assert_eq!(
            decode(b"\xEF\xBB\xBFbom").unwrap(),
            ("bom".to_string(), "UTF-8 with BOM")
        );
        assert_eq!(
            decode(b"\xFF\xFEh\0i\0").unwrap(),
            ("hi".to_string(), "UTF-16 LE")
        );
        assert_eq!(
            decode(b"\xFE\xFF\0h\0i").unwrap(),
            ("hi".to_string(), "UTF-16 BE")
        );
        // Latin-1 "café" isn't valid UTF-8.
        assert_eq!(
            decode(b"caf\xE9").unwrap(),
            ("café".to_string(), "Windows-1252")
        );
        assert_eq!(decode(b"").unwrap(), (String::new(), "UTF-8"));
    }

    #[test]
    fn refuses_binary_files() {
        assert_eq!(
            decode(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"),
            Err(DecodeError::Binary)
        );
        assert_eq!(decode(b"ELF\0\x01\x02"), Err(DecodeError::Binary));
    }

    #[test]
    fn detects_line_endings() {
        assert_eq!(line_ending("a\nb\nc"), "LF");
        assert_eq!(line_ending("a\r\nb\r\nc"), "CRLF");
        assert_eq!(line_ending("a\rb\rc"), "CR");
        assert_eq!(line_ending("one line"), "LF");
        assert_eq!(line_ending("a\r\nb\r\nc\nd"), "CRLF");
    }

    #[test]
    fn reads_files_and_explains_problems() {
        let dir = temp_dir("read");
        fs::write(dir.join("hello.py"), "print('hi')\r\n").unwrap();
        fs::write(dir.join("image.png"), b"\x89PNG\r\n\x1a\n\0\0").unwrap();
        let f = read_text("f1", &dir.join("hello.py")).unwrap();
        assert_eq!(
            (f.name.as_str(), f.text.as_str(), f.encoding, f.line_ending),
            ("hello.py", "print('hi')\r\n", "UTF-8", "CRLF")
        );
        assert!(!f.read_only);
        assert_eq!(f.size, 13);
        let binary = read_text("f2", &dir.join("image.png")).unwrap_err();
        assert!(binary.contains("isn't a text file"), "{binary}");
        let missing = read_text("f3", &dir.join("gone.txt")).unwrap_err();
        assert!(missing.contains("no longer exists"), "{missing}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn finds_files_in_arguments() {
        let dir = temp_dir("args");
        fs::write(dir.join("a.txt"), "a").unwrap();
        fs::write(dir.join("b c.md"), "b").unwrap();
        fs::create_dir_all(dir.join("folder")).unwrap();
        let url = tauri::Url::from_file_path(dir.join("b c.md"))
            .unwrap()
            .to_string();
        let args: Vec<String> = [
            "tuxnotes",
            "--some-flag",
            "a.txt",
            &url,
            "folder",
            "missing.txt",
            "a.txt",
            "",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let found = paths_from_args(&args, &dir);
        let canon = |n: &str| fs::canonicalize(dir.join(n)).unwrap();
        assert_eq!(found, vec![canon("a.txt"), canon("b c.md")]);
        assert!(paths_from_args(&["tuxnotes".to_string()], &dir).is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn encodes_like_the_file_was() {
        assert_eq!(encode("a\nb", "UTF-8", "LF").unwrap(), b"a\nb");
        assert_eq!(encode("a\nb", "UTF-8", "CRLF").unwrap(), b"a\r\nb");
        assert_eq!(
            encode("a\r\nb\nc", "UTF-8", "CRLF").unwrap(),
            b"a\r\nb\r\nc"
        );
        assert_eq!(encode("a\nb", "UTF-8", "CR").unwrap(), b"a\rb");
        assert_eq!(
            encode("hi", "UTF-8 with BOM", "LF").unwrap(),
            b"\xEF\xBB\xBFhi"
        );
        assert_eq!(encode("hi", "UTF-16 LE", "LF").unwrap(), b"\xFF\xFEh\0i\0");
        assert_eq!(encode("hi", "UTF-16 BE", "LF").unwrap(), b"\xFE\xFF\0h\0i");
        assert_eq!(encode("café", "Windows-1252", "LF").unwrap(), b"caf\xE9");
        assert_eq!(encode("日本", "Windows-1252", "LF"), Err(UNMAPPABLE));
        // Saved bytes read back the same.
        for enc in [
            "UTF-8",
            "UTF-8 with BOM",
            "UTF-16 LE",
            "UTF-16 BE",
            "Windows-1252",
        ] {
            let bytes = encode("héllo\nwörld", enc, "LF").unwrap();
            assert_eq!(
                decode(&bytes).unwrap(),
                ("héllo\nwörld".to_string(), enc),
                "{enc}"
            );
        }
    }

    #[test]
    fn saves_safely_and_keeps_permissions_and_links() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("save");
        let file = dir.join("script.sh");
        fs::write(&file, "echo old\n").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o750)).unwrap();
        let link = dir.join("link.sh");
        std::os::unix::fs::symlink(&file, &link).unwrap();

        let opened = read_text("f1", &link).unwrap();
        let saved = save_text(
            "f1",
            &link,
            "echo new\n",
            "UTF-8",
            "LF",
            Some(opened.modified),
            false,
        )
        .unwrap();
        assert_eq!(saved.text, "echo new\n");
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "echo new\n",
            "the link's target was changed"
        );
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink(),
            "the link is still a link"
        );
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o750
        );
        // No temporary files left behind.
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("tuxnotes-"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_to_overwrite_changes_made_elsewhere() {
        let dir = temp_dir("conflict");
        let file = dir.join("notes.txt");
        fs::write(&file, "mine\n").unwrap();
        let opened = read_text("f1", &file).unwrap();
        // Another program changes the file (a different modification time).
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&file, "theirs\n").unwrap();
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(later)
            .unwrap();

        let err = save_text(
            "f1",
            &file,
            "mine, edited\n",
            "UTF-8",
            "LF",
            Some(opened.modified),
            false,
        )
        .unwrap_err();
        assert_eq!(err, CHANGED_ON_DISK);
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "theirs\n",
            "nothing was overwritten"
        );
        // Saving anyway (the user chose to) works.
        save_text(
            "f1",
            &file,
            "mine, edited\n",
            "UTF-8",
            "LF",
            Some(opened.modified),
            true,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "mine, edited\n");
        // A deleted file is simply created again.
        fs::remove_file(&file).unwrap();
        assert!(!status_of(&file).exists);
        save_text(
            "f1",
            &file,
            "back\n",
            "UTF-8",
            "LF",
            Some(opened.modified),
            false,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "back\n");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_crlf_and_explains_unstorable_characters() {
        let dir = temp_dir("crlf");
        let file = dir.join("win.txt");
        fs::write(&file, b"caf\xE9\r\nline\r\n").unwrap();
        let opened = read_text("f1", &file).unwrap();
        assert_eq!(
            (opened.encoding, opened.line_ending),
            ("Windows-1252", "CRLF")
        );
        // The editor hands back "\n" line breaks.
        save_text(
            "f1",
            &file,
            "café\nline\nnew\n",
            opened.encoding,
            opened.line_ending,
            Some(opened.modified),
            false,
        )
        .unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"caf\xE9\r\nline\r\nnew\r\n");
        let err = save_text(
            "f1",
            &file,
            "café 日本\n",
            "Windows-1252",
            "CRLF",
            None,
            false,
        )
        .unwrap_err();
        assert_eq!(err, UNMAPPABLE);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_opened_files_have_ids() {
        let files = OpenFiles::default();
        let a = files.register(PathBuf::from("/tmp/a.txt"));
        let again = files.register(PathBuf::from("/tmp/a.txt"));
        assert_eq!(a.id, again.id, "opening the same file again keeps its id");
        assert_eq!(a.name, "a.txt");
        assert_eq!(files.path(&a.id), Some(PathBuf::from("/tmp/a.txt")));
        assert_eq!(files.path("f999"), None);
        files.queue(PathBuf::from("/tmp/b.txt"));
        files.queue(PathBuf::from("/tmp/b.txt"));
        let pending = files.take_pending();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].name, "b.txt");
        assert!(files.take_pending().is_empty());
    }
}
