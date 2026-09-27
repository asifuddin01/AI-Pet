//! The complete IPC surface. Each command is allow-listed per window in
//! `capabilities/*.json`; arguments are validated here before use.

use std::time::Duration;

use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::ai::{self, AiRequest, StreamEvent};
use crate::geometry::{Point, Rect};
use crate::screens::ScreenInfo;
use crate::settings::{Provider, Settings};
use crate::AppState;

const SETTINGS_LABEL: &str = "settings";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    settings: Settings,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    platform: &'static str,
    version: &'static str,
    accessibility_trusted: bool,
    hotkey_warnings: Vec<String>,
    /// True when the current provider has everything it needs (model + key if required).
    ai_configured: bool,
    has_api_key: bool,
    /// A separate speech-to-text (Whisper) key is saved.
    has_stt_key: bool,
    has_search_key: bool,
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

// ---------------------------------------------------------------- settings

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.read().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> SaveResult {
    let (settings, warnings) = crate::settings::apply(&app, settings);
    SaveResult { settings, warnings }
}

#[tauri::command]
pub async fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let settings = state.settings.read().map(|s| s.clone()).unwrap_or_default();
    let has_api_key = state.secrets.has(settings.provider);
    let ai_configured = ai::resolve_config(&settings, &state.secrets).is_ok();
    Ok(AppStatus {
        platform: platform(),
        version: env!("CARGO_PKG_VERSION"),
        accessibility_trusted: crate::accessibility::is_trusted(),
        hotkey_warnings: state.hotkey_warnings.lock().unwrap().clone(),
        ai_configured,
        has_api_key,
        has_stt_key: state.secrets.get_stt().is_some(),
        has_search_key: state.secrets.get_search().is_some(),
    })
}

#[tauri::command]
pub async fn set_api_key(state: State<'_, AppState>, provider: Provider, key: String) -> Result<(), String> {
    state.secrets.set(provider, &key)
}

#[tauri::command]
pub async fn delete_api_key(state: State<'_, AppState>, provider: Provider) -> Result<(), String> {
    state.secrets.delete(provider)
}

// ---------------------------------------------------------------- window

#[tauri::command]
pub fn get_screens(app: AppHandle) -> Vec<ScreenInfo> {
    crate::screens::screens(&app)
}

#[tauri::command]
pub fn get_mouse_position(app: AppHandle) -> Point {
    crate::screens::cursor_position(&app)
}

#[tauri::command]
pub fn get_pet_frame(app: AppHandle) -> Rect {
    crate::window::current_frame(&app)
}

#[tauri::command]
pub fn set_pet_frame(app: AppHandle, frame: Rect) -> Result<(), String> {
    crate::window::set_frame(&app, frame)
}

#[tauri::command]
pub fn set_pet_position(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    crate::window::stop_motion(&app);
    crate::window::set_position(&app, Point { x, y })
}

#[tauri::command]
pub fn move_pet_to(app: AppHandle, x: f64, y: f64, duration_ms: u32) -> Result<u64, String> {
    let duration = Duration::from_millis(duration_ms.clamp(50, 60_000) as u64);
    crate::window::move_to(&app, Point { x, y }, duration)
}

#[tauri::command]
pub fn stop_pet_motion(app: AppHandle) -> Rect {
    crate::window::stop_motion(&app);
    crate::window::current_frame(&app)
}

#[tauri::command]
pub fn show_pet(app: AppHandle) -> Result<(), String> {
    crate::window::show(&app)
}

#[tauri::command]
pub fn hide_pet(app: AppHandle) -> Result<(), String> {
    crate::tts::stop(&app);
    crate::window::hide(&app)
}

#[tauri::command]
pub fn focus_pet(app: AppHandle) -> Result<(), String> {
    crate::window::focus(&app)
}

#[tauri::command]
pub fn release_focus(app: AppHandle) {
    crate::window::release_focus(&app)
}

#[tauri::command]
pub fn set_click_through(app: AppHandle, enabled: bool, hit_rect: Option<Rect>) -> Result<(), String> {
    crate::window::set_click_through(&app, enabled, hit_rect)
}

// ---------------------------------------------------------------- permissions & clipboard

#[tauri::command]
pub fn check_accessibility_permission() -> bool {
    crate::accessibility::is_trusted()
}

/// Shows the system "allow Accessibility" prompt. The UI calls this only the first
/// time; afterwards it uses `open_accessibility_settings` so the user is never
/// shown System Settings repeatedly or unasked.
#[tauri::command]
pub fn request_accessibility_permission() -> bool {
    if crate::accessibility::is_trusted() {
        return true;
    }
    log::info!("Requesting Accessibility permission");
    crate::accessibility::prompt_for_trust()
}

#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    crate::accessibility::open_settings()
}

/// Explicit, user-initiated read (e.g. "Translate clipboard").
#[tauri::command]
pub async fn read_clipboard() -> Option<String> {
    crate::clipboard::read_text().map(|t| t.chars().take(crate::selection::MAX_CHARS).collect())
}

/// "Copy result". Returns false where no native clipboard is available (UI falls back).
#[tauri::command]
pub fn write_clipboard(text: String) -> bool {
    let text: String = text.chars().take(100_000).collect();
    crate::clipboard::write_text(&text)
}

// ---------------------------------------------------------------- AI

#[tauri::command]
pub async fn ai_stream(
    state: State<'_, AppState>,
    request_id: u32,
    request: AiRequest,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    request.validate()?;
    let settings = state.settings.read().map(|s| s.clone()).unwrap_or_default();
    let cfg = match ai::resolve_config(&settings, &state.secrets) {
        Ok(cfg) => cfg,
        Err(e) => {
            let _ = on_event.send(e.into_event());
            return Ok(());
        }
    };
    let client = state.ai.client();
    let tasks = state.ai.tasks.clone();
    // Hold the lock while spawning so the task can't finish (and remove itself) first.
    let mut guard = tasks.lock().unwrap();
    let tasks_for_task = tasks.clone();
    let handle = tokio::spawn(async move {
        log::info!("AI request started (provider={}, model={})", cfg.provider.as_str(), cfg.model);
        let started = std::time::Instant::now();
        let sink = on_event.clone();
        let mut emit = move |ev: StreamEvent| {
            let _ = sink.send(ev);
        };
        let outcome = tokio::time::timeout(cfg.timeout, ai::stream_chat(&client, &cfg, &request, &mut emit)).await;
        let result = match outcome {
            Ok(r) => r,
            Err(_) => Err(ai::AiError::new(ai::ErrorKind::Timeout, "The request timed out")),
        };
        match result {
            Ok(()) => {
                log::info!("AI request finished in {} ms", started.elapsed().as_millis());
                let _ = on_event.send(StreamEvent::Done);
            }
            Err(e) => {
                log::error!("AI request failed (kind={:?}, status={:?})", e.kind, e.status);
                let _ = on_event.send(e.into_event());
            }
        }
        tasks_for_task.lock().unwrap().remove(&request_id);
    });
    if let Some(old) = guard.insert(request_id, handle.abort_handle()) {
        old.abort();
    }
    Ok(())
}

#[tauri::command]
pub fn ai_cancel(state: State<'_, AppState>, request_id: u32) {
    if state.ai.cancel(request_id) {
        log::info!("AI request cancelled");
    }
}

/// Small round-trip used by the Settings "Test connection" button.
#[tauri::command]
pub async fn ai_test_connection(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.read().map(|s| s.clone()).unwrap_or_default();
    let mut cfg = ai::resolve_config(&settings, &state.secrets).map_err(|e| e.message)?;
    cfg.timeout = cfg.timeout.min(Duration::from_secs(30));
    let request = AiRequest {
        system: "You are a connectivity check. Reply with the single word: OK".into(),
        messages: vec![ai::ChatMessage { role: "user".into(), content: "ping".into() }],
    };
    let mut text = String::new();
    let mut emit = |ev: StreamEvent| match ev {
        StreamEvent::Delta { text: t } => text.push_str(&t),
        StreamEvent::Reset => text.clear(),
        _ => {}
    };
    let client = state.ai.client();
    let result = tokio::time::timeout(cfg.timeout, ai::stream_chat(&client, &cfg, &request, &mut emit))
        .await
        .unwrap_or_else(|_| Err(ai::AiError::new(ai::ErrorKind::Timeout, "The request timed out")));
    match result {
        Ok(()) => {
            let reply: String = text.trim().chars().take(60).collect();
            log::info!("AI connection test succeeded");
            Ok(if reply.is_empty() { "Connected.".into() } else { format!("Connected — the model replied “{reply}”.") })
        }
        Err(e) => {
            log::warn!("AI connection test failed (kind={:?}, status={:?})", e.kind, e.status);
            Err(match e.kind {
                ai::ErrorKind::Auth => "The API key was rejected.".into(),
                ai::ErrorKind::InvalidModel => "The model or endpoint wasn't found.".into(),
                ai::ErrorKind::RateLimit => "Rate limited — try again in a moment.".into(),
                ai::ErrorKind::Network => "Couldn't reach the endpoint. Check the URL and your internet.".into(),
                ai::ErrorKind::Timeout => "The provider took too long to answer.".into(),
                _ => e.message,
            })
        }
    }
}

// ---------------------------------------------------------------- character assets

fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

/// Raw-bytes upload of a VRM model or a sprite/clip (headers: x-kind, x-name, x-state).
#[tauri::command]
pub async fn import_character_file(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected file bytes".into());
    };
    let kind = crate::characters::Kind::parse(header(&request, "x-kind").unwrap_or_default())?;
    let name = header(&request, "x-name").ok_or("Missing file name")?;
    crate::characters::import(&app, kind, name, header(&request, "x-state"), bytes)
}

#[tauri::command]
pub async fn list_characters(app: AppHandle) -> Result<crate::characters::CharacterList, String> {
    crate::characters::list(&app)
}

#[tauri::command]
pub async fn read_character_file(app: AppHandle, kind: String, name: String) -> Result<Response, String> {
    let kind = crate::characters::Kind::parse(&kind)?;
    crate::characters::read(&app, kind, &name).map(Response::new)
}

#[tauri::command]
pub async fn delete_character_file(app: AppHandle, kind: String, name: String) -> Result<(), String> {
    let kind = crate::characters::Kind::parse(&kind)?;
    crate::characters::delete(&app, kind, &name)
}

// ---------------------------------------------------------------- voice

#[tauri::command]
pub async fn tts_speak(app: AppHandle, text: String, voice: Option<String>, rate: Option<f32>) -> Result<bool, String> {
    crate::tts::speak(app, text, voice, rate.unwrap_or(1.0)).await
}

#[tauri::command]
pub fn tts_stop(app: AppHandle) {
    crate::tts::stop(&app)
}

// ---------------------------------------------------------------- voice input

#[tauri::command]
pub async fn voice_start(
    app: AppHandle,
    on_event: Channel<crate::voice::VoiceEvent>,
    mode: Option<crate::voice::Mode>,
) -> Result<(), String> {
    crate::voice::start(app, on_event, mode.unwrap_or_default()).await
}

/// Seconds since the last keyboard/mouse input anywhere (so check-ins don't talk to an empty room).
#[tauri::command]
pub fn get_idle_seconds() -> f64 {
    #[cfg(target_os = "macos")]
    {
        crate::macos::seconds_since_input()
    }
    #[cfg(not(target_os = "macos"))]
    {
        0.0
    }
}

#[tauri::command]
pub async fn voice_stop(app: AppHandle) -> Result<(), String> {
    crate::voice::stop(app).await
}

#[tauri::command]
pub fn voice_cancel(app: AppHandle) {
    crate::voice::cancel(&app)
}

#[tauri::command]
pub async fn set_stt_key(state: State<'_, AppState>, key: String) -> Result<(), String> {
    state.secrets.set_stt(&key)
}

#[tauri::command]
pub async fn delete_stt_key(state: State<'_, AppState>) -> Result<(), String> {
    state.secrets.delete_stt()
}

// ---------------------------------------------------------------- tools

#[tauri::command]
pub async fn get_notes(app: AppHandle) -> Vec<crate::notes::Note> {
    crate::notes::load(&app)
}

#[tauri::command]
pub async fn save_notes(app: AppHandle, notes: Vec<crate::notes::Note>) -> Result<(), String> {
    if notes.len() > crate::notes::MAX_NOTES {
        return Err("Too many notes".into());
    }
    crate::notes::save(&app, notes)
}

// ---------------------------------------------------------------- web search

#[tauri::command]
pub async fn web_search(state: State<'_, AppState>, query: String) -> Result<Vec<crate::search::SearchResult>, String> {
    let settings = state.settings.read().map(|s| s.clone()).unwrap_or_default();
    if !settings.ai_enabled {
        return Err("Network features are switched off in Settings (Allow AI requests).".into());
    }
    let key = state
        .secrets
        .get_search()
        .ok_or("Add a search key in Settings → Search to let me look things up.")?;
    let provider = crate::search::Provider::parse(&settings.search_provider);
    let results =
        crate::search::search(&state.ai.client(), provider, &key, &settings.search_engine_id, &query).await?;
    if let Ok(mut links) = state.search_links.lock() {
        *links = results.iter().map(|r| r.link.clone()).collect();
    }
    Ok(results)
}

#[tauri::command]
pub fn open_search_result(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let allowed = state.search_links.lock().map(|l| l.clone()).unwrap_or_default();
    crate::search::open(&url, &allowed)
}

#[tauri::command]
pub async fn set_search_key(state: State<'_, AppState>, key: String) -> Result<(), String> {
    state.secrets.set_search(&key)
}

#[tauri::command]
pub async fn delete_search_key(state: State<'_, AppState>) -> Result<(), String> {
    state.secrets.delete_search()
}

// ---------------------------------------------------------------- updates

#[tauri::command]
pub async fn check_for_update(state: State<'_, AppState>) -> Result<crate::updates::UpdateInfo, String> {
    crate::updates::check(&state.ai.client()).await
}

#[tauri::command]
pub fn open_release_page(url: String) -> Result<(), String> {
    crate::updates::open(&url)
}

// ---------------------------------------------------------------- app

pub fn show_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        win.unminimize().ok();
        win.show().map_err(|e| e.to_string())?;
        return win.set_focus().map_err(|e| e.to_string());
    }
    let win = WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("settings.html".into()))
        .title("AI Pet Settings")
        .inner_size(560.0, 680.0)
        .min_inner_size(460.0, 480.0)
        .resizable(true)
        .center()
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> Result<(), String> {
    show_settings_window(&app)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    crate::quit(&app)
}

/// Lets the UI write to the app log. Callers must never pass user text or secrets.
#[tauri::command]
pub fn app_log(level: String, message: String) {
    let message: String = message.chars().filter(|c| !c.is_control()).take(300).collect();
    match level.as_str() {
        "error" => log::error!("[ui] {message}"),
        "warn" => log::warn!("[ui] {message}"),
        _ => log::info!("[ui] {message}"),
    }
}
