//! AI Pet — native layer.
//!
//! Startup: start native services → load settings → initialise the pet window →
//! register hotkeys → build the menu bar icon. The UI then shows the pet if enabled.
//! Quit: unregister hotkeys → stop speech and AI requests → save settings → exit.

mod accessibility;
mod ai;
mod autostart;
mod clipboard;
mod commands;
mod geometry;
mod hotkey;
#[cfg(target_os = "macos")]
mod macos;
mod screens;
mod secrets;
mod selection;
mod settings;
mod tray;
mod tts;
mod window;

use std::sync::atomic::AtomicU64;
use std::sync::{Mutex, RwLock};

use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

pub struct AppState {
    pub settings: RwLock<settings::Settings>,
    pub secrets: secrets::SecretStore,
    pub pet: window::PetWindowState,
    pub ai: ai::AiState,
    pub tts: tts::TtsState,
    pub activation_seq: AtomicU64,
    pub hotkey_warnings: Mutex<Vec<String>>,
}

/// Orderly shutdown (menu bar "Quit", context menu "Quit").
pub fn quit(app: &AppHandle) {
    log::info!("Quitting");
    app.exit(0);
}

fn shutdown(app: &AppHandle) {
    hotkey::unregister_all(app);
    tts::stop(app);
    if let Some(state) = app.try_state::<AppState>() {
        state.ai.cancel_all();
        if let Ok(s) = state.settings.read() {
            let _ = settings::persist(app, &s);
        }
    }
    log::info!("Shutdown complete");
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("hyper_util", log::LevelFilter::Warn)
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout))
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }))
                .max_file_size(1_000_000)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkey::handle)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(hotkey::RegisteredHotkeys::default())
        .manage(tray::TrayState::default())
        .setup(|app| {
            log::info!("App started (v{})", env!("CARGO_PKG_VERSION"));
            // Background utility: no Dock icon, no app-switcher entry, never the "main" app.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let settings = settings::load(&handle);
            app.manage(AppState {
                settings: RwLock::new(settings.clone()),
                secrets: secrets::SecretStore::default(),
                pet: window::PetWindowState::default(),
                ai: ai::AiState::default(),
                tts: tts::TtsState::default(),
                activation_seq: AtomicU64::new(0),
                hotkey_warnings: Mutex::new(Vec::new()),
            });

            window::setup(&handle)?;
            window::start_click_through_watcher(handle.clone());

            let warnings = hotkey::register_all(&handle, &settings);
            *app.state::<AppState>().hotkey_warnings.lock().unwrap() = warnings;

            if let Err(e) = tray::create(&handle, &settings) {
                log::error!("Menu bar icon unavailable: {e}");
            }
            autostart::reconcile(&handle, settings.launch_at_login);
            if accessibility::is_trusted() {
                log::info!("Accessibility permission available");
            } else {
                log::warn!("Accessibility permission not granted yet");
            }
            // The UI positions and shows the pet itself once it has loaded.
            Ok(())
        })
        .on_window_event(|win, event| match event {
            WindowEvent::Moved(_) if win.label() == window::PET_LABEL => {
                window::on_moved(win.app_handle(), win);
            }
            // The pet window has no close button; never let it be closed by accident.
            WindowEvent::CloseRequested { api, .. } if win.label() == window::PET_LABEL => {
                api.prevent_close();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::get_app_status,
            commands::set_api_key,
            commands::delete_api_key,
            commands::get_screens,
            commands::get_mouse_position,
            commands::get_pet_frame,
            commands::set_pet_frame,
            commands::set_pet_position,
            commands::move_pet_to,
            commands::stop_pet_motion,
            commands::show_pet,
            commands::hide_pet,
            commands::focus_pet,
            commands::release_focus,
            commands::set_click_through,
            commands::check_accessibility_permission,
            commands::request_accessibility_permission,
            commands::open_accessibility_settings,
            commands::read_clipboard,
            commands::write_clipboard,
            commands::ai_stream,
            commands::ai_cancel,
            commands::ai_test_connection,
            commands::tts_speak,
            commands::tts_stop,
            commands::open_settings_window,
            commands::quit_app,
            commands::app_log,
        ])
        .build(tauri::generate_context!())
        .expect("error while building AI Pet");

    app.run(|app, event| match event {
        // Closing the Settings window must not quit a menu-bar utility.
        RunEvent::ExitRequested { api, code: None, .. } => api.prevent_exit(),
        RunEvent::Exit => shutdown(app),
        _ => {}
    });
}
