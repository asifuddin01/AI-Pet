//! User-supplied character assets: 3D VRM models and animated images/clips per pet
//! state. Stored in the app's data folder (never in the repo), imported explicitly
//! from Settings, and read back by the pet window as raw bytes.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub const SPRITE_STATES: &[&str] = &["idle", "walk", "talk", "think", "listen", "sleep", "error", "happy", "wave"];
const VRM_EXTS: &[&str] = &["vrm"];
const SPRITE_EXTS: &[&str] = &["webp", "gif", "png", "apng", "webm", "mp4", "m4v", "mov"];
const MAX_VRM_BYTES: usize = 250 * 1024 * 1024;
const MAX_SPRITE_BYTES: usize = 80 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Vrm,
    Sprite,
}

impl Kind {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "vrm" => Ok(Kind::Vrm),
            "sprite" => Ok(Kind::Sprite),
            _ => Err("Unknown character asset type".into()),
        }
    }

    fn dir(self) -> &'static str {
        match self {
            Kind::Vrm => "vrm",
            Kind::Sprite => "sprites",
        }
    }
}

#[derive(Debug, Serialize, Default)]
pub struct CharacterList {
    pub vrm: Vec<String>,
    /// state → stored file name
    pub sprites: BTreeMap<String, String>,
}

fn root(app: &AppHandle, kind: Kind) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("characters")
        .join(kind.dir());
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create character folder: {e}"))?;
    Ok(dir)
}

fn extension(name: &str) -> Option<String> {
    name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase())
}

/// A safe, flat file name: letters, digits, spaces, `-`, `_`, `.` only; no paths.
pub fn sanitize_name(name: &str) -> Result<String, String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default().trim();
    let clean: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') { c } else { '_' })
        .take(80)
        .collect();
    let clean = clean.trim_start_matches('.').trim().to_string();
    if clean.is_empty() || !clean.contains('.') {
        return Err("That file name isn't usable.".into());
    }
    Ok(clean)
}

/// Validate and store an imported file. For sprites, `state` picks the pet state it
/// animates and replaces any previous file for that state.
pub fn import(app: &AppHandle, kind: Kind, name: &str, state: Option<&str>, bytes: &[u8]) -> Result<String, String> {
    let name = sanitize_name(name)?;
    let ext = extension(&name).unwrap_or_default();
    let dir = root(app, kind)?;
    let stored = match kind {
        Kind::Vrm => {
            if !VRM_EXTS.contains(&ext.as_str()) {
                return Err("Choose a .vrm model file.".into());
            }
            if bytes.len() > MAX_VRM_BYTES {
                return Err("That model is too large (limit 250 MB).".into());
            }
            // glTF binary magic: "glTF"
            if bytes.len() < 12 || &bytes[..4] != b"glTF" {
                return Err("That file isn't a VRM (glTF binary) model.".into());
            }
            name
        }
        Kind::Sprite => {
            let state = state.filter(|s| SPRITE_STATES.contains(s)).ok_or("Unknown pet state.")?;
            if !SPRITE_EXTS.contains(&ext.as_str()) {
                return Err("Use an animated WebP/GIF/PNG or a WebM/MP4/MOV clip.".into());
            }
            if bytes.len() > MAX_SPRITE_BYTES {
                return Err("That file is too large (limit 80 MB).".into());
            }
            remove_sprite(&dir, state);
            format!("{state}.{ext}")
        }
    };
    std::fs::write(dir.join(&stored), bytes).map_err(|e| format!("Could not save the file: {e}"))?;
    log::info!("Character asset imported ({:?}, {} bytes)", kind, bytes.len());
    let _ = app.emit("characters-changed", ());
    Ok(stored)
}

fn remove_sprite(dir: &std::path::Path, state: &str) {
    for ext in SPRITE_EXTS {
        let _ = std::fs::remove_file(dir.join(format!("{state}.{ext}")));
    }
}

pub fn list(app: &AppHandle) -> Result<CharacterList, String> {
    let mut out = CharacterList::default();
    for (kind, target) in [(Kind::Vrm, 0), (Kind::Sprite, 1)] {
        let dir = root(app, kind)?;
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let ext = extension(&name).unwrap_or_default();
            if target == 0 && VRM_EXTS.contains(&ext.as_str()) {
                out.vrm.push(name);
            } else if target == 1 && SPRITE_EXTS.contains(&ext.as_str()) {
                if let Some((state, _)) = name.rsplit_once('.') {
                    if SPRITE_STATES.contains(&state) {
                        out.sprites.insert(state.to_string(), name);
                    }
                }
            }
        }
    }
    out.vrm.sort();
    Ok(out)
}

fn existing_path(app: &AppHandle, kind: Kind, name: &str) -> Result<PathBuf, String> {
    let clean = sanitize_name(name)?;
    if clean != name {
        return Err("Invalid file name".into());
    }
    let path = root(app, kind)?.join(&clean);
    if !path.is_file() {
        return Err("That character file is missing. Import it again in Settings.".into());
    }
    Ok(path)
}

pub fn read(app: &AppHandle, kind: Kind, name: &str) -> Result<Vec<u8>, String> {
    std::fs::read(existing_path(app, kind, name)?).map_err(|e| format!("Could not read the file: {e}"))
}

pub fn delete(app: &AppHandle, kind: Kind, name: &str) -> Result<(), String> {
    std::fs::remove_file(existing_path(app, kind, name)?).map_err(|e| e.to_string())?;
    let _ = app.emit("characters-changed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_flattened_and_sanitized() {
        assert_eq!(sanitize_name("Lucy v2.vrm").unwrap(), "Lucy v2.vrm");
        assert_eq!(sanitize_name("../../etc/passwd.vrm").unwrap(), "passwd.vrm");
        assert_eq!(sanitize_name("C:\\x\\lucy?.vrm").unwrap(), "lucy_.vrm");
        assert_eq!(sanitize_name("..hidden.vrm").unwrap(), "hidden.vrm");
        assert!(sanitize_name("noext").is_err());
        assert!(sanitize_name("").is_err());
    }

    #[test]
    fn kinds_parse() {
        assert_eq!(Kind::parse("vrm").unwrap(), Kind::Vrm);
        assert_eq!(Kind::parse("sprite").unwrap(), Kind::Sprite);
        assert!(Kind::parse("exe").is_err());
    }
}
