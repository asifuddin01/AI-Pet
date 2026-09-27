import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Point, ScreenInfo } from "../types";
import { chooseDestination, IDLE_MAX_MS, IDLE_MIN_MS, roamBounds, RoamingController, walkDurationMs } from "./RoamingController";

const visible = { x: 0, y: 25, width: 1440, height: 800 };
const primary: ScreenInfo = { frame: { x: 0, y: 0, width: 1440, height: 900 }, visibleFrame: visible, scaleFactor: 2, isPrimary: true };
const second: ScreenInfo = {
  frame: { x: 1440, y: 0, width: 1920, height: 1080 },
  visibleFrame: { x: 1440, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  isPrimary: false,
};
const S = 120;

function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("destination selection", () => {
  it("stays within the bottom band by default", () => {
    const b = roamBounds(visible, S, "bottom");
    for (let i = 0; i < 200; i++) {
      const d = chooseDestination({ x: 700, y: b.y }, S, [primary], { roamAllDisplays: false, roamArea: "bottom", animationSpeed: 1 }, Math.random)!;
      expect(d.x).toBeGreaterThanOrEqual(b.x);
      expect(d.x).toBeLessThanOrEqual(b.x + b.width);
      expect(d.y).toBeGreaterThanOrEqual(b.y);
      expect(d.y + S).toBeLessThanOrEqual(visible.y + visible.height);
    }
  });

  it("walks a short, calm distance and turns around at edges", () => {
    const b = roamBounds(visible, S, "anywhere");
    const nearRight = { x: b.x + b.width - 10, y: 300 };
    const d = chooseDestination(nearRight, S, [primary], { roamAllDisplays: false, roamArea: "anywhere", animationSpeed: 1 }, seq(0.5, 0.99, 0.5))!;
    expect(d.x).toBeLessThan(nearRight.x);
    expect(Math.abs(d.x - nearRight.x)).toBeLessThanOrEqual(420);
  });

  it("only visits other displays when allowed", () => {
    const opts = { roamAllDisplays: false, roamArea: "bottom" as const, animationSpeed: 1 };
    for (let i = 0; i < 100; i++) {
      const d = chooseDestination({ x: 700, y: 700 }, S, [primary, second], opts, Math.random)!;
      expect(d.x).toBeLessThan(1440);
    }
    const hop = chooseDestination({ x: 700, y: 700 }, S, [primary, second], { ...opts, roamAllDisplays: true }, seq(0.1, 0, 0.5, 0.5))!;
    expect(hop.x).toBeGreaterThanOrEqual(1440);
  });

  it("hover mode drifts anywhere on screen, in both directions, and stays inside", () => {
    const b = roamBounds(visible, S, "float");
    const opts = { roamAllDisplays: false, roamArea: "float" as const, animationSpeed: 1 };
    let pos: Point = { x: 700, y: 400 };
    let movedUp = false;
    let movedDown = false;
    for (let i = 0; i < 300; i++) {
      const d = chooseDestination(pos, S, [primary], opts, Math.random)!;
      expect(d.x).toBeGreaterThanOrEqual(b.x);
      expect(d.x).toBeLessThanOrEqual(b.x + b.width);
      expect(d.y).toBeGreaterThanOrEqual(b.y);
      expect(d.y).toBeLessThanOrEqual(b.y + b.height);
      if (d.y < pos.y - 50) movedUp = true;
      if (d.y > pos.y + 50) movedDown = true;
      pos = d;
    }
    expect(movedUp && movedDown).toBe(true);
    // Hovering is a bit quicker than walking.
    expect(walkDurationMs({ x: 0, y: 0 }, { x: 420, y: 0 }, 1, true)).toBeLessThan(walkDurationMs({ x: 0, y: 0 }, { x: 420, y: 0 }, 1));
  });

  it("walk duration follows distance and speed", () => {
    const a: Point = { x: 0, y: 0 };
    expect(walkDurationMs(a, { x: 420, y: 0 }, 1)).toBeCloseTo(10000, -2);
    expect(walkDurationMs(a, { x: 420, y: 0 }, 2)).toBeCloseTo(5000, -2);
    expect(walkDurationMs(a, { x: 1, y: 0 }, 1)).toBe(800);
  });
});

describe("RoamingController loop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    let position: Point = { x: 700, y: 700 };
    let resolveMove: ((arrived: boolean) => void) | null = null;
    const deps = {
      getScreens: vi.fn(async () => [primary]),
      getPosition: () => position,
      petSize: () => S,
      options: () => ({ roamAllDisplays: false, roamArea: "bottom" as const, animationSpeed: 1 }),
      moveTo: vi.fn((target: Point) => new Promise<boolean>((r) => (resolveMove = (ok) => {
        if (ok) position = target;
        r(ok);
      }))),
      stopMotion: vi.fn(() => resolveMove?.(false)),
      onWalkStart: vi.fn(),
      onWalkEnd: vi.fn(),
      random: () => 0.5,
    };
    return { deps, arrive: () => resolveMove?.(true) };
  }

  it("rests, walks, rests again (2–8 s idle)", async () => {
    const { deps, arrive } = setup();
    const roaming = new RoamingController(deps);
    roaming.start(1000);
    expect(deps.moveTo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.onWalkStart).toHaveBeenCalledOnce();
    expect(roaming.isWalking).toBe(true);
    arrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.onWalkEnd).toHaveBeenCalledOnce();
    expect(roaming.isWalking).toBe(false);
    // Next walk starts only after a rest within the configured range.
    await vi.advanceTimersByTimeAsync(IDLE_MIN_MS - 1);
    expect(deps.moveTo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(IDLE_MAX_MS);
    expect(deps.moveTo).toHaveBeenCalledTimes(2);
  });

  it("stop() pauses immediately, including a walk in progress", async () => {
    const { deps } = setup();
    const roaming = new RoamingController(deps);
    roaming.start(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(roaming.isWalking).toBe(true);
    roaming.stop();
    expect(deps.stopMotion).toHaveBeenCalledOnce();
    expect(roaming.isRunning).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.moveTo).toHaveBeenCalledOnce();
    expect(deps.onWalkEnd).not.toHaveBeenCalled();
  });

  it("does nothing while stopped and restarts cleanly", async () => {
    const { deps } = setup();
    const roaming = new RoamingController(deps);
    roaming.start(5000);
    roaming.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deps.getScreens).not.toHaveBeenCalled();
    roaming.start(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.moveTo).toHaveBeenCalledOnce();
  });
});
