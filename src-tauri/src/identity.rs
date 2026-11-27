//! Which app this is: TuxNotes, or TuxNotes Dev (test builds with their own app ID,
//! notes and keyring entries; see src-tauri/tauri.dev.conf.json and scripts/dev-app.mjs).
//!
//! Tauri doesn't compile the product name and version from `tauri build --config` into
//! the app, so the name follows from the app ID, and dev builds pass their version in
//! `TUXNOTES_BUILD_VERSION` at build time.

/// A TuxNotes Dev build.
pub fn is_dev(app_id: &str) -> bool {
    app_id.ends_with(".Dev")
}

/// "TuxNotes", or "TuxNotes Dev".
pub fn display_name(app_id: &str) -> &'static str {
    if is_dev(app_id) {
        "TuxNotes Dev"
    } else {
        "TuxNotes"
    }
}

/// The version to show: a dev build's own version (e.g. 0.1.0-dev.84), otherwise the app's.
pub fn display_version(app_version: &str) -> String {
    option_env!("TUXNOTES_BUILD_VERSION")
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(app_version)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The Dev settings replace the window list, so it must match the normal one apart
    /// from the title.
    #[test]
    fn the_dev_window_is_the_normal_window_with_its_own_title() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let dev: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.dev.conf.json")).unwrap();
        let mut expected = conf["app"]["windows"].clone();
        for w in expected.as_array_mut().unwrap() {
            w["title"] = "TuxNotes Dev".into();
        }
        assert_eq!(
            dev["app"]["windows"], expected,
            "copy the window settings from tauri.conf.json to tauri.dev.conf.json"
        );
        assert_eq!(
            display_name(dev["identifier"].as_str().unwrap()),
            "TuxNotes Dev"
        );
    }

    #[test]
    fn names_follow_the_app_id() {
        assert_eq!(display_name("io.github.Rick8509.TuxNotes"), "TuxNotes");
        assert_eq!(
            display_name("io.github.Rick8509.TuxNotes.Dev"),
            "TuxNotes Dev"
        );
        assert!(!is_dev("io.github.Rick8509.TuxNotes"));
        assert!(is_dev("io.github.Rick8509.TuxNotes.Dev"));
    }
}
