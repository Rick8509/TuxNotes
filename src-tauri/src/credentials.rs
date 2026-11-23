//! Storage for secrets: the Google refresh token and the backup encryption key.
//!
//! Preferred: the desktop keyring via the Secret Service API (GNOME Keyring,
//! KWallet, KeePassXC…). If no keyring is available (e.g. minimal window
//! managers), the token is written to a file readable only by the current user.
//!
//! All methods block (D-Bus round trips); call them from `spawn_blocking`.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

const SERVICE: &str = "io.github.Rick8509.TuxNotes";
/// Where secrets were stored before the app ID changed; moved on first use.
const LEGACY_SERVICE: &str = crate::legacy_id::LEGACY_ID;
const ACCOUNT: &str = "google-drive-refresh-token";
/// Key derived from the backup password (never the password itself).
pub const BACKUP_KEY_ACCOUNT: &str = "backup-encryption-key";

#[derive(Clone)]
pub struct TokenVault {
    account: &'static str,
    fallback_path: PathBuf,
}

impl TokenVault {
    /// The vault for the Google refresh token.
    pub fn new(fallback_path: PathBuf) -> Self {
        Self::with_account(ACCOUNT, fallback_path)
    }

    pub fn with_account(account: &'static str, fallback_path: PathBuf) -> Self {
        Self {
            account,
            fallback_path,
        }
    }

    fn entry(&self) -> keyring::Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, self.account)
    }

    /// A secret saved under the old app ID: move it to the current one.
    fn take_legacy(&self) -> Option<String> {
        let legacy = keyring::Entry::new(LEGACY_SERVICE, self.account).ok()?;
        let secret = legacy.get_password().ok()?;
        if self.entry().and_then(|e| e.set_password(&secret)).is_ok() {
            let _ = legacy.delete_credential();
            log::info!("moved {} to the new app ID in the keyring", self.account);
        }
        Some(secret)
    }

    pub fn load(&self) -> Option<String> {
        match self.entry().and_then(|e| e.get_password()) {
            Ok(token) => return Some(token),
            Err(keyring::Error::NoEntry) => {
                if let Some(secret) = self.take_legacy() {
                    return Some(secret);
                }
            }
            Err(e) => log::warn!("keyring unavailable ({e}); checking fallback file"),
        }
        fs::read_to_string(&self.fallback_path)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    pub fn save(&self, token: &str) -> std::io::Result<()> {
        match self.entry().and_then(|e| e.set_password(token)) {
            Ok(()) => {
                let _ = fs::remove_file(&self.fallback_path);
                Ok(())
            }
            Err(e) => {
                log::warn!(
                    "keyring unavailable ({e}); storing {} in {} (owner-only)",
                    self.account,
                    self.fallback_path.display()
                );
                write_private(&self.fallback_path, token)
            }
        }
    }

    pub fn clear(&self) {
        match self.entry().and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => log::warn!("could not remove {} from keyring: {e}", self.account),
        }
        if let Ok(legacy) = keyring::Entry::new(LEGACY_SERVICE, self.account) {
            let _ = legacy.delete_credential();
        }
        let _ = fs::remove_file(&self.fallback_path);
    }
}

/// Write a file with mode 0600, created that way from the start.
fn write_private(path: &PathBuf, contents: &str) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let _ = fs::remove_file(path);
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(contents.as_bytes())
}
