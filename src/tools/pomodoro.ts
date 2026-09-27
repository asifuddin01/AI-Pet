import { formatClock } from "./time";
import { normalizeInput, type LocalTool, type ToolHost, type ToolReply } from "./types";

/**
 * Pomodoro focus sessions: 25 min focus / 5 min break, a 15 min break after every 4th
 * round. While a focus block runs, Lucy stays put and switches into her focused mood.
 */

export type Phase = "idle" | "focus" | "break" | "long-break";

const ROUNDS_PER_LONG_BREAK = 4;

export class Pomodoro implements LocalTool {
  readonly id = "pomodoro";
  readonly name = "Pomodoro";
  readonly icon = "🍅";
  readonly description = "Focus sessions: pomodoro, focus 50/10, stop pomodoro.";
  phase: Phase = "idle";
  round = 0;
  endsAt = 0;
  focusMin = 25;
  breakMin = 5;
  longBreakMin = 15;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly host: ToolHost,
    private readonly now: () => number = Date.now,
  ) {}

  get running(): boolean {
    return this.phase !== "idle";
  }

  handle(raw: string): ToolReply | null {
    const input = normalizeInput(raw).toLowerCase();
    const name = String.raw`(?:pomodoro|pomo|focus(?:\s+(?:mode|session|timer))?)`;
    if (new RegExp(String.raw`^(?:stop|end|cancel|quit|finish)\s+(?:the\s+|my\s+)?${name}$`).test(input)) {
      return this.stop();
    }
    if (new RegExp(String.raw`^${name}\s+status$|^how(?:'s| is) (?:my|the) ${name}(?: going)?$`).test(input)) {
      return this.status();
    }
    const m = new RegExp(
      String.raw`^(?:start\s+(?:a\s+|the\s+)?|begin\s+(?:a\s+)?|let'?s\s+)?${name}(?:\s+(\d{1,3})(?:\s*(?:/|and)\s*(\d{1,2}))?(?:\s*min(?:ute)?s?)?)?$`,
    ).exec(input);
    if (m) {
      const focus = m[1] ? parseInt(m[1], 10) : 25;
      const rest = m[2] ? parseInt(m[2], 10) : focus >= 50 ? 10 : 5;
      if (focus < 1 || focus > 180 || rest < 1 || rest > 60) {
        return { title: "Pomodoro", text: "Pick a focus time between 1 and 180 minutes." };
      }
      return this.start(focus, rest);
    }
    return null;
  }

  start(focusMin = 25, breakMin = 5): ToolReply {
    this.focusMin = focusMin;
    this.breakMin = breakMin;
    this.longBreakMin = Math.max(breakMin, 15);
    this.round = 0;
    this.beginFocus();
    return {
      title: "🍅 Focus on",
      text: `**${focusMin} min** of focus, then a ${breakMin} min break. I'll keep still and quiet till then.\n\nSay "stop pomodoro" to end it.`,
      speech: `Focus mode. ${focusMin} minutes. I'll stay out of your way.`,
      gesture: "happy",
    };
  }

  stop(): ToolReply {
    if (!this.running) return { title: "Pomodoro", text: "No focus session running." };
    const rounds = this.round;
    this.reset();
    return {
      title: "Pomodoro stopped",
      text: rounds ? `Nice — ${rounds} round${rounds === 1 ? "" : "s"} done.` : "Session ended.",
    };
  }

  reset(): void {
    clearTimeout(this.timer);
    const wasFocus = this.phase === "focus";
    this.phase = "idle";
    this.round = 0;
    if (wasFocus) this.host.setFocus(false);
  }

  statusLine(): string | null {
    if (!this.running) return null;
    const left = formatClock(this.endsAt - this.now());
    return this.phase === "focus" ? `🍅 Focus ${left} · round ${this.round + 1}` : `☕ Break ${left}`;
  }

  private status(): ToolReply {
    const line = this.statusLine();
    return { title: "Pomodoro", text: line ?? 'No focus session running. Say "pomodoro" to start one.' };
  }

  private schedule(minutes: number, next: () => void): void {
    clearTimeout(this.timer);
    this.endsAt = this.now() + minutes * 60_000;
    this.timer = setTimeout(next, minutes * 60_000);
  }

  private beginFocus(): void {
    this.phase = "focus";
    this.host.setFocus(true);
    this.schedule(this.focusMin, () => this.endFocus());
  }

  private endFocus(): void {
    this.round++;
    const long = this.round % ROUNDS_PER_LONG_BREAK === 0;
    const minutes = long ? this.longBreakMin : this.breakMin;
    this.phase = long ? "long-break" : "break";
    this.host.setFocus(false);
    this.schedule(minutes, () => this.endBreak());
    this.host.alert({
      title: long ? "☕ Long break" : "☕ Break time",
      text: `Round ${this.round} done. Take **${minutes} min** — stretch, water, look away from the screen.`,
      speech: long ? `That's ${this.round} rounds. Take a proper break, choom.` : "Break time. Stretch a little.",
      gesture: "wave",
    });
  }

  private endBreak(): void {
    this.beginFocus();
    this.host.alert({
      title: "🍅 Back to it",
      text: `Round ${this.round + 1}: **${this.focusMin} min** of focus.`,
      speech: "Break's over. Back to it.",
      gesture: "hop",
    });
  }
}
