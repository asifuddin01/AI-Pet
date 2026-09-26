import { native, log } from "./native";

export interface VoicePrefs {
  /** A system voice name, or "" for Lucy's automatic pick. */
  voice: string;
  rate: number;
  pitch: number;
}

/**
 * Lucy's voice: a calm, clear female system voice. Premium/Enhanced variants are
 * preferred when installed (System Settings → Accessibility → Spoken Content).
 */
export const LUCY_VOICES = ["Ava", "Zoe", "Allison", "Samantha", "Susan", "Karen", "Moira", "Tessa"];

/** Pick the voice to use: the user's choice, else Lucy's preferred voice for the language. */
export function chooseVoice(
  voices: Pick<SpeechSynthesisVoice, "name" | "lang">[],
  preferred: string,
  lang?: string,
): Pick<SpeechSynthesisVoice, "name" | "lang"> | undefined {
  const prefix = lang?.split("-")[0];
  const fits = (v: Pick<SpeechSynthesisVoice, "lang">) => !prefix || v.lang.toLowerCase().startsWith(prefix.toLowerCase());
  const chosen = voices.find((v) => v.name === preferred);
  if (chosen && fits(chosen)) return chosen;
  if (!prefix || prefix === "en") {
    const quality = (name: string) => (/premium/i.test(name) ? 0 : /enhanced/i.test(name) ? 1 : 2);
    const lucy = voices
      .filter((v) => v.lang.toLowerCase().startsWith("en") && LUCY_VOICES.some((n) => v.name.startsWith(n)))
      .sort(
        (a, b) =>
          quality(a.name) - quality(b.name) ||
          LUCY_VOICES.findIndex((n) => a.name.startsWith(n)) - LUCY_VOICES.findIndex((n) => b.name.startsWith(n)),
      );
    if (lucy.length) return lucy[0];
  }
  if (!lang) return undefined;
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => fits(v));
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
      const { voice, rate, pitch } = this.prefs();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Math.min(2, Math.max(0.5, rate));
      utterance.pitch = Math.min(2, Math.max(0, pitch));
      const voices = speechSynthesis.getVoices();
      if (lang) utterance.lang = lang;
      const match = chooseVoice(voices, voice, lang);
      if (match) utterance.voice = match as SpeechSynthesisVoice;
      utterance.onend = () => resolve(true);
      utterance.onerror = (e) => resolve(e.error === "interrupted" || e.error === "canceled");
      speechSynthesis.speak(utterance);
    });
  }

  private async speakNative(text: string): Promise<boolean> {
    const { voice, rate } = this.prefs();
    try {
      // `say` has no pitch control; Samantha ships with every Mac and suits Lucy.
      return await native.ttsSpeak(text, voice || "Samantha", rate);
    } catch {
      return false;
    }
  }
}
