import type { Point, Rect, RoamArea, ScreenInfo } from "../types";
import { bottom, clamp, EDGE_MARGIN, petCenter, right, screenForPoint } from "./PetPosition";

export interface RoamOptions {
  roamAllDisplays: boolean;
  roamArea: RoamArea;
  animationSpeed: number;
}

/** Gentle walking speed in points per second (scaled by animation speed). */
export const WALK_SPEED = 42;
/** Hovering is a little quicker and covers more ground. */
export const FLOAT_SPEED = 58;
const FLOAT_MIN_STEP = 140;
const FLOAT_MAX_STEP = 560;
/** Keep individual walks short and calm. */
const MIN_STEP = 70;
const MAX_STEP = 420;
/** Height of the strip along the bottom of the screen the pet wanders in. */
const BOTTOM_BAND = 36;

export const IDLE_MIN_MS = 2000;
export const IDLE_MAX_MS = 8000;

/** Area the pet's top-left corner may occupy on a screen. */
export function roamBounds(visible: Rect, size: number, area: RoamArea): Rect {
  const minX = visible.x + EDGE_MARGIN;
  const maxX = right(visible) - size - EDGE_MARGIN;
  const maxY = bottom(visible) - size;
  const minY = area === "bottom" ? maxY - BOTTOM_BAND : visible.y + EDGE_MARGIN;
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

/** Choose a nearby, safe destination (occasionally on another display if allowed). */
export function chooseDestination(
  current: Point,
  size: number,
  screens: ScreenInfo[],
  options: RoamOptions,
  random: () => number,
): Point | null {
  if (!screens.length) return null;
  let screen = screenForPoint(petCenter(current, size), screens) ?? screens[0];
  const others = screens.filter((s) => s !== screen);
  const hopScreens = options.roamAllDisplays && others.length > 0 && random() < 0.2;
  if (hopScreens) screen = others[Math.floor(random() * others.length)];

  const b = roamBounds(screen.visibleFrame, size, options.roamArea);
  if (hopScreens) {
    return { x: b.x + random() * b.width, y: b.y + random() * b.height };
  }
  const start0 = { x: clamp(current.x, b.x, right(b)), y: clamp(current.y, b.y, bottom(b)) };
  if (options.roamArea === "float") {
    // Drift in any direction, bouncing off the screen edges.
    const angle = random() * Math.PI * 2;
    const dist = FLOAT_MIN_STEP + random() * (FLOAT_MAX_STEP - FLOAT_MIN_STEP);
    let dx = Math.cos(angle) * dist;
    let dy = Math.sin(angle) * dist;
    if (start0.x + dx > right(b) || start0.x + dx < b.x) dx = -dx;
    if (start0.y + dy > bottom(b) || start0.y + dy < b.y) dy = -dy;
    return { x: clamp(start0.x + dx, b.x, right(b)), y: clamp(start0.y + dy, b.y, bottom(b)) };
  }

  const start = { x: clamp(current.x, b.x, right(b)), y: clamp(current.y, b.y, bottom(b)) };
  const step = MIN_STEP + random() * (MAX_STEP - MIN_STEP);
  let dir = random() < 0.5 ? -1 : 1;
  // Turn around rather than walking into an edge.
  if (start.x + dir * step > right(b) || start.x + dir * step < b.x) dir = -dir;
  const x = clamp(start.x + dir * step, b.x, right(b));
  const yJitter = options.roamArea === "bottom" ? b.height : Math.min(b.height, step * 0.6);
  const y = clamp(start.y + (random() - 0.5) * yJitter, b.y, bottom(b));
  return { x, y };
}

export function walkDurationMs(from: Point, to: Point, speed: number, floating = false): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const pace = (floating ? FLOAT_SPEED : WALK_SPEED) * Math.max(speed, 0.25);
  return clamp((distance / pace) * 1000, 800, 20000);
}

export interface RoamingDeps {
  getScreens(): Promise<ScreenInfo[]>;
  getPosition(): Point;
  petSize(): number;
  options(): RoamOptions;
  /** Resolves true on arrival, false if the move was cancelled. */
  moveTo(target: Point, durationMs: number): Promise<boolean>;
  stopMotion(): void;
  onWalkStart(direction: "left" | "right"): void;
  onWalkEnd(position: Point): void;
  random?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/**
 * Pick a destination → walk there (native, eased) → rest 2–8 s → repeat.
 * Pausing cancels both the pending rest and any walk in progress.
 */
export class RoamingController {
  private running = false;
  private timer: unknown = null;
  private walking = false;
  private generation = 0;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(private readonly deps: RoamingDeps) {
    this.random = deps.random ?? Math.random;
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isWalking(): boolean {
    return this.walking;
  }

  start(initialDelayMs = this.restMs()): void {
    if (this.running) return;
    this.running = true;
    this.schedule(initialDelayMs);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.walking) {
      this.walking = false;
      this.deps.stopMotion();
    }
  }

  restMs(): number {
    return IDLE_MIN_MS + this.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
  }

  private schedule(ms: number): void {
    const gen = this.generation;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.step(gen);
    }, ms);
  }

  private async step(gen: number): Promise<void> {
    if (!this.running || gen !== this.generation) return;
    const screens = await this.deps.getScreens();
    if (!this.running || gen !== this.generation) return;
    const from = this.deps.getPosition();
    const to = chooseDestination(from, this.deps.petSize(), screens, this.deps.options(), this.random);
    if (!to) {
      this.schedule(this.restMs());
      return;
    }
    this.walking = true;
    this.deps.onWalkStart(to.x < from.x ? "left" : "right");
    const opts = this.deps.options();
    const arrived = await this.deps.moveTo(to, walkDurationMs(from, to, opts.animationSpeed, opts.roamArea === "float"));
    if (gen !== this.generation) return;
    this.walking = false;
    this.deps.onWalkEnd(arrived ? to : this.deps.getPosition());
    if (this.running) this.schedule(this.restMs());
  }
}
