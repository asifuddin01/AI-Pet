//! Global shortcuts: Option+P (summon the pet) and Option+Shift+P (pet on/off).
//!
//! Flow for Option+P (UI first, never waiting on anything slow):
//!   hotkey → emit `global-hotkey` with the cursor position (the pet shows immediately)
//!          → capture selected text on a background thread → emit `selected-text`.

use std::sync::atomic::Ordering;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::geometry::Point;
use crate::selection::Capture;
use crate::settings::Settings;
use crate::window::PET_LABEL;
use crate::AppState;

pub const CONFLICT_MESSAGE: &str = "This shortcut is already in use. Choose another shortcut in Settings.";

#[derive(Default)]
pub struct Registered {
    main: Option<Shortcut>,
    toggle: Option<Shortcut>,
}

pub type RegisteredHotkeys = Mutex<Registered>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeyPayload {
    seq: u64,
    cursor: Point,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectedTextPayload {
    seq: u64,
    #[serde(flatten)]
    capture: Capture,
}

pub fn parse(s: &str) -> Result<Shortcut, String> {
    let shortcut: Shortcut = s
        .parse()
        .map_err(|_| format!("\"{s}\" isn't a shortcut I understand."))?;
    if shortcut.mods.is_empty() {
        return Err("Shortcuts need at least one modifier key (⌥, ⌘, ⌃ or ⇧).".into());
    }
    Ok(shortcut)
}

/// (Re-)register both shortcuts from settings. Returns user-facing warnings.
pub fn register_all(app: &AppHandle, settings: &Settings) -> Vec<String> {
    let gs = app.global_shortcut();
    let registered = app.state::<RegisteredHotkeys>();
    let mut guard = registered.lock().unwrap();
    let reg = &mut *guard;
    for sc in [reg.main.take(), reg.toggle.take()].into_iter().flatten() {
        let _ = gs.unregister(sc);
    }

    let mut warnings = Vec::new();
    let main = parse(&settings.hotkey);
    let toggle = parse(&settings.toggle_hotkey);
    if let (Ok(a), Ok(b)) = (&main, &toggle) {
        if a == b {
            warnings.push("The two shortcuts must be different.".to_string());
            return warnings;
        }
    }
    for (label, parsed, slot) in [
        ("Pet shortcut", main, &mut reg.main),
        ("Toggle shortcut", toggle, &mut reg.toggle),
    ] {
        match parsed {
            Ok(sc) => match gs.register(sc) {
                Ok(()) => {
                    log::info!("Hotkey registered ({label})");
                    *slot = Some(sc);
                }
                Err(e) => {
                    log::warn!("Hotkey registration failed ({label}): {e}");
                    warnings.push(format!("{label}: {CONFLICT_MESSAGE}"));
                }
            },
            Err(e) => warnings.push(format!("{label}: {e}")),
        }
    }
    warnings
}

pub fn unregister_all(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
    log::info!("Hotkeys unregistered");
}

/// Plugin handler; runs on the main thread, so it must return quickly.
pub fn handle(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let (is_main, is_toggle) = {
        let reg = app.state::<RegisteredHotkeys>();
        let reg = reg.lock().unwrap();
        (reg.main.as_ref() == Some(shortcut), reg.toggle.as_ref() == Some(shortcut))
    };
    if is_toggle {
        crate::settings::update(app, |s| s.pet_enabled = !s.pet_enabled);
    } else if is_main {
        activate(app);
    }
}

fn activate(app: &AppHandle) {
    let state = app.state::<AppState>();
    let enabled = state.settings.read().map(|s| s.pet_enabled).unwrap_or(false);
    if !enabled {
        log::info!("Pet hotkey ignored: pet is off");
        return;
    }
    let seq = state.activation_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let cursor = crate::screens::cursor_position(app);
    crate::window::remember_previous_app(app);
    let _ = app.emit_to(PET_LABEL, "global-hotkey", HotkeyPayload { seq, cursor });

    let app = app.clone();
    std::thread::spawn(move || {
        let capture = crate::selection::capture();
        let _ = app.emit_to(PET_LABEL, "selected-text", SelectedTextPayload { seq, capture });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_shortcuts() {
        assert!(parse("Alt+KeyP").is_ok());
        assert!(parse("Alt+Shift+KeyP").is_ok());
        assert!(parse("Option+P").is_ok());
        assert_ne!(parse("Alt+KeyP").unwrap(), parse("Alt+Shift+KeyP").unwrap());
    }

    #[test]
    fn rejects_bare_keys_and_garbage() {
        assert!(parse("KeyP").is_err());
        assert!(parse("Alt+NotAKey").is_err());
        assert!(parse("").is_err());
    }
}
