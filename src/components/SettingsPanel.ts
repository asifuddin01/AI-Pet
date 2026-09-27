import { TRANSLATE_LANGUAGES } from "../ai/language";
import { OUTFIT_IDS, OUTFITS, voiceFor } from "../pet/Wardrobe";
import { SPRITE_STATES, type SpriteState } from "./CharacterView";
import { native, on, type CharacterList } from "../services/native";
import type { SettingsService } from "../services/SettingsService";
import { TTSService } from "../services/TTSService";
import type { AppStatus, ProviderId, Settings } from "../types";
import { formatShortcut, shortcutFromEvent } from "../util/shortcut";

interface Preset {
  label: string;
  provider: ProviderId;
  baseUrl: string;
  model: string;
  modelHint: string;
  needsKey: boolean;
  keyHint: string;
}

export const PRESETS: Record<string, Preset> = {
  openai: {
    label: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    modelHint: "e.g. gpt-4o-mini",
    needsKey: true,
    keyHint: "sk-…",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-opus-5",
    modelHint: "e.g. claude-opus-5, claude-sonnet-5, claude-haiku-4-5",
    needsKey: true,
    keyHint: "sk-ant-…",
  },
  ollama: {
    label: "Ollama (local, free)",
    provider: "openai",
    baseUrl: "http://localhost:11434/v1",
    model: "",
    modelHint: "e.g. llama3.2",
    needsKey: false,
    keyHint: "not needed",
  },
  openrouter: {
    label: "OpenRouter",
    provider: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    modelHint: "e.g. anthropic/claude-opus-5",
    needsKey: true,
    keyHint: "sk-or-…",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    provider: "openai",
    baseUrl: "",
    model: "",
    modelHint: "model name",
    needsKey: true,
    keyHint: "API key (if required)",
  },
};

const SPRITE_LABELS: Record<SpriteState, string> = {
  idle: "Idle (required)",
  walk: "Walking",
  talk: "Talking",
  think: "Thinking",
  listen: "Listening",
  sleep: "Sleeping",
  error: "Confused",
  happy: "Happy",
  wave: "Waving hello",
};

type Props = Record<string, string | number | boolean | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

/** Languages for voice input (BCP-47). macOS covers most of these on-device; Bangla needs Whisper. */
const SPEECH_LANGUAGES: [string, string][] = [
  ["", "Same as my Mac"],
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["en-IN", "English (India)"],
  ["bn-BD", "Bangla (Whisper only)"],
  ["hi-IN", "Hindi"],
  ["ur-PK", "Urdu (Whisper only)"],
  ["ar-SA", "Arabic"],
  ["es-ES", "Spanish"],
  ["fr-FR", "French"],
  ["de-DE", "German"],
  ["it-IT", "Italian"],
  ["pt-BR", "Portuguese (Brazil)"],
  ["ru-RU", "Russian"],
  ["tr-TR", "Turkish"],
  ["ja-JP", "Japanese"],
  ["ko-KR", "Korean"],
  ["zh-CN", "Chinese (Mandarin)"],
];

/** The Settings window: simple sections, saved as you change them. */
export class SettingsPanel {
  private status: AppStatus | null = null;
  private statusLine!: HTMLElement;
  private keyState!: HTMLElement;
  private accessState!: HTMLElement;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: Partial<Settings> = {};
  private characters: CharacterList = { vrm: [], sprites: {} };

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: SettingsService,
  ) {}

  async mount(): Promise<void> {
    this.status = await native.getAppStatus().catch(() => null);
    await this.loadCharacters();
    this.render();
    this.settings.onChange(() => this.render());
    void on("characters-changed", () => void this.loadCharacters().then(() => this.render()));
    window.addEventListener("focus", () => void this.refreshStatus());
  }

  private get s(): Settings {
    return { ...this.settings.get(), ...this.pending };
  }

  private save(patch: Partial<Settings>, immediate = true): void {
    Object.assign(this.pending, patch);
    clearTimeout(this.saveTimer);
    const flush = async () => {
      const toSave = this.pending;
      this.pending = {};
      try {
        const warnings = await this.settings.update(toSave);
        this.flash(warnings.length ? warnings.join(" ") : "Saved.", warnings.length ? "warn" : "ok");
      } catch (e) {
        this.flash(`Couldn't save: ${String(e)}`, "warn");
      }
    };
    if (immediate) void flush();
    else this.saveTimer = setTimeout(() => void flush(), 500);
  }

  private async loadCharacters(): Promise<void> {
    this.characters = await native.listCharacters().catch(() => this.characters);
  }

  private flash(message: string, kind: "ok" | "warn" = "ok"): void {
    this.statusLine.textContent = message;
    this.statusLine.dataset.kind = kind;
  }

  private async refreshStatus(): Promise<void> {
    this.status = await native.getAppStatus().catch(() => this.status);
    this.paintStatus();
  }

  private paintStatus(): void {
    const st = this.status;
    const preset = PRESETS[this.s.preset] ?? PRESETS.custom;
    this.keyState.textContent = !preset.needsKey
      ? "No key needed for local models."
      : st?.hasApiKey
        ? "✓ A key is saved in your macOS Keychain."
        : "No key saved yet.";
    if (st?.platform === "macos") {
      this.accessState.textContent = st.accessibilityTrusted ? "✓ Granted" : "Not granted";
      this.accessState.dataset.ok = String(st.accessibilityTrusted);
    } else {
      this.accessState.textContent = "Only needed on macOS";
    }
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    // Don't clobber a field the user is typing in.
    const active = document.activeElement;
    if (active && this.root.contains(active) && active.matches("input[type=text], input[type=password], input[type=url]")) return;

    this.statusLine = h("div", { class: "status-line", role: "status", "aria-live": "polite" });
    this.root.replaceChildren(
      h("header", { class: "page-header" }, h("div", { class: "logo", "aria-hidden": "true", text: "🤖" }), h("div", {},
        h("h1", { text: "AI Pet Settings" }),
        h("p", { class: "muted", text: `Version ${this.status?.version ?? ""} · changes save automatically` }),
      )),
      this.general(),
      this.interaction(),
      this.ai(),
      this.voice(),
      this.search(),
      this.appearance(),
      this.characterSection(),
      this.privacy(),
      this.updates(),
      this.statusLine,
    );
    this.paintStatus();
  }

  private section(title: string, ...rows: HTMLElement[]): HTMLElement {
    return h("section", { class: "card" }, h("h2", { text: title }), ...rows);
  }

  private row(label: string, control: HTMLElement, help?: string): HTMLElement {
    return h(
      "label",
      { class: "row" },
      h("span", { class: "row__label" }, label, help ? h("small", { text: help }) : null),
      control,
    );
  }

  private toggle(key: keyof Settings, label: string, help?: string, disabled = false): HTMLElement {
    const input = h("input", { type: "checkbox", class: "switch", checked: Boolean(this.s[key]), disabled });
    input.addEventListener("change", () => this.save({ [key]: input.checked } as Partial<Settings>));
    return this.row(label, input, help);
  }

  private select(key: keyof Settings, label: string, options: [string, string][], help?: string): HTMLElement {
    const sel = h("select", {});
    for (const [value, text] of options) {
      sel.append(h("option", { value, text, selected: String(this.s[key]) === value }));
    }
    sel.addEventListener("change", () => this.save({ [key]: sel.value } as Partial<Settings>));
    return this.row(label, sel, help);
  }

  private range(
    key: keyof Settings,
    label: string,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
  ): HTMLElement {
    const value = Number(this.s[key]);
    const out = h("output", { text: format(value) });
    const input = h("input", { type: "range", min, max, step, value });
    input.addEventListener("input", () => (out.textContent = format(Number(input.value))));
    input.addEventListener("change", () => this.save({ [key]: Number(input.value) } as Partial<Settings>));
    return this.row(label, h("span", { class: "range" }, input, out));
  }

  private general(): HTMLElement {
    return this.section(
      "General",
      this.toggle("launchAtLogin", "Launch at login", "Off unless you turn it on."),
      this.toggle("petEnabled", "Enable pet", `Toggle anytime with ${formatShortcut(this.s.toggleHotkey)}.`),
      this.toggle("roaming", "Roam around the screen", "Or right-click her → Stay still / Move around."),
      this.select("roamArea", "How she moves", [
        ["bottom", "Walks along the bottom (above the Dock)"],
        ["anywhere", "Walks anywhere on screen"],
        ["float", "Floats around the whole screen (hover)"],
      ]),
      this.toggle("roamAllDisplays", "Roam across all displays", "Default: primary display only."),
    );
  }

  private shortcutField(key: "hotkey" | "toggleHotkey" | "talkHotkey", label: string, help: string): HTMLElement {
    const button = h("button", { type: "button", class: "shortcut", text: formatShortcut(this.s[key]) });
    button.addEventListener("click", () => {
      button.textContent = "Press keys…";
      button.classList.add("recording");
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        if (e.key === "Escape") return stop();
        const shortcut = shortcutFromEvent(e);
        if (!shortcut) return;
        stop();
        this.save({ [key]: shortcut });
      };
      const stop = () => {
        window.removeEventListener("keydown", onKey, true);
        button.classList.remove("recording");
        button.textContent = formatShortcut(this.s[key]);
      };
      window.addEventListener("keydown", onKey, true);
      button.addEventListener("blur", stop, { once: true });
    });
    return this.row(label, button, help);
  }

  private interaction(): HTMLElement {
    this.accessState = h("span", { class: "pill" });
    const open = h("button", { type: "button", class: "btn", text: "Open System Settings" });
    open.addEventListener("click", () => {
      const first = !this.s.accessibilityPrompted;
      const request = first ? native.requestAccessibility() : native.openAccessibilitySettings();
      void request.catch(() => undefined).then(() => {
        if (first) this.save({ accessibilityPrompted: true });
      });
    });
    const warnings = this.status?.hotkeyWarnings.length
      ? h("p", { class: "warn", text: this.status.hotkeyWarnings.join(" ") })
      : null;
    return this.section(
      "Interaction",
      this.shortcutField("hotkey", "Pet shortcut", "Summon the pet near your cursor or selected text."),
      this.shortcutField("toggleHotkey", "Toggle shortcut", "Turn the pet on or off."),
      ...(warnings ? [warnings] : []),
      this.row(
        "Accessibility access",
        h("span", { class: "inline" }, this.accessState, open),
        "Lets the pet read the text you've selected — only when you press the shortcut.",
      ),
    );
  }

  private ai(): HTMLElement {
    const s = this.s;
    const preset = PRESETS[s.preset] ?? PRESETS.custom;

    const presetSel = h("select", {});
    for (const [id, p] of Object.entries(PRESETS)) presetSel.append(h("option", { value: id, text: p.label, selected: id === s.preset }));
    presetSel.addEventListener("change", () => {
      const p = PRESETS[presetSel.value];
      this.save({ preset: presetSel.value, provider: p.provider, baseUrl: p.baseUrl, model: p.model });
      void this.refreshStatus();
    });

    const baseUrl = h("input", { type: "url", value: s.baseUrl, placeholder: "https://…", spellcheck: "false" });
    baseUrl.addEventListener("input", () => this.save({ baseUrl: baseUrl.value.trim() }, false));
    const model = h("input", { type: "text", value: s.model, placeholder: preset.modelHint, spellcheck: "false" });
    model.addEventListener("input", () => this.save({ model: model.value.trim() }, false));

    const key = h("input", { type: "password", placeholder: preset.keyHint, autocomplete: "off", disabled: !preset.needsKey });
    const saveKey = h("button", { type: "button", class: "btn btn--primary", text: "Save key", disabled: !preset.needsKey });
    const removeKey = h("button", { type: "button", class: "btn", text: "Remove", disabled: !preset.needsKey });
    saveKey.addEventListener("click", async () => {
      try {
        await native.setApiKey(s.provider, key.value);
        key.value = "";
        this.flash("API key saved to your Keychain.");
      } catch (e) {
        this.flash(String(e), "warn");
      }
      await this.refreshStatus();
    });
    removeKey.addEventListener("click", async () => {
      await native.deleteApiKey(s.provider).catch((e) => this.flash(String(e), "warn"));
      await this.refreshStatus();
    });
    this.keyState = h("small", { class: "muted" });

    const test = h("button", { type: "button", class: "btn", text: "Test connection" });
    const testResult = h("span", { class: "muted", role: "status" });
    test.addEventListener("click", async () => {
      clearTimeout(this.saveTimer);
      if (Object.keys(this.pending).length) {
        await this.settings.update(this.pending);
        this.pending = {};
      }
      testResult.textContent = "Testing…";
      testResult.dataset.kind = "";
      try {
        testResult.textContent = await native.aiTestConnection();
        testResult.dataset.kind = "ok";
      } catch (e) {
        testResult.textContent = String(e);
        testResult.dataset.kind = "warn";
      }
    });

    const languages: [string, string][] = TRANSLATE_LANGUAGES.map((l) => [l, l]);
    return this.section(
      "AI",
      this.toggle("aiEnabled", "Allow AI requests", "When off, the pet never contacts an AI provider."),
      this.row("Provider", presetSel),
      this.row("API endpoint", baseUrl, "HTTPS required (http is allowed only for localhost)."),
      this.row("Model", model),
      this.row("API key", h("span", { class: "inline" }, key, saveKey, removeKey)),
      h("div", { class: "row row--note" }, this.keyState),
      this.row("Timeout", this.timeoutInput()),
      h("div", { class: "row row--actions" }, test, testResult),
      this.select("translateTarget", "Translate into", [["auto", "Auto (smart)"], ...languages]),
      this.select(
        "autoSecondLanguage",
        "Auto mode: English becomes",
        languages.filter(([l]) => l !== "English"),
        "Other languages are translated into English.",
      ),
    );
  }

  private timeoutInput(): HTMLElement {
    const input = h("input", { type: "number", min: 5, max: 300, step: 5, value: this.s.requestTimeoutSecs });
    input.addEventListener("change", () => this.save({ requestTimeoutSecs: Number(input.value) }));
    return h("span", { class: "inline" }, input, h("small", { class: "muted", text: "seconds" }));
  }

  private voice(): HTMLElement {
    const voiceSel = h("select", {}, h("option", { value: "", text: "Lucy (calm, automatic)" }));
    void TTSService.voices().then((voices) => {
      for (const v of voices) {
        voiceSel.append(h("option", { value: v.name, text: `${v.name} (${v.lang})`, selected: v.name === this.s.voice }));
      }
    });
    voiceSel.addEventListener("change", () => this.save({ voice: voiceSel.value }));
    const delivery = voiceFor("confident");
    const tts = new TTSService(() => ({
      voice: this.s.voice,
      rate: this.s.speechRate * delivery.rate,
      pitch: delivery.pitch,
    }));
    const test = h("button", { type: "button", class: "btn", text: "Test voice" });
    test.addEventListener("click", () => {
      tts.stop();
      tts.speak("Hey, choom. It's Lucy. Press Option P whenever you need me.");
    });
    return this.section(
      "Voice",
      this.toggle("speak", "Speak responses", "Built-in macOS voices — offline and free. Her pace and pitch follow her mood."),
      this.row("Voice", h("span", { class: "inline" }, voiceSel, test)),
      this.range("speechRate", "Speech speed", 0.5, 2, 0.1, (v) => `${v.toFixed(1)}×`),
      ...this.voiceInput(),
    );
  }

  /** Push-to-talk: engine, language, the talk shortcut and (for Whisper) endpoint + key. */
  private voiceInput(): HTMLElement[] {
    const s = this.s;
    const rows: HTMLElement[] = [
      this.toggle(
        "voiceInput",
        "Voice input",
        "Talk to her with the 🎤 button or by holding the talk shortcut. The mic is only on while you talk.",
      ),
    ];
    if (!s.voiceInput) return rows;
    rows.push(
      this.toggle(
        "wakeWord",
        "Answer when I call her",
        "Say \"Hey Lucy\", \"Lucy, …\" or \"I'm home\". Keeps the mic on (macOS shows the orange dot) " +
          "but recognises speech on this Mac only, and ignores everything that isn't meant for her. Uses a little battery.",
      ),
      this.shortcutField("talkHotkey", "Talk shortcut", "Hold it, say your question, let go. Works from any app."),
      this.select(
        "speechEngine",
        "Speech recognition",
        [
          ["apple", "macOS (on-device when supported, free)"],
          ["whisper", "Whisper (OpenAI-compatible, needs a key)"],
        ],
        s.speechEngine === "apple"
          ? "macOS doesn't recognise Bangla — use Whisper for that."
          : "Sends the recording to the endpoint below. Supports Bangla and ~50 other languages.",
      ),
      this.select("speechLanguage", "Language you speak", SPEECH_LANGUAGES),
    );
    if (s.speechEngine === "whisper") {
      const url = h("input", { type: "url", value: s.sttBaseUrl, placeholder: "https://api.openai.com/v1", spellcheck: "false" });
      url.addEventListener("input", () => this.save({ sttBaseUrl: url.value.trim() }, false));
      const model = h("input", { type: "text", value: s.sttModel, placeholder: "whisper-1", spellcheck: "false" });
      model.addEventListener("input", () => this.save({ sttModel: model.value.trim() }, false));
      const key = h("input", { type: "password", placeholder: "sk-… (optional if it's your OpenAI chat key)", autocomplete: "off" });
      const saveKey = h("button", { type: "button", class: "btn btn--primary", text: "Save key" });
      const removeKey = h("button", { type: "button", class: "btn", text: "Remove" });
      const keyState = h("small", {
        class: "muted",
        text: this.status?.hasSttKey
          ? "✓ A speech-to-text key is saved in your Keychain."
          : "No separate key saved: your OpenAI chat key is used if the endpoint is the same.",
      });
      saveKey.addEventListener("click", async () => {
        try {
          await native.setSttKey(key.value);
          key.value = "";
          this.flash("Speech-to-text key saved to your Keychain.");
        } catch (e) {
          this.flash(String(e), "warn");
        }
        await this.refreshStatus();
        this.render();
      });
      removeKey.addEventListener("click", async () => {
        await native.deleteSttKey().catch((e) => this.flash(String(e), "warn"));
        await this.refreshStatus();
        this.render();
      });
      rows.push(
        this.row("Whisper endpoint", url, "OpenAI, Groq (https://api.groq.com/openai/v1) or a local server."),
        this.row("Whisper model", model, "e.g. whisper-1, gpt-4o-mini-transcribe, whisper-large-v3"),
        this.row("Speech-to-text key", h("span", { class: "inline" }, key, saveKey, removeKey)),
        h("div", { class: "row row--note" }, keyState),
      );
    }
    return rows;
  }

  private appearance(): HTMLElement {
    const outfits: [string, string][] = [
      ["auto", "Let Lucy choose (by mood)"],
      ...OUTFIT_IDS.map((id): [string, string] => [id, `${OUTFITS[id].emoji}  ${OUTFITS[id].name}`]),
    ];
    return this.section(
      "Appearance",
      this.select("outfit", "Wardrobe", outfits, "In auto mode she changes clothes and hair when her mood shifts."),
      this.toggle("checkIns", "Check in now and then", "She asks if you need anything, or how her outfit looks — only while you're at the Mac."),
      this.select("checkInEvery", "How often", [
        ["rare", "Rarely (every couple of hours)"],
        ["sometimes", "Sometimes (about hourly)"],
        ["often", "Often (every 15–30 min)"],
      ]),
      this.select("theme", "Bubble theme", [
        ["auto", "Match macOS (light / dark)"],
        ["light", "Light"],
        ["dark", "Dark"],
        ["neon", "Night City (neon)"],
      ]),
      this.range("petSize", "Pet size", 0.6, 3, 0.05, (v) => `${Math.round(v * 100)}%`),
      this.range("animationSpeed", "Animation speed", 0.5, 2, 0.1, (v) => `${v.toFixed(1)}×`),
    );
  }

  // ---------------------------------------------------------------- character

  private characterSection(): HTMLElement {
    const kind = this.s.character;
    const rows: HTMLElement[] = [
      this.select(
        "character",
        "Look",
        [
          ["vector", "Built-in Lucy (drawn)"],
          ["vrm", "3D model (VRM)"],
          ["sprites", "Anime clips / images"],
        ],
        "Bring your own Lucy: a 3D model or animated images. Files stay on this Mac.",
      ),
    ];
    if (kind === "vrm") rows.push(...this.vrmRows());
    if (kind === "sprites") rows.push(...this.spriteRows());
    return this.section("Character", ...rows);
  }

  /** A button that opens a file picker and hands the chosen file to `onFile`. */
  private fileButton(text: string, accept: string, onFile: (file: File) => Promise<void>): HTMLElement {
    const input = h("input", { type: "file", accept, hidden: true });
    const button = h("button", { type: "button", class: "btn", text });
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      button.disabled = true;
      this.flash(`Importing ${file.name}…`);
      try {
        await onFile(file);
      } catch (e) {
        this.flash(String(e), "warn");
      } finally {
        button.disabled = false;
      }
    });
    return h("span", {}, button, input);
  }

  private vrmRows(): HTMLElement[] {
    const models = this.characters.vrm;
    const importBtn = this.fileButton("Import .vrm…", ".vrm", async (file) => {
      const stored = await native.importCharacterFile("vrm", file.name, await file.arrayBuffer());
      await this.loadCharacters();
      if (!this.s.vrmModel) this.save({ vrmModel: stored });
      else this.render();
      this.flash(`Imported ${stored}.`);
    });

    const rows: HTMLElement[] = [
      h(
        "p",
        { class: "help" },
        "Make a free anime-style model in VRoid Studio (vroid.com/en/studio) — pink-white bob, lavender tips, " +
          "white cropped jacket, black bodysuit — then File → Export as VRM. Any VRM 0.x or 1.0 model works.",
      ),
      h("div", { class: "row row--actions" }, importBtn),
    ];
    if (!models.length) {
      rows.push(h("p", { class: "warn", text: "No models yet — import a .vrm file to use this look." }));
      return rows;
    }

    const options: [string, string][] = models.map((m) => [m, m]);
    rows.push(this.select("vrmModel", "Model", options, "What she wears unless an outfit has its own model."));

    const list = h("ul", { class: "files" });
    for (const name of models) {
      const remove = h("button", { type: "button", class: "btn btn--small", text: "Remove" });
      remove.addEventListener("click", async () => {
        try {
          await native.deleteCharacterFile("vrm", name);
          await this.loadCharacters();
          const outfitModels = Object.fromEntries(Object.entries(this.s.outfitModels).filter(([, m]) => m !== name));
          const vrmModel = this.s.vrmModel === name ? (this.characters.vrm[0] ?? "") : this.s.vrmModel;
          this.save({ vrmModel, outfitModels });
          this.flash(`Removed ${name}.`);
        } catch (e) {
          this.flash(String(e), "warn");
        }
      });
      list.append(h("li", {}, h("span", { text: name }), remove));
    }
    rows.push(list);

    if (models.length > 1) {
      const table = h("div", { class: "outfit-models" });
      for (const id of OUTFIT_IDS) {
        const sel = h("select", {}, h("option", { value: "", text: "Same as default" }));
        for (const m of models) sel.append(h("option", { value: m, text: m, selected: this.s.outfitModels[id] === m }));
        sel.addEventListener("change", () => {
          const outfitModels = { ...this.s.outfitModels };
          if (sel.value) outfitModels[id] = sel.value;
          else delete outfitModels[id];
          this.save({ outfitModels });
        });
        table.append(this.row(`${OUTFITS[id].emoji}  ${OUTFITS[id].name}`, sel));
      }
      rows.push(
        h(
          "details",
          { class: "more" },
          h("summary", { text: "Models per outfit" }),
          h("p", { class: "help", text: "Give each outfit its own model and she swaps models when her mood changes her clothes." }),
          table,
        ),
      );
    }
    return rows;
  }

  private spriteRows(): HTMLElement[] {
    const files = this.characters.sprites;
    const rows: HTMLElement[] = [
      h(
        "p",
        { class: "help" },
        "One animated image or short clip per state: animated WebP, GIF or PNG, or a WebM/MP4/MOV video " +
          "(transparent WebM/MOV clips float right on your desktop). To cut a character out of an anime clip, " +
          "run scripts/make_sprite.py from the project (see the README). Only Idle is required.",
      ),
    ];
    if (!files.idle) rows.push(h("p", { class: "warn", text: "Add an Idle image or clip to use this look." }));
    const accept = ".webp,.gif,.png,.apng,.webm,.mp4,.m4v,.mov";
    for (const state of SPRITE_STATES) {
      const current = files[state];
      const choose = this.fileButton(current ? "Replace…" : "Choose…", accept, async (file) => {
        await native.importCharacterFile("sprite", file.name, await file.arrayBuffer(), state);
        await this.loadCharacters();
        this.render();
        this.flash(`${SPRITE_LABELS[state]} updated.`);
      });
      const controls = h("span", { class: "inline" }, h("small", { class: "muted", text: current ?? "—" }), choose);
      if (current) {
        const remove = h("button", { type: "button", class: "btn btn--small", text: "Remove" });
        remove.addEventListener("click", async () => {
          await native.deleteCharacterFile("sprite", current).catch((e) => this.flash(String(e), "warn"));
          await this.loadCharacters();
          this.render();
        });
        controls.append(remove);
      }
      rows.push(h("div", { class: "row" }, h("span", { class: "row__label", text: SPRITE_LABELS[state] }), controls));
    }
    return rows;
  }

  private privacy(): HTMLElement {
    const reset = h("button", { type: "button", class: "btn", text: "Show the welcome tour again" });
    reset.addEventListener("click", () => this.save({ firstRunCompleted: false }));
    return this.section(
      "Privacy",
      h(
        "ul",
        { class: "privacy" },
        h("li", { text: "Selected text is read only when you press the shortcut — never continuously." }),
        h("li", { text: "Text is sent to your AI provider only when you ask for an AI action." }),
        h("li", { text: "Selected text, chats and keys are never written to logs or disk." }),
        h("li", { text: "Your API key lives in the macOS Keychain, never in plain files." }),
        h("li", { text: "The clipboard fallback restores your clipboard right after reading." }),
        h("li", { text: "Notes you save (\"note buy milk\") stay in a file on this Mac; timers and maths never leave it." }),
        h("li", {
          text:
            "Voice input is off by default. When on, the mic listens only while you talk; macOS recognition runs " +
            "on-device when it can, Whisper sends the clip to the endpoint you chose.",
        }),
      ),
      h("div", { class: "row row--actions" }, reset),
    );
  }

  /** Web search keys: Google Programmable Search (key + engine ID) or Brave Search. */
  private search(): HTMLElement {
    const s = this.s;
    const google = s.searchProvider === "google";
    const key = h("input", { type: "password", placeholder: google ? "Google API key (AIza…)" : "Brave Search API key", autocomplete: "off" });
    const saveKey = h("button", { type: "button", class: "btn btn--primary", text: "Save key" });
    const removeKey = h("button", { type: "button", class: "btn", text: "Remove" });
    saveKey.addEventListener("click", async () => {
      try {
        await native.setSearchKey(key.value);
        key.value = "";
        this.flash("Search key saved to your Keychain.");
      } catch (e) {
        this.flash(String(e), "warn");
      }
      await this.refreshStatus();
      this.render();
    });
    removeKey.addEventListener("click", async () => {
      await native.deleteSearchKey().catch((e) => this.flash(String(e), "warn"));
      await this.refreshStatus();
      this.render();
    });
    const rows: HTMLElement[] = [
      this.select("searchProvider", "Search with", [
        ["google", "Google (Programmable Search)"],
        ["brave", "Brave Search"],
      ], "Say or type \"search for …\", \"google …\", \"weather in …\". Only your query is sent."),
      this.row("API key", h("span", { class: "inline" }, key, saveKey, removeKey)),
      h("div", {
        class: "row row--note",
      }, h("small", {
        class: "muted",
        text: this.status?.hasSearchKey
          ? "✓ A search key is saved in your Keychain."
          : google
            ? "Get a key and a search engine ID at programmablesearchengine.google.com (search the whole web)."
            : "Get a free key at api-dashboard.search.brave.com.",
      })),
    ];
    if (google) {
      const cx = h("input", { type: "text", value: s.searchEngineId, placeholder: "e.g. 0123456789abcdef0", spellcheck: "false" });
      cx.addEventListener("input", () => this.save({ searchEngineId: cx.value.trim() }, false));
      rows.splice(2, 0, this.row("Search engine ID", cx, "The \"cx\" value of your Programmable Search Engine."));
    }
    return this.section("Search", ...rows);
  }

  private updates(): HTMLElement {
    const check = h("button", { type: "button", class: "btn", text: "Check for updates" });
    const result = h("span", { class: "muted", role: "status" });
    const download = h("button", { type: "button", class: "btn btn--primary", text: "Download", hidden: true });
    let url = "";
    download.addEventListener("click", () => void native.openReleasePage(url).catch((e) => this.flash(String(e), "warn")));
    check.addEventListener("click", async () => {
      result.textContent = "Checking…";
      result.dataset.kind = "";
      download.hidden = true;
      try {
        const info = await native.checkForUpdate();
        url = info.url;
        if (info.newer && info.latest) {
          result.textContent = `Version ${info.latest} is out (you have ${info.current}).`;
          result.dataset.kind = "ok";
          download.hidden = false;
        } else {
          result.textContent = info.latest ? `You're up to date (${info.current}).` : "No releases published yet.";
        }
      } catch (e) {
        result.textContent = String(e);
        result.dataset.kind = "warn";
      }
    });
    return this.section(
      "Updates",
      this.toggle("checkUpdates", "Check once a day", "Asks GitHub for the latest release. Off until you turn it on."),
      h("div", { class: "row row--actions" }, check, download, result),
    );
  }
}
