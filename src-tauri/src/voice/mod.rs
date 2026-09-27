//! Voice input (guide §12): microphone → speech-to-text → the pet's chat.
//!
//! Off unless enabled in Settings. The microphone is open only between `start` and
//! `stop` (a click on the mic button, or holding the talk shortcut); nothing listens
//! in the background. Two engines:
//!
//! - `apple`: macOS speech recognition, streaming partial results; on-device where
//!   the Mac supports it for the chosen language.
//! - `whisper`: records a short clip and sends it to an OpenAI-compatible
//!   `/audio/transcriptions` endpoint (needed for languages Apple doesn't cover, e.g. Bangla).

// Off macOS only the stubs below exist, so parts of the shared model go unused there.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

mod whisper;

#[cfg(target_os = "macos")]
mod macos;

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::settings::{Provider, Settings};
use crate::AppState;

/// Longest recording we accept (Whisper uploads are capped at 25 MB anyway).
pub const MAX_RECORDING: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum VoiceEvent {
    /// The microphone is open.
    Started,
    /// Best guess so far (Apple engine only).
    Partial { text: String },
    /// The finished transcript ("" when nothing was heard).
    Final { text: String },
    Error { kind: VoiceErrorKind, message: String },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VoiceErrorKind {
    /// Microphone or speech recognition access was denied.
    Permission,
    /// Voice input is off, or no speech-to-text endpoint/key is set up.
    NotConfigured,
    /// The language isn't supported, or the recognizer is unavailable right now.
    Unavailable,
    Network,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VoiceError {
    pub kind: VoiceErrorKind,
    /// Safe to show: never contains what was said.
    pub message: String,
}

impl VoiceError {
    pub fn new(kind: VoiceErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub fn event(self) -> VoiceEvent {
        VoiceEvent::Error { kind: self.kind, message: self.message }
    }
}

/// How a listening session was started.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Mic button / talk key: the engine chosen in Settings.
    #[default]
    Push,
    /// A follow-up after "Hey Lucy": Apple recognition, so pauses can end it hands-free.
    HandsFree,
    /// The "Hey Lucy" listener itself: Apple, on-device only.
    Wake,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    Apple,
    Whisper,
}

impl Engine {
    pub fn from_settings(s: &Settings) -> Self {
        if s.speech_engine == "whisper" {
            Engine::Whisper
        } else {
            Engine::Apple
        }
    }
}

/// What `stop` hands back: either the recognizer will deliver the final text itself,
/// or there is a recording to transcribe.
pub enum Stopped {
    Streaming,
    Recorded { id: u64, path: std::path::PathBuf, channel: Channel<VoiceEvent> },
    Idle,
}

#[derive(Default)]
pub struct VoiceState {
    next_id: AtomicU64,
}

/// Whisper settings resolved for one request.
#[derive(Debug, Clone)]
pub struct SttConfig {
    pub base_url: url::Url,
    pub model: String,
    pub api_key: Option<String>,
    /// ISO-639-1 code ("bn", "en") or None to auto-detect.
    pub language: Option<String>,
}

/// The primary language subtag Whisper expects: "bn-BD" → "bn".
pub fn whisper_language(tag: &str) -> Option<String> {
    let primary = tag.split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
    (primary.len() == 2 || primary.len() == 3).then_some(primary)
}

fn same_host(a: &str, b: &str) -> bool {
    match (url::Url::parse(a), url::Url::parse(b)) {
        (Ok(a), Ok(b)) => a.host_str().is_some() && a.host_str() == b.host_str(),
        _ => false,
    }
}

pub fn stt_config(settings: &Settings, secrets: &crate::secrets::SecretStore) -> Result<SttConfig, VoiceError> {
    let base_url = crate::ai::validate_base_url(&settings.stt_base_url)
        .map_err(|e| VoiceError::new(VoiceErrorKind::NotConfigured, e.message))?;
    let local = base_url
        .host_str()
        .is_some_and(|h| matches!(h, "localhost" | "127.0.0.1" | "::1" | "[::1]"));
    // A separate speech key wins; otherwise reuse the chat key for the same OpenAI-compatible host.
    let api_key = secrets.get_stt().or_else(|| {
        (settings.provider == Provider::OpenAi && same_host(&settings.base_url, &settings.stt_base_url))
            .then(|| secrets.get(Provider::OpenAi))
            .flatten()
    });
    if api_key.is_none() && !local {
        return Err(VoiceError::new(
            VoiceErrorKind::NotConfigured,
            "Whisper needs an API key — add one in Settings → Voice.",
        ));
    }
    Ok(SttConfig {
        base_url,
        model: settings.stt_model.clone(),
        api_key,
        language: whisper_language(&settings.speech_language),
    })
}

fn settings(app: &AppHandle) -> Settings {
    app.state::<AppState>().settings.read().map(|s| s.clone()).unwrap_or_default()
}

/// Open the microphone and start recognising. Progress and the result arrive on `channel`.
///
/// `continuous` is the "Hey Lucy" listener: Apple engine only, and only when the Mac can
/// recognise the language on-device, so audio never leaves it while she waits for her name.
pub async fn start(app: AppHandle, channel: Channel<VoiceEvent>, mode: Mode) -> Result<(), String> {
    let s = settings(&app);
    let continuous = mode == Mode::Wake;
    if !s.voice_input || (continuous && !s.wake_word) {
        let _ = channel.send(VoiceError::new(VoiceErrorKind::NotConfigured, "Voice input is off in Settings.").event());
        return Ok(());
    }
    let engine = if mode == Mode::Push { Engine::from_settings(&s) } else { Engine::Apple };
    if engine == Engine::Whisper {
        if let Err(e) = stt_config(&s, &app.state::<AppState>().secrets) {
            let _ = channel.send(e.event());
            return Ok(());
        }
    }
    cancel(&app);
    let id = app.state::<AppState>().voice.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    log::info!("Voice input starting (engine={engine:?}, continuous={continuous})");
    match platform_start(&app, id, engine, s.speech_language.clone(), channel.clone(), continuous).await {
        Ok(()) => {
            let _ = channel.send(VoiceEvent::Started);
        }
        Err(e) => {
            log::warn!("Voice input unavailable ({:?})", e.kind);
            let _ = channel.send(e.event());
        }
    }
    Ok(())
}

/// Close the microphone and deliver the final transcript.
pub async fn stop(app: AppHandle) -> Result<(), String> {
    match platform_stop(&app).await {
        Stopped::Recorded { id, path, channel } => {
            let s = settings(&app);
            let state = app.state::<AppState>();
            let result = match stt_config(&s, &state.secrets) {
                Ok(cfg) => {
                    let audio = tauri::async_runtime::spawn_blocking({
                        let path = path.clone();
                        move || std::fs::read(path)
                    })
                    .await
                    .map_err(|e| e.to_string())
                    .and_then(|r| r.map_err(|e| e.to_string()));
                    match audio {
                        Ok(bytes) if bytes.len() < 2_000 => Ok(String::new()), // basically silence
                        Ok(bytes) => whisper::transcribe(&state.ai.client(), &cfg, bytes).await,
                        Err(e) => {
                            log::error!("Could not read the recording: {e}");
                            Err(VoiceError::new(VoiceErrorKind::Failed, "I couldn't read what I recorded."))
                        }
                    }
                }
                Err(e) => Err(e),
            };
            let _ = std::fs::remove_file(&path);
            // A newer session may have started while we were uploading; it owns the UI now.
            if state.voice.next_id.load(Ordering::SeqCst) == id {
                let _ = channel.send(match result {
                    Ok(text) => VoiceEvent::Final { text },
                    Err(e) => e.event(),
                });
            }
        }
        Stopped::Streaming | Stopped::Idle => {}
    }
    Ok(())
}

/// Stop listening and throw away whatever was heard.
pub fn cancel(app: &AppHandle) {
    platform_cancel(app);
}

#[cfg(target_os = "macos")]
async fn platform_start(
    app: &AppHandle,
    id: u64,
    engine: Engine,
    language: String,
    channel: Channel<VoiceEvent>,
    continuous: bool,
) -> Result<(), VoiceError> {
    macos::start(app, id, engine, language, channel, continuous).await
}

#[cfg(target_os = "macos")]
async fn platform_stop(app: &AppHandle) -> Stopped {
    macos::stop(app).await
}

#[cfg(target_os = "macos")]
fn platform_cancel(app: &AppHandle) {
    macos::cancel(app);
}

#[cfg(not(target_os = "macos"))]
async fn platform_start(
    _app: &AppHandle,
    _id: u64,
    _engine: Engine,
    _language: String,
    _channel: Channel<VoiceEvent>,
    _continuous: bool,
) -> Result<(), VoiceError> {
    Err(VoiceError::new(VoiceErrorKind::Unavailable, "Voice input needs macOS."))
}

#[cfg(not(target_os = "macos"))]
async fn platform_stop(_app: &AppHandle) -> Stopped {
    Stopped::Idle
}

#[cfg(not(target_os = "macos"))]
fn platform_cancel(_app: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_language_uses_the_primary_subtag() {
        assert_eq!(whisper_language("bn-BD").as_deref(), Some("bn"));
        assert_eq!(whisper_language("en_US").as_deref(), Some("en"));
        assert_eq!(whisper_language("yue-CN").as_deref(), Some("yue"));
        assert_eq!(whisper_language(""), None);
    }

    #[test]
    fn stt_key_is_required_for_remote_endpoints() {
        let secrets = crate::secrets::SecretStore::default();
        let remote = Settings { stt_base_url: "https://stt.example.com/v1".into(), ..Settings::default() };
        let err = stt_config(&remote, &secrets).unwrap_err();
        assert_eq!(err.kind, VoiceErrorKind::NotConfigured);

        let local = Settings { stt_base_url: "http://localhost:8000/v1".into(), ..Settings::default() };
        let cfg = stt_config(&local, &secrets).unwrap();
        assert!(cfg.api_key.is_none());

        let insecure = Settings { stt_base_url: "http://stt.example.com/v1".into(), ..Settings::default() };
        assert_eq!(stt_config(&insecure, &secrets).unwrap_err().kind, VoiceErrorKind::NotConfigured);
    }

    #[test]
    fn same_host_compares_hosts_only() {
        assert!(same_host("https://api.openai.com/v1", "https://api.openai.com/v1/"));
        assert!(!same_host("https://api.openai.com/v1", "https://api.groq.com/openai/v1"));
        assert!(!same_host("nonsense", "https://api.openai.com"));
    }

    #[test]
    fn events_serialize_for_the_ui() {
        let json = serde_json::to_string(&VoiceEvent::Partial { text: "hi".into() }).unwrap();
        assert_eq!(json, r#"{"event":"partial","data":{"text":"hi"}}"#);
        let err = VoiceError::new(VoiceErrorKind::Permission, "no").event();
        assert_eq!(serde_json::to_string(&err).unwrap(), r#"{"event":"error","data":{"kind":"permission","message":"no"}}"#);
        assert_eq!(serde_json::to_string(&VoiceEvent::Started).unwrap(), r#"{"event":"started"}"#);
    }
}
