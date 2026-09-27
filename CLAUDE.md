# AI Pet (Lucy): notes for Claude Code

A macOS desktop pet: **Tauri 2 + Rust** (native layer, all network, keys) and **vanilla
TypeScript** (UI, no framework). The spec is `docs/BUILD_GUIDE.md`. Architecture is in
`docs/ARCHITECTURE.md`, and local setup with the 3D model is in `docs/LOCAL_SETUP.md`.

## Commands

```bash
./scripts/setup-macos.sh          # one-time: checks Xcode CLT, Rust, Node 20+, then npm install
npm run tauri dev                 # run in development (permissions go to the terminal app)
npm run tauri build -- --bundles app   # fast host-only .app → src-tauri/target/release/bundle/macos/
npm run app:build                 # universal .app + .dmg (slower)
npm test                          # Vitest
npm run typecheck
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

Run all four checks (Vitest, typecheck, cargo test, clippy) before committing. CI runs the same
checks on Linux and macOS.

## Where things live on the Mac (not in the repo)

- Settings: `~/Library/Application Support/com.asifuddin.aipet/settings.json` (camelCase keys; the
  Rust side validates them. Edit only while the app is closed.)
- 3D models: `~/Library/Application Support/com.asifuddin.aipet/characters/vrm/*.vrm`
  - Select one with `"character": "vrm"` and `"vrmModel": "<file name>"`.
  - Or use Settings → Character → Import .vrm…
- Clips and images: `…/characters/sprites/`
- Notes: `…/notes.json`
- Logs: `~/Library/Logs/com.asifuddin.aipet/`
- API keys: macOS Keychain, service `com.asifuddin.aipet`

## Rules

- **Never commit** `.vrm`/`.glb` models, clips, `settings.json`, `.env`, or any API key.
  Character files are the user's own and stay on their Mac.
- Never ask the user to paste keys into chat; keys are entered in the app's Settings (Keychain).
- Never log selected text, chats, transcripts, notes or keys (guide §47).
- All HTTP (AI, search, speech-to-text, update check) lives in Rust. The webview's CSP allows no
  network.
- Every new Tauri command must be added to three places, and to a window's capability file only if
  that window needs it:
  - `src-tauri/build.rs` (`COMMANDS`)
  - `src-tauri/src/lib.rs` (`generate_handler!`)
  - `src-tauri/capabilities/{pet,settings}.json`
- Keep the pet light: no continuous screen capture, no polling of the selection.
- Voice input is off by default. The always-on "Hey Lucy" listener must stay on-device only.

## Map

- `src/pet/PetController.ts`: orchestration (views, hotkeys, voice, commands, check-ins, search)
- `src/tools/`: offline tools, pet commands (`petCommands.ts`), wake phrases (`wake.ts`), search
  phrases
- `src/ai/`: prompts, tasks, provider bridge
- `src/components/`: bubble, settings, renderers (`Pet` drawn, `VrmPet` 3D, `SpritePet` clips)
- `src/pet/Wardrobe.ts`: moods and outfits. Outfits map to `Layer_*` meshes in the VRM (see
  `layerPlan` in `VrmPet.ts`).
- `src-tauri/src/`: `voice/` (speech), `search.rs`, `notes.rs`, `updates.rs`, `ai/`, `hotkey.rs`,
  `window.rs`, `selection.rs`, `settings.rs`, `secrets.rs`
