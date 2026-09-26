//! Menu bar icon: control the pet even while it's hidden.

use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::settings::Settings;
use crate::window::PET_LABEL;

pub struct TrayItems {
    pet: CheckMenuItem<Wry>,
    roaming: CheckMenuItem<Wry>,
    voice: CheckMenuItem<Wry>,
}

pub type TrayState = Mutex<Option<TrayItems>>;

fn on_off(label: &str, on: bool) -> String {
    format!("{label}: {}", if on { "ON" } else { "OFF" })
}

pub fn create(app: &AppHandle, settings: &Settings) -> tauri::Result<()> {
    let header = MenuItem::with_id(app, "header", "🤖 AI Pet", false, None::<&str>)?;
    let pet = CheckMenuItem::with_id(app, "pet", on_off("Pet", settings.pet_enabled), true, settings.pet_enabled, None::<&str>)?;
    let roaming = CheckMenuItem::with_id(app, "roaming", on_off("Roaming", settings.roaming), true, settings.roaming, None::<&str>)?;
    let voice = CheckMenuItem::with_id(app, "voice", on_off("Voice", settings.speak), true, settings.speak, None::<&str>)?;
    let chat = MenuItem::with_id(app, "chat", "Chat", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AI Pet", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &header,
            &PredefinedMenuItem::separator(app)?,
            &pet,
            &roaming,
            &voice,
            &PredefinedMenuItem::separator(app)?,
            &chat,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("ai-pet")
        .icon(Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?)
        .icon_as_template(true)
        .tooltip("AI Pet")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle(app, event.id().as_ref()))
        .build(app)?;

    *app.state::<TrayState>().lock().unwrap() = Some(TrayItems { pet, roaming, voice });
    Ok(())
}

fn handle(app: &AppHandle, id: &str) {
    match id {
        "pet" => {
            crate::settings::update(app, |s| s.pet_enabled = !s.pet_enabled);
        }
        "roaming" => {
            crate::settings::update(app, |s| s.roaming = !s.roaming);
        }
        "voice" => {
            crate::settings::update(app, |s| s.speak = !s.speak);
        }
        "chat" => {
            // Asking for chat implies wanting the pet around.
            crate::settings::update(app, |s| s.pet_enabled = true);
            let _ = app.emit_to(PET_LABEL, "open-chat", ());
        }
        "settings" => {
            if let Err(e) = crate::commands::show_settings_window(app) {
                log::error!("Could not open settings: {e}");
            }
        }
        "quit" => crate::quit(app),
        _ => {}
    }
}

/// Keep the check marks in sync when settings change elsewhere.
pub fn sync(app: &AppHandle, settings: &Settings) {
    let Some(state) = app.try_state::<TrayState>() else {
        return;
    };
    let guard = state.lock().unwrap();
    if let Some(items) = guard.as_ref() {
        for (item, label, on) in [
            (&items.pet, "Pet", settings.pet_enabled),
            (&items.roaming, "Roaming", settings.roaming),
            (&items.voice, "Voice", settings.speak),
        ] {
            let _ = item.set_checked(on);
            let _ = item.set_text(on_off(label, on));
        }
    }
}
