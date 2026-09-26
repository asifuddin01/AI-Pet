# macOS permissions

AI Pet asks for the minimum (guide §60). This page documents every one.

## Accessibility — required for selected text

**Why:** when you press **⌥P**, the pet reads the text you've selected:

1. **Accessibility API** (`AXUIElementCopyAttributeValue` → `kAXFocusedUIElementAttribute` →
   `kAXSelectedTextAttribute`) on the focused element of the frontmost app.
2. If that app doesn't expose its selection (common in Chrome/Electron apps), a **clipboard
   fallback**: the app snapshots every clipboard item and type, posts **⌘C** with `CGEventPost`,
   reads the copied text, and immediately restores the original clipboard. Posting keyboard
   events is also gated by Accessibility.

**What it never does:** read the screen, poll the selection, record keystrokes, or read anything
unless you pressed the shortcut. Nothing is sent anywhere unless you then pick an AI action.

**How it's requested:** the first time you ask for selected-text access (onboarding or the first
⌥P), the pet explains why and — only when you click **Enable access** — shows the system prompt.
After that it never opens System Settings on its own; the **Open System Settings** buttons go
straight to *Privacy & Security → Accessibility*. The "already asked" state is remembered.

**If denied:** everything else works (roaming, chat, clipboard translation); ⌥P opens the text
box with "I couldn't find selected text".

**Development note:** in `npm run tauri dev` the permission belongs to the program that launched
the binary (Terminal, iTerm, VS Code…). Grant it there. Unsigned rebuilds change the code
signature, so macOS may forget the grant — toggle it off and on again if ⌥P stops seeing text.

## Keychain — for your API key

Not a privacy permission, but macOS may ask whether *AI Pet* may use the item
`com.asifuddin.aipet` in your login keychain (especially after a rebuild). Choose **Always Allow**.
The key is only read by the Rust process; the UI can only ask *whether* one is saved.

## Launch at login — only if you enable it

Off by default. When you turn it on in Settings (or the right-click menu), a LaunchAgent is
registered via `tauri-plugin-autostart`; turning it off removes it.

## Microphone — not used in v0.1

Voice input is planned (guide §12) and appears as a disabled setting. `Info.plist` already
contains `NSMicrophoneUsageDescription` so that enabling it later needs no plist change; the
permission is never requested today.

## Not requested

Camera, Location, Contacts, Photos, Screen Recording, Input Monitoring, Full Disk Access,
Automation/Apple Events. The app is **not sandboxed** because the App Sandbox blocks the
Accessibility API and global hotkeys (see `DISTRIBUTION.md`).

## Network

Only when you trigger an AI action (or press *Test connection*), and only to the endpoint you
configured. HTTPS is required except for `localhost` model servers. **Settings → AI → Allow AI
requests** switches all AI traffic off.
