import { formatClock, formatDuration, formatTimeOfDay, parseClockTime, parseDuration } from "./time";
import { normalizeInput, type LocalTool, type ToolHost, type ToolReply } from "./types";

/** Timers and reminders: "timer 5 min", "10 min timer for tea", "remind me in 20 min to stretch". */

export interface Timer {
  id: number;
  label: string;
  kind: "timer" | "reminder";
  endsAt: number;
  durationMs: number;
}

const MAX_TIMERS = 20;
const MAX_MS = 24 * 3_600_000;

/** Split "5 min tea" into a duration and a label, preferring the longest duration prefix. */
export function splitDurationLabel(rest: string): { ms: number; label: string } | null {
  const words = rest.trim().split(/\s+/);
  for (let n = words.length; n > 0; n--) {
    const ms = parseDuration(words.slice(0, n).join(" "), true);
    if (ms !== null) {
      // "timer 2 days": a unit timers don't do, not 2 minutes labelled "days".
      if (/^(?:days?|weeks?|months?|years?)\b/i.test(words[n] ?? "")) return null;
      const label = words
        .slice(n)
        .join(" ")
        .replace(/^(?:for|to|called|named|-|:)\s+/i, "")
        .trim();
      return { ms, label };
    }
  }
  return null;
}

export class Timers implements LocalTool {
  readonly id = "timers";
  readonly name = "Timer";
  readonly icon = "⏱";
  readonly description = "Timers and reminders: timer 5 min, remind me in 20 min to stretch, remind me at 5pm to call mum.";
  private list: (Timer & { handle: ReturnType<typeof setTimeout> })[] = [];
  private nextId = 1;

  constructor(
    private readonly host: ToolHost,
    private readonly now: () => number = Date.now,
  ) {}

  active(): Timer[] {
    return this.list
      .map(({ handle: _, ...t }) => t)
      .sort((a, b) => a.endsAt - b.endsAt);
  }

  handle(raw: string): ToolReply | null {
    const input = normalizeInput(raw).toLowerCase();
    if (input.length > 200) return null;

    let m = /^(?:cancel|stop|clear|delete|remove|kill)\s+(?:all\s+|the\s+|my\s+)*(?:timers?|reminders?|alarms?)(?:\s+#?(\d+))?$/.exec(input);
    if (m) return this.cancel(m[1] ? parseInt(m[1], 10) : null);

    if (/^(?:(?:list|show|check)\s+)?(?:my\s+)?(?:timers|reminders)$|^(?:how much time is left|time left|how long left)$/.test(input)) {
      return this.status();
    }

    // "remind me in 20 min to stretch" / "remind me at 5pm to call mum"
    m = /^remind me\s+(in|after|at)\s+(.+?)(?:\s+to\s+(.+))?$/.exec(input);
    if (m) return this.remind(m[1] === "at" ? { at: m[2] } : { after: m[2] }, m[3] ?? "", raw);
    // "remind me to stretch in 20 min" / "remind me to call mum at 5pm"
    m = /^remind me to\s+(.+?)\s+(in|after|at)\s+(.+)$/.exec(input);
    if (m) return this.remind(m[2] === "at" ? { at: m[3] } : { after: m[3] }, m[1], raw);

    // "timer 5 min", "set a timer for 10 minutes tea", "start a timer for 1h"
    m = /^(?:(?:set|start|make)\s+(?:a\s+|an\s+|the\s+)?)?timer(?:\s+for)?\s+(.+)$/.exec(input);
    if (m) {
      const parsed = splitDurationLabel(m[1]);
      return parsed ? this.start(parsed.ms, parsed.label, "timer") : null;
    }
    // "5 min timer", "set a 10 minute timer for pasta"
    m = /^(?:(?:set|start|make)\s+(?:a\s+|an\s+)?)?(.+?)\s+timer(?:\s+(?:for|to)\s+(.+))?$/.exec(input);
    if (m) {
      const ms = parseDuration(m[1].replace(/-/g, " "), true);
      return ms === null ? null : this.start(ms, m[2] ?? "", "timer");
    }
    return null;
  }

  cancelAll(): void {
    for (const t of this.list) clearTimeout(t.handle);
    this.list = [];
  }

  /** "⏱ 4:12 tea" for the quick menu. */
  statusLine(): string | null {
    const next = this.active()[0];
    if (!next) return null;
    const left = formatClock(next.endsAt - this.now());
    const more = this.list.length > 1 ? ` (+${this.list.length - 1})` : "";
    return `⏱ ${left}${next.label ? ` ${next.label}` : ""}${more}`;
  }

  private remind(when: { at: string } | { after: string }, label: string, raw: string): ToolReply | null {
    let ms: number | null;
    if ("at" in when) {
      const at = parseClockTime(when.at, new Date(this.now()));
      if (!at) return null;
      ms = at.getTime() - this.now();
    } else {
      ms = parseDuration(when.after, true);
    }
    if (ms === null) return null;
    // Keep the user's own capitalisation for the reminder text.
    const original = label ? (raw.match(new RegExp(escapeRegExp(label), "i"))?.[0] ?? label) : "";
    return this.start(ms, original.trim(), "reminder");
  }

  private start(ms: number, label: string, kind: Timer["kind"]): ToolReply {
    if (ms < 1000 || ms > MAX_MS) {
      return { title: "Timer", text: "I can set timers from a second up to 24 hours." };
    }
    if (this.list.length >= MAX_TIMERS) {
      return { title: "Timer", text: `That's ${MAX_TIMERS} timers already. Cancel some first ("cancel timers").` };
    }
    const id = this.nextId++;
    const endsAt = this.now() + ms;
    const handle = setTimeout(() => this.ring(id), ms);
    this.list.push({ id, label: label.slice(0, 120), kind, endsAt, durationMs: ms, handle });
    const when = formatTimeOfDay(new Date(endsAt));
    const what = label ? ` — ${label}` : "";
    if (kind === "reminder") {
      return {
        title: "Reminder set",
        text: `⏰ **${when}**${what}\n\nI'll remind you in ${formatDuration(ms)}.`,
        speech: `Got it. I'll remind you at ${when}.`,
        gesture: "happy",
      };
    }
    return {
      title: "Timer set",
      text: `⏱ **${formatDuration(ms)}**${what}\n\nI'll ping you at ${when}.`,
      speech: `Timer set for ${formatDuration(ms).replace("min", "minutes").replace(" h", " hours").replace(" s", " seconds")}.`,
      gesture: "happy",
    };
  }

  private ring(id: number): void {
    const t = this.list.find((x) => x.id === id);
    if (!t) return;
    this.list = this.list.filter((x) => x.id !== id);
    if (t.kind === "reminder") {
      this.host.alert({
        title: "⏰ Reminder",
        text: t.label ? `**${t.label}**` : "You asked me to remind you about something.",
        speech: t.label ? `Reminder: ${t.label}.` : "Here's your reminder.",
        gesture: "wave",
      });
      return;
    }
    this.host.alert({
      title: "⏰ Time's up!",
      text: t.label ? `**${t.label}** — your ${formatDuration(t.durationMs)} timer is done.` : `Your ${formatDuration(t.durationMs)} timer is done.`,
      speech: t.label ? `Time's up, choom. ${t.label}.` : "Time's up, choom.",
      gesture: "wave",
    });
  }

  private cancel(index: number | null): ToolReply {
    const active = this.active();
    if (!active.length) return { title: "Timers", text: "No timers running." };
    if (index === null) {
      const n = active.length;
      this.cancelAll();
      return { title: "Timers", text: n === 1 ? "Timer cancelled." : `Cancelled ${n} timers.` };
    }
    const target = active[index - 1];
    if (!target) return { title: "Timers", text: `There's no timer ${index}. Say "timers" to see them.` };
    const entry = this.list.find((t) => t.id === target.id);
    if (entry) clearTimeout(entry.handle);
    this.list = this.list.filter((t) => t.id !== target.id);
    return { title: "Timers", text: `Cancelled ${target.label ? `"${target.label}"` : `timer ${index}`}.` };
  }

  private status(): ToolReply {
    const active = this.active();
    if (!active.length) return { title: "Timers", text: 'No timers running. Try "timer 5 min".' };
    const lines = active.map((t, i) => {
      const left = formatClock(t.endsAt - this.now());
      const icon = t.kind === "reminder" ? "⏰" : "⏱";
      return `${i + 1}. ${icon} **${left}** left${t.label ? ` — ${t.label}` : ""}`;
    });
    return { title: "Timers", text: `${lines.join("\n")}\n\nSay "cancel timer 1" or "cancel timers".` };
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
