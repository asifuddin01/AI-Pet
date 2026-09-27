/**
 * Small offline tools ("plugins", guide §63/§64). Each one recognises its own kind of
 * message ("25*4", "10 km in miles", "timer 5 min", "note buy milk") and answers
 * instantly, with no AI and no network. Anything no tool claims goes to the AI as chat.
 */

export interface ToolReply {
  title: string;
  /** Shown in the bubble (light Markdown). */
  text: string;
  /** Spoken instead of `text` when that reads badly aloud ("12 × 7 = 84"). */
  speech?: string;
  gesture?: "happy" | "wave" | "hop" | "hair-touch";
}

/** What tools may ask of the pet when something happens later (a timer rings). */
export interface ToolHost {
  alert(reply: ToolReply): void;
  /** Pomodoro focus block started (true) or ended (false). */
  setFocus(on: boolean): void;
}

export interface LocalTool {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Answer `input` if it is meant for this tool; null otherwise. */
  handle(input: string): ToolReply | null | Promise<ToolReply | null>;
}

/** Bangla (and other) digits typed on a native keyboard count as numbers too. */
export function asciiDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Trim polite wrappers so "hey lucy, what's 2+2?" reads as "what's 2+2". */
export function normalizeInput(input: string): string {
  return asciiDigits(input)
    .trim()
    .replace(/^(?:hey|hi|ok|okay|yo)[,!\s]+/i, "")
    .replace(/^lucy[,:!\s]+/i, "")
    .replace(/^(?:please|pls|can you|could you)\s+/i, "")
    .replace(/[\s?.]+$/, "")
    .replace(/(?<![\d)])!+$/, "") // keep "5!" (factorial)
    .replace(/\s+please$/i, "")
    .trim();
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Object.is(n, -0)) n = 0;
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return n.toPrecision(6).replace(/\.?0+e/, "e");
  const rounded = Number(n.toPrecision(12));
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 10 });
}
