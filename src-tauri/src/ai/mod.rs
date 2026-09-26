//! AI service layer. All provider HTTP happens here in Rust so API keys never
//! enter the webview. The frontend builds prompts (`src/ai/PromptBuilder.ts`)
//! and receives streamed text through a Tauri channel.

mod anthropic;
mod openai;
pub mod sse;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::secrets::SecretStore;
use crate::settings::{Provider, Settings};

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
/// Maximum silence between streamed chunks before we give up.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_MESSAGES: usize = 40;
const MAX_MESSAGE_CHARS: usize = 60_000;
const MAX_SYSTEM_CHARS: usize = 8_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    pub system: String,
    pub messages: Vec<ChatMessage>,
}

impl AiRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.messages.is_empty() || self.messages.len() > MAX_MESSAGES {
            return Err("Invalid message count".into());
        }
        if self.system.chars().count() > MAX_SYSTEM_CHARS {
            return Err("System prompt too long".into());
        }
        if self.messages.first().map(|m| m.role.as_str()) != Some("user") {
            return Err("First message must come from the user".into());
        }
        for m in &self.messages {
            if m.role != "user" && m.role != "assistant" {
                return Err("Invalid message role".into());
            }
            if m.content.trim().is_empty() || m.content.chars().count() > MAX_MESSAGE_CHARS {
                return Err("Invalid message content".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum StreamEvent {
    Delta { text: String },
    /// Discard text received so far (the provider switched models mid-stream).
    Reset,
    Done,
    Error { kind: ErrorKind, message: String },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    NotConfigured,
    AiDisabled,
    InvalidUrl,
    Network,
    Timeout,
    Auth,
    RateLimit,
    InvalidModel,
    Unavailable,
    Refused,
    BadRequest,
    BadResponse,
    Unknown,
}

/// `message` is safe to show/log: it never contains keys or user text.
#[derive(Debug, Clone, PartialEq)]
pub struct AiError {
    pub kind: ErrorKind,
    pub message: String,
    pub status: Option<u16>,
}

impl AiError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), status: None }
    }

    pub fn from_status(status: u16, body: &str) -> Self {
        let kind = classify_status(status, body);
        Self { kind, message: format!("Provider returned HTTP {status}"), status: Some(status) }
    }

    pub fn from_reqwest(e: &reqwest::Error) -> Self {
        let kind = if e.is_timeout() {
            ErrorKind::Timeout
        } else if e.is_connect() || e.is_request() {
            ErrorKind::Network
        } else if e.is_decode() || e.is_body() {
            ErrorKind::BadResponse
        } else {
            ErrorKind::Unknown
        };
        Self::new(kind, format!("{kind:?} error talking to the provider"))
    }

    pub fn into_event(self) -> StreamEvent {
        StreamEvent::Error { kind: self.kind, message: self.message }
    }
}

pub fn classify_status(status: u16, body: &str) -> ErrorKind {
    match status {
        401 | 403 => ErrorKind::Auth,
        429 => ErrorKind::RateLimit,
        404 => ErrorKind::InvalidModel,
        400 | 422 if body.to_ascii_lowercase().contains("model") => ErrorKind::InvalidModel,
        400 | 413 | 422 => ErrorKind::BadRequest,
        408 | 504 => ErrorKind::Timeout,
        500..=599 => ErrorKind::Unavailable,
        _ => ErrorKind::Unknown,
    }
}

fn is_local_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

/// HTTPS everywhere; plain HTTP is only allowed for local model servers (Ollama, LM Studio).
pub fn validate_base_url(raw: &str) -> Result<Url, AiError> {
    let bad = |why: &str| AiError::new(ErrorKind::InvalidUrl, why.to_string());
    let url = Url::parse(raw.trim()).map_err(|_| bad("The API endpoint isn't a valid URL."))?;
    let host = url.host_str().ok_or_else(|| bad("The API endpoint has no host."))?;
    match url.scheme() {
        "https" => {}
        "http" if is_local_host(host) => {}
        "http" => return Err(bad("Use https:// for remote AI providers.")),
        _ => return Err(bad("The API endpoint must start with https://")),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(bad("Don't put credentials in the endpoint URL."));
    }
    if url.fragment().is_some() {
        return Err(bad("The API endpoint can't contain a #fragment."));
    }
    Ok(url)
}

/// Append path segments to a base URL without losing its existing path.
pub fn join_path(base: &Url, suffix: &str) -> Url {
    let mut url = base.clone();
    let path = format!("{}/{}", base.path().trim_end_matches('/'), suffix.trim_start_matches('/'));
    url.set_path(&path);
    url
}

#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub provider: Provider,
    pub base_url: Url,
    pub model: String,
    pub api_key: Option<String>,
    pub timeout: Duration,
}

pub fn resolve_config(settings: &Settings, secrets: &SecretStore) -> Result<ProviderConfig, AiError> {
    if !settings.ai_enabled {
        return Err(AiError::new(ErrorKind::AiDisabled, "AI requests are turned off in Settings"));
    }
    if settings.model.trim().is_empty() || settings.base_url.trim().is_empty() {
        return Err(AiError::new(ErrorKind::NotConfigured, "No AI model configured"));
    }
    let base_url = validate_base_url(&settings.base_url)?;
    let api_key = secrets.get(settings.provider);
    let local = base_url.host_str().is_some_and(is_local_host);
    if api_key.is_none() && (settings.provider == Provider::Anthropic || !local) {
        return Err(AiError::new(ErrorKind::NotConfigured, "No API key configured"));
    }
    Ok(ProviderConfig {
        provider: settings.provider,
        base_url,
        model: settings.model.trim().to_string(),
        api_key,
        timeout: Duration::from_secs(settings.request_timeout_secs as u64),
    })
}

/// What a provider-specific parser extracted from one SSE event.
#[derive(Debug, PartialEq)]
pub enum Parsed {
    Text(String),
    Reset,
    Done,
    Nothing,
}

/// Drive an SSE response, handing each event to `parse`, until the stream ends,
/// the parser reports `Done`, or an error/idle-timeout occurs.
async fn pump_sse(
    resp: reqwest::Response,
    mut parse: impl FnMut(&sse::SseEvent) -> Result<Parsed, AiError>,
    emit: &mut (dyn FnMut(StreamEvent) + Send),
) -> Result<(), AiError> {
    let mut stream = resp.bytes_stream();
    let mut parser = sse::SseParser::default();
    let mut handle = |events: Vec<sse::SseEvent>, emit: &mut (dyn FnMut(StreamEvent) + Send)| -> Result<bool, AiError> {
        for ev in events {
            match parse(&ev)? {
                Parsed::Text(t) if !t.is_empty() => emit(StreamEvent::Delta { text: t }),
                Parsed::Reset => emit(StreamEvent::Reset),
                Parsed::Done => return Ok(true),
                _ => {}
            }
        }
        Ok(false)
    };
    loop {
        let next = tokio::time::timeout(IDLE_TIMEOUT, stream.next())
            .await
            .map_err(|_| AiError::new(ErrorKind::Timeout, "The provider stopped responding"))?;
        match next {
            None => break,
            Some(Err(e)) => return Err(AiError::from_reqwest(&e)),
            Some(Ok(bytes)) => {
                if handle(parser.push(&bytes), emit)? {
                    return Ok(());
                }
            }
        }
    }
    handle(parser.finish(), emit)?;
    Ok(())
}

/// Read a (bounded) error body without ever logging it.
async fn error_body(resp: reqwest::Response) -> String {
    let bytes = resp.bytes().await.unwrap_or_default();
    String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]).into_owned()
}

pub async fn stream_chat(
    client: &reqwest::Client,
    cfg: &ProviderConfig,
    req: &AiRequest,
    emit: &mut (dyn FnMut(StreamEvent) + Send),
) -> Result<(), AiError> {
    match cfg.provider {
        Provider::OpenAi => openai::stream(client, cfg, req, emit).await,
        Provider::Anthropic => anthropic::stream(client, cfg, req, emit).await,
    }
}

pub fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(concat!("AI-Pet/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("HTTP client")
}

#[derive(Default)]
pub struct AiState {
    client: std::sync::OnceLock<reqwest::Client>,
    pub tasks: Arc<Mutex<HashMap<u32, tokio::task::AbortHandle>>>,
}

impl AiState {
    /// Built lazily: no HTTP machinery exists until the first AI request.
    pub fn client(&self) -> reqwest::Client {
        self.client.get_or_init(build_client).clone()
    }

    pub fn cancel(&self, request_id: u32) -> bool {
        match self.tasks.lock().unwrap().remove(&request_id) {
            Some(handle) => {
                handle.abort();
                true
            }
            None => false,
        }
    }

    pub fn cancel_all(&self) {
        for (_, handle) in self.tasks.lock().unwrap().drain() {
            handle.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_validation() {
        assert!(validate_base_url("https://api.openai.com/v1").is_ok());
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
        assert!(validate_base_url("http://127.0.0.1:1234/v1").is_ok());
        assert_eq!(validate_base_url("http://example.com/v1").unwrap_err().kind, ErrorKind::InvalidUrl);
        assert!(validate_base_url("ftp://example.com").is_err());
        assert!(validate_base_url("https://user:pass@example.com").is_err());
        assert!(validate_base_url("not a url").is_err());
        assert!(validate_base_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn join_path_keeps_base_path() {
        let base = Url::parse("https://openrouter.ai/api/v1").unwrap();
        assert_eq!(join_path(&base, "chat/completions").as_str(), "https://openrouter.ai/api/v1/chat/completions");
        let base = Url::parse("https://api.anthropic.com/").unwrap();
        assert_eq!(join_path(&base, "/v1/messages").as_str(), "https://api.anthropic.com/v1/messages");
    }

    #[test]
    fn status_classification() {
        assert_eq!(classify_status(401, ""), ErrorKind::Auth);
        assert_eq!(classify_status(429, ""), ErrorKind::RateLimit);
        assert_eq!(classify_status(404, ""), ErrorKind::InvalidModel);
        assert_eq!(classify_status(400, "{\"error\":\"unknown model\"}"), ErrorKind::InvalidModel);
        assert_eq!(classify_status(400, "bad"), ErrorKind::BadRequest);
        assert_eq!(classify_status(529, ""), ErrorKind::Unavailable);
        assert_eq!(classify_status(503, ""), ErrorKind::Unavailable);
    }

    fn settings(provider: Provider, url: &str, model: &str) -> Settings {
        Settings { provider, base_url: url.into(), model: model.into(), ..Settings::default() }
    }

    #[test]
    fn config_requires_model_and_key() {
        let store = SecretStore::default();
        // These tests must not depend on the developer's environment.
        for var in ["AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] {
            std::env::remove_var(var);
        }
        let err = resolve_config(&settings(Provider::OpenAi, "https://api.openai.com/v1", ""), &store).unwrap_err();
        assert_eq!(err.kind, ErrorKind::NotConfigured);
        let err = resolve_config(&settings(Provider::OpenAi, "https://api.openai.com/v1", "m"), &store).unwrap_err();
        assert_eq!(err.kind, ErrorKind::NotConfigured);
        // Local servers don't need a key.
        let cfg = resolve_config(&settings(Provider::OpenAi, "http://localhost:11434/v1", "llama3.2"), &store).unwrap();
        assert!(cfg.api_key.is_none());
        let mut off = settings(Provider::OpenAi, "http://localhost:11434/v1", "llama3.2");
        off.ai_enabled = false;
        assert_eq!(resolve_config(&off, &store).unwrap_err().kind, ErrorKind::AiDisabled);
    }

    #[test]
    fn request_validation() {
        let ok = AiRequest {
            system: "s".into(),
            messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }],
        };
        assert!(ok.validate().is_ok());
        let bad_role = AiRequest {
            system: "s".into(),
            messages: vec![ChatMessage { role: "system".into(), content: "hi".into() }],
        };
        assert!(bad_role.validate().is_err());
        let empty = AiRequest { system: "s".into(), messages: vec![] };
        assert!(empty.validate().is_err());
    }

    #[test]
    fn stream_event_wire_format() {
        let json = serde_json::to_string(&StreamEvent::Delta { text: "hi".into() }).unwrap();
        assert_eq!(json, r#"{"event":"delta","data":{"text":"hi"}}"#);
        let json = serde_json::to_string(&StreamEvent::Error { kind: ErrorKind::RateLimit, message: "m".into() }).unwrap();
        assert_eq!(json, r#"{"event":"error","data":{"kind":"rate_limit","message":"m"}}"#);
        assert_eq!(serde_json::to_string(&StreamEvent::Done).unwrap(), r#"{"event":"done"}"#);
    }
}
