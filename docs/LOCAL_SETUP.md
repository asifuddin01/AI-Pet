# Run Lucy on your Mac as a separate project (with the 3D Lucy.vrm)

This sets up a **fresh, separate copy** of the app in its own folder (`~/AI/LucyPet`) and loads the
3D **Lucy.vrm** model. Your older checkout (e.g. `~/AI/PET`) is left alone.

You can do it by hand (below) or let **Claude Code** do it: open Terminal and run `claude`, then
paste the prompt in [Let Claude Code do it](#let-claude-code-do-it).

> Both copies are the same app (`com.asifuddin.aipet`), so they share settings, the API key in the
> Keychain, and imported models. Run **one at a time**.

## What you need

- macOS 13 Ventura or later (Apple Silicon or Intel)
- `Lucy.vrm`: the model file from the chat, saved as **`~/Downloads/Lucy.vrm`**
- About 3 GB free disk (Rust build cache) and 10–15 minutes for the first build

## 1. Get the code into its own folder

```bash
mkdir -p ~/AI && cd ~/AI
git clone --branch claude/determined-galileo-sjlbe1 https://github.com/asifuddin01/AI-Pet.git LucyPet
cd LucyPet
```

## 2. Install the tools (once)

```bash
./scripts/setup-macos.sh
```

This checks for the Xcode Command Line Tools, Rust and Node.js 20+. If anything is missing, it
prints the exact command to install it. Run those commands, then run the script again until it
says everything is ready. It finishes with `npm install`.

## 3. Put Lucy.vrm where the app looks for models

The app keeps models in its own data folder, never inside the project:

```bash
DATA="$HOME/Library/Application Support/com.asifuddin.aipet"
mkdir -p "$DATA/characters/vrm"
cp ~/Downloads/Lucy.vrm "$DATA/characters/vrm/Lucy.vrm"
```

**Alternative:** skip this step and import the file in the app later: **Settings → Character →
Look: 3D model (VRM) → Import .vrm…**.

## 4. Run it

**Quick try:**

```bash
npm run tauri dev
```

The first build takes a few minutes, then Lucy appears at the bottom right.

**For daily use and voice:** build the real app. macOS then asks for permissions for **AI Pet**
itself instead of Terminal, which voice input and "Hey Lucy" need.

```bash
npm run tauri build -- --bundles app
cp -R "src-tauri/target/release/bundle/macos/AI Pet.app" /Applications/
xattr -cr "/Applications/AI Pet.app"
open "/Applications/AI Pet.app"
```

`xattr -cr` is needed once because the build isn't notarized.

## 5. Switch her to the 3D look

Right-click Lucy → **Settings…**, then:

1. **Character → Look:** choose **3D model (VRM)**, then **Model:** choose **Lucy.vrm**.
2. **Appearance → Wardrobe:** *Let Lucy choose (by mood)*. Or pick an outfit yourself; the
   right-click **Outfit** menu works too.
3. **AI:** pick a provider, then enter the model and API key and press **Test connection**:
   - Anthropic: `claude-opus-5`
   - OpenAI: e.g. `gpt-4o-mini`
   - Ollama: local and free
4. **Voice:**
   - Turn on **Voice input**, and optionally **Answer when I call her** ("Hey Lucy").
   - For **Bangla** speech, choose **Whisper** and add a key.
5. **Search** (optional): add a Google API key and search engine ID, or a Brave Search key.
6. **Interaction → Accessibility:** click **Open System Settings** and allow AI Pet (or Terminal,
   when using `tauri dev`). This lets ⌥P read the text you've selected.

The first time you talk to her, macOS asks for **Microphone** and **Speech Recognition** access.
Allow both.

## 6. Try it

| Do | Expect |
| --- | --- |
| Select text anywhere, press **⌥P** | Translate / Explain / Define / Summarize… |
| Click her → **Tools** | Timer, Pomodoro, Notes, Calculator, Convert, World clock |
| Hold **⌥L** and say "set a timer for 1 minute" | Timer set, and she pings you after a minute |
| Say **"Hey Lucy"** | "Yeah? I'm listening." (needs *Answer when I call her*) |
| Say **"I'm home"** | She welcomes you back |
| "wear the saree" / "float around" / "stay still" / "come here" | She does it |
| "what can you do?" | Her list of skills |
| "weather in Dhaka" | Web answer with sources (needs a search key) |
| Right-click → **Movement** | Float / walk / stay still |
| **⌥⇧P** | Hide or show her |

## Updating later

```bash
cd ~/AI/LucyPet
git pull
npm install
```

Then run `npm run tauri dev`, or rebuild the app as in step 4. If a chat gives you a newer
**Lucy.vrm**, copy it over the old one (step 3) and choose it again in Settings → Character.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Couldn't load my look" | The file isn't in `…/characters/vrm/`, or it's damaged. Copy it again (step 3), or use *Import .vrm…*. |
| ⌥P says it can't see selected text | Allow Accessibility for AI Pet (or Terminal in dev). If you rebuilt the app, toggle the entry off and on again. |
| Voice: "I can't use the microphone" | System Settings → Privacy & Security → **Microphone** and **Speech Recognition** → allow AI Pet. |
| "Hey Lucy" won't turn on | Needs a language your Mac recognises **on-device**, like English. Bangla works only with the 🎤 / ⌥L + Whisper. |
| Shortcut conflict warning | Pick another shortcut in Settings → Interaction or Voice. |
| Build fails on Rust | Run `rustup update`, then `cd src-tauri && cargo clean`, and build again. |
| "App is damaged" when opening | `xattr -cr "/Applications/AI Pet.app"` |

## Let Claude Code do it

Open Terminal, run `claude` (in any folder), and paste this:

```text
Set up the AI Pet (Lucy) desktop app on this Mac as a separate project, and load my 3D Lucy model.

1. Clone https://github.com/asifuddin01/AI-Pet.git, branch claude/determined-galileo-sjlbe1,
   into ~/AI/LucyPet. Don't touch any other folder like ~/AI/PET. Then cd into it and follow
   CLAUDE.md in that repo.
2. Run ./scripts/setup-macos.sh. If it reports anything missing (Xcode Command Line Tools, Rust,
   Node 20+), tell me the exact install command and wait for me. Don't run sudo yourself. Re-run
   it until everything is OK.
3. Copy ~/Downloads/Lucy.vrm to
   "$HOME/Library/Application Support/com.asifuddin.aipet/characters/vrm/Lucy.vrm" (create the
   folders). If ~/Downloads/Lucy.vrm doesn't exist, ask me where the file is.
4. Make sure AI Pet isn't running (quit it from the menu bar icon if needed). Then, in
   "$HOME/Library/Application Support/com.asifuddin.aipet/settings.json" (create it as {} if
   missing), set "character": "vrm", "vrmModel": "Lucy.vrm", "outfit": "auto",
   "roamArea": "float". Keep every other key as it is.
5. Run the checks: npm test, npm run typecheck, and
   cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings.
6. Build the app with: npm run tauri build -- --bundles app
   Copy "src-tauri/target/release/bundle/macos/AI Pet.app" to /Applications, run
   xattr -cr "/Applications/AI Pet.app", and open it.
7. Tell me to:
   - allow Accessibility for AI Pet;
   - set my AI provider and API key in Settings → AI;
   - turn on Voice input and "Answer when I call her" in Settings → Voice.
   Never ask me to paste API keys into this chat; I'll type them into Settings myself.
8. Never commit or push Lucy.vrm, settings.json or any keys to git.
```
