/** Parsing and formatting for durations and times of day ("1h 30m", "half an hour", "5:30 pm"). */

const UNIT_MS: [RegExp, number][] = [
  [/^(?:s|sec|secs|second|seconds)$/, 1000],
  [/^(?:m|min|mins|minute|minutes)$/, 60_000],
  [/^(?:h|hr|hrs|hour|hours)$/, 3_600_000],
];

function unitMs(unit: string): number | undefined {
  return UNIT_MS.find(([re]) => re.test(unit))?.[1];
}

/**
 * Duration in ms, or null. Accepts "5 min", "1h30m", "1 hour 30 minutes", "1.5 hours",
 * "90s", "half an hour", "an hour", "a minute". A bare number counts as minutes
 * when `bareMinutes` is set ("timer 5").
 */
export function parseDuration(text: string, bareMinutes = false): number | null {
  const t = text
    .toLowerCase()
    .trim()
    .replace(/\band\b/g, " ")
    .replace(/\bhalf an? hour\b/g, "30 min")
    .replace(/\ban? (hour|minute|second)\b/g, "1 $1")
    .replace(/\ba quarter of an hour\b|\bquarter hour\b/g, "15 min")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  if (bareMinutes && /^\d+(?:\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60_000);
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let total = 0;
  let consumed = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const ms = unitMs(m[2]);
    if (ms === undefined) return null;
    total += parseFloat(m[1]) * ms;
    consumed += m[0];
  }
  if (!total || consumed.replace(/\s/g, "") !== t.replace(/\s/g, "")) return null;
  return Math.round(total);
}

/** Next occurrence of a clock time ("17:30", "5pm", "5:30 pm", "noon") after `now`. */
export function parseClockTime(text: string, now: Date): Date | null {
  const t = text.toLowerCase().trim().replace(/\./g, "");
  let hours: number;
  let minutes = 0;
  if (t === "noon" || t === "midday") hours = 12;
  else if (t === "midnight") hours = 0;
  else {
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);
    if (!m) return null;
    hours = parseInt(m[1], 10);
    minutes = m[2] ? parseInt(m[2], 10) : 0;
    if (!m[2] && !m[3]) return null; // "at 5" is too ambiguous
    if (minutes > 59) return null;
    if (m[3]) {
      if (hours < 1 || hours > 12) return null;
      hours = (hours % 12) + (m[3] === "pm" ? 12 : 0);
    } else if (hours > 23) {
      return null;
    }
  }
  const at = new Date(now);
  at.setHours(hours, minutes, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/** "25 min", "1 h 5 min", "45 s". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (s && !h) parts.push(`${s} s`);
  return parts.join(" ") || "0 s";
}

/** "4:05" or "1:02:03" for countdowns. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function formatTimeOfDay(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
