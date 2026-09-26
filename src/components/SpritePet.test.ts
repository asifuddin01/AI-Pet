import { describe, expect, it } from "vitest";

import { SPRITE_STATES } from "./CharacterView";
import { ANIMATION_SPRITE, resolveSprite } from "./SpritePet";

describe("sprite selection", () => {
  it("picks the first state that has a file", () => {
    expect(resolveSprite(["listen", "think", "idle"], new Set(["idle", "think"]))).toBe("think");
    expect(resolveSprite(["talk", "idle"], new Set(["idle"]))).toBe("idle");
    expect(resolveSprite(["wave", "happy"], new Set(["idle"]))).toBeNull();
  });

  it("falls back to idle for every animation", () => {
    for (const [animation, states] of Object.entries(ANIMATION_SPRITE)) {
      expect(states.at(-1), animation).toBe("idle");
      for (const s of states) expect(SPRITE_STATES).toContain(s);
    }
  });

  it("shows idle when only idle is imported", () => {
    const onlyIdle = new Set(["idle"]);
    for (const states of Object.values(ANIMATION_SPRITE)) {
      expect(resolveSprite(states, onlyIdle)).toBe("idle");
    }
  });
});
