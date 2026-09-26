import { native, log } from "./native";

export interface VoicePrefs {
  voice: string;
  rate: number;
}

type Engine = "web" | "native";

/**
 * Speaks with the system voices. Primary engine: the webview's Web Speech API
 * (backed by macOS AVSpeechSynthesizer — offline, no cost, low latency).
 * Fallback: the native `say` command via Rust, if Web Speech is missing or fails.
 *
 * Chunks are queued so streamed answers can start speaking at the first sentence.
 */
export class TTSService {
  private engine: Engine;
  private queue: { text: string; lang?: string }[] = [];
  private active = false;
  private generation = 0;
  private listeners = new Set<(speaking: boolean) => void>();

  constructor(private prefs: () => VoicePrefs) {
    this.engine = "speechSynthesis" in globalThis && typeof SpeechSynthesisUtterance !== "undefined" ? "web" : "native";
  }

  get speaking(): boolean {
    return this.active;
  }

  onSpeakingChange(listener: (speaking: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Queue text; `lang` is a BCP-47 hint used to pick a matching voice. */
  speak(text: string, lang?: string): void {
    if (!text.trim()) return;
    this.queue.push({ text, lang });
    if (!this.active) void this.drain();
  }

  stop(): void {
    this.generation++;
    this.queue = [];
    if (this.engine === "web") {
      speechSynthesis.cancel();
    } else {
      native.ttsStop().catch(() => undefined);
    }
    this.setActive(false);
  }

  /** Voices for the Settings picker (may be empty until the system loads them). */
  static async voices(): Promise<SpeechSynthesisVoice[]> {
    if (!("speechSynthesis" in globalThis)) return [];
    const list = speechSynthesis.getVoices();
    if (list.length) return list;
    return new Promise((resolve) => {
      const done = () => resolve(speechSynthesis.getVoices());
      speechSynthesis.addEventListener("voiceschanged", done, { once: true });
      setTimeout(done, 1500);
    });
  }

  private setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    for (const l of this.listeners) l(active);
  }

  private async drain(): Promise<void> {
    const gen = this.generation;
    this.setActive(true);
    while (this.queue.length && gen === this.generation) {
      const chunk = this.queue.shift()!;
      const ok = this.engine === "web" ? await this.speakWeb(chunk.text, chunk.lang) : await this.speakNative(chunk.text);
      if (!ok && this.engine === "web" && gen === this.generation) {
        log("warn", "Web Speech failed; switching to native speech");
        this.engine = "native";
        await this.speakNative(chunk.text);
      }
    }
    if (gen === this.generation) this.setActive(false);
  }

  private speakWeb(text: string, lang?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const { voice, rate } = this.prefs();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      const voices = speechSynthesis.getVoices();
      const chosen = voices.find((v) => v.name === voice);
      const langPrefix = lang?.split("-")[0];
      if (chosen && (!langPrefix || chosen.lang.startsWith(langPrefix))) {
        utterance.voice = chosen;
      } else if (lang) {
        utterance.lang = lang;
        const match = voices.find((v) => v.lang === lang) ?? voices.find((v) => langPrefix && v.lang.startsWith(langPrefix));
        if (match) utterance.voice = match;
      }
      utterance.onend = () => resolve(true);
      utterance.onerror = (e) => resolve(e.error === "interrupted" || e.error === "canceled");
      speechSynthesis.speak(utterance);
    });
  }

  private async speakNative(text: string): Promise<boolean> {
    const { voice, rate } = this.prefs();
    try {
      return await native.ttsSpeak(text, voice || null, rate);
    } catch {
      return false;
    }
  }
}
