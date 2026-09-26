//! Strategy A: read the focused element's `AXSelectedText` via the macOS
//! Accessibility API. Only ever called in response to the user's hotkey — the
//! app never polls or monitors the screen or selection.

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;

    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};

    type AXUIElementRef = *const c_void;
    type AXError = i32;
    const AX_SUCCESS: AXError = 0;
    /// Seconds to wait on an unresponsive app before giving up.
    const AX_TIMEOUT_SECS: f32 = 0.35;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout: f32) -> AXError;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    pub fn is_trusted() -> bool {
        unsafe { AXIsProcessTrusted() != 0 }
    }

    /// Shows the system "allow accessibility" prompt (only if not yet trusted).
    pub fn prompt_for_trust() -> bool {
        unsafe {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let options = CFDictionary::from_CFType_pairs(&[(
                key.as_CFType(),
                CFBoolean::true_value().as_CFType(),
            )]);
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) != 0
        }
    }

    unsafe fn copy_attribute(element: CFTypeRef, name: &'static str) -> Option<CFType> {
        let attribute = CFString::from_static_string(name);
        let mut value: CFTypeRef = std::ptr::null();
        let err = AXUIElementCopyAttributeValue(element, attribute.as_concrete_TypeRef(), &mut value);
        if err != AX_SUCCESS || value.is_null() {
            return None;
        }
        Some(CFType::wrap_under_create_rule(value))
    }

    pub fn selected_text() -> Option<String> {
        unsafe {
            let system = AXUIElementCreateSystemWide();
            if system.is_null() {
                return None;
            }
            let system = CFType::wrap_under_create_rule(system);
            // A timeout on the system-wide element applies to every AX call we make.
            AXUIElementSetMessagingTimeout(system.as_CFTypeRef(), AX_TIMEOUT_SECS);
            let focused = copy_attribute(system.as_CFTypeRef(), "AXFocusedUIElement")?;
            let value = copy_attribute(focused.as_CFTypeRef(), "AXSelectedText")?;
            value.downcast_into::<CFString>().map(|s| s.to_string())
        }
    }

    pub fn open_settings() -> Result<(), String> {
        std::process::Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open System Settings: {e}"))
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn is_trusted() -> bool {
        false
    }
    pub fn prompt_for_trust() -> bool {
        false
    }
    pub fn selected_text() -> Option<String> {
        None
    }
    pub fn open_settings() -> Result<(), String> {
        Err("Accessibility settings are only available on macOS".into())
    }
}

pub use imp::{is_trusted, open_settings, prompt_for_trust, selected_text};
