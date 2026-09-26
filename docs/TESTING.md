# Testing

## Automated

```bash
npm test                                   # Vitest — 85 tests
npm run typecheck
cd src-tauri
cargo test                                 # 34 tests
cargo clippy --all-targets -- -D warnings
```

| Area (guide §48) | Where |
| --- | --- |
| TaskRunner | `src/ai/TaskRunner.test.ts` — every task through one provider, text requirements, plugin-style registration |
| PromptBuilder | `src/ai/PromptBuilder.test.ts` — response limits, selected text wrapping, history bounds, role alternation |
| AI provider | `src/ai/NativeAIProvider.test.ts` — streaming, typed errors, cancellation (§69), watchdog timeout (§51), mid-stream reset; `src-tauri/src/ai/*` — SSE parsing, OpenAI/Anthropic events, refusals, HTTP status mapping, URL validation |
| RoamingController | `src/pet/RoamingController.test.ts` — safe destinations, 2–8 s rests, pause mid-walk, multi-display rules |
| Position calculations | `src/pet/PetPosition.test.ts` — §25 cursor placement, bubble above/below, screen clamping, multi-monitor lookup |
| State machine / animation | `src/pet/PetState.test.ts` |
| Settings | `src-tauri/src/settings.rs` — defaults, clamping, camelCase wire format; `secrets.rs` key validation |
| Hotkeys | `src-tauri/src/hotkey.rs` — parsing, modifier requirement; `src/util/shortcut.test.ts` |
| Language / speech | `src/ai/language.test.ts`, `src/services/speech.test.ts` |
| Moods / wardrobe / voice | `src/pet/Wardrobe.test.ts` — mood decisions, outfit picks, mood tracker, voice choice |
| Characters | `src/components/SpritePet.test.ts` — state fallbacks; `src/components/VrmPet.test.ts` — outfit → clothing layers; `src-tauri/src/characters.rs` — name sanitizing, asset kinds |

CI (`.github/workflows/ci.yml`) runs all of the above on Linux and again on macOS, then builds the
universal `.dmg`.

## Manual checklist (macOS)

Run `npm run tauri dev` (or the built app) and tick these off.

### Pet
- [ ] Pet appears bottom-right, transparent, no Dock icon, not in ⌘-Tab.
- [ ] Stays above normal windows; visible after switching Spaces; floats over a full-screen app.
- [ ] Roams slowly along the bottom; rests between walks; *Pause roaming* stops it immediately.
- [ ] Clicks anywhere except the pet go through to the app underneath.
- [ ] Click → quick menu; double-click → chat; drag → moves and position survives a restart.
- [ ] ⌥⇧P hides/shows; menu bar toggles stay in sync with the right-click menu and Settings.
- [ ] After ~12 min without interaction it falls asleep; clicking wakes it.

### Hotkey + selected text — try each app
Chrome · Safari · VS Code · Terminal · TextEdit · Notes · Preview (PDF) · Microsoft Word · Discord · Slack

- [ ] Select text, ⌥P → pet appears **immediately** by the cursor (before any AI work).
- [ ] The quote chip shows the right text; a task gives a streamed answer.
- [ ] Put an image on the clipboard first, then use ⌥P in an app that needs the clipboard
      fallback (e.g. Discord): the image is still on the clipboard afterwards.
- [ ] Nothing selected → "I couldn't find selected text".
- [ ] ⌥P twice quickly → one bubble, the old answer is cancelled.
- [ ] Accessibility off → explanation bubble; *Open System Settings* only when clicked.

### AI
- [ ] Chat, Translate (Bangla ↔ English auto), Define, Explain, Summarize (bullets), Rewrite, Fix grammar.
- [ ] Wrong key → "My API key didn't work"; wrong model → "I couldn't find that AI model";
      Wi-Fi off → "I couldn't reach my AI brain"; the pet returns to idle in every case.
- [ ] No provider configured → "Connect an AI provider to use this feature" + Settings button.
- [ ] *Allow AI requests* off → no network traffic (check with Little Snitch / `nettop`).

### Character
- [ ] Settings → Character → *3D model*: import a `.vrm` from VRoid Studio; she appears within a
      few seconds, blinks, breathes, walks when roaming, talks while answering, waves hello.
- [ ] With two models mapped to different outfits, *Change outfit* swaps the model.
- [ ] *Anime clips / images*: import an Idle `.webp` (from `scripts/make_sprite.py`) and a Talking
      clip; the talking one plays while she answers.
- [ ] Remove the Idle file: the pet falls back to the built-in look and explains why.
- [ ] Hidden pet (⌥⇧P) with the 3D look: CPU drops to ~0% (render loop stopped).

### Voice
- [ ] Answers are spoken, starting before the text finishes; mouth animates while speaking.
- [ ] Mute (right-click) / Voice toggle (menu bar) stop speech at once.
- [ ] Bangla answers use a Bangla-capable voice if one is installed
      (System Settings → Accessibility → Spoken Content → System voice → Manage Voices).

## Performance (§49)

With the built app (`npm run app:build`, not the dev build):

```bash
# CPU and memory of the app and its WebKit helper processes, sampled every 5 s
top -l 0 -s 5 -stats pid,command,cpu,mem | grep -E "AI Pet|WebKit"
```

| Measure | How | Target |
| --- | --- | --- |
| Idle CPU (roaming off) | the command above, pet resting | ~0% between blinks |
| CPU while roaming | same, roaming on | low single digits |
| Idle RAM | Activity Monitor → *AI Pet* + *AI Pet Web Content* | tens of MB |
| Hidden | ⌥⇧P, then measure | no timers or animation |
| Pet appearance latency | ⌥P → pet visible | < 100 ms, never waits for AI |
| AI latency | log line `AI request finished in N ms` | depends on provider/model |

Design choices behind these numbers: all animation is CSS transforms/opacity (Core Animation on
macOS), the resting pet is static between occasional gestures, window movement is interpolated
natively in Rust at ~30 fps, the click-through hover check only runs while the pet is visible,
and no HTTP client exists until the first AI request.
