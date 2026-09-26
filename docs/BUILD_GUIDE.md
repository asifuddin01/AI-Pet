# AI Desktop Pet — Full Build Guide
## Lightweight macOS AI Pet with Chat, Selected-Text Actions, TTS, Global Hotkey, and Roaming Animation

> **Goal:** Build a lightweight desktop AI pet inspired by the uploaded reference image: a small cute floating robot/creature that stays above normal windows, can wander around the screen, can be turned on/off, can chat, speak, and perform small useful tasks.
>
> **Primary target:** macOS first, especially Apple Silicon.
>
> **Build agent:** Codex or Claude Code should implement the project from this specification without changing the core UX unless a technical limitation requires it.

> **Revision note (v1.1):** This revision adds three sections the original spec was missing — distribution/signing (§67), multi-Space & full-screen window visibility (§68), and request cancellation/concurrency (§69) — plus small clarifications inline (marked "Added in v1.1") on click-through, IPC permissions, minimum OS version, repeated-hotkey behavior, and how free-form questions use selected text. No existing requirement was removed or weakened.

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Core UX](#2-core-ux)
3. [Enable / Disable](#3-enable--disable)
4. [Main Interaction](#4-main-interaction)
5. [Selected Text Workflow](#5-selected-text-workflow)
6. [Selected Text Acquisition](#6-selected-text-acquisition)
7. [AI Task System](#7-ai-task-system)
8. [AI Provider Architecture](#8-ai-provider-architecture)
9. [AI Prompt Design](#9-ai-prompt-design)
10. [Chat](#10-chat)
11. [Voice / Talking](#11-voice--talking)
12. [Optional Voice Input](#12-optional-voice-input)
13. [Pet Visual Design](#13-pet-visual-design)
14. [Animation System](#14-animation-system)
15. [Roaming System](#15-roaming-system)
16. [Multi-Monitor Support](#16-multi-monitor-support)
17. [Window Behavior](#17-window-behavior)
18. [Window Layer](#18-window-layer)
19. [Recommended Technology](#19-recommended-technology)
20. [Native macOS Integration](#20-native-macos-integration)
21. [Suggested Architecture](#21-suggested-architecture)
22. [Project Structure](#22-project-structure)
23. [IPC API](#23-ipc-api)
24. [Global Hotkey](#24-global-hotkey)
25. [Pet Position Near Selection](#25-pet-position-near-selection)
26. [Context Menu](#26-context-menu)
27. [Settings](#27-settings)
28. [Performance Requirements](#28-performance-requirements)
29. [AI Request Optimization](#29-ai-request-optimization)
30. [Response Limits](#30-response-limits)
31. [Streaming](#31-streaming)
32. [Error Handling](#32-error-handling)
33. [Privacy](#33-privacy)
34. [Security](#34-security)
35. [Small Task Architecture](#35-small-task-architecture)
36. [Context Object](#36-context-object)
37. [Smart Language Detection](#37-smart-language-detection)
38. [Interaction UI](#38-interaction-ui)
39. [Pet States](#39-pet-states)
40. [Animation State Mapping](#40-animation-state-mapping)
41. [Accessibility Permission Flow](#41-accessibility-permission-flow)
42. [First-Run Experience](#42-first-run-experience)
43. [Offline Behavior](#43-offline-behavior)
44. [Launch at Startup](#44-launch-at-startup)
45. [Menu Bar Integration](#45-menu-bar-integration)
46. [Application Lifecycle](#46-application-lifecycle)
47. [Logging](#47-logging)
48. [Testing](#48-testing)
49. [Performance Testing](#49-performance-testing)
50. [Important UX Rule](#50-important-ux-rule)
51. [AI Provider Timeout](#51-ai-provider-timeout)
52. [Clipboard Safety](#52-clipboard-safety)
53. [Hotkey Conflict Handling](#53-hotkey-conflict-handling)
54. [Pet Interaction](#54-pet-interaction)
55. [Avoid Overengineering](#55-avoid-overengineering)
56. [Version Roadmap](#56-version-roadmap)
57. [Development Order](#57-development-order)
58. [Definition of Done](#58-definition-of-done)
59. [Coding Rules for Codex / Claude Code](#59-coding-rules-for-codex--claude-code)
60. [Important macOS Permission Principle](#60-important-macos-permission-principle)
61. [Suggested Initial AI UX](#61-suggested-initial-ai-ux)
62. [Suggested Chat UX](#62-suggested-chat-ux)
63. [Future Plugin System](#63-future-plugin-system)
64. [Possible Future Features](#64-possible-future-features)
65. [Final Architecture](#65-final-architecture)
66. [Instructions to the Coding Agent](#66-instructions-to-the-coding-agent)
67. [macOS Distribution: Signing, Notarization & Sandbox Limits](#67-macos-distribution-signing-notarization--sandbox-limits) *(new in v1.1)*
68. [Multi-Space, Full-Screen & Dock Visibility](#68-multi-space-full-screen--dock-visibility) *(new in v1.1)*
69. [Request Cancellation & Concurrency](#69-request-cancellation--concurrency) *(new in v1.1)*

---

# 1. Product Vision

The application is a small desktop companion, not a full AI assistant.

The pet should:

- Float above normal desktop applications.
- Move/roam slowly around the screen when idle.
- Be able to stop roaming.
- Be globally enabled/disabled.
- Appear instantly with a keyboard shortcut.
- Read currently selected text when possible.
- Let the user ask an AI question about the selected text.
- Perform small utility tasks such as:
  - Translation
  - Definition
  - Explanation
  - Summarization
  - Rewrite
  - Grammar correction
  - Short Q&A
  - Copy result
- Chat normally when no selected text is available.
- Speak responses using macOS text-to-speech.
- Optionally listen through the microphone later.
- Stay extremely lightweight when idle.
- Avoid behaving like a heavy Electron application.

The pet should feel like a small character living on the desktop rather than a conventional application window.

---

# 2. Core UX

## 2.1 Idle Mode

When enabled:

1. Pet appears on the desktop.
2. Pet stays above normal windows.
3. Pet slowly moves around a defined safe area.
4. Movement should be subtle and non-distracting.
5. Pet occasionally performs a tiny idle animation.
6. Pet should not constantly consume CPU.
7. Pet should pause movement when the user is interacting with it.

Example idle behaviors:

- Walk left/right.
- Small hop.
- Look around.
- Blink.
- Sit.
- Sleep.
- Tiny floating movement.
- Move toward another area of the screen.

Do NOT make it move continuously at high speed.

---

# 3. Enable / Disable

The application needs a global state:

```text
PET ON
PET OFF
```

When OFF:

- Pet disappears completely.
- Global pet interactions are disabled.
- Background activity should be minimal.
- Global hotkey may still be available to turn it back on.

Recommended controls:

```text
Option + Shift + P
```

for enable/disable.

The exact shortcut should be configurable later.

---

# 4. Main Interaction

## Global shortcut

Primary interaction:

```text
Option + P
```

When the user presses:

```text
Option + P
```

the pet should appear near the selected text or near the current mouse/cursor position.

Preferred behavior:

```text
User selects text
        ↓
Option + P
        ↓
Pet appears
        ↓
Selected text is captured
        ↓
Pet opens a small interaction bubble
        ↓
User chooses an action or types a question
```

If no text is selected:

```text
Option + P
        ↓
Pet appears
        ↓
Normal chat box opens
```

---

# 5. Selected Text Workflow

This is one of the most important features.

Example:

User selects:

```text
Photosynthesis is the process by which plants convert light energy...
```

Then presses:

```text
Option + P
```

Pet appears.

The UI can show:

```text
┌──────────────────────────────┐
│ 🤖 What should I do?         │
│                              │
│ Translate                    │
│ Explain                      │
│ Define                       │
│ Summarize                    │
│ Rewrite                      │
│ Ask AI...                    │
└──────────────────────────────┘
```

The user can choose:

```text
Translate
```

The AI receives:

```text
Selected text:
Photosynthesis is...
```

and returns a concise translation.

*(Added in v1.1)* If the user instead types into "Ask AI...", the captured selected text is automatically included as context alongside their question — the user should not need to re-paste it. Show a small visual reference (e.g. a truncated quote chip) so it is clear the pet is answering about that text specifically.

---

# 6. Selected Text Acquisition

Implement multiple strategies because not every macOS application exposes selected text the same way.

## Strategy A — macOS Accessibility API

Preferred method.

Use the macOS Accessibility framework to attempt to retrieve:

```text
kAXSelectedTextAttribute
```

from the currently focused UI element.

This can work with many native applications.

The application must request:

```text
Accessibility permission
```

from the user.

Explain clearly why permission is needed.

Example permission explanation:

> This permission allows the pet to read text you have selected so it can translate, explain, define, or process it when you press Option + P. The app does not continuously read your screen.

Do NOT continuously inspect the screen.

Only request the selected text when the user activates the pet.

---

## Strategy B — Clipboard fallback

If Accessibility selected-text retrieval fails:

1. Save current clipboard content.
2. Trigger copy using the system mechanism.
3. Read clipboard.
4. Restore the previous clipboard contents.

Important:

- Restore clipboard as quickly as possible.
- Preserve text, images, and other clipboard types where practical.
- Do not silently overwrite the user's clipboard permanently.

Use this only as a fallback because clipboard manipulation can be intrusive.

---

## Strategy C — No selected text

If both methods fail:

Show:

```text
I couldn't find selected text.
Type or paste something for me.
```

Never pretend that text was captured.

---

# 7. AI Task System

Do not hard-code each task into separate UI logic.

Create a task abstraction.

Example:

```typescript
type PetTask =
  | "chat"
  | "translate"
  | "define"
  | "explain"
  | "summarize"
  | "rewrite"
  | "grammar"
  | "ask";
```

Create a task runner:

```text
TaskRunner
    ├── translate()
    ├── define()
    ├── explain()
    ├── summarize()
    ├── rewrite()
    ├── grammar()
    └── ask()
```

All tasks should use the same AI service layer.

---

# 8. AI Provider Architecture

Do NOT hard-code the application to one AI provider.

Create an abstraction:

```text
AIProvider
```

with methods such as:

```typescript
chat(messages)
complete(prompt)
```

Possible providers:

```text
OpenAI-compatible API
Anthropic
Google
Local Ollama
Local llama.cpp
Custom API
```

Recommended first implementation:

```text
OpenAI-compatible provider
```

Then make the provider configurable.

Example configuration:

```env
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

Never commit API keys.

Never put API keys directly inside frontend JavaScript.

---

# 9. AI Prompt Design

The pet should not behave like a huge autonomous agent.

Keep the system prompt concise.

Example:

```text
You are a small desktop AI pet.

Be concise, friendly, useful, and natural.

The user may provide selected text.

When answering utility tasks:
- Stay focused on the requested task.
- Do not add unnecessary explanations.
- Preserve meaning when translating or rewriting.
- Clearly state uncertainty when relevant.
- Prefer short answers unless the user asks for detail.
```

Task-specific instructions should be generated separately.

Example:

```text
Task: Translate

Translate the following text into English.

Text:
{{SELECTED_TEXT}}
```

---

# 10. Chat

The pet should support normal chat.

UI:

```text
        🤖
   ┌───────────────┐
   │ Hey!           │
   │ What can I     │
   │ help with?     │
   └───────────────┘

   [ Ask me something... ]
```

Chat should be intentionally compact.

Do not build a large ChatGPT-style interface.

The desktop pet is the product.

---

# 11. Voice / Talking

The pet should be able to speak.

## First implementation

Use macOS native TTS:

```text
AVSpeechSynthesizer
```

or an appropriate macOS native speech API.

Benefits:

- No external API cost.
- Very low latency.
- Works offline.
- Lightweight.

The pet should animate while speaking.

Example states:

```text
IDLE
THINKING
SPEAKING
LISTENING
HAPPY
ERROR
SLEEPING
```

The animation state should change according to the current action.

---

# 12. Optional Voice Input

Do not make voice input mandatory for version 1.

Prepare the architecture for:

```text
Microphone
    ↓
Speech-to-text
    ↓
AI
    ↓
Text-to-speech
```

Possible future providers:

- macOS Speech Recognition
- Whisper
- Local Whisper
- Cloud speech API

Keep this feature behind a setting.

---

# 13. Pet Visual Design

Use the uploaded reference image as the visual inspiration.

Important characteristics:

- Small.
- Cute.
- Robot-like.
- Rounded body.
- Blue/purple visual identity.
- Large expressive screen/face.
- Tiny legs.
- Simple silhouette.
- Minimal detail.
- Soft, friendly appearance.

Do not copy copyrighted character artwork from another product.

Create original assets inspired by the general visual language.

---

# 14. Animation System

Do not use expensive real-time 3D rendering.

Prefer:

```text
2D sprite animation
```

or:

```text
Lottie / lightweight vector animation
```

Possible states:

```text
idle
walk
run
jump
blink
happy
sad
thinking
talking
sleep
wave
```

Each animation should have a controlled frame rate.

Do not run a high-frequency animation loop when the pet is invisible.

---

# 15. Roaming System

The pet should be able to wander around the desktop.

Create:

```text
RoamingController
```

Responsibilities:

- Determine screen bounds.
- Select a safe random destination.
- Move toward destination.
- Stop at destination.
- Wait for a random idle duration.
- Select another destination.

Pseudo behavior:

```text
while petEnabled:

    if userIsInteracting:
        pause

    choose destination

    walk to destination

    idle for 2-8 seconds

    repeat
```

Movement should be smooth.

Use interpolation/easing rather than teleportation.

---

# 16. Multi-Monitor Support

The pet should support multiple monitors.

Detect:

```text
NSScreen.screens
```

or the appropriate native API.

Each screen should have:

```text
screen frame
visible frame
```

Do not place the pet underneath:

- Menu bar
- Dock
- Notch
- unsafe screen edges

Allow the user to configure:

```text
Roam on all displays
Roam only on primary display
```

Default:

```text
Primary display
```

---

# 17. Window Behavior

The pet window should be:

```text
borderless
transparent
always-on-top
non-activating when appropriate
```

It should NOT:

- Show a normal title bar.
- Appear in the normal Dock app workflow unnecessarily.
- Block mouse interaction when it is not being used.
- Steal keyboard focus unexpectedly.

Recommended behavior:

```text
Idle pet:
click-through where possible

Interaction mode:
mouse interaction enabled
```

*(Added in v1.1)* Implement click-through with Tauri's `set_ignore_cursor_events(true)` while the pet is idle/roaming, and call `set_ignore_cursor_events(false)` the moment the interaction bubble or chat box opens so its buttons and text field remain clickable. See §68 for how the window must behave across Spaces and full-screen apps.

---

# 18. Window Layer

Use the native macOS window system.

Recommended concept:

```text
NSPanel / NSWindow
```

with:

```text
borderless
transparent
floating
non-opaque
```

Choose the correct window level so it stays visible without behaving like a fullscreen overlay.

Do not use a full-screen transparent window for the entire desktop.

That would hurt performance and interaction.

---

# 19. Recommended Technology

## Preferred architecture

```text
Tauri 2
    +
Rust
    +
TypeScript
    +
HTML/CSS
```

Why:

- Much lighter than Electron.
- Small memory footprint.
- Native macOS integration.
- Rust is suitable for global hotkeys and OS-level functionality.
- TypeScript is good for UI.
- Easy to build a polished 2D interface.

*(Added in v1.1)* Target macOS 13 (Ventura) or later, since this is the practical floor for a current Tauri 2 / WKWebView build and avoids maintaining workarounds for older WebKit versions. Since Apple Silicon is the primary target but Intel Macs are still common, build a universal binary (`cargo tauri build --target universal-apple-darwin`) rather than an Apple-Silicon-only binary, unless the user has explicitly decided to drop Intel support.

---

# 20. Native macOS Integration

Some features should live in the native layer.

Native/Rust responsibilities:

```text
Global hotkey
Window control
Accessibility integration
Clipboard fallback
Screen detection
Mouse position
System permissions
Application lifecycle
Secure configuration
```

Frontend responsibilities:

```text
Pet rendering
Animations
Chat UI
Task buttons
Settings
Conversation display
Pet state
```

AI provider responsibilities:

```text
API communication
Prompt generation
Response parsing
Error handling
```

*(Added in v1.1)* Tauri 2 scopes every IPC command through a capabilities/permissions system (`src-tauri/capabilities/*.json`). Each native command listed in §23 must be explicitly allow-listed there rather than left globally exposed — this is the concrete mechanism behind coding rule #19 ("Keep IPC commands narrowly scoped") in §59. See §67 for why this app cannot be sandboxed for App Store distribution.

---

# 21. Suggested Architecture

```text
┌─────────────────────────────────────┐
│             Pet UI                  │
│       TypeScript / HTML / CSS       │
├─────────────────────────────────────┤
│          Pet State Manager          │
├─────────────────────────────────────┤
│             Tauri IPC               │
├───────────────┬─────────────────────┤
│ Rust Native   │ AI Service          │
│ Layer         │                     │
├───────────────┼─────────────────────┤
│ Hotkey        │ OpenAI-compatible   │
│ Accessibility │ Anthropic           │
│ Clipboard     │ Local Ollama        │
│ Screen        │ Other providers     │
│ Window        │                     │
└───────────────┴─────────────────────┘
```

---

# 22. Project Structure

Recommended:

```text
ai-pet/
│
├── src/
│   ├── components/
│   │   ├── Pet.tsx
│   │   ├── ChatBubble.tsx
│   │   ├── TaskMenu.tsx
│   │   ├── InputBox.tsx
│   │   └── SettingsPanel.tsx
│   │
│   ├── pet/
│   │   ├── PetState.ts
│   │   ├── AnimationController.ts
│   │   ├── RoamingController.ts
│   │   └── PetPosition.ts
│   │
│   ├── ai/
│   │   ├── AIProvider.ts
│   │   ├── OpenAICompatibleProvider.ts
│   │   ├── PromptBuilder.ts
│   │   └── TaskRunner.ts
│   │
│   ├── services/
│   │   ├── SelectedTextService.ts
│   │   ├── ClipboardService.ts
│   │   ├── TTSService.ts
│   │   └── SettingsService.ts
│   │
│   ├── styles/
│   │   └── pet.css
│   │
│   └── main.tsx
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── hotkey.rs
│   │   ├── accessibility.rs
│   │   ├── clipboard.rs
│   │   ├── screens.rs
│   │   ├── window.rs
│   │   └── commands.rs
│   │
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── assets/
│   ├── pet/
│   │   ├── idle/
│   │   ├── walk/
│   │   ├── talking/
│   │   ├── thinking/
│   │   └── sleep/
│   │
│   └── icons/
│
├── .env.example
├── README.md
└── package.json
```

---

# 23. IPC API

Keep the bridge between frontend and native code small.

Suggested commands:

```text
get_selected_text()
get_mouse_position()
get_screens()
set_pet_position(x, y)
show_pet()
hide_pet()
toggle_pet()
set_click_through(enabled)
check_accessibility_permission()
request_accessibility_permission()
read_clipboard()
restore_clipboard()
register_hotkey()
```

Events:

```text
global-hotkey
pet-toggle
pet-show
pet-hide
selected-text
screen-changed
```

---

# 24. Global Hotkey

Primary shortcut:

```text
Option + P
```

Flow:

```text
Global hotkey
      ↓
Native layer receives event
      ↓
Ask selected-text service for text
      ↓
Get mouse/cursor location
      ↓
Send result to frontend
      ↓
Show pet
      ↓
Open interaction UI
```

Important:

The hotkey must work while another application is focused.

Test with:

- Chrome
- Safari
- VS Code
- Terminal
- PDF viewer
- Word
- Notes
- Discord
- Slack

*(Added in v1.1)* If the user presses the hotkey again while the pet is already open and interacting, treat it as "refresh": re-capture the current selection/cursor position, move the pet there, and replace the open bubble's content — do not stack a second bubble. If an AI request from the previous trigger is still in flight, cancel it first (see §69).

---

# 25. Pet Position Near Selection

Ideal behavior:

```text
selected text
     ↓
cursor position
     ↓
pet appears slightly beside/above cursor
```

Do not cover the selected text.

Use screen bounds to keep the pet visible.

Pseudo:

```text
x = cursorX + offsetX
y = cursorY - petHeight - offsetY

if x + petWidth > screenRight:
    x = cursorX - petWidth - offsetX

if y < screenTop:
    y = cursorY + offsetY
```

---

# 26. Context Menu

Right-clicking the pet should open:

```text
AI Pet
──────────────
Chat
Settings
Pause roaming
Resume roaming
Mute
Pet enabled ✓
Launch at startup
Quit
```

Optional:

```text
Change animation
Change pet size
Change AI model
```

---

# 27. Settings

Keep settings simple.

## General

```text
[✓] Launch at startup
[✓] Enable pet
[✓] Roam
[ ] Roam across all displays
```

## Interaction

```text
Global shortcut: Option + P
Toggle shortcut: Option + Shift + P
```

## AI

```text
Provider
Model
API endpoint
API key
```

API key must be stored securely.

Use macOS Keychain where practical.

Do not store secrets in plain JSON.

## Voice

```text
[✓] Speak responses
Voice
Speech speed
```

## Appearance

```text
Pet size
Animation speed
```

---

# 28. Performance Requirements

This is critical.

The application must be lightweight.

Target:

```text
Idle CPU:
very low

Idle RAM:
as low as reasonably possible

No AI request:
no network activity

Pet hidden:
minimal background work

No continuous screen capture
No continuous OCR
No continuous screenshot processing
```

Never continuously capture the screen.

Never continuously send screen data to an AI provider.

Only retrieve selected text when the user activates the shortcut.

---

# 29. AI Request Optimization

The pet should not call AI for simple UI actions.

For example:

```text
Show pet
Move pet
Open menu
Close menu
Toggle roaming
```

must not require AI.

Only call AI when needed.

Examples:

```text
Translate → AI
Define → AI
Explain → AI
Summarize → AI
Chat → AI
```

---

# 30. Response Limits

Default AI responses should be short.

For utility tasks:

```text
Translate:
direct translation

Define:
1-3 sentences

Explain:
short explanation

Summarize:
3-5 bullet points

Rewrite:
only rewritten text unless explanation requested
```

This reduces latency and API cost.

---

# 31. Streaming

Use streaming AI responses where the provider supports it.

Flow:

```text
AI response starts
        ↓
Pet changes to talking/thinking
        ↓
Text appears progressively
        ↓
TTS can optionally begin after a safe sentence boundary
```

Do not wait for a long response before showing anything.

---

# 32. Error Handling

The pet must handle:

```text
No internet
API timeout
Invalid API key
Rate limit
AI provider unavailable
Accessibility permission missing
Clipboard unavailable
No selected text
Invalid model
```

Never crash.

Friendly example:

```text
Hmm... I couldn't reach my AI brain right now.
```

Technical details should go to logs, not the pet bubble.

---

# 33. Privacy

Privacy is important because the app can access selected text.

Rules:

1. Never continuously monitor the screen.
2. Never continuously monitor selected text.
3. Only retrieve selected text after user activation.
4. Do not upload selected text unless the user requests an AI action.
5. Do not store selected text by default.
6. Do not log API keys.
7. Do not log private selected text.
8. Provide a clear privacy explanation.
9. Use secure storage for credentials.
10. Allow the user to disable AI network requests.

---

# 34. Security

Implement:

```text
No API keys in frontend source
No API keys in Git
No secrets in logs
Secure Keychain storage
Validate IPC arguments
Restrict IPC commands
Validate AI provider URLs
Use HTTPS by default
```

Do not allow arbitrary shell commands from AI output.

The AI pet is NOT a shell agent.

For version 1:

```text
AI cannot execute terminal commands.
AI cannot run arbitrary code.
AI cannot control other applications.
```

This keeps the application safer and much simpler.

*(Added in v1.1)* Code signing, notarization, and entitlements are covered separately in §67 — they are a distribution requirement, not an app-logic one, but skipping them means Gatekeeper will block the app on other Macs.

---

# 35. Small Task Architecture

Future tasks should be easy to add.

Example:

```typescript
interface PetTaskHandler {
    id: string;
    label: string;
    run(context: TaskContext): Promise<TaskResult>;
}
```

Example:

```text
TranslateTask
DefineTask
ExplainTask
SummarizeTask
RewriteTask
GrammarTask
AskTask
```

This allows future additions without rewriting the pet.

---

# 36. Context Object

Use a common context:

```typescript
interface TaskContext {
    selectedText?: string;
    userPrompt?: string;
    language?: string;
    clipboardText?: string;
}
```

Then:

```text
TaskRunner.run(task, context)
```

---

# 37. Smart Language Detection

For translation:

If the user selects Bangla:

```text
Bangla → English
```

If the user selects English:

```text
English → Bangla
```

But do not hard-code this permanently.

Settings should allow:

```text
Auto
English
Bangla
Japanese
Chinese
etc.
```

Default:

```text
Auto
```

---

# 38. Interaction UI

The pet itself should remain visible.

Example:

```text
             ┌──────────────────────┐
             │ What should I do?    │
             │                      │
             │ Translate            │
             │ Explain              │
             │ Define               │
             │ Summarize            │
             │ Rewrite              │
             │                      │
             │ [ Ask anything... ]  │
             └──────────┬───────────┘
                        │
                      🤖
```

The panel should visually connect to the pet.

Use a soft rounded UI.

Avoid a generic enterprise dashboard appearance.

---

# 39. Pet States

Implement a finite state machine.

```text
OFF
IDLE
WALKING
INTERACTING
THINKING
SPEAKING
LISTENING
ERROR
SLEEPING
```

Example:

```text
IDLE
  ↓
Option+P
  ↓
INTERACTING
  ↓
Task selected
  ↓
THINKING
  ↓
SPEAKING
  ↓
IDLE
```

---

# 40. Animation State Mapping

```text
IDLE       → idle animation
WALKING    → walking animation
THINKING   → thinking animation
SPEAKING   → talking animation
LISTENING  → listening animation
ERROR      → error animation
SLEEPING   → sleeping animation
```

If actual animation assets are not available yet, create a temporary CSS/vector placeholder system so development can continue.

---

# 41. Accessibility Permission Flow

On first selected-text usage:

```text
User presses Option+P
        ↓
Accessibility unavailable
        ↓
Pet explains why permission is required
        ↓
Open System Settings
        ↓
User grants permission
        ↓
Retry
```

Do not repeatedly open System Settings.

Remember permission state.

---

# 42. First-Run Experience

First launch:

```text
        🤖

Hi! I'm your desktop pet.

I can:
• Chat with you
• Translate selected text
• Explain words
• Summarize text
• Speak responses

Press Option + P anytime.
```

Then:

```text
Enable selected-text access?
```

Explain Accessibility permission.

Then optional:

```text
Connect your AI provider
```

The app should still launch if no provider is configured.

---

# 43. Offline Behavior

Without an AI provider:

The pet should still:

- Appear.
- Roam.
- Animate.
- Open settings.
- Respond to basic UI interactions.
- Use native TTS for local text if applicable.

AI tasks should show:

```text
Connect an AI provider to use this feature.
```

---

# 44. Launch at Startup

Implement optional:

```text
Launch at Login
```

Do not enable it without user consent.

---

# 45. Menu Bar Integration

Recommended.

The app can have a menu bar icon.

Example:

```text
🤖 AI Pet
──────────────
Pet: ON ✓
Roaming: ON ✓
Voice: ON ✓

Chat
Settings

Quit
```

This gives the user control even when the pet is hidden.

---

# 46. Application Lifecycle

The application should behave like a background utility.

When launched:

```text
start native services
load settings
initialize pet
register hotkey
initialize menu bar
show pet if enabled
```

When quit:

```text
unregister hotkey
stop animations
stop TTS
save settings
release resources
exit
```

---

# 47. Logging

Use structured logs.

Example:

```text
INFO  App started
INFO  Hotkey registered
INFO  Pet enabled
INFO  Accessibility permission available
INFO  AI request started
WARN  Accessibility unavailable
ERROR AI request failed
```

Never log:

```text
API keys
selected private text
full chat history
passwords
tokens
```

---

# 48. Testing

## Unit tests

Test:

```text
TaskRunner
PromptBuilder
RoamingController
Position calculations
Settings
AI provider
```

## Integration tests

Test:

```text
Global hotkey
Selected text
Clipboard fallback
Window positioning
TTS
AI streaming
```

## Manual tests

Test selected text in:

```text
Chrome
Safari
VS Code
Terminal
TextEdit
Notes
PDF viewer
Microsoft Word
Discord
Slack
```

---

# 49. Performance Testing

Measure:

```text
RAM idle
CPU idle
CPU while roaming
RAM while chatting
AI response latency
Pet appearance latency
```

Target experience:

```text
Option+P
    ↓
pet appears almost immediately
```

The UI must not wait for AI before appearing.

Correct:

```text
hotkey
  ↓
show pet immediately
  ↓
capture text
  ↓
show task menu
  ↓
AI request
```

Incorrect:

```text
hotkey
  ↓
AI request
  ↓
wait
  ↓
show pet
```

---

# 50. Important UX Rule

The pet must always feel responsive.

If AI takes 5 seconds:

The pet should already be visible.

It can show:

```text
🤔
Thinking...
```

Never freeze the UI while waiting for the model.

---

# 51. AI Provider Timeout

Set reasonable timeout values.

Example:

```text
Connection timeout: 5-10 sec
Request timeout: configurable
```

If the provider fails:

```text
AI request failed
```

Do not leave the pet permanently stuck in:

```text
THINKING
```

Always return to:

```text
IDLE
```

or:

```text
ERROR
```

*(Added in v1.1)* See §69 for what to do if a new request arrives before the previous one has timed out or resolved.

---

# 52. Clipboard Safety

If clipboard fallback is used:

```text
oldClipboard = captureClipboard()

perform copy

selectedText = readClipboard()

restoreClipboard(oldClipboard)
```

Add safeguards.

If copying fails:

```text
restore clipboard
return error
```

Never lose the user's clipboard intentionally.

---

# 53. Hotkey Conflict Handling

If:

```text
Option + P
```

is already used by another application or system utility:

Show:

```text
This shortcut is already in use.
Choose another shortcut in Settings.
```

Allow configurable hotkeys later.

---

# 54. Pet Interaction

Clicking the pet should open:

```text
Quick menu
```

Example:

```text
Chat
Translate clipboard
Settings
Pause roaming
```

Double-click:

```text
Open chat
```

Optional:

```text
Drag pet
```

If drag is implemented:

- Disable roaming temporarily.
- Save last position.
- Resume roaming only if enabled.

---

# 55. Avoid Overengineering

This is important.

Version 1 should NOT include:

```text
Autonomous agents
Long-term memory
Browser automation
Terminal execution
Computer vision
Continuous OCR
Full screen understanding
Complex RAG
Vector database
3D engine
```

Build the tiny useful pet first.

---

# 56. Version Roadmap

## Version 0.1

Build:

```text
Pet window
Idle animation
Roaming
Enable/disable
Global hotkey
Basic chat
```

## Version 0.2

Add:

```text
Selected text
Accessibility API
Clipboard fallback
Translate
Define
Explain
Summarize
```

## Version 0.3

Add:

```text
TTS
Talking animation
Menu bar
Settings
Keychain
Launch at login
```

## Version 0.4

Add:

```text
Multiple monitors
Custom hotkeys
Better animations
Pet positioning
Performance optimization
```

## Version 0.5

Optional:

```text
Voice input
Local AI
Ollama
Custom pets
Themes
More task plugins
```

---

# 57. Development Order

Implement in exactly this general order:

### Phase 1 — Skeleton

```text
Tauri project
Frontend
Rust backend
Build system
```

### Phase 2 — Pet

```text
Transparent window
Pet rendering
Idle animation
Always-on-top behavior
```

### Phase 3 — Roaming

```text
Screen detection
Positioning
Movement
Pause/resume
```

### Phase 4 — Global hotkey

```text
Option+P
Show pet
Move near cursor
```

### Phase 5 — Selected text

```text
Accessibility API
Permission handling
Clipboard fallback
```

### Phase 6 — AI

```text
Provider interface
API integration
Streaming
TaskRunner
```

### Phase 7 — Utility tasks

```text
Translate
Define
Explain
Summarize
Rewrite
Grammar
```

### Phase 8 — Voice

```text
TTS
Talking animation
Mute
Voice settings
```

### Phase 9 — Polish

```text
Menu bar
Settings
Startup
Multi-monitor
Performance
Packaging
```

---

# 58. Definition of Done

The project is considered successful when all of these work:

## Pet

- [ ] Pet appears as a transparent floating character.
- [ ] Pet stays above normal windows.
- [ ] Pet can roam.
- [ ] Roaming can be disabled.
- [ ] Pet can be enabled/disabled.
- [ ] Pet does not consume significant CPU when idle.

## Hotkey

- [ ] Option+P works globally.
- [ ] Pet appears immediately.
- [ ] Pet appears near the cursor/selection.

## Selected text

- [ ] Selected text can be captured using Accessibility.
- [ ] Permission flow works.
- [ ] Clipboard fallback works.
- [ ] Clipboard is restored safely.
- [ ] No selected text is handled gracefully.

## AI

- [ ] Normal chat works.
- [ ] Translation works.
- [ ] Definition works.
- [ ] Explanation works.
- [ ] Summarization works.
- [ ] Rewrite works.
- [ ] Streaming works where supported.
- [ ] AI provider is configurable.

## Voice

- [ ] Pet can speak.
- [ ] Voice can be disabled.
- [ ] Pet animation changes while speaking.

## Security

- [ ] API keys are never committed.
- [ ] API keys are not exposed to frontend logs.
- [ ] Secrets use secure storage where possible.
- [ ] Selected text is not logged.
- [ ] AI cannot execute arbitrary shell commands.

## Performance

- [ ] No continuous screen capture.
- [ ] No continuous OCR.
- [ ] No unnecessary network requests.
- [ ] UI appears immediately after hotkey.
- [ ] AI work does not block the UI.

## Distribution & window behavior *(added in v1.1 — see §67, §68, §69)*

- [ ] App is code-signed with a Developer ID and notarized; it is not sandboxed for the Mac App Store.
- [ ] Pet window remains visible across Spaces and over full-screen apps.
- [ ] App has no Dock icon or app-switcher entry (accessory activation policy).
- [ ] A new hotkey trigger or task selection cancels any still-pending AI request instead of letting both resolve.

---

# 59. Coding Rules for Codex / Claude Code

Follow these rules throughout development:

1. Prefer simple architecture.
2. Do not introduce dependencies without a reason.
3. Prefer native macOS APIs for OS-level functions.
4. Keep the pet UI lightweight.
5. Never block the UI thread.
6. Never continuously capture the screen.
7. Never continuously read selected text.
8. Do not log private user text.
9. Do not hard-code API keys.
10. Keep AI provider logic isolated.
11. Keep task logic modular.
12. Write tests for important native functions.
13. Handle macOS permission failures gracefully.
14. Keep the app functional without AI configuration.
15. Do not turn the project into a general-purpose autonomous agent.
16. Optimize for responsiveness before adding advanced features.
17. Use clear TypeScript types.
18. Use Rust error handling instead of panics for expected runtime failures.
19. Keep IPC commands narrowly scoped.
20. Document every macOS permission required by the application.

---

# 60. Important macOS Permission Principle

The application should request the minimum permissions necessary.

Potential permissions:

```text
Accessibility
Microphone (only if voice input is enabled)
```

Do not request:

```text
Camera
Location
Contacts
Photos
```

unless a future feature genuinely requires them.

---

# 61. Suggested Initial AI UX

When the user presses Option+P with selected text:

```text
                 🤖
        ┌───────────────────────┐
        │ I found some text!    │
        │                       │
        │ Translate  Define     │
        │ Explain    Summarize  │
        │ Rewrite               │
        │                       │
        │ Ask me anything...    │
        └───────────────────────┘
```

If the user clicks Translate:

```text
                 🤖
        ┌───────────────────────┐
        │ Thinking...            │
        └───────────────────────┘
```

Then:

```text
                 🤖
        ┌───────────────────────┐
        │ Translation:           │
        │                        │
        │ ...                    │
        └───────────────────────┘
```

Pet speaks the answer if TTS is enabled.

---

# 62. Suggested Chat UX

Click pet:

```text
                 🤖
        ┌───────────────────────┐
        │ Hey!                  │
        │ What can I help with? │
        │                       │
        │ [Ask something...]    │
        └───────────────────────┘
```

Keep the interaction compact and visually attached to the pet.

---

# 63. Future Plugin System

Once the core is stable, tasks can become plugins.

Example:

```text
plugins/
    translate/
    define/
    summarize/
    rewrite/
    grammar/
```

Each plugin:

```text
id
name
icon
description
handler
```

This allows future small tools without modifying the core pet engine.

---

# 64. Possible Future Features

Only after version 1 is stable:

```text
Weather
Timer
Calculator
Unit conversion
Clipboard assistant
Quick notes
Pomodoro
Calendar reminders
Dictionary
Wikipedia lookup
Coding explanation
Code translation
Screenshot explanation
Voice conversation
Local AI
Multiple pet characters
Pet accessories
Pet mood
Pet leveling
Custom animation packs
```

These should be optional modules.

---

# 65. Final Architecture

The final conceptual system should look like:

```text
                         ┌───────────────┐
                         │   User        │
                         └───────┬───────┘
                                 │
                    Option + P / Click Pet
                                 │
                                 ▼
                         ┌───────────────┐
                         │   Pet UI      │
                         │  TypeScript   │
                         └───────┬───────┘
                                 │
                               IPC
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
       ┌────────────┐    ┌──────────────┐    ┌────────────┐
       │ Hotkey     │    │ Selected     │    │ Screen /   │
       │ Controller │    │ Text Service │    │ Position   │
       └────────────┘    └──────┬───────┘    └────────────┘
                                │
                         Accessibility
                                │
                         Clipboard fallback
                                │
                                ▼
                       ┌─────────────────┐
                       │   Task Runner   │
                       └────────┬────────┘
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
        Translate            Define             Explain
             │                  │                  │
             └──────────────────┼──────────────────┘
                                ▼
                         ┌───────────────┐
                         │  AI Provider  │
                         └───────┬───────┘
                                 │
                       ┌─────────┴─────────┐
                       │                   │
                       ▼                   ▼
                Cloud AI API          Local AI
                                      (future)

                                 ▼
                         ┌───────────────┐
                         │ TTS / Voice   │
                         └───────┬───────┘
                                 │
                                 ▼
                              🤖 Pet
```

---

# 66. Instructions to the Coding Agent

When starting implementation, do NOT attempt to build the entire application in one step.

Work phase-by-phase.

For each phase:

1. Implement the feature.
2. Build the application.
3. Run tests.
4. Launch it locally.
5. Verify the feature manually.
6. Fix errors.
7. Commit/checkpoint the working state.
8. Only then continue.

If a macOS API behaves differently than expected:

- Inspect the official API behavior.
- Prefer native macOS APIs.
- Do not replace native functionality with continuous screen scraping just because it is easier.

If a feature requires a permission:

- Implement a proper permission flow.
- Explain the reason to the user.
- Fail gracefully if permission is denied.

If a dependency is unnecessary:

- Do not add it.

The finished application should feel like:

> **A tiny AI creature living on the desktop that is always nearby, but never annoying.**

The key priorities are:

```text
1. Lightweight
2. Fast
3. Responsive
4. Cute
5. Useful
6. Private
7. Simple
```

Do not sacrifice responsiveness for additional AI features.

---

# 67. macOS Distribution: Signing, Notarization & Sandbox Limits

*(New in v1.1 — the original spec did not say how the finished app reaches a user's Mac.)*

This app depends on the Accessibility API and a global hotkey. Both are effectively incompatible with the Mac App Store's App Sandbox, so plan to distribute outside the App Store from the start rather than discovering the conflict late.

Required for any build leaving the developer's own machine:

```text
Apple Developer ID (Application) certificate
Hardened Runtime enabled
Notarization via notarytool
Stapled notarization ticket
```

Without this, Gatekeeper blocks the app on other Macs with an unqualified "damaged" or "unidentified developer" error.

Entitlements to include:

```text
com.apple.security.cs.allow-jit          (only if the webview needs it)
com.apple.security.automation.apple-events  (only if AppleScript is used for the copy fallback)
```

Do NOT add:

```text
App Sandbox (com.apple.security.app-sandbox)
```

Sandboxing blocks the Accessibility API and global-hotkey registration this app relies on. Accept that this rules out Mac App Store distribution for version 1; distribute as a notarized `.dmg` instead.

Recommended for updates:

```text
Tauri's built-in updater plugin, signed with its own update key
```

so users on a direct-download build still get automatic updates without an App Store.

---

# 68. Multi-Space, Full-Screen & Dock Visibility

*(New in v1.1 — the original spec covered window transparency and always-on-top but not what happens when the user switches Spaces or enters a full-screen app, which is a common failure mode for "always visible" pet apps.)*

By default, a normal window disappears when the user switches to another Space or a full-screen app. A desktop pet should not:

```text
User switches Space
        ↓
Pet should still be visible (or reappear immediately)

User enters a full-screen app
        ↓
Pet should still float above it, or hide gracefully — never leave a stale
window frozen on an abandoned Space
```

To achieve this on macOS, set the window's collection behavior to include:

```text
canJoinAllSpaces
fullScreenAuxiliary
```

Tauri's cross-platform window API does not expose `NSWindow.collectionBehavior` directly, so this requires a small amount of native code that reaches the underlying `NSWindow` (Tauri exposes this via its raw window handle on macOS) and sets the behavior once at window creation.

Pair this with:

```text
Window level: .floating (not .screenSaver — that level is too aggressive
and will draw over system UI like Mission Control or the login screen)

Activation policy: .accessory (equivalent to Info.plist LSUIElement = true)
so the pet has no Dock icon and never steals focus as the active app
```

If joining all Spaces is not feasible in an early version, the fallback is to make the roaming/idle pet gracefully hide when the active Space or app changes and reappear when the user returns — but never leave an orphaned window rendering on a Space the user has left.

---

# 69. Request Cancellation & Concurrency

*(New in v1.1 — §31 and §51 describe streaming and timeouts for a single request, but not what happens when a second request starts before the first has finished, which will happen in normal use.)*

The pet only ever needs the latest request's answer. Do not let two AI requests resolve into the same bubble.

Rule:

```text
New task triggered (hotkey again, new task button, new chat message)
        ↓
If a previous AI request for this bubble is still pending:
    cancel it (AbortController / cancel token)
        ↓
Start the new request
```

Practical notes:

- Use `AbortController` (or the equivalent for the chosen HTTP client) so an in-flight `fetch`/stream is actually torn down, not just ignored.
- Cancelling must also stop any TTS queued for the old response.
- A cancelled request should silently return the pet to `IDLE` or straight into the new `THINKING` state — never show an error bubble for a cancellation the user caused on purpose.
- This applies within one pet bubble only; it is not a general-purpose task queue or agent loop, which §55 already rules out.
