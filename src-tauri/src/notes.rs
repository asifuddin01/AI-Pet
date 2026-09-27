//! Quick notes ("note buy milk"), kept as JSON in the app's data folder on this Mac.
//! Notes are the user's own text: they are stored, never logged, and never sent anywhere.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const MAX_NOTES: usize = 200;
pub const MAX_NOTE_CHARS: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Note {
    pub text: String,
    /// Unix milliseconds.
    pub created: f64,
}

fn notes_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("notes.json"))
}

/// Trim, drop control characters (except line breaks) and cap sizes.
pub fn sanitize(notes: Vec<Note>) -> Vec<Note> {
    notes
        .into_iter()
        .filter_map(|n| {
            let cleaned: String = n.text.chars().filter(|c| !c.is_control() || *c == '\n').collect();
            let text: String = cleaned.trim().chars().take(MAX_NOTE_CHARS).collect();
            if text.is_empty() {
                return None;
            }
            let created = if n.created.is_finite() && n.created >= 0.0 { n.created } else { 0.0 };
            Some(Note { text, created })
        })
        .take(MAX_NOTES)
        .collect()
}

pub fn load(app: &AppHandle) -> Vec<Note> {
    let Some(path) = notes_path(app) else { return Vec::new() };
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str::<Vec<Note>>(&json).map(sanitize).unwrap_or_else(|e| {
            log::warn!("Notes file is invalid, starting empty: {e}");
            Vec::new()
        }),
        Err(_) => Vec::new(),
    }
}

pub fn save(app: &AppHandle, notes: Vec<Note>) -> Result<(), String> {
    let path = notes_path(app).ok_or("No data directory available")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not create data dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&sanitize(notes)).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("Could not write notes: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Could not save notes: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_trims_caps_and_drops_empty_notes() {
        let long = "x".repeat(MAX_NOTE_CHARS + 50);
        let notes = sanitize(vec![
            Note { text: "  buy milk \u{7} ".into(), created: 5.0 },
            Note { text: "   ".into(), created: 1.0 },
            Note { text: long, created: f64::NAN },
            Note { text: "line one\nline two".into(), created: -3.0 },
        ]);
        assert_eq!(notes.len(), 3);
        assert_eq!(notes[0].text, "buy milk");
        assert_eq!(notes[1].text.chars().count(), MAX_NOTE_CHARS);
        assert_eq!(notes[1].created, 0.0);
        assert_eq!(notes[2].text, "line one\nline two");
        assert_eq!(notes[2].created, 0.0);
    }

    #[test]
    fn sanitize_caps_the_number_of_notes() {
        let many = (0..MAX_NOTES + 10).map(|i| Note { text: format!("n{i}"), created: 0.0 }).collect();
        assert_eq!(sanitize(many).len(), MAX_NOTES);
    }
}
