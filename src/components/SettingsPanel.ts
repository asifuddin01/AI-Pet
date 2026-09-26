import { TRANSLATE_LANGUAGES } from "../ai/language";
import { native } from "../services/native";
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

/** The Settings window: simple sections, saved as you change them. */
export class SettingsPanel {
  private status: AppStatus | null = null;
  private statusLine!: HTMLElement;
  private keyState!: HTMLElement;
  private accessState!: HTMLElement;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: Partial<Settings> = {};

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: SettingsService,
  ) {}

  async mount(): Promise<void> {
    this.status = await native.getAppStatus().catch(() => null);
    this.render();
    this.settings.onChange(() => this.render());
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
      this.appearance(),
      this.privacy(),
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
      this.toggle("roaming", "Roam around the screen"),
      this.select("roamArea", "Where to roam", [
        ["bottom", "Along the bottom (above the Dock)"],
        ["anywhere", "Anywhere on screen"],
      ]),
      this.toggle("roamAllDisplays", "Roam across all displays", "Default: primary display only."),
    );
  }

  private shortcutField(key: "hotkey" | "toggleHotkey", label: string, help: string): HTMLElement {
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
    const voiceSel = h("select", {}, h("option", { value: "", text: "System default" }));
    void TTSService.voices().then((voices) => {
      for (const v of voices) {
        voiceSel.append(h("option", { value: v.name, text: `${v.name} (${v.lang})`, selected: v.name === this.s.voice }));
      }
    });
    voiceSel.addEventListener("change", () => this.save({ voice: voiceSel.value }));
    const tts = new TTSService(() => ({ voice: this.s.voice, rate: this.s.speechRate }));
    const test = h("button", { type: "button", class: "btn", text: "Test voice" });
    test.addEventListener("click", () => {
      tts.stop();
      tts.speak("Hi! I'm your desktop pet. Press Option P anytime.");
    });
    return this.section(
      "Voice",
      this.toggle("speak", "Speak responses", "Uses the built-in macOS voices — offline and free."),
      this.row("Voice", h("span", { class: "inline" }, voiceSel, test)),
      this.range("speechRate", "Speech speed", 0.5, 2, 0.1, (v) => `${v.toFixed(1)}×`),
      this.toggle("voiceInput", "Voice input", "Coming in a future version.", true),
    );
  }

  private appearance(): HTMLElement {
    return this.section(
      "Appearance",
      this.range("petSize", "Pet size", 0.7, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`),
      this.range("animationSpeed", "Animation speed", 0.5, 2, 0.1, (v) => `${v.toFixed(1)}×`),
    );
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
      ),
      h("div", { class: "row row--actions" }, reset),
    );
  }
}
