import { describe, expect, it } from "vitest";

import type { ScreenInfo } from "../types";
import {
  PET_BASE,
  BUBBLE_GAP,
  BUBBLE_PAD,
  clampPet,
  compactFrame,
  defaultPetPosition,
  EDGE_MARGIN,
  expandedLayout,
  petBoxSize,
  placeNearCursor,
  screenForPoint,
} from "./PetPosition";

const visible = { x: 0, y: 25, width: 1440, height: 800 }; // below menu bar, above Dock
const primary: ScreenInfo = { frame: { x: 0, y: 0, width: 1440, height: 900 }, visibleFrame: visible, scaleFactor: 2, isPrimary: true };
const external: ScreenInfo = {
  frame: { x: 1440, y: -200, width: 1920, height: 1080 },
  visibleFrame: { x: 1440, y: -200, width: 1920, height: 1080 },
  scaleFactor: 1,
  isPrimary: false,
};
const S = 120;

describe("placement near the cursor (§25)", () => {
  it("appears beside/above the cursor without covering it", () => {
    const { pet, side } = placeNearCursor({ x: 500, y: 600 }, S, visible, 250);
    expect(side).toBe("above");
    expect(pet.x).toBeGreaterThan(500);
    expect(pet.y + S).toBeLessThan(600);
  });

  it("flips to the left near the right edge", () => {
    const { pet } = placeNearCursor({ x: 1400, y: 600 }, S, visible, 250);
    expect(pet.x + S).toBeLessThanOrEqual(1400);
  });

  it("goes below the cursor near the top of the screen", () => {
    const { pet, side } = placeNearCursor({ x: 500, y: 80 }, S, visible, 250);
    expect(side).toBe("below");
    expect(pet.y).toBeGreaterThan(80);
  });

  it("never ends up under the menu bar or Dock", () => {
    for (const cursor of [{ x: 0, y: 0 }, { x: 1440, y: 900 }, { x: -50, y: 2000 }]) {
      const { pet } = placeNearCursor(cursor, S, visible, 250);
      expect(pet.y).toBeGreaterThanOrEqual(visible.y);
      expect(pet.y + S).toBeLessThanOrEqual(visible.y + visible.height);
      expect(pet.x).toBeGreaterThanOrEqual(visible.x);
      expect(pet.x + S).toBeLessThanOrEqual(visible.x + visible.width);
    }
  });
});

describe("expanded layout (pet + bubble)", () => {
  it("keeps the pet exactly where it was on screen", () => {
    const pet = { x: 600, y: 500 };
    const l = expandedLayout(pet, S, 200, visible);
    expect(l.side).toBe("above");
    expect(l.frame.x + l.pet.x).toBe(pet.x);
    expect(l.frame.y + l.pet.y).toBe(pet.y);
    expect(l.bubble.y + l.bubble.height + BUBBLE_GAP).toBe(l.pet.y);
    expect(l.frame.height).toBe(BUBBLE_PAD + 200 + BUBBLE_GAP + S);
  });

  it("puts the bubble below when there is no room above", () => {
    const pet = { x: 600, y: 40 };
    const l = expandedLayout(pet, S, 200, visible);
    expect(l.side).toBe("below");
    expect(l.pet.y).toBe(0);
    expect(l.bubble.y).toBe(S + BUBBLE_GAP);
    expect(l.frame.y + l.pet.y).toBe(pet.y);
  });

  it("stays inside the screen horizontally and points the tail at the pet", () => {
    const pet = { x: visible.width - S - EDGE_MARGIN, y: 500 };
    const l = expandedLayout(pet, S, 200, visible);
    expect(l.frame.x + l.frame.width).toBeLessThanOrEqual(visible.width);
    const petCenter = pet.x + S / 2 - l.frame.x - l.bubble.x;
    expect(Math.abs(l.tailX - petCenter)).toBeLessThanOrEqual(l.bubble.width / 2);
  });

  it("caps the bubble and lets it scroll", () => {
    const l = expandedLayout({ x: 600, y: 700 }, S, 5000, visible);
    expect(l.bubble.height).toBe(l.maxBubbleHeight);
    expect(l.maxBubbleHeight).toBeLessThanOrEqual(380);
  });
});

describe("screens", () => {
  it("finds the screen for a point, falling back to the nearest", () => {
    expect(screenForPoint({ x: 100, y: 100 }, [primary, external])).toBe(primary);
    expect(screenForPoint({ x: 2000, y: 0 }, [primary, external])).toBe(external);
    expect(screenForPoint({ x: 99999, y: 0 }, [primary, external])).toBe(external);
  });

  it("starts at the bottom-right above the Dock", () => {
    const p = defaultPetPosition(primary, S);
    expect(p.y + S).toBeLessThanOrEqual(visible.y + visible.height);
    expect(p.x).toBeGreaterThan(visible.width / 2);
  });

  it("clamps into the visible area and scales with size", () => {
    expect(clampPet({ x: -500, y: -500 }, S, visible)).toEqual({ x: EDGE_MARGIN, y: visible.y + EDGE_MARGIN });
    expect(petBoxSize(1.5)).toBe(Math.round(PET_BASE * 1.5));
    expect(compactFrame({ x: 1, y: 2 }, S)).toEqual({ x: 1, y: 2, width: S, height: S });
  });
});
