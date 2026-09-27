import { describe, expect, it, vi } from "vitest";

import { AnimationController, STATE_ANIMATION, type AnimatedView } from "./AnimationController";
import { PetStateMachine } from "./PetState";

describe("PetStateMachine", () => {
  it("follows the guide's main flow", () => {
    const fsm = new PetStateMachine();
    const seen: string[] = [];
    fsm.onChange((s) => seen.push(s));
    for (const s of ["IDLE", "INTERACTING", "THINKING", "SPEAKING", "IDLE"] as const) {
      expect(fsm.transition(s)).toBe(true);
    }
    expect(seen).toEqual(["IDLE", "INTERACTING", "THINKING", "SPEAKING", "IDLE"]);
  });

  it("rejects impossible transitions without changing state", () => {
    const fsm = new PetStateMachine();
    expect(fsm.transition("THINKING")).toBe(false);
    expect(fsm.state).toBe("OFF");
    fsm.transition("IDLE");
    fsm.transition("SLEEPING");
    expect(fsm.transition("SPEAKING")).toBe(false);
  });

  it("can always turn off, and never gets stuck in THINKING", () => {
    const fsm = new PetStateMachine();
    fsm.transition("IDLE");
    fsm.transition("INTERACTING");
    fsm.transition("THINKING");
    expect(fsm.can("ERROR")).toBe(true);
    expect(fsm.can("IDLE")).toBe(true);
    expect(fsm.can("INTERACTING")).toBe(true);
    expect(fsm.transition("OFF")).toBe(true);
  });
});

describe("AnimationController", () => {
  function view() {
    return {
      setAnimation: vi.fn(),
      playGesture: vi.fn(),
      setPaused: vi.fn(),
    } satisfies AnimatedView;
  }

  it("maps every state to its animation (§40)", () => {
    expect(STATE_ANIMATION).toMatchObject({
      IDLE: "idle",
      WALKING: "walk",
      THINKING: "thinking",
      SPEAKING: "talking",
      LISTENING: "listening",
      ERROR: "error",
      SLEEPING: "sleep",
      OFF: null,
    });
  });

  it("hovers instead of walking in float mode", () => {
    const v = view();
    const anim = new AnimationController(v, () => 0.5, { setTimeout: () => 1, clearTimeout: () => undefined });
    anim.apply("WALKING");
    expect(v.setAnimation).toHaveBeenLastCalledWith("walk");
    anim.setFloating(true);
    expect(v.setAnimation).toHaveBeenLastCalledWith("float");
    anim.apply("IDLE");
    expect(v.setAnimation).toHaveBeenLastCalledWith("idle");
    anim.apply("WALKING");
    expect(v.setAnimation).toHaveBeenLastCalledWith("float");
  });

  it("pauses everything and schedules nothing when off", () => {
    const v = view();
    const timers = { setTimeout: vi.fn(), clearTimeout: vi.fn() };
    new AnimationController(v, () => 0.5, timers).apply("OFF");
    expect(v.setPaused).toHaveBeenCalledWith(true);
    expect(timers.setTimeout).not.toHaveBeenCalled();
  });

  it("only schedules occasional idle gestures (4–10 s)", () => {
    const v = view();
    const timers = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() };
    const anim = new AnimationController(v, () => 0.5, timers);
    anim.apply("IDLE");
    expect(v.setAnimation).toHaveBeenCalledWith("idle");
    const delay = (timers.setTimeout.mock.calls[0] as unknown as [unknown, number])[1];
    expect(delay).toBeGreaterThanOrEqual(4000);
    expect(delay).toBeLessThanOrEqual(10000);
    anim.apply("THINKING");
    expect(timers.clearTimeout).toHaveBeenCalled();
    expect(timers.setTimeout).toHaveBeenCalledTimes(1); // no idle gestures while thinking
  });

  it("snores (occasionally) while asleep instead of looping an animation", () => {
    const timers = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() };
    const anim = new AnimationController(view(), () => 0.5, timers);
    anim.apply("SLEEPING");
    expect(timers.setTimeout).toHaveBeenCalledOnce();
    expect(anim.nextGesture()).toBe("snore");
  });

  it("mostly blinks", () => {
    const anim = new AnimationController(view(), () => 0.1);
    anim.apply("IDLE");
    expect(anim.nextGesture()).toBe("blink");
    anim.stop();
  });
});
