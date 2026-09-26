//! Thin, safe wrappers around the few CoreGraphics / AppKit calls the app needs.
//! Everything here is macOS-only and deliberately small.

use std::ffi::c_void;
use std::time::{Duration, Instant};

use core_foundation::base::{CFRelease, CFTypeRef};
use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSApplicationActivationOptions, NSRunningApplication, NSScreen, NSWindow,
    NSWindowCollectionBehavior, NSWorkspace,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};

use crate::geometry::{Point, Rect};

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

type CGEventRef = *mut c_void;
type CGEventSourceRef = *mut c_void;

const K_CG_EVENT_SOURCE_STATE_COMBINED: i32 = 0;
const K_CG_EVENT_SOURCE_STATE_HID: i32 = 1;
const K_CG_HID_EVENT_TAP: u32 = 0;

const FLAG_SHIFT: u64 = 0x0002_0000;
const FLAG_CONTROL: u64 = 0x0004_0000;
const FLAG_OPTION: u64 = 0x0008_0000;
const FLAG_COMMAND: u64 = 0x0010_0000;
const KEY_C: u16 = 8; // kVK_ANSI_C

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreate(source: CGEventSourceRef) -> CGEventRef;
    fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
    fn CGEventSourceCreate(state_id: i32) -> CGEventSourceRef;
    fn CGEventCreateKeyboardEvent(
        source: CGEventSourceRef,
        virtual_key: u16,
        key_down: bool,
    ) -> CGEventRef;
    fn CGEventSetFlags(event: CGEventRef, flags: u64);
    fn CGEventPost(tap: u32, event: CGEventRef);
    fn CGEventSourceFlagsState(state_id: i32) -> u64;
}

/// Mouse location in logical points, top-left origin (same space as window positions).
/// Safe to call from any thread.
pub fn cursor_position() -> Option<Point> {
    unsafe {
        let event = CGEventCreate(std::ptr::null_mut());
        if event.is_null() {
            return None;
        }
        let p = CGEventGetLocation(event);
        CFRelease(event as CFTypeRef);
        Some(Point { x: p.x, y: p.y })
    }
}

/// Wait (bounded) until the user lets go of the hotkey's modifier keys, so a synthetic
/// Cmd+C is not seen as Cmd+Option+C by the target app.
pub fn wait_for_modifiers_released(timeout: Duration) {
    let deadline = Instant::now() + timeout;
    let mask = FLAG_SHIFT | FLAG_CONTROL | FLAG_OPTION | FLAG_COMMAND;
    while Instant::now() < deadline {
        let flags = unsafe { CGEventSourceFlagsState(K_CG_EVENT_SOURCE_STATE_COMBINED) };
        if flags & mask == 0 {
            return;
        }
        std::thread::sleep(Duration::from_millis(15));
    }
}

/// Post a Cmd+C key press to the frontmost app. Requires Accessibility permission.
pub fn post_copy_shortcut() -> Result<(), String> {
    unsafe {
        let source = CGEventSourceCreate(K_CG_EVENT_SOURCE_STATE_HID);
        let down = CGEventCreateKeyboardEvent(source, KEY_C, true);
        let up = CGEventCreateKeyboardEvent(source, KEY_C, false);
        let result = if down.is_null() || up.is_null() {
            Err("Could not create keyboard event".to_string())
        } else {
            CGEventSetFlags(down, FLAG_COMMAND);
            CGEventSetFlags(up, FLAG_COMMAND);
            CGEventPost(K_CG_HID_EVENT_TAP, down);
            CGEventPost(K_CG_HID_EVENT_TAP, up);
            Ok(())
        };
        for r in [down, up, source] {
            if !r.is_null() {
                CFRelease(r as CFTypeRef);
            }
        }
        result
    }
}

fn to_top_left(r: NSRect, primary_height: f64) -> Rect {
    Rect {
        x: r.origin.x,
        y: primary_height - (r.origin.y + r.size.height),
        width: r.size.width,
        height: r.size.height,
    }
}

pub struct NativeScreen {
    pub frame: Rect,
    pub visible_frame: Rect,
    pub scale_factor: f64,
}

/// All displays, primary (menu-bar screen) first. Must run on the main thread.
pub fn screens(mtm: MainThreadMarker) -> Vec<NativeScreen> {
    let screens = NSScreen::screens(mtm);
    let Some(primary) = screens.firstObject() else {
        return Vec::new();
    };
    let primary_height = primary.frame().size.height;
    screens
        .iter()
        .map(|s| NativeScreen {
            frame: to_top_left(s.frame(), primary_height),
            visible_frame: to_top_left(s.visibleFrame(), primary_height),
            scale_factor: s.backingScaleFactor(),
        })
        .collect()
}

/// # Safety
/// `ns_window` must be a valid `NSWindow*` and this must run on the main thread.
unsafe fn window<'a>(ns_window: *mut c_void) -> &'a NSWindow {
    &*(ns_window as *const NSWindow)
}

/// Keep the pet visible on every Space and above full-screen apps, without joining
/// the Cmd+` window cycle. Must run on the main thread.
///
/// # Safety
/// `ns_window` must be a valid `NSWindow*`.
pub unsafe fn configure_pet_window(ns_window: *mut c_void) {
    let w = window(ns_window);
    w.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    w.setHasShadow(false);
}

/// Move + resize in one step (no intermediate frame). Must run on the main thread.
///
/// # Safety
/// `ns_window` must be a valid `NSWindow*`.
pub unsafe fn set_window_frame(ns_window: *mut c_void, rect: Rect, mtm: MainThreadMarker) {
    let primary_height = NSScreen::screens(mtm)
        .firstObject()
        .map(|s| s.frame().size.height)
        .unwrap_or(rect.y + rect.height);
    let cocoa = NSRect::new(
        NSPoint::new(rect.x, primary_height - rect.y - rect.height),
        NSSize::new(rect.width, rect.height),
    );
    window(ns_window).setFrame_display(cocoa, true);
}

/// PID of the frontmost app if it isn't us.
pub fn frontmost_other_app() -> Option<i32> {
    let app: Retained<NSRunningApplication> = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let pid = app.processIdentifier();
    (pid != std::process::id() as i32).then_some(pid)
}

pub fn we_are_active() -> bool {
    NSRunningApplication::currentApplication().isActive()
}

/// Give keyboard focus back to the app the user was in before the pet took it.
pub fn activate_app(pid: i32) -> bool {
    match NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        Some(app) => app.activateWithOptions(NSApplicationActivationOptions::empty()),
        None => false,
    }
}
