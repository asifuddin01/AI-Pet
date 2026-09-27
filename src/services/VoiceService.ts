import { Channel, native, type VoiceEvent } from "./native";

export type VoiceErrorKind = Extract<VoiceEvent, { event: "error" }>["data"]["kind"];

export interface VoiceHandlers {
  /** The microphone is open. */
  onListening(): void;
  onPartial(text: string): void;
  /** The finished transcript; "" when nothing was heard. */
  onFinal(text: string): void;
  onError(kind: VoiceErrorKind, message: string): void;
}

export interface VoiceOptions {
  /** Stop by itself after a pause in speech (mic button), vs. until released (hold to talk). */
  autoStop: boolean;
  /** A follow-up after "Hey Lucy": always the live (Apple) engine so pauses end it. */
  handsFree?: boolean;
}

/** Stop after this much silence once she has heard something (auto-stop mode). */
export const PAUSE_MS = 1600;
/** Give up if nothing at all is said for this long (auto-stop mode). */
export const NO_SPEECH_MS = 8000;
/** Never listen longer than this. */
export const MAX_LISTEN_MS = 60_000;
/** How long to wait for the final transcript after the mic closes. */
export const FINAL_WAIT_MS = 10_000;

type Phase = "idle" | "starting" | "listening" | "finishing";

/**
 * Push-to-talk speech input. One session at a time; the native layer opens the mic
 * only between start and stop. A newer session (or cancel) silences older events.
 */
export class VoiceService {
  private session = 0;
  private phase: Phase = "idle";
  private handlers: VoiceHandlers | null = null;
  private options: VoiceOptions = { autoStop: true };
  private stopRequested = false;
  private heard = "";
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private maxTimer: ReturnType<typeof setTimeout> | undefined;
  private finalTimer: ReturnType<typeof setTimeout> | undefined;

  get active(): boolean {
    return this.phase !== "idle";
  }

  get listening(): boolean {
    return this.phase === "starting" || this.phase === "listening";
  }

  async start(handlers: VoiceHandlers, options: VoiceOptions): Promise<void> {
    this.cancel();
    const id = ++this.session;
    this.handlers = handlers;
    this.options = options;
    this.phase = "starting";
    this.stopRequested = false;
    this.heard = "";
    const channel = new Channel<VoiceEvent>();
    channel.onmessage = (event) => this.onEvent(id, event);
    try {
      await native.voiceStart(channel, options.handsFree ? "handsFree" : "push");
    } catch {
      if (id !== this.session) return;
      this.reset();
      handlers.onError("failed", "Voice input failed to start.");
    }
  }

  /** Close the mic; the transcript follows through `onFinal`. */
  async stop(): Promise<void> {
    if (this.phase === "starting") {
      // Released before the mic opened (e.g. while macOS asked for permission).
      this.stopRequested = true;
      return;
    }
    if (this.phase !== "listening") return;
    const id = this.session;
    this.phase = "finishing";
    this.clearTimers();
    this.finalTimer = setTimeout(() => {
      if (id !== this.session || this.phase !== "finishing") return;
      const handlers = this.handlers;
      const text = this.heard;
      this.cancel();
      handlers?.onFinal(text);
    }, FINAL_WAIT_MS);
    await native.voiceStop().catch(() => undefined);
  }

  /** Stop listening and drop whatever was heard. */
  cancel(): void {
    if (this.phase === "idle") return;
    this.session++;
    this.reset();
    void native.voiceCancel().catch(() => undefined);
  }

  private reset(): void {
    this.phase = "idle";
    this.handlers = null;
    this.clearTimers();
  }

  private clearTimers(): void {
    clearTimeout(this.silenceTimer);
    clearTimeout(this.maxTimer);
    clearTimeout(this.finalTimer);
  }

  private armSilence(ms: number): void {
    if (!this.options.autoStop) return;
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => void this.stop(), ms);
  }

  private onEvent(id: number, event: VoiceEvent): void {
    if (id !== this.session) return;
    const handlers = this.handlers;
    if (!handlers) return;
    switch (event.event) {
      case "started":
        if (this.stopRequested) {
          // Too short to be a question: close the mic quietly.
          this.cancel();
          handlers.onFinal("");
          return;
        }
        this.phase = "listening";
        this.maxTimer = setTimeout(() => void this.stop(), MAX_LISTEN_MS);
        this.armSilence(NO_SPEECH_MS);
        handlers.onListening();
        return;
      case "partial":
        this.heard = event.data.text;
        this.armSilence(PAUSE_MS);
        handlers.onPartial(event.data.text);
        return;
      case "final":
        this.reset();
        handlers.onFinal(event.data.text.trim());
        return;
      case "error":
        this.reset();
        handlers.onError(event.data.kind, event.data.message);
        return;
    }
  }
}
