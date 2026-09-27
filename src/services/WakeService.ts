import { parseWake, type WakeResult } from "../tools/wake";
import { Channel, native, type VoiceEvent } from "./native";

/** Silence that ends an utterance. */
export const UTTERANCE_PAUSE_MS = 1200;
/** Start a fresh recognition this often so transcripts stay short. */
export const RECYCLE_MS = 55_000;
const RETRY_MS = [1_000, 3_000, 10_000, 30_000, 60_000];

export type Wake = Exclude<WakeResult, { kind: "none" }>;

export interface WakeHandlers {
  /** She was called. The listener has stopped; turn it back on when the conversation is over. */
  onWake(wake: Wake): void;
  /** Permission denied or language unsupported: it stays off until `reset`. */
  onUnavailable(message: string): void;
}

/**
 * "Hey Lucy": a continuous, on-device recognition session. Speech is cut into
 * utterances at pauses; each one is checked for her name (or "I'm home") and then
 * forgotten. Nothing is kept or sent anywhere unless she was called.
 */
export class WakeService {
  private wanted = false;
  private running = false;
  private blocked = false;
  private session = 0;
  private failures = 0;
  private text = "";
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private recycleTimer: ReturnType<typeof setTimeout> | undefined;
  private openTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly handlers: WakeHandlers) {}

  get active(): boolean {
    return this.wanted && !this.blocked;
  }

  /** Listen or not. Cheap to call repeatedly. */
  setActive(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) this.open(250);
    else this.halt();
  }

  /** Try again after a permission or language problem (e.g. settings changed). */
  reset(): void {
    this.blocked = false;
    this.failures = 0;
    if (this.wanted) this.open(250);
  }

  private open(delay: number): void {
    clearTimeout(this.openTimer);
    if (!this.wanted || this.blocked || this.running) return;
    this.openTimer = setTimeout(() => void this.start(), delay);
  }

  private async start(): Promise<void> {
    if (!this.wanted || this.blocked || this.running) return;
    const id = ++this.session;
    this.running = true;
    this.text = "";
    const channel = new Channel<VoiceEvent>();
    channel.onmessage = (event) => this.onEvent(id, event);
    this.recycleTimer = setTimeout(() => this.finishUtterance(id), RECYCLE_MS);
    try {
      await native.voiceStart(channel, "wake");
    } catch {
      if (id === this.session) this.retry();
    }
  }

  private onEvent(id: number, event: VoiceEvent): void {
    if (id !== this.session) return;
    switch (event.event) {
      case "started":
        this.failures = 0;
        return;
      case "partial":
        this.text = event.data.text;
        clearTimeout(this.pauseTimer);
        this.pauseTimer = setTimeout(() => this.finishUtterance(id), UTTERANCE_PAUSE_MS);
        return;
      case "final": {
        // The recognizer ended by itself (time limit, long silence).
        const text = event.data.text || this.text;
        this.closed();
        if (!this.consider(text)) this.open(300);
        return;
      }
      case "error":
        this.closed();
        if (event.data.kind === "permission" || event.data.kind === "unavailable" || event.data.kind === "not_configured") {
          this.blocked = true;
          this.handlers.onUnavailable(event.data.message);
        } else {
          this.retry();
        }
        return;
    }
  }

  /** A pause (or the recycle timer): judge what was said, then listen afresh. */
  private finishUtterance(id: number): void {
    if (id !== this.session) return;
    const text = this.text;
    this.stopSession();
    if (!this.consider(text)) this.open(200);
  }

  private consider(text: string): boolean {
    const wake = parseWake(text);
    if (wake.kind === "none") return false;
    this.wanted = false; // the pet takes the mic now; it switches us back on afterwards
    this.handlers.onWake(wake);
    return true;
  }

  private retry(): void {
    this.closed();
    const delay = RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)];
    this.failures++;
    this.open(delay);
  }

  private closed(): void {
    this.running = false;
    this.session++;
    clearTimeout(this.pauseTimer);
    clearTimeout(this.recycleTimer);
  }

  private stopSession(): void {
    const wasRunning = this.running;
    this.closed();
    if (wasRunning) void native.voiceCancel().catch(() => undefined);
  }

  private halt(): void {
    clearTimeout(this.openTimer);
    this.stopSession();
  }
}
