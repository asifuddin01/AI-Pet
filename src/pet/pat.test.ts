import { describe, expect, it } from "vitest";

import { PatDetector } from "./pat";

const feed = (d: PatDetector, xs: number[], stepMs = 70) => xs.map((x, i) => d.push({ x, y: 100 }, i * stepMs));

describe("PatDetector", () => {
  it("counts a few back-and-forth strokes as a pat", () => {
    expect(feed(new PatDetector(), [0, 20, 0, 20, 0])).toEqual([false, false, false, false, true]);
  });

  it("ignores the cursor just passing across her", () => {
    expect(feed(new PatDetector(), [0, 20, 40, 60, 80, 100]).some(Boolean)).toBe(false);
  });

  it("starts over after a pause", () => {
    expect(feed(new PatDetector(), [0, 20, 0, 20, 0], 500).some(Boolean)).toBe(false);
  });
});
