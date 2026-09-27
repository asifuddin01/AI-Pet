/**
 * "Hey Lucy" — deciding whether something said out loud was meant for her.
 * She answers to her name anywhere in a sentence ("Lucy", "hi Lucy", "what are you
 * doing, Lucy?") and to coming-home greetings ("I'm home", "I'm back, Lucy").
 */

/** Her name, plus the ways speech recognition tends to spell it. */
const NAME = String.raw`(?:lucy|lucie|luci|lucey|lucee|lusi|lucia|loosey|lucy's)`;
const NAME_RE = new RegExp(String.raw`\b${NAME}\b`, "i");
const HELLO = String.raw`(?:hey|hi|hello|hiya|yo|oi|ok|okay|psst|good (?:morning|afternoon|evening))`;
/** "hey lucy," / "lucy?" / ", lucy" with the punctuation around it. */
const CALL_RE = new RegExp(String.raw`(?:\b${HELLO}\s*,?\s*)?\b${NAME}\b\s*[,.!?]*`, "gi");
const HOME_RE = /\b(?:i(?:'m| am) (?:home|back)|i(?:'ve| have) (?:come|got|gotten) (?:home|back)|(?:honey|lucy),? i'm home)\b/i;
const GREETING_RE = new RegExp(String.raw`^${HELLO}?$`, "i");

export type WakeResult =
  | { kind: "none" }
  /** Just her name (maybe with "hey"/"good morning"): answer and listen. */
  | { kind: "called"; greeting: string }
  /** "I'm home": welcome, plus anything said after it. */
  | { kind: "home"; rest: string }
  /** A request with her name in it: the request without the name. */
  | { kind: "request"; text: string };

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s,.!?;:-]+|[\s,;:-]+$/g, "")
    .trim();
}

export function parseWake(utterance: string): WakeResult {
  const text = utterance.replace(/[’]/g, "'").trim();
  if (!text || text.length > 400) return { kind: "none" };
  const named = NAME_RE.test(text);
  const home = HOME_RE.test(text);
  if (!named && !home) return { kind: "none" };

  const greeting = (new RegExp(String.raw`\b${HELLO}\b`, "i").exec(text)?.[0] ?? "").toLowerCase();
  const rest = tidy(text.replace(CALL_RE, " "));
  if (home) {
    return { kind: "home", rest: tidy(rest.replace(HOME_RE, " ").replace(/^(?:and|so)\b/i, "")) };
  }
  if (!rest || GREETING_RE.test(rest)) return { kind: "called", greeting };
  return { kind: "request", text: rest };
}

const HOME_REPLIES = [
  "Welcome home, choom! 👋 How was your day?",
  "Hey, you're back! I kept the desktop warm for you. How'd it go?",
  "Welcome back! Missed having someone to talk to. How was it out there?",
];

const CALLED_REPLIES = ["Yeah? I'm listening.", "Right here. What's up?", "Mm-hm? Go ahead.", "You called, choom?"];

/** What she says when called. `pick` chooses among a few variants. */
export function wakeReply(result: Exclude<WakeResult, { kind: "none" | "request" }>, pick = Math.random): string {
  const choose = (list: string[]) => list[Math.min(list.length - 1, Math.floor(pick() * list.length))];
  if (result.kind === "home") return choose(HOME_REPLIES);
  if (/morning/.test(result.greeting)) return "Morning! ☀️ What's first today?";
  if (/afternoon/.test(result.greeting)) return "Afternoon, choom. What do you need?";
  if (/evening/.test(result.greeting)) return "Evening. What's on your mind?";
  return choose(CALLED_REPLIES);
}
