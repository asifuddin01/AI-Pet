import { describe, expect, it } from "vitest";

import { formatShortcut, shortcutFromEvent } from "./shortcut";

const key = (code: string, mods: Partial<Record<"altKey" | "shiftKey" | "ctrlKey" | "metaKey", boolean>> = {}) => ({
  code,
  altKey: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe("shortcuts", () => {
  it("formats the defaults the macOS way", () => {
    expect(formatShortcut("Alt+KeyP")).toBe("⌥P");
    expect(formatShortcut("Alt+Shift+KeyP")).toBe("⌥⇧P");
    expect(formatShortcut("Cmd+Ctrl+Space")).toBe("⌃⌘Space");
    expect(formatShortcut("Option+Digit1")).toBe("⌥1");
  });

  it("records physical keys (Option+P is not π)", () => {
    expect(shortcutFromEvent(key("KeyP", { altKey: true }))).toBe("Alt+KeyP");
    expect(shortcutFromEvent(key("KeyK", { metaKey: true, shiftKey: true }))).toBe("Shift+Cmd+KeyK");
  });

  it("ignores lone modifiers and unmodified keys", () => {
    expect(shortcutFromEvent(key("AltLeft", { altKey: true }))).toBeNull();
    expect(shortcutFromEvent(key("KeyP"))).toBeNull();
  });
});
