//! Native text-to-speech fallback using macOS's built-in `/usr/bin/say`.
//!
//! The pet normally speaks through the webview's Web Speech API (which is backed by
//! the same system voices); this is used only when that API is unavailable.
//! The text is passed on stdin — never through a shell — and only fixed arguments are used.

use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::AppState;

const MAX_CHARS: usize = 5_000;

#[derive(Default)]
pub struct TtsState {
    current: Mutex<Option<(u64, Child)>>,
    next_id: AtomicU64,
}

fn valid_voice(voice: &str) -> bool {
    !voice.is_empty()
        && voice.len() <= 64
        && voice
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '(' | ')' | '-' | '_' | '.'))
}

pub fn stop(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut current = state.tts.current.lock().unwrap();
    if let Some((_, mut child)) = current.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Speak and wait until finished. Returns false if interrupted.
pub async fn speak(app: AppHandle, text: String, voice: Option<String>, rate: f32) -> Result<bool, String> {
    if !cfg!(target_os = "macos") {
        return Err("Native speech is only available on macOS".into());
    }
    let text: String = text.chars().take(MAX_CHARS).collect();
    if text.trim().is_empty() {
        return Ok(true);
    }
    stop(&app);

    let wpm = (180.0 * rate.clamp(0.5, 2.0)).round() as u32;
    let mut cmd = Command::new("/usr/bin/say");
    cmd.arg("-r").arg(wpm.to_string());
    if let Some(v) = voice.as_deref().filter(|v| valid_voice(v)) {
        cmd.arg("-v").arg(v);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not start speech: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }

    let state = app.state::<AppState>();
    let id = state.tts.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    *state.tts.current.lock().unwrap() = Some((id, child));

    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || loop {
        {
            let state = app2.state::<AppState>();
            let mut current = state.tts.current.lock().unwrap();
            match current.as_mut() {
                Some((cid, child)) if *cid == id => match child.try_wait() {
                    Ok(Some(status)) => {
                        current.take();
                        return status.success();
                    }
                    Ok(None) => {}
                    Err(_) => return false,
                },
                _ => return false, // stopped or replaced
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::valid_voice;

    #[test]
    fn voice_names_are_restricted() {
        assert!(valid_voice("Samantha"));
        assert!(valid_voice("Eddy (English (US))"));
        assert!(!valid_voice(""));
        assert!(!valid_voice("-o /tmp/x"));
        assert!(!valid_voice("Alex; rm -rf"));
    }
}
