import { describe, expect, it } from "vitest";

import { parseWake, wakeReply } from "./wake";

describe("calling Lucy", () => {
  it("answers to her name however she's called", () => {
    for (const call of ["Lucy", "Hey Lucy", "hi lucy!", "Hello, Lucy.", "Lucy?", "ok Lucie", "psst lucy"]) {
      expect(parseWake(call).kind, call).toBe("called");
    }
    expect(parseWake("good morning Lucy")).toEqual({ kind: "called", greeting: "good morning" });
  });

  it("hears requests with her name anywhere in them", () => {
    expect(parseWake("what are you doing Lucy")).toEqual({ kind: "request", text: "what are you doing" });
    expect(parseWake("Hey Lucy, set a timer for 10 minutes")).toEqual({ kind: "request", text: "set a timer for 10 minutes" });
    expect(parseWake("Lucy wear the saree")).toEqual({ kind: "request", text: "wear the saree" });
    expect(parseWake("can you float around, Lucy?")).toEqual({ kind: "request", text: "can you float around" });
    expect(parseWake("hi Lucy how are you")).toEqual({ kind: "request", text: "how are you" });
  });

  it("welcomes you home, with or without her name", () => {
    expect(parseWake("I'm home")).toEqual({ kind: "home", rest: "" });
    expect(parseWake("I am home Lucy")).toEqual({ kind: "home", rest: "" });
    expect(parseWake("Lucy I'm back")).toEqual({ kind: "home", rest: "" });
    expect(parseWake("I'm home, what's the time")).toEqual({ kind: "home", rest: "what's the time" });
  });

  it("ignores everything else", () => {
    for (const other of ["", "turn the music down", "I'm going to the shop", "the lucid dream was weird", "home is where the heart is"]) {
      expect(parseWake(other).kind, other).toBe("none");
    }
  });

  it("replies in character", () => {
    expect(wakeReply({ kind: "home", rest: "" }, () => 0)).toMatch(/welcome home/i);
    expect(wakeReply({ kind: "called", greeting: "good morning" })).toMatch(/morning/i);
    expect(wakeReply({ kind: "called", greeting: "" }, () => 0)).toBe("Yeah? I'm listening.");
  });
});
