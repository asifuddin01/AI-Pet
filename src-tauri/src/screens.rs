//! Display geometry in logical points (top-left origin at the primary display).

use serde::Serialize;
use tauri::AppHandle;

use crate::geometry::{Point, Rect};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfo {
    pub frame: Rect,
    /// Excludes the menu bar (and the notch) and the Dock.
    pub visible_frame: Rect,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[cfg(target_os = "macos")]
/// Run `f` on the main thread and wait for its result.
/// Safe to call from the main thread too: Tauri then runs it inline.
pub fn on_main<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .ok()?;
    rx.recv_timeout(std::time::Duration::from_secs(2)).ok()
}

#[cfg(target_os = "macos")]
pub fn screens(app: &AppHandle) -> Vec<ScreenInfo> {
    on_main(app, || {
        let mtm = objc2::MainThreadMarker::new().expect("on main thread");
        crate::macos::screens(mtm)
            .into_iter()
            .enumerate()
            .map(|(i, s)| ScreenInfo {
                frame: s.frame,
                visible_frame: s.visible_frame,
                scale_factor: s.scale_factor,
                is_primary: i == 0,
            })
            .collect()
    })
    .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub fn screens(app: &AppHandle) -> Vec<ScreenInfo> {
    let primary = app.primary_monitor().ok().flatten();
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let scale = m.scale_factor();
            let pos = m.position().to_logical::<f64>(scale);
            let size = m.size().to_logical::<f64>(scale);
            let work = m.work_area();
            let work_pos = work.position.to_logical::<f64>(scale);
            let work_size = work.size.to_logical::<f64>(scale);
            ScreenInfo {
                frame: Rect { x: pos.x, y: pos.y, width: size.width, height: size.height },
                visible_frame: Rect {
                    x: work_pos.x,
                    y: work_pos.y,
                    width: work_size.width,
                    height: work_size.height,
                },
                scale_factor: scale,
                is_primary: primary.as_ref().is_some_and(|p| p.position() == m.position()),
            }
        })
        .collect()
}

#[cfg(target_os = "macos")]
pub fn cursor_position(_app: &AppHandle) -> Point {
    crate::macos::cursor_position().unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub fn cursor_position(app: &AppHandle) -> Point {
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    app.cursor_position()
        .map(|p| Point { x: p.x / scale, y: p.y / scale })
        .unwrap_or_default()
}
