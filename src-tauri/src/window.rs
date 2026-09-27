//! The pet window: frame control, smooth native movement, focus hand-off and
//! "click-through except over the pet" behaviour.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewWindow};

use crate::geometry::{ease_in_out_sine, lerp, Point, Rect};
use crate::AppState;

pub const PET_LABEL: &str = "pet";
const MOTION_FRAME: Duration = Duration::from_millis(33); // ~30 fps is plenty for a slow walk
const HIT_TEST_ACTIVE: Duration = Duration::from_millis(70);
const HIT_TEST_IDLE: Duration = Duration::from_millis(400);

#[derive(Default)]
pub struct ClickThrough {
    /// true: ignore the mouse everywhere except over `hit` (idle / roaming).
    /// false: the whole window receives the mouse (bubble / chat open).
    pub enabled: bool,
    /// Interactive region, relative to the window.
    pub hit: Option<Rect>,
    /// What we last told the OS, to avoid redundant calls.
    applied_ignore: Option<bool>,
}

#[derive(Default)]
pub struct PetWindowState {
    pub frame: Mutex<Rect>,
    pub click_through: Mutex<ClickThrough>,
    pub visible: AtomicBool,
    motion_generation: AtomicU64,
    /// App that had focus before the pet took it (macOS pid).
    previous_app: Mutex<Option<i32>>,
}

#[derive(Clone, Serialize)]
struct Arrived {
    id: u64,
}

pub fn pet_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(PET_LABEL)
        .ok_or_else(|| "Pet window is missing".to_string())
}

/// One-time native setup at launch.
pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let win = pet_window(app)?;
    #[cfg(target_os = "macos")]
    {
        let ptr = win.ns_window()?;
        // SAFETY: `setup` runs on the main thread and the pointer comes from Tauri.
        unsafe { crate::macos::configure_pet_window(ptr) };
    }
    let size = win.outer_size()?.to_logical::<f64>(win.scale_factor()?);
    let pos = win.outer_position()?.to_logical::<f64>(win.scale_factor()?);
    let state = app.state::<AppState>();
    *state.pet.frame.lock().unwrap() = Rect {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    };
    // Click-through is applied by the watcher once the window is visible
    // (some platforms can't change it on a window that was never shown).
    state.pet.click_through.lock().unwrap().enabled = true;
    Ok(())
}

pub fn current_frame(app: &AppHandle) -> Rect {
    *app.state::<AppState>().pet.frame.lock().unwrap()
}

/// Called from the window event handler when the OS reports a move.
pub fn on_moved(app: &AppHandle, win: &tauri::Window) {
    if let (Ok(pos), Ok(scale)) = (win.outer_position(), win.scale_factor()) {
        let p = pos.to_logical::<f64>(scale);
        let state = app.state::<AppState>();
        let mut frame = state.pet.frame.lock().unwrap();
        frame.x = p.x;
        frame.y = p.y;
    }
}

pub fn set_frame(app: &AppHandle, rect: Rect) -> Result<(), String> {
    if !rect.is_valid() {
        return Err("Invalid frame".into());
    }
    stop_motion(app);
    let win = pet_window(app)?;
    *app.state::<AppState>().pet.frame.lock().unwrap() = rect;

    #[cfg(target_os = "macos")]
    {
        let ptr = win.ns_window().map_err(|e| e.to_string())? as usize;
        app.run_on_main_thread(move || {
            let mtm = objc2::MainThreadMarker::new().expect("on main thread");
            // SAFETY: the pet window lives for the whole app lifetime; we're on the main thread.
            unsafe { crate::macos::set_window_frame(ptr as *mut std::ffi::c_void, rect, mtm) };
        })
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        win.set_size(tauri::LogicalSize::new(rect.width, rect.height))
            .map_err(|e| e.to_string())?;
        win.set_position(LogicalPosition::new(rect.x, rect.y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn set_position(app: &AppHandle, p: Point) -> Result<(), String> {
    if !p.is_valid() {
        return Err("Invalid position".into());
    }
    let win = pet_window(app)?;
    {
        let state = app.state::<AppState>();
        let mut frame = state.pet.frame.lock().unwrap();
        frame.x = p.x;
        frame.y = p.y;
    }
    win.set_position(LogicalPosition::new(p.x, p.y))
        .map_err(|e| e.to_string())
}

/// Cancel any in-progress `move_to`.
pub fn stop_motion(app: &AppHandle) {
    app.state::<AppState>()
        .pet
        .motion_generation
        .fetch_add(1, Ordering::SeqCst);
}

/// Glide the window's top-left corner to `target` over `duration`, with easing,
/// on a background thread. Emits `pet-arrived { id }` unless cancelled.
pub fn move_to(app: &AppHandle, target: Point, duration: Duration) -> Result<u64, String> {
    if !target.is_valid() {
        return Err("Invalid target".into());
    }
    let state = app.state::<AppState>();
    let id = state.pet.motion_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let start = {
        let f = state.pet.frame.lock().unwrap();
        Point { x: f.x, y: f.y }
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let began = Instant::now();
        let total = duration.as_secs_f64().max(0.001);
        loop {
            let state = app.state::<AppState>();
            if state.pet.motion_generation.load(Ordering::SeqCst) != id {
                return; // cancelled or superseded
            }
            let t = (began.elapsed().as_secs_f64() / total).min(1.0);
            let p = lerp(start, target, ease_in_out_sine(t));
            if set_position(&app, p).is_err() {
                return;
            }
            if t >= 1.0 {
                break;
            }
            std::thread::sleep(MOTION_FRAME);
        }
        let _ = app.emit_to(PET_LABEL, "pet-arrived", Arrived { id });
    });
    Ok(id)
}

pub fn show(app: &AppHandle) -> Result<(), String> {
    let win = pet_window(app)?;
    win.show().map_err(|e| e.to_string())?;
    app.state::<AppState>().pet.visible.store(true, Ordering::SeqCst);
    log::info!("Pet shown");
    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    stop_motion(app);
    let win = pet_window(app)?;
    win.hide().map_err(|e| e.to_string())?;
    app.state::<AppState>().pet.visible.store(false, Ordering::SeqCst);
    log::info!("Pet hidden");
    Ok(())
}

pub fn set_click_through(app: &AppHandle, enabled: bool, hit: Option<Rect>) -> Result<(), String> {
    if let Some(h) = hit {
        if !h.is_valid() {
            return Err("Invalid hit region".into());
        }
    }
    let state = app.state::<AppState>();
    let mut ct = state.pet.click_through.lock().unwrap();
    ct.enabled = enabled;
    ct.hit = hit;
    let visible = state.pet.visible.load(Ordering::SeqCst);
    if !enabled && visible && ct.applied_ignore != Some(false) {
        // Apply immediately so the bubble is clickable the moment it opens.
        pet_window(app)?
            .set_ignore_cursor_events(false)
            .map_err(|e| e.to_string())?;
        ct.applied_ignore = Some(false);
    }
    Ok(())
}

/// Background watcher: while idle, the window ignores the mouse except when the
/// cursor is over the pet itself, so the pet stays clickable/draggable but never
/// blocks clicks meant for the apps underneath. Polls the cursor only while visible.
pub fn start_click_through_watcher(app: AppHandle) {
    std::thread::Builder::new()
        .name("pet-hit-test".into())
        .spawn(move || {
            let mut last_hover = None;
            loop {
                let state = app.state::<AppState>();
                if !state.pet.visible.load(Ordering::SeqCst) {
                    std::thread::sleep(HIT_TEST_IDLE);
                    continue;
                }
                let (enabled, hit) = {
                    let ct = state.pet.click_through.lock().unwrap();
                    (ct.enabled, ct.hit)
                };
                let cursor = crate::screens::cursor_position(&app);
                let over = hit.is_some_and(|hit| {
                    let frame = *state.pet.frame.lock().unwrap();
                    hit.offset(Point { x: frame.x, y: frame.y }).contains(cursor)
                });
                // The webview gets no mouse moves while it isn't focused, so tell it when the
                // cursor moves over her (the UI turns back-and-forth strokes into a pat).
                if enabled && over && last_hover != Some(cursor) {
                    let _ = app.emit_to(PET_LABEL, "pet-hover", cursor);
                }
                last_hover = over.then_some(cursor);
                // Interactive mode: the whole window takes the mouse. Idle mode: only the pet.
                let ignore = enabled && !over;
                let mut ct = state.pet.click_through.lock().unwrap();
                if ct.enabled == enabled && ct.applied_ignore != Some(ignore) {
                    if let Ok(win) = pet_window(&app) {
                        if win.set_ignore_cursor_events(ignore).is_ok() {
                            ct.applied_ignore = Some(ignore);
                        }
                    }
                    if enabled && !ignore {
                        remember_previous_app(&app);
                    }
                }
                drop(ct);
                std::thread::sleep(if enabled { HIT_TEST_ACTIVE } else { HIT_TEST_IDLE });
            }
        })
        .expect("spawn hit-test thread");
}

/// Remember which app had focus so we can hand it back when the bubble closes.
pub fn remember_previous_app(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if let Some(pid) = crate::macos::frontmost_other_app() {
        *app.state::<AppState>().pet.previous_app.lock().unwrap() = Some(pid);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Activate the app and make the pet window key so the text box can take typing.
pub fn focus(app: &AppHandle) -> Result<(), String> {
    remember_previous_app(app);
    pet_window(app)?.set_focus().map_err(|e| e.to_string())
}

/// Hand keyboard focus back to whatever the user was doing before.
pub fn release_focus(app: &AppHandle) {
    let prev = app.state::<AppState>().pet.previous_app.lock().unwrap().take();
    #[cfg(target_os = "macos")]
    if let Some(pid) = prev {
        if crate::macos::we_are_active() {
            crate::macos::activate_app(pid);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = prev;
}
