//! "Is there a newer version?" — one request to the GitHub Releases API, only when the
//! user presses "Check for updates" or has turned on the daily check. Nothing is sent
//! except a plain GET; downloading and installing stay in the user's hands.

use std::time::Duration;

use serde::{Deserialize, Serialize};

pub const REPO: &str = "asifuddin01/AI-Pet";
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    /// None when no release has been published yet.
    pub latest: Option<String>,
    pub newer: bool,
    /// The release page (always on github.com/<REPO>/releases).
    pub url: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// "v1.2.3" / "1.2" → (1, 2, 3) / (1, 2, 0). Pre-release suffixes are ignored.
pub fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let core = v.trim().trim_start_matches(['v', 'V']).split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u64>());
    let major = parts.next()?.ok()?;
    let minor = parts.next().unwrap_or(Ok(0)).ok()?;
    let patch = parts.next().unwrap_or(Ok(0)).ok()?;
    Some((major, minor, patch))
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    matches!((parse_version(latest), parse_version(current)), (Some(l), Some(c)) if l > c)
}

pub fn releases_page() -> String {
    format!("https://github.com/{REPO}/releases")
}

/// Only our own release pages may be opened from the UI.
pub fn is_release_url(url: &str) -> bool {
    let prefix = format!("{}/", releases_page());
    url == releases_page() || (url.starts_with(&prefix) && !url.contains(['"', '\'', ' ', '\n', '\\']))
}

pub async fn check(client: &reqwest::Client) -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let resp = client
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(|_| "I couldn't reach GitHub to check for updates.".to_string())?;
    if resp.status().as_u16() == 404 {
        return Ok(UpdateInfo { current, latest: None, newer: false, url: releases_page() });
    }
    if !resp.status().is_success() {
        log::warn!("Update check failed (HTTP {})", resp.status().as_u16());
        return Err("GitHub didn't answer the update check. Try again later.".into());
    }
    let release: Release = resp.json().await.map_err(|_| "GitHub sent an unexpected answer.".to_string())?;
    if release.draft || release.prerelease {
        return Ok(UpdateInfo { current, latest: None, newer: false, url: releases_page() });
    }
    let url = if is_release_url(&release.html_url) { release.html_url } else { releases_page() };
    let newer = is_newer(&release.tag_name, &current);
    log::info!("Update check: latest {} (newer: {newer})", release.tag_name);
    Ok(UpdateInfo { current, latest: Some(release.tag_name.trim_start_matches('v').to_string()), newer, url })
}

/// Open a release page in the default browser.
pub fn open(url: &str) -> Result<(), String> {
    if !is_release_url(url) {
        return Err("That isn't an AI Pet release page.".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Couldn't open the browser: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err("Opening links is only supported on macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_compares_versions() {
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("1.2"), Some((1, 2, 0)));
        assert_eq!(parse_version("2.0.0-beta.1"), Some((2, 0, 0)));
        assert_eq!(parse_version("latest"), None);
        assert!(is_newer("v1.0.1", "1.0.0"));
        assert!(is_newer("v1.10.0", "1.9.9"));
        assert!(!is_newer("v1.0.0", "1.0.0"));
        assert!(!is_newer("v0.9.0", "1.0.0"));
        assert!(!is_newer("garbage", "1.0.0"));
    }

    #[test]
    fn only_our_release_pages_can_be_opened() {
        assert!(is_release_url("https://github.com/asifuddin01/AI-Pet/releases"));
        assert!(is_release_url("https://github.com/asifuddin01/AI-Pet/releases/tag/v1.0.0"));
        assert!(!is_release_url("https://github.com/someone/else/releases"));
        assert!(!is_release_url("https://github.com/asifuddin01/AI-Pet/releases.evil.com"));
        assert!(!is_release_url("file:///etc/passwd"));
        assert!(!is_release_url("https://github.com/asifuddin01/AI-Pet/releases/x\" --args"));
    }
}
