//! "A new version is out": asks GitHub which TuxNotes release is the latest. Only that
//! question is sent (GitHub sees the address it comes from and the user agent
//! "TuxNotes/<version>"); the interface does it at most once a day, and it can be turned
//! off in Settings → General → Updates.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// The latest published release (drafts and pre-releases aren't "latest").
pub const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/Rick8509/TuxNotes/releases/latest";

type CmdResult<T> = Result<T, String>;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// This app's version.
    pub current: String,
    /// The latest release, e.g. "0.2.0".
    pub latest: String,
    /// The latest release is newer than this app.
    pub newer: bool,
    /// Its release page (notes and downloads).
    pub url: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
}

/// "v0.2.0" → 0.2.0. Dev builds ("0.1.0-dev.84") count as their base version: they come
/// after that release, so only a later release is an update for them.
fn base_version(v: &str) -> Option<semver::Version> {
    let v = v.trim().trim_start_matches('v');
    let mut parsed = semver::Version::parse(v).ok()?;
    if parsed.pre.as_str().starts_with("dev") {
        parsed.pre = semver::Prerelease::EMPTY;
    }
    Some(parsed)
}

/// Whether `latest` is a newer version than `current`.
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (base_version(latest), base_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// Ask `url` (GitHub's "latest release") which version is out.
pub async fn latest_release(url: &str, current: &str) -> CmdResult<UpdateInfo> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .user_agent(format!("TuxNotes/{current}"))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() || e.is_connect() {
                "Couldn't reach GitHub. Are you online?".to_string()
            } else {
                format!("Couldn't check for updates: {e}")
            }
        })?;
    match response.status().as_u16() {
        200 => {}
        404 => return Err("No TuxNotes release is published yet.".into()),
        403 | 429 => return Err("GitHub asked to wait a bit. Try again later.".into()),
        code => {
            return Err(format!(
                "Couldn't check for updates (GitHub answered {code})."
            ));
        }
    }
    let release: Release = response
        .json()
        .await
        .map_err(|_| "GitHub's answer wasn't understood.".to_string())?;
    let latest = release.tag_name.trim_start_matches('v').to_string();
    Ok(UpdateInfo {
        newer: is_newer(&latest, current),
        current: current.to_string(),
        latest,
        url: release.html_url,
    })
}

/// Is there a newer TuxNotes? (Settings → Updates, and once a day in the background.)
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> CmdResult<UpdateInfo> {
    let current = crate::identity::display_version(&app.package_info().version.to_string());
    latest_release(LATEST_RELEASE_URL, &current).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(is_newer("v0.1.1", "0.1.0"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
        // Dev builds come after their base release.
        assert!(!is_newer("0.1.0", "0.1.0-dev.84"));
        assert!(is_newer("0.1.1", "0.1.0-dev.84"));
        // Nonsense never says "update".
        assert!(!is_newer("latest", "0.1.0"));
        assert!(!is_newer("0.2.0", "unknown"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn reads_the_latest_release() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/latest"))
            .and(header("user-agent", "TuxNotes/0.1.0"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "tag_name": "v0.2.0",
                "html_url": "https://github.com/Rick8509/TuxNotes/releases/tag/v0.2.0",
                "name": "TuxNotes 0.2.0",
                "draft": false
            })))
            .mount(&server)
            .await;
        let info = latest_release(&format!("{}/latest", server.uri()), "0.1.0")
            .await
            .unwrap();
        assert_eq!(
            info,
            UpdateInfo {
                current: "0.1.0".into(),
                latest: "0.2.0".into(),
                newer: true,
                url: "https://github.com/Rick8509/TuxNotes/releases/tag/v0.2.0".into(),
            }
        );
        let same = latest_release(&format!("{}/latest", server.uri()), "0.2.0").await;
        // The user agent differs, so the mock doesn't match: an error, not a wrong answer.
        assert!(same.is_err());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn explains_problems() {
        let server = MockServer::start().await;
        Mock::given(path("/none"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(path("/busy"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        Mock::given(path("/odd"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<html>"))
            .mount(&server)
            .await;
        let base = server.uri();
        assert_eq!(
            latest_release(&format!("{base}/none"), "0.1.0")
                .await
                .unwrap_err(),
            "No TuxNotes release is published yet."
        );
        assert!(
            latest_release(&format!("{base}/busy"), "0.1.0")
                .await
                .unwrap_err()
                .contains("wait")
        );
        assert!(
            latest_release(&format!("{base}/odd"), "0.1.0")
                .await
                .unwrap_err()
                .contains("understood")
        );
        // Nothing listening: offline.
        let offline = latest_release("http://127.0.0.1:9/latest", "0.1.0")
            .await
            .unwrap_err();
        assert!(
            offline.contains("online") || offline.contains("Couldn't"),
            "{offline}"
        );
    }
}
