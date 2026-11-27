//! Spell checking in notes: WebKitGTK's checker, which uses Enchant with the Hunspell
//! dictionaries installed on the system (e.g. `hunspell-en-us`). Misspelled words get a
//! red underline; right-clicking one in a note shows suggestions in WebKit's menu.
//!
//! The choices (on/off, languages) are stored with the other preferences in the
//! interface, which applies them at start and whenever they change.

use std::collections::BTreeSet;
use std::path::PathBuf;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellingInfo {
    /// Languages with an installed dictionary, e.g. ["de_DE", "en_US"].
    available: Vec<String>,
    /// What to use when nothing was chosen: the desktop's language, if installed.
    system_default: Vec<String>,
}

/// Where Hunspell dictionaries (`<lang>.dic` + `<lang>.aff`) are installed.
fn dictionary_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = dirs::data_dir()
        .map(|d| d.join("hunspell"))
        .into_iter()
        .collect();
    for d in [
        "/usr/share/hunspell",
        "/usr/share/myspell",
        "/usr/share/myspell/dicts",
        "/usr/local/share/hunspell",
    ] {
        dirs.push(PathBuf::from(d));
    }
    dirs
}

/// "en_US", "de", "pt_BR", "sr_Latn_RS"… but not hyphenation or other helper files.
fn looks_like_language(code: &str) -> bool {
    let mut parts = code.split(['_', '-']);
    let lang = parts.next().unwrap_or("");
    (2..=3).contains(&lang.len())
        && lang.bytes().all(|b| b.is_ascii_lowercase())
        && parts.all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric()))
}

/// Languages that have both a `.dic` and an `.aff` file in one of `dirs`.
pub fn installed_languages(dirs: &[PathBuf]) -> Vec<String> {
    let mut found = BTreeSet::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("dic") {
                continue;
            }
            let Some(code) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if looks_like_language(code) && path.with_extension("aff").is_file() {
                found.insert(code.to_string());
            }
        }
    }
    found.into_iter().collect()
}

/// The desktop's language ("en_US.UTF-8" → "en_US") if it has a dictionary, else another
/// dictionary for the same language ("en_GB" when only that is installed).
pub fn system_default(installed: &[String], locale: Option<&str>) -> Vec<String> {
    let Some(locale) = locale.map(|l| l.split(['.', '@']).next().unwrap_or("")) else {
        return Vec::new();
    };
    if locale.is_empty() || locale == "C" || locale == "POSIX" {
        return Vec::new();
    }
    if installed.iter().any(|l| l == locale) {
        return vec![locale.to_string()];
    }
    let lang = locale.split('_').next().unwrap_or(locale);
    installed
        .iter()
        .find(|l| *l == lang || l.starts_with(&format!("{lang}_")))
        .map(|l| vec![l.clone()])
        .unwrap_or_default()
}

/// The desktop's language setting, as the C library sees it.
fn desktop_locale() -> Option<String> {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|v| std::env::var(v).ok())
        .find(|v| !v.is_empty())
}

/// Installed dictionaries and the default language, for Settings.
#[tauri::command]
pub fn spelling_info() -> SpellingInfo {
    let available = installed_languages(&dictionary_dirs());
    let system_default = system_default(&available, desktop_locale().as_deref());
    SpellingInfo {
        available,
        system_default,
    }
}

/// Turn spell checking on or off with these languages (empty: the desktop's language).
/// Returns the languages WebKit actually uses (it leaves out any without a dictionary).
#[tauri::command]
pub async fn set_spelling(
    webview: tauri::Webview,
    enabled: bool,
    languages: Vec<String>,
) -> Result<Vec<String>, String> {
    let languages = if languages.is_empty() {
        spelling_info().system_default
    } else {
        languages
    };
    apply(webview, enabled, languages).await
}

#[cfg(target_os = "linux")]
async fn apply(
    webview: tauri::Webview,
    enabled: bool,
    languages: Vec<String>,
) -> Result<Vec<String>, String> {
    use webkit2gtk::{WebContextExt, WebViewExt};

    let (tx, rx) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |view| {
            let active = view.inner().context().map(|ctx| {
                ctx.set_spell_checking_enabled(enabled);
                if enabled {
                    let refs: Vec<&str> = languages.iter().map(String::as_str).collect();
                    ctx.set_spell_checking_languages(&refs);
                    ctx.spell_checking_languages()
                        .iter()
                        .map(|l| l.to_string())
                        .collect()
                } else {
                    Vec::new()
                }
            });
            let _ = tx.send(active.unwrap_or_default());
        })
        .map_err(|e| e.to_string())?;
    let active = rx.await.map_err(|e| e.to_string())?;
    log::info!(
        "spell checking {} ({})",
        if enabled { "on" } else { "off" },
        active.join(", ")
    );
    Ok(active)
}

#[cfg(not(target_os = "linux"))]
async fn apply(
    _webview: tauri::Webview,
    _enabled: bool,
    _languages: Vec<String>,
) -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_dictionaries_with_both_files() {
        let dir = std::env::temp_dir().join(format!("tuxnotes-dicts-{}", std::process::id()));
        let other = dir.join("other");
        fs::create_dir_all(&other).unwrap();
        for f in [
            "en_US.dic",
            "en_US.aff",
            "de_DE.dic",
            "hyph_en_US.dic",
            "hyph_en_US.aff",
            "README.txt",
        ] {
            fs::write(dir.join(f), "").unwrap();
        }
        for f in ["pt_BR.dic", "pt_BR.aff", "en_US.dic", "en_US.aff"] {
            fs::write(other.join(f), "").unwrap();
        }
        let missing = dir.join("does-not-exist");
        // de_DE has no .aff, hyph_* isn't a language, en_US is listed once.
        assert_eq!(
            installed_languages(&[dir.clone(), other, missing]),
            ["en_US", "pt_BR"]
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn language_codes() {
        for ok in [
            "en",
            "en_US",
            "de_DE",
            "pt_BR",
            "sr_Latn_RS",
            "ast_ES",
            "de_DE_frami",
            "en-GB",
        ] {
            assert!(looks_like_language(ok), "{ok}");
        }
        for bad in [
            "hyph_en_US",
            "EN_us",
            "e",
            "english",
            "en__US",
            "th_en_US_v2 x",
            "",
        ] {
            assert!(!looks_like_language(bad), "{bad}");
        }
    }

    #[test]
    fn default_follows_the_desktop_language() {
        let installed = vec![
            "de_DE".to_string(),
            "en_GB".to_string(),
            "en_US".to_string(),
        ];
        assert_eq!(system_default(&installed, Some("en_US.UTF-8")), ["en_US"]);
        assert_eq!(system_default(&installed, Some("de_DE@euro")), ["de_DE"]);
        // Same language, other country: use what's installed.
        assert_eq!(system_default(&installed, Some("en_AU.UTF-8")), ["en_GB"]);
        assert_eq!(system_default(&installed, Some("de_AT.UTF-8")), ["de_DE"]);
        // Nothing for the language, or no real language set: no default.
        assert!(system_default(&installed, Some("fr_FR.UTF-8")).is_empty());
        assert!(system_default(&installed, Some("C.UTF-8")).is_empty());
        assert!(system_default(&installed, Some("POSIX")).is_empty());
        assert!(system_default(&installed, None).is_empty());
        assert!(system_default(&[], Some("en_US.UTF-8")).is_empty());
    }
}
