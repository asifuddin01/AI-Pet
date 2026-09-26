//! Non-secret user settings, persisted as JSON in the app config directory.
//!
//! API keys are never stored here — see `secrets.rs` (macOS Keychain).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::geometry::Point;
use crate::AppState;

pub const DEFAULT_HOTKEY: &str = "Alt+KeyP";
pub const DEFAULT_TOGGLE_HOTKEY: &str = "Alt+Shift+KeyP";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    /// Any OpenAI-compatible `/chat/completions` endpoint (OpenAI, Ollama, LM Studio, OpenRouter, ...).
    #[default]
    OpenAi,
    /// Anthropic Messages API.
    Anthropic,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::OpenAi => "openai",
            Provider::Anthropic => "anthropic",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RoamArea {
    /// Walk along the bottom of the screen, above the Dock (least distracting).
    #[default]
    Bottom,
    /// Wander anywhere inside the visible screen area.
    Anywhere,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    // General
    pub pet_enabled: bool,
    pub roaming: bool,
    pub roam_all_displays: bool,
    pub roam_area: RoamArea,
    pub launch_at_login: bool,

    // Interaction
    pub hotkey: String,
    pub toggle_hotkey: String,

    // AI
    /// Master switch: when false the app never makes AI network requests.
    pub ai_enabled: bool,
    pub provider: Provider,
    /// UI preset id ("openai", "anthropic", "ollama", "openrouter", "custom"); cosmetic only.
    pub preset: String,
    pub base_url: String,
    pub model: String,
    pub request_timeout_secs: u32,
    /// "auto" or a language name such as "English", "Bangla", "Japanese".
    pub translate_target: String,
    /// In auto mode, English text is translated into this language.
    pub auto_second_language: String,

    // Voice
    pub speak: bool,
    /// Voice name ("" = system default).
    pub voice: String,
    pub speech_rate: f32,
    pub voice_input: bool,

    // Appearance
    pub pet_size: f32,
    pub animation_speed: f32,
    /// "auto" (the pet picks outfits by mood) or a fixed outfit id.
    pub outfit: String,
    /// Outfit currently worn, remembered across restarts.
    pub current_outfit: String,
    /// "vector" (built-in), "vrm" (3D model) or "sprites" (animated images/clips).
    pub character: String,
    /// Default VRM model file (in the app's character folder).
    pub vrm_model: String,
    /// Optional per-outfit VRM models (outfit id → model file).
    pub outfit_models: std::collections::BTreeMap<String, String>,

    // Remembered state
    pub first_run_completed: bool,
    pub accessibility_prompted: bool,
    pub last_position: Option<Point>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            pet_enabled: true,
            roaming: true,
            roam_all_displays: false,
            roam_area: RoamArea::Bottom,
            launch_at_login: false,
            hotkey: DEFAULT_HOTKEY.into(),
            toggle_hotkey: DEFAULT_TOGGLE_HOTKEY.into(),
            ai_enabled: true,
            provider: Provider::OpenAi,
            preset: "openai".into(),
            base_url: "https://api.openai.com/v1".into(),
            model: String::new(),
            request_timeout_secs: 60,
            translate_target: "auto".into(),
            auto_second_language: "Bangla".into(),
            speak: true,
            voice: String::new(),
            speech_rate: 1.0,
            voice_input: false,
            pet_size: 1.0,
            animation_speed: 1.0,
            outfit: "auto".into(),
            current_outfit: String::new(),
            character: "vector".into(),
            vrm_model: String::new(),
            outfit_models: Default::default(),
            first_run_completed: false,
            accessibility_prompted: false,
            last_position: None,
        }
    }
}

fn clean(s: &str, max_chars: usize) -> String {
    s.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max_chars)
        .collect()
}

impl Settings {
    /// Clamp and sanitize every field so the rest of the app can trust the values.
    pub fn normalized(mut self) -> Self {
        let defaults = Settings::default();
        self.hotkey = clean(&self.hotkey, 64);
        if self.hotkey.is_empty() {
            self.hotkey = defaults.hotkey.clone();
        }
        self.toggle_hotkey = clean(&self.toggle_hotkey, 64);
        if self.toggle_hotkey.is_empty() {
            self.toggle_hotkey = defaults.toggle_hotkey.clone();
        }
        self.preset = clean(&self.preset, 32);
        self.base_url = clean(&self.base_url, 500).trim_end_matches('/').to_string();
        self.model = clean(&self.model, 200);
        self.request_timeout_secs = self.request_timeout_secs.clamp(5, 300);
        self.translate_target = clean(&self.translate_target, 40);
        if self.translate_target.is_empty() {
            self.translate_target = "auto".into();
        }
        self.auto_second_language = clean(&self.auto_second_language, 40);
        if self.auto_second_language.is_empty() {
            self.auto_second_language = defaults.auto_second_language;
        }
        self.voice = clean(&self.voice, 200);
        self.outfit = clean(&self.outfit, 32);
        if self.outfit.is_empty() {
            self.outfit = "auto".into();
        }
        self.current_outfit = clean(&self.current_outfit, 32);
        if !matches!(self.character.as_str(), "vector" | "vrm" | "sprites") {
            self.character = "vector".into();
        }
        self.vrm_model = clean(&self.vrm_model, 80);
        self.outfit_models = std::mem::take(&mut self.outfit_models)
            .into_iter()
            .take(32)
            .map(|(k, v)| (clean(&k, 32), clean(&v, 80)))
            .filter(|(k, v)| !k.is_empty() && !v.is_empty())
            .collect();
        self.speech_rate = finite_or(self.speech_rate, 1.0).clamp(0.5, 2.0);
        self.pet_size = finite_or(self.pet_size, 1.0).clamp(0.6, 3.0);
        self.animation_speed = finite_or(self.animation_speed, 1.0).clamp(0.5, 2.0);
        if let Some(p) = self.last_position {
            if !p.x.is_finite() || !p.y.is_finite() {
                self.last_position = None;
            }
        }
        self
    }

    /// Development convenience: `AI_BASE_URL`, `AI_MODEL`, `AI_PROVIDER` override the
    /// stored provider config (see `.env.example`). Keys come from `secrets.rs`.
    fn apply_env_overrides(&mut self) {
        if let Ok(provider) = std::env::var("AI_PROVIDER") {
            match provider.trim().to_lowercase().as_str() {
                "anthropic" => self.provider = Provider::Anthropic,
                "openai" | "openai-compatible" => self.provider = Provider::OpenAi,
                _ => log::warn!("Ignoring unknown AI_PROVIDER value"),
            }
        }
        if let Ok(url) = std::env::var("AI_BASE_URL") {
            if !url.trim().is_empty() {
                self.base_url = url;
            }
        }
        if let Ok(model) = std::env::var("AI_MODEL") {
            if !model.trim().is_empty() {
                self.model = model;
            }
        }
    }
}

fn finite_or(v: f32, fallback: f32) -> f32 {
    if v.is_finite() {
        v
    } else {
        fallback
    }
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    let mut settings = match settings_path(app).map(std::fs::read_to_string) {
        Some(Ok(json)) => serde_json::from_str::<Settings>(&json).unwrap_or_else(|e| {
            log::warn!("Settings file is invalid, using defaults: {e}");
            Settings::default()
        }),
        _ => Settings::default(),
    };
    settings.apply_env_overrides();
    settings.normalized()
}

pub fn persist(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app).ok_or("No config directory available")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not create config dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    // Write-then-rename so a crash never leaves a half-written settings file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("Could not write settings: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Could not save settings: {e}"))?;
    Ok(())
}

/// Replace the settings, persist them, apply side effects (hotkeys, login item, tray)
/// and broadcast `settings-changed`. Returns user-facing warnings.
pub fn apply(app: &AppHandle, new: Settings) -> (Settings, Vec<String>) {
    let state = app.state::<AppState>();
    let mut new = new.normalized();
    let old = state.settings.read().map(|s| s.clone()).unwrap_or_default();
    let mut warnings = Vec::new();

    if old.hotkey != new.hotkey || old.toggle_hotkey != new.toggle_hotkey {
        let hotkey_warnings = crate::hotkey::register_all(app, &new);
        if !hotkey_warnings.is_empty() {
            // Keep the shortcuts that still work instead of leaving the user without any.
            new.hotkey = old.hotkey.clone();
            new.toggle_hotkey = old.toggle_hotkey.clone();
            crate::hotkey::register_all(app, &new);
            warnings.extend(hotkey_warnings);
        }
    }

    if old.launch_at_login != new.launch_at_login {
        if let Err(e) = crate::autostart::set_enabled(app, new.launch_at_login) {
            log::error!("Launch at login change failed: {e}");
            warnings.push("I couldn't change the launch-at-login setting.".into());
            new.launch_at_login = old.launch_at_login;
        }
    }

    if let Ok(mut guard) = state.settings.write() {
        *guard = new.clone();
    }
    if let Err(e) = persist(app, &new) {
        log::error!("{e}");
        warnings.push("I couldn't save your settings to disk.".into());
    }

    if old.pet_enabled != new.pet_enabled {
        log::info!("Pet {}", if new.pet_enabled { "enabled" } else { "disabled" });
        let _ = app.emit("pet-toggle", new.pet_enabled);
        if !new.pet_enabled {
            crate::tts::stop(app);
        }
    }
    crate::tray::sync(app, &new);
    let _ = app.emit("settings-changed", &new);
    (new, warnings)
}

/// Read-modify-write helper used by the tray menu and the toggle hotkey.
pub fn update(app: &AppHandle, f: impl FnOnce(&mut Settings)) -> Settings {
    let state = app.state::<AppState>();
    let mut next = state.settings.read().map(|s| s.clone()).unwrap_or_default();
    f(&mut next);
    apply(app, next).0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_stable_and_normalized() {
        let d = Settings::default();
        assert_eq!(d.clone().normalized(), d);
        assert!(d.pet_enabled);
        assert!(!d.launch_at_login, "launch at login must never default to on");
        assert_eq!(d.hotkey, "Alt+KeyP");
        assert_eq!(d.outfit, "auto", "Lucy picks her own outfits by default");
    }

    #[test]
    fn clamps_out_of_range_values() {
        let s = Settings {
            speech_rate: 99.0,
            pet_size: f32::NAN,
            animation_speed: 0.0,
            request_timeout_secs: 1,
            hotkey: "   ".into(),
            base_url: "https://example.com/v1/".into(),
            ..Settings::default()
        }
        .normalized();
        assert_eq!(s.speech_rate, 2.0);
        assert_eq!(s.pet_size, 1.0);
        assert_eq!(s.animation_speed, 0.5);
        assert_eq!(s.request_timeout_secs, 5);
        assert_eq!(s.hotkey, DEFAULT_HOTKEY);
        assert_eq!(s.base_url, "https://example.com/v1");
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let s: Settings = serde_json::from_str(r#"{"roaming": false, "provider": "anthropic"}"#).unwrap();
        assert!(!s.roaming);
        assert_eq!(s.provider, Provider::Anthropic);
        assert!(s.pet_enabled);
    }

    #[test]
    fn serializes_camel_case() {
        let json = serde_json::to_string(&Settings::default()).unwrap();
        assert!(json.contains("\"petEnabled\":true"));
        assert!(json.contains("\"provider\":\"openai\""));
        assert!(json.contains("\"roamArea\":\"bottom\""));
    }
}
