import { describe, expect, it } from "vitest";

import { findOutfit, parsePetCommand } from "./petCommands";

describe("pet commands", () => {
  it("changes outfits by name, alias or just 'something else'", () => {
    expect(parsePetCommand("wear the saree")).toEqual({ kind: "outfit", id: "saree" });
    expect(parsePetCommand("Lucy, can you put on your office outfit?")).toEqual({ kind: "outfit", id: "office" });
    expect(parsePetCommand("switch to bikini")).toEqual({ kind: "outfit", id: "beach" });
    expect(parsePetCommand("wear the sweater dress")).toEqual({ kind: "outfit", id: "sweater" });
    expect(parsePetCommand("put on the white nun outfit")).toEqual({ kind: "outfit", id: "sisterwhite" });
    expect(parsePetCommand("change your outfit")).toEqual({ kind: "outfit", id: null });
    expect(parsePetCommand("surprise me")).toEqual({ kind: "outfit", id: null });
    expect(parsePetCommand("wear something else")).toEqual({ kind: "outfit", id: null });
    expect(parsePetCommand("choose your own outfit")).toEqual({ kind: "outfit-auto" });
    expect(parsePetCommand("what are you wearing?")).toEqual({ kind: "outfit-status" });
    expect(findOutfit("your usual")).toBe("edgerunner");
    expect(findOutfit("sharee")).toBe("saree");
  });

  it("moves, stays, floats and comes over", () => {
    expect(parsePetCommand("stop walking")).toEqual({ kind: "roam", on: false });
    expect(parsePetCommand("stay still")).toEqual({ kind: "roam", on: false });
    expect(parsePetCommand("float around")).toEqual({ kind: "roam", on: true, area: "float" });
    expect(parsePetCommand("hover")).toEqual({ kind: "roam", on: true, area: "float" });
    expect(parsePetCommand("walk around")).toEqual({ kind: "roam", on: true });
    expect(parsePetCommand("walk along the bottom")).toEqual({ kind: "roam", on: true, area: "bottom" });
    expect(parsePetCommand("come here")).toEqual({ kind: "come" });
  });

  it("sleeps, wakes, hushes and hides", () => {
    expect(parsePetCommand("go to sleep")).toEqual({ kind: "sleep" });
    expect(parsePetCommand("good night")).toEqual({ kind: "sleep" });
    expect(parsePetCommand("wake up")).toEqual({ kind: "wake" });
    expect(parsePetCommand("be quiet")).toEqual({ kind: "mute", on: true });
    expect(parsePetCommand("talk to me again")).toEqual({ kind: "mute", on: false });
    expect(parsePetCommand("stop talking")).toEqual({ kind: "shush" });
    expect(parsePetCommand("go away")).toEqual({ kind: "hide" });
    expect(parsePetCommand("bye")).toEqual({ kind: "bye" });
    expect(parsePetCommand("open settings")).toEqual({ kind: "settings" });
    expect(parsePetCommand("translate my clipboard")).toEqual({ kind: "translate-clipboard" });
  });

  it("does tricks and explains itself", () => {
    expect(parsePetCommand("wave at me")).toEqual({ kind: "gesture", gesture: "wave" });
    expect(parsePetCommand("dance for me")).toEqual({ kind: "gesture", gesture: "dance" });
    expect(parsePetCommand("What can you do?")).toEqual({ kind: "help" });
    expect(parsePetCommand("what are you doing?")).toEqual({ kind: "status" });
  });

  it("leaves real questions for the AI", () => {
    for (const q of [
      "how are you?",
      "put on some music",
      "what should I wear to a wedding",
      "explain how sleep works",
      "can you stop the war",
      "tell me about the moon",
      "help me write an email to my boss about the delay",
    ]) {
      expect(parsePetCommand(q), q).toBeNull();
    }
  });
});
