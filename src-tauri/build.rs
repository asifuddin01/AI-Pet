// Every command gets an auto-generated `allow-<command>` permission; a command is
// only callable from a window whose capability file lists it (guide §20, rule #19).
const COMMANDS: &[&str] = &[
    "get_settings",
    "save_settings",
    "get_app_status",
    "set_api_key",
    "delete_api_key",
    "get_screens",
    "get_mouse_position",
    "get_pet_frame",
    "set_pet_frame",
    "set_pet_position",
    "move_pet_to",
    "stop_pet_motion",
    "show_pet",
    "hide_pet",
    "focus_pet",
    "release_focus",
    "set_click_through",
    "check_accessibility_permission",
    "request_accessibility_permission",
    "open_accessibility_settings",
    "read_clipboard",
    "write_clipboard",
    "ai_stream",
    "ai_cancel",
    "ai_test_connection",
    "tts_speak",
    "tts_stop",
    "open_settings_window",
    "quit_app",
    "app_log",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
