/** Pure helpers for speaking streamed text. */

const SENTENCE_END = /[.!?।。！？\n]/;

/**
 * Split a growing buffer into complete sentences plus the unfinished remainder,
 * so TTS can start after the first safe sentence boundary while text still streams.
 */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (!SENTENCE_END.test(ch)) continue;
    if (ch === ".") {
      const next = buffer[i + 1];
      if (next === undefined) break; // can't tell yet: "3." may become "3.14"
      if (!/\s/.test(next)) continue; // "3.14", "example.com"
    }
    const sentence = buffer.slice(start, i + 1).trim();
    if (sentence) sentences.push(sentence);
    start = i + 1;
  }
  return { sentences, rest: buffer.slice(start) };
}

/** Strip light Markdown so the voice doesn't read symbols aloud. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/\s+/g, " ")
    .trim();
}

/** Feeds streamed deltas and emits speakable chunks at sentence boundaries. */
export class SentenceStreamer {
  private buffer = "";

  constructor(private readonly emit: (sentence: string) => void) {}

  push(delta: string): void {
    this.buffer += delta;
    const { sentences, rest } = takeSentences(this.buffer);
    this.buffer = rest;
    for (const s of sentences) this.say(s);
  }

  flush(): void {
    const rest = this.buffer;
    this.buffer = "";
    this.say(rest);
  }

  reset(): void {
    this.buffer = "";
  }

  private say(text: string): void {
    const clean = cleanForSpeech(text);
    if (clean) this.emit(clean);
  }
}
