# Architecture

```text
 User ── ⌥P / click ──►  Pet UI (TypeScript, one small transparent window)
                            │  PetController · PetStateMachine · AnimationController
                            │  RoamingController · PetPosition · ChatBubble
                            │
                        Tauri IPC  (per-window allow-list: capabilities/pet.json, settings.json)
                            │
   ┌────────────────────────┼─────────────────────────────┐
   ▼                        ▼                             ▼
 hotkey.rs            selection.rs                   window.rs / screens.rs
 (global shortcuts)   accessibility.rs → clipboard.rs (frame, motion, click-through,
                      (AX first, Cmd+C fallback,      Spaces/full-screen, focus hand-off)
                       clipboard restored)
                            │
                     TaskRunner (TS) ── PromptBuilder ── NativeAIProvider
                            │                                   │ Channel (streamed events)
                            ▼                                   ▼
                     TTSService (Web Speech → `say`)      ai/ (Rust): OpenAI-compatible,
                                                          Anthropic, SSE, Keychain key
```

## Responsibilities (guide §20)

| Layer | Owns |
| --- | --- |
| Rust | global hotkeys, window control (frame, native movement, click-through, collection behaviour), Accessibility, clipboard fallback, screens & cursor, permissions, lifecycle, settings file, Keychain, **AI HTTP**, menu bar, `say` fallback, logging |
| TypeScript | pet rendering & animation, state machine, roaming decisions, bubble/chat UI, task buttons, prompts, settings UI |

## Key flows

**⌥P (responsiveness first, §49):**
1. Rust handler (main thread) reads the cursor, remembers the frontmost app and emits
   `global-hotkey {seq, cursor}` — nothing slow happens before this.
2. The UI cancels any running request/speech, places the pet beside the cursor (`placeNearCursor`),
   opens a "Let me see…" bubble and shows the window **without taking focus** (so the other app
   keeps its selection).
3. A Rust background thread captures the selection and emits `selected-text {seq, …}`. The UI
   buffers it until the bubble is up, then shows the task menu / permission help / text box.
4. Only then does the pet take keyboard focus for the input box. Closing the bubble hands focus
   back to the previous app.

**AI request (§31, §51, §69):** `TaskRunner.run(task, context)` → handler builds the prompt →
`NativeAIProvider.chat()` invokes `ai_stream` with a `Channel`. Rust validates the request,
resolves provider + Keychain key, streams SSE and forwards `delta`/`reset`/`done`/`error`. Each new
action aborts the previous one (`AbortController` → `ai_cancel` → Tokio task aborted → HTTP stream
dropped) and stops queued speech. Rust enforces connect (8 s), idle (30 s) and total
(configurable) timeouts; the UI adds a watchdog so the pet can never stay in THINKING.

**Window model:** one window. *Compact* = exactly the pet box (120 pt × size). *Expanded* = pet +
bubble; the frame is recomputed so the pet stays in place on screen (`expandedLayout`) and
resized as streamed content grows. On macOS the frame is set atomically with
`-[NSWindow setFrame:display:]`.

**Click-through (§17):** idle → `setIgnoresMouseEvents(YES)` except while the cursor is over the
pet's body (a Rust thread checks the cursor every 70 ms, only while the pet is visible), so the
pet is clickable but never blocks clicks. Bubble open → the whole window takes the mouse.

**Spaces / full-screen (§68):** accessory activation policy + `LSUIElement`, floating window level,
collection behaviour `CanJoinAllSpaces | Stationary | IgnoresCycle | FullScreenAuxiliary`.

**Coordinates:** everything is in logical points with a top-left origin at the primary display
(Tauri's convention and CSS pixels). `macos.rs` converts from Cocoa's bottom-left space.

## Pet states (§39, §40)

`OFF → IDLE ⇄ WALKING`, `IDLE → SLEEPING`, `→ INTERACTING → THINKING → SPEAKING → INTERACTING/IDLE`,
`→ ERROR → IDLE/INTERACTING`. Illegal transitions are rejected. Animations: idle (brief float,
then still), walk, thinking, talking, listening, error, sleep, plus one-shot gestures (blink,
look, hop, wave, happy, snore).

## Adding a task (§35, §63)

Write a `PetTaskHandler` (id, label, icon, title, `needsText`, `inMenu`, `buildPrompt`) and
register it with `TaskRunner.register()`. The bubble picks it up automatically.

## Security (§34)

- IPC: every app command has an auto-generated permission (`build.rs`); the pet window can't
  manage keys, the settings window can't move the pet or stream AI.
- Arguments are validated in Rust (rect sanity, message roles/sizes, URL scheme/host, voice names).
- No shell: the only processes spawned are `/usr/bin/say` (text via stdin) and `/usr/bin/open`
  with a fixed System Settings URL. AI output is only ever rendered as text.
- Strict CSP; model output is rendered with `textContent` only.
