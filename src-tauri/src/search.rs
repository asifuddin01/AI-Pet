//! Web search, only when asked ("search for …", "google …", the Search button).
//!
//! Providers: Google Programmable Search (Custom Search JSON API: key + search engine
//! ID) or Brave Search (key). Keys live in the Keychain and never reach the webview.
//! Only the query is sent; results come back as title/link/snippet.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_RESULTS: usize = 5;
pub const MAX_QUERY_CHARS: usize = 300;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub title: String,
    pub link: String,
    pub snippet: String,
    /// "en.wikipedia.org"
    pub site: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Google,
    Brave,
}

impl Provider {
    pub fn parse(s: &str) -> Self {
        if s == "brave" {
            Provider::Brave
        } else {
            Provider::Google
        }
    }
}

/// Google search engine IDs ("cx") are short tokens like `0123456789abcdef0:abcdefghi`.
pub fn valid_engine_id(cx: &str) -> bool {
    !cx.is_empty() && cx.len() <= 64 && cx.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-'))
}

fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}

fn site_of(link: &str) -> String {
    url::Url::parse(link).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())).unwrap_or_default()
}

/// Keep only http(s) results and cap every field.
fn tidy(results: Vec<SearchResult>) -> Vec<SearchResult> {
    results
        .into_iter()
        .filter(|r| r.link.starts_with("https://") || r.link.starts_with("http://"))
        .take(MAX_RESULTS)
        .map(|r| SearchResult {
            title: clean(&r.title, 200),
            site: if r.site.is_empty() { site_of(&r.link) } else { clean(&r.site, 100) },
            snippet: clean(&r.snippet, 500),
            link: clean(&r.link, 2000),
        })
        .collect()
}

#[derive(Deserialize)]
struct GoogleResponse {
    #[serde(default)]
    items: Vec<GoogleItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleItem {
    #[serde(default)]
    title: String,
    #[serde(default)]
    link: String,
    #[serde(default)]
    snippet: String,
    #[serde(default)]
    display_link: String,
}

#[derive(Deserialize)]
struct BraveResponse {
    #[serde(default)]
    web: Option<BraveWeb>,
}

#[derive(Deserialize)]
struct BraveWeb {
    #[serde(default)]
    results: Vec<BraveItem>,
}

#[derive(Deserialize)]
struct BraveItem {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    description: String,
}

pub fn parse_google(json: &str) -> Result<Vec<SearchResult>, String> {
    let r: GoogleResponse = serde_json::from_str(json).map_err(|_| "Google sent an unexpected answer.".to_string())?;
    Ok(tidy(
        r.items
            .into_iter()
            .map(|i| SearchResult { title: i.title, link: i.link, snippet: i.snippet, site: i.display_link })
            .collect(),
    ))
}

pub fn parse_brave(json: &str) -> Result<Vec<SearchResult>, String> {
    let r: BraveResponse = serde_json::from_str(json).map_err(|_| "Brave sent an unexpected answer.".to_string())?;
    Ok(tidy(
        r.web
            .map(|w| w.results)
            .unwrap_or_default()
            .into_iter()
            // Brave marks query matches with <strong>; the pet shows plain text.
            .map(|i| SearchResult {
                title: strip_tags(&i.title),
                link: i.url,
                snippet: strip_tags(&i.description),
                site: String::new(),
            })
            .collect(),
    ))
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">")
}

fn http_error(provider: Provider, status: u16) -> String {
    let name = if provider == Provider::Google { "Google" } else { "Brave" };
    match status {
        400 if provider == Provider::Google => "Google didn't accept the search. Check the Search engine ID in Settings → Search.".into(),
        401 | 403 => format!("{name} rejected the search key (or the API isn't enabled for it). Check Settings → Search."),
        429 => format!("{name} search is over its daily limit. Try again later."),
        _ => format!("{name} search had a problem (HTTP {status})."),
    }
}

pub async fn search(
    client: &reqwest::Client,
    provider: Provider,
    key: &str,
    engine_id: &str,
    query: &str,
) -> Result<Vec<SearchResult>, String> {
    let query = clean(query, MAX_QUERY_CHARS);
    if query.is_empty() {
        return Err("Search for what?".into());
    }
    let req = match provider {
        Provider::Google => {
            if !valid_engine_id(engine_id) {
                return Err("Add your Google Search engine ID in Settings → Search.".into());
            }
            client.get("https://www.googleapis.com/customsearch/v1").query(&[
                ("key", key),
                ("cx", engine_id),
                ("q", query.as_str()),
                ("num", "5"),
            ])
        }
        Provider::Brave => client
            .get("https://api.search.brave.com/res/v1/web/search")
            .header("X-Subscription-Token", key)
            .header("Accept", "application/json")
            .query(&[("q", query.as_str()), ("count", "5")]),
    };
    let started = std::time::Instant::now();
    let resp = req.timeout(TIMEOUT).send().await.map_err(|_| "I couldn't reach the search service.".to_string())?;
    let status = resp.status().as_u16();
    if !resp.status().is_success() {
        log::warn!("Web search failed (HTTP {status})");
        return Err(http_error(provider, status));
    }
    let body = resp.text().await.map_err(|_| "The search answer got cut off.".to_string())?;
    let results = match provider {
        Provider::Google => parse_google(&body)?,
        Provider::Brave => parse_brave(&body)?,
    };
    log::info!("Web search finished in {} ms ({} results)", started.elapsed().as_millis(), results.len());
    Ok(results)
}

/// Open a search result in the default browser (only links from the latest results).
pub fn open(url: &str, allowed: &[String]) -> Result<(), String> {
    if !allowed.iter().any(|a| a == url) || !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("I can only open links from the last search.".into());
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
        Err("Opening links is only supported on macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_google_results() {
        let json = r#"{"items":[
            {"title":"Dhaka - Wikipedia","link":"https://en.wikipedia.org/wiki/Dhaka","snippet":"Dhaka is the capital…","displayLink":"en.wikipedia.org"},
            {"title":"bad","link":"javascript:alert(1)","snippet":"x"}
        ]}"#;
        let r = parse_google(json).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].site, "en.wikipedia.org");
        assert_eq!(parse_google(r#"{"kind":"customsearch#search"}"#).unwrap(), vec![]);
    }

    #[test]
    fn parses_brave_results_without_markup() {
        let json = r#"{"web":{"results":[{"title":"<strong>Lucy</strong> &amp; David","url":"https://www.example.com/lucy","description":"About <strong>Lucy</strong>"}]}}"#;
        let r = parse_brave(json).unwrap();
        assert_eq!(r[0].title, "Lucy & David");
        assert_eq!(r[0].snippet, "About Lucy");
        assert_eq!(r[0].site, "example.com");
    }

    #[test]
    fn validates_engine_ids_and_links() {
        assert!(valid_engine_id("0123456789abcdef0:abc_def-1"));
        assert!(!valid_engine_id(""));
        assert!(!valid_engine_id("a b"));
        assert!(!valid_engine_id("x&key=steal"));
        let allowed = vec!["https://en.wikipedia.org/wiki/Dhaka".to_string()];
        assert!(open("https://evil.example.com", &allowed).is_err());
        assert!(open("file:///etc/passwd", &["file:///etc/passwd".to_string()]).is_err());
    }

    #[test]
    fn explains_http_errors() {
        assert!(http_error(Provider::Google, 400).contains("Search engine ID"));
        assert!(http_error(Provider::Brave, 403).contains("Brave rejected"));
        assert!(http_error(Provider::Google, 429).contains("daily limit"));
    }
}
