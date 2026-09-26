# Distribution: signing, notarization & sandbox limits (guide §67)

AI Pet relies on the **Accessibility API** and a **global hotkey**. The Mac App Store's App
Sandbox blocks both, so the app is distributed as a **notarized `.dmg`** outside the App Store.

## What's already configured

`src-tauri/tauri.conf.json`:

- `bundle.targets`: `app`, `dmg`
- `bundle.macOS.minimumSystemVersion`: `13.0`
- `bundle.macOS.hardenedRuntime`: `true`
- `bundle.macOS.entitlements`: `Entitlements.plist` — intentionally **empty**: no
  `app-sandbox`, no `allow-jit` (WKWebView runs JS in its own process), no Apple Events (the
  clipboard fallback uses `CGEventPost`, not AppleScript)
- `bundle.macOS.signingIdentity`: `"-"` → **ad-hoc** signing, so builds run on Apple Silicon
  without an Apple account. Replace it (or set `APPLE_SIGNING_IDENTITY`) for real releases.
- `Info.plist`: `LSUIElement = true` (no Dock icon / app switcher entry)

## Universal build

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run app:build        # = tauri build --target universal-apple-darwin
```

## Developer ID signing + notarization

You need an Apple Developer account and a **Developer ID Application** certificate in your login
keychain.

```bash
# Signing
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
# Notarization (app-specific password from appleid.apple.com)
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"

npm run app:build
```

Tauri signs with the hardened runtime, submits to `notarytool`, waits, and staples the ticket.
Verify:

```bash
APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/AI Pet.app"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose "$APP"      # → accepted, source=Notarized Developer ID
xcrun stapler validate "$APP"
```

Without this, Gatekeeper on other Macs shows "damaged" / "unidentified developer". For personal
use of an ad-hoc build: `xattr -cr "/Applications/AI Pet.app"`.

**Tip:** TCC remembers the Accessibility grant per code signature. Signing every build with the
same Developer ID means users don't have to re-grant permission after updates.

## Automatic updates (recommended next step)

Use the official `tauri-plugin-updater`:

1. `npm run tauri signer generate -- -w ~/.tauri/ai-pet.key` (keep the private key secret).
2. Add the plugin (`cargo add tauri-plugin-updater`, `npm i @tauri-apps/plugin-updater`), put
   the public key and your update endpoint (e.g. a GitHub Releases `latest.json`) in
   `tauri.conf.json → plugins.updater`, and set `bundle.createUpdaterArtifacts: true`.
3. Build with `TAURI_SIGNING_PRIVATE_KEY` set; upload the `.app.tar.gz`, its `.sig` and
   `latest.json` with each release.

It isn't enabled yet because it needs your key and a release location.
