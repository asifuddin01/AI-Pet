//! Launch at login — only ever enabled when the user turns it on.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|e| e.to_string())?;
    log::info!("Launch at login {}", if enabled { "enabled" } else { "disabled" });
    Ok(())
}

/// Make the OS state match the saved setting (e.g. after the app was moved).
pub fn reconcile(app: &AppHandle, wanted: bool) {
    let launcher = app.autolaunch();
    match launcher.is_enabled() {
        Ok(actual) if actual != wanted => {
            if let Err(e) = set_enabled(app, wanted) {
                log::warn!("Could not reconcile launch at login: {e}");
            }
        }
        Ok(_) => {}
        Err(e) => log::warn!("Could not read launch-at-login state: {e}"),
    }
}
