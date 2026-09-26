//! Selected-text capture: Accessibility first, clipboard fallback second, and an
//! honest "nothing found" otherwise. Never pretends text was captured.

use serde::Serialize;

pub const MAX_CHARS: usize = 20_000;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub text: Option<String>,
    /// "accessibility" | "clipboard" | "none" | "unsupported"
    pub source: &'static str,
    pub permission_missing: bool,
    pub truncated: bool,
}

impl Capture {
    fn empty(source: &'static str, permission_missing: bool) -> Self {
        Self { text: None, source, permission_missing, truncated: false }
    }
}

fn finish(text: String, source: &'static str) -> Capture {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Capture::empty("none", false);
    }
    let truncated = text.chars().count() > MAX_CHARS;
    let text = if truncated { text.chars().take(MAX_CHARS).collect() } else { text };
    Capture { text: Some(text), source, permission_missing: false, truncated }
}

/// Blocking (up to ~1s in the worst case); call from a background thread.
pub fn capture() -> Capture {
    if !cfg!(target_os = "macos") {
        return Capture::empty("unsupported", false);
    }
    // Both strategies need Accessibility (posting Cmd+C is gated by it too).
    if !crate::accessibility::is_trusted() {
        log::warn!("Accessibility unavailable");
        return Capture::empty("none", true);
    }
    if let Some(text) = crate::accessibility::selected_text() {
        if !text.trim().is_empty() {
            log::info!("Selected text captured via Accessibility");
            return finish(text, "accessibility");
        }
    }
    match crate::clipboard::copy_selected_text() {
        Ok(Some(text)) if !text.trim().is_empty() => {
            log::info!("Selected text captured via clipboard fallback");
            return finish(text, "clipboard");
        }
        Ok(_) => {}
        Err(e) => log::warn!("Clipboard fallback failed: {e}"),
    }
    log::info!("No selected text found");
    Capture::empty("none", false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finish_trims_and_rejects_blank() {
        assert_eq!(finish("  hi  ".into(), "clipboard").text.as_deref(), Some("hi"));
        let blank = finish("   \n ".into(), "accessibility");
        assert_eq!(blank.text, None);
        assert_eq!(blank.source, "none");
    }

    #[test]
    fn finish_truncates_long_text_by_chars() {
        let long = "ক".repeat(MAX_CHARS + 10);
        let c = finish(long, "accessibility");
        assert!(c.truncated);
        assert_eq!(c.text.unwrap().chars().count(), MAX_CHARS);
    }
}
