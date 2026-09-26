//! Strategy B (fallback): simulate Cmd+C, read the copied text, then put the user's
//! original clipboard back — every item and every type (text, images, files, rich text).
//!
//! Safety rules:
//! - Snapshot before touching anything; restore as soon as the text is read.
//! - If the copy never lands, the clipboard was not modified, so nothing is overwritten.
//! - Never log clipboard contents.

#[cfg(target_os = "macos")]
mod imp {
    use std::time::{Duration, Instant};

    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSData, NSString};

    type Snapshot = Vec<Vec<(Retained<NSString>, Retained<NSData>)>>;

    fn snapshot(pb: &NSPasteboard) -> Snapshot {
        let Some(items) = pb.pasteboardItems() else {
            return Vec::new();
        };
        items
            .iter()
            .map(|item| {
                item.types()
                    .iter()
                    .filter_map(|ty| item.dataForType(&ty).map(|data| (ty, data)))
                    .collect()
            })
            .collect()
    }

    fn restore(pb: &NSPasteboard, snapshot: &Snapshot) -> bool {
        pb.clearContents();
        if snapshot.is_empty() {
            return true;
        }
        let items: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> = snapshot
            .iter()
            .map(|entries| {
                let item = NSPasteboardItem::new();
                for (ty, data) in entries {
                    item.setData_forType(data, ty);
                }
                ProtocolObject::from_retained(item)
            })
            .collect();
        pb.writeObjects(&NSArray::from_retained_slice(&items))
    }

    pub fn write_text(text: &str) -> bool {
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        // SAFETY: reading an immutable AppKit constant.
        let ty = unsafe { NSPasteboardTypeString };
        pb.setString_forType(&NSString::from_str(text), ty)
    }

    pub fn read_text() -> Option<String> {
        let pb = NSPasteboard::generalPasteboard();
        // SAFETY: reading an immutable AppKit constant.
        let ty = unsafe { NSPasteboardTypeString };
        pb.stringForType(ty).map(|s| s.to_string())
    }

    pub fn copy_selected_text() -> Result<Option<String>, String> {
        let pb = NSPasteboard::generalPasteboard();
        let saved = snapshot(&pb);
        let before = pb.changeCount();

        crate::macos::wait_for_modifiers_released(Duration::from_millis(450));
        crate::macos::post_copy_shortcut()?;

        let deadline = Instant::now() + Duration::from_millis(450);
        let mut changed = false;
        while Instant::now() < deadline {
            if pb.changeCount() != before {
                changed = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(15));
        }
        if !changed {
            // Nothing was copied (no selection, or the app ignores Cmd+C): clipboard untouched.
            return Ok(None);
        }
        // Give lazy/promised pasteboard data a moment to materialise.
        std::thread::sleep(Duration::from_millis(25));
        let text = read_text();
        if !restore(&pb, &saved) {
            log::warn!("Clipboard restore reported a failure");
        }
        Ok(text)
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn write_text(_text: &str) -> bool {
        false
    }
    pub fn read_text() -> Option<String> {
        None
    }
    pub fn copy_selected_text() -> Result<Option<String>, String> {
        Ok(None)
    }
}

pub use imp::{copy_selected_text, read_text, write_text};
