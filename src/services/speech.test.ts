import { describe, expect, it } from "vitest";

import { cleanForSpeech, SentenceStreamer, takeSentences } from "./speech";

describe("takeSentences", () => {
  it("splits at safe boundaries and keeps the remainder", () => {
    expect(takeSentences("Hello there. How are")).toEqual({ sentences: ["Hello there."], rest: " How are" });
  });

  it("does not split numbers, domains, or a trailing period that may continue", () => {
    expect(takeSentences("Pi is 3.14 roughly")).toEqual({ sentences: [], rest: "Pi is 3.14 roughly" });
    expect(takeSentences("Visit example.com now")).toEqual({ sentences: [], rest: "Visit example.com now" });
    expect(takeSentences("It is 3.").sentences).toEqual([]);
  });

  it("understands Bangla and CJK sentence marks", () => {
    expect(takeSentences("আমি ভাত খাই। তুমি").sentences).toEqual(["আমি ভাত খাই।"]);
    expect(takeSentences("こんにちは。元気").sentences).toEqual(["こんにちは。"]);
  });
});

describe("cleanForSpeech", () => {
  it("removes markdown so symbols aren't read aloud", () => {
    expect(cleanForSpeech("- **Bold** point\n- `code` here")).toBe("Bold point code here");
    expect(cleanForSpeech("## Title\nSee [docs](https://x.y) at https://a.b/c")).toBe("Title See docs at link");
  });
});

describe("SentenceStreamer", () => {
  it("emits sentences as streamed text arrives, then flushes the rest", () => {
    const out: string[] = [];
    const s = new SentenceStreamer((x) => out.push(x));
    for (const chunk of ["Hel", "lo! This is ", "**great**. And", " more"]) s.push(chunk);
    expect(out).toEqual(["Hello!", "This is great."]);
    s.flush();
    expect(out).toEqual(["Hello!", "This is great.", "And more"]);
  });

  it("reset drops unspoken text", () => {
    const out: string[] = [];
    const s = new SentenceStreamer((x) => out.push(x));
    s.push("partial answer");
    s.reset();
    s.flush();
    expect(out).toEqual([]);
  });
});
