import type { PetState } from "./PetState";

export type Animation = "idle" | "walk" | "thinking" | "talking" | "listening" | "error" | "sleep";
export type Gesture = "blink" | "look-left" | "look-right" | "hop" | "wave" | "happy" | "snore";

/** Guide §40: state → base animation. OFF renders nothing. */
export const STATE_ANIMATION: Record<PetState, Animation | null> = {
  OFF: null,
  IDLE: "idle",
  WALKING: "walk",
  INTERACTING: "idle",
  THINKING: "thinking",
  SPEAKING: "talking",
  LISTENING: "listening",
  ERROR: "error",
  SLEEPING: "sleep",
};

export const GESTURE_MS: Record<Gesture, number> = {
  blink: 160,
  "look-left": 1400,
  "look-right": 1400,
  hop: 520,
  wave: 1300,
  happy: 1400,
  snore: 3900,
};

export interface AnimatedView {
  setAnimation(animation: Animation): void;
  playGesture(gesture: Gesture, durationMs: number): void;
  setPaused(paused: boolean): void;
}

interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * Drives the pet's look from its state. All motion is CSS (compositor-driven), and a
 * resting pet is completely still between occasional gestures, so idle CPU stays near
 * zero. The only JS work is one timer every few seconds; none at all while off.
 */
export class AnimationController {
  private timer: unknown = null;
  private state: PetState = "OFF";

  constructor(
    private readonly view: AnimatedView,
    private readonly random: () => number = Math.random,
    private readonly timers: Timers = defaultTimers,
  ) {}

  apply(state: PetState): void {
    this.state = state;
    const animation = STATE_ANIMATION[state];
    this.clear();
    if (!animation) {
      this.view.setPaused(true);
      return;
    }
    this.view.setPaused(false);
    this.view.setAnimation(animation);
    if (state === "IDLE" || state === "INTERACTING" || state === "WALKING" || state === "SLEEPING") {
      this.scheduleGesture();
    }
  }

  gesture(gesture: Gesture): void {
    this.view.playGesture(gesture, GESTURE_MS[gesture]);
  }

  stop(): void {
    this.clear();
    this.view.setPaused(true);
  }

  /** Picks the next small idle behaviour (mostly blinks, sometimes more). */
  nextGesture(): Gesture {
    const r = this.random();
    if (this.state === "SLEEPING") return "snore";
    if (this.state === "WALKING") return "blink";
    if (r < 0.55) return "blink";
    if (r < 0.7) return "look-left";
    if (r < 0.85) return "look-right";
    if (r < 0.95 || this.state !== "IDLE") return "hop";
    return "wave";
  }

  private scheduleGesture(): void {
    const delay = 4000 + this.random() * 6000;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.gesture(this.nextGesture());
      this.scheduleGesture();
    }, delay);
  }

  private clear(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
