/**
 * Pure geometry for placing the pet window. Coordinates are logical points with a
 * top-left origin (same as the native layer and CSS pixels).
 */
import type { Point, Rect, ScreenInfo } from "../types";

/** Pet box edge at size 1.0 (the compact window is exactly this square). */
export const PET_BASE = 120;
export const BUBBLE_WIDTH = 300;
export const BUBBLE_MIN_HEIGHT = 72;
export const BUBBLE_MAX_HEIGHT = 380;
/** Space around the bubble inside the window, for its shadow. */
export const BUBBLE_PAD = 12;
/** Room for the bubble tail between the bubble and the pet's antenna. */
export const BUBBLE_GAP = 10;
export const EDGE_MARGIN = 8;
const CURSOR_OFFSET_X = 18;
const CURSOR_OFFSET_Y = 14;

export type BubbleSide = "above" | "below";

export function petBoxSize(scale: number): number {
  return Math.round(PET_BASE * scale);
}

/** The pet's body inside its box (clickable when idle; the rest is click-through). */
export function petHitRect(size: number): Rect {
  return { x: size * 0.16, y: size * 0.04, width: size * 0.68, height: size * 0.9 };
}

export const right = (r: Rect) => r.x + r.width;
export const bottom = (r: Rect) => r.y + r.height;

export function clamp(v: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(v, min), max);
}

function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x < right(r) && p.y >= r.y && p.y < bottom(r);
}

function distanceToRect(r: Rect, p: Point): number {
  const dx = Math.max(r.x - p.x, 0, p.x - right(r));
  const dy = Math.max(r.y - p.y, 0, p.y - bottom(r));
  return Math.hypot(dx, dy);
}

/** Screen containing the point, else the nearest one, else the primary. */
export function screenForPoint(p: Point, screens: ScreenInfo[]): ScreenInfo | undefined {
  const inside = screens.find((s) => contains(s.frame, p));
  if (inside) return inside;
  let best: ScreenInfo | undefined;
  let bestD = Infinity;
  for (const s of screens) {
    const d = distanceToRect(s.frame, p);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best ?? screens.find((s) => s.isPrimary);
}

export function primaryScreen(screens: ScreenInfo[]): ScreenInfo | undefined {
  return screens.find((s) => s.isPrimary) ?? screens[0];
}

/** Keep the whole pet inside the visible area (not under the menu bar, notch or Dock). */
export function clampPet(p: Point, size: number, visible: Rect): Point {
  return {
    x: clamp(p.x, visible.x + EDGE_MARGIN, right(visible) - size - EDGE_MARGIN),
    y: clamp(p.y, visible.y + EDGE_MARGIN, bottom(visible) - size - EDGE_MARGIN),
  };
}

/** First-launch spot: bottom-right corner of the visible area, above the Dock. */
export function defaultPetPosition(screen: ScreenInfo, size: number): Point {
  const v = screen.visibleFrame;
  return clampPet({ x: right(v) - size - 80, y: bottom(v) - size }, size, v);
}

export function petCenter(p: Point, size: number): Point {
  return { x: p.x + size / 2, y: p.y + size / 2 };
}

/**
 * Guide §25: appear slightly beside/above the cursor without covering the selection.
 * When there's no room above for the pet *and* its bubble, go below the cursor.
 */
export function placeNearCursor(
  cursor: Point,
  size: number,
  visible: Rect,
  bubbleHeight: number,
): { pet: Point; side: BubbleSide } {
  let x = cursor.x + CURSOR_OFFSET_X;
  if (x + size > right(visible) - EDGE_MARGIN) x = cursor.x - size - CURSOR_OFFSET_X;

  const neededAbove = size + CURSOR_OFFSET_Y + bubbleHeight + BUBBLE_PAD;
  const roomAbove = cursor.y - visible.y;
  if (roomAbove >= neededAbove) {
    const pet = clampPet({ x, y: cursor.y - size - CURSOR_OFFSET_Y }, size, visible);
    return { pet, side: "above" };
  }
  const pet = clampPet({ x, y: cursor.y + CURSOR_OFFSET_Y + 6 }, size, visible);
  return { pet, side: "below" };
}

export interface ExpandedLayout {
  /** Window frame on screen. */
  frame: Rect;
  /** Pet box inside the window. */
  pet: Point;
  /** Bubble box inside the window. */
  bubble: Rect;
  side: BubbleSide;
  /** Horizontal position of the bubble's tail, relative to the bubble. */
  tailX: number;
  /** Most the bubble may grow before it scrolls. */
  maxBubbleHeight: number;
}

/**
 * Window frame for "pet + speech bubble", keeping the pet exactly where it is on
 * screen. The bubble goes above the pet when there's room (preferred), else below.
 */
export function expandedLayout(
  pet: Point,
  size: number,
  bubbleHeight: number,
  visible: Rect,
  prefer: BubbleSide = "above",
): ExpandedLayout {
  const bubbleW = Math.min(BUBBLE_WIDTH, visible.width - 2 * BUBBLE_PAD);
  const width = Math.max(bubbleW + 2 * BUBBLE_PAD, size);
  const roomAbove = pet.y - visible.y - BUBBLE_GAP - BUBBLE_PAD;
  const roomBelow = bottom(visible) - (pet.y + size) - BUBBLE_GAP - BUBBLE_PAD;
  const fitsAbove = roomAbove >= Math.min(bubbleHeight, BUBBLE_MAX_HEIGHT);
  const fitsBelow = roomBelow >= Math.min(bubbleHeight, BUBBLE_MAX_HEIGHT);
  let side: BubbleSide;
  if (prefer === "above") side = fitsAbove || (!fitsBelow && roomAbove >= roomBelow) ? "above" : "below";
  else side = fitsBelow || (!fitsAbove && roomBelow >= roomAbove) ? "below" : "above";

  const room = side === "above" ? roomAbove : roomBelow;
  const maxBubbleHeight = Math.max(BUBBLE_MIN_HEIGHT, Math.min(BUBBLE_MAX_HEIGHT, room));
  const h = clamp(bubbleHeight, BUBBLE_MIN_HEIGHT, maxBubbleHeight);

  const petCenterX = pet.x + size / 2;
  const x = clamp(petCenterX - width / 2, visible.x, right(visible) - width);
  const height = BUBBLE_PAD + h + BUBBLE_GAP + size;
  const y = side === "above" ? pet.y - (BUBBLE_PAD + h + BUBBLE_GAP) : pet.y;

  const petInWindow = { x: pet.x - x, y: side === "above" ? height - size : 0 };
  const bubble: Rect = {
    x: BUBBLE_PAD,
    y: side === "above" ? BUBBLE_PAD : size + BUBBLE_GAP,
    width: bubbleW,
    height: h,
  };
  const tailX = clamp(petCenterX - x - bubble.x, 28, bubbleW - 28);
  return { frame: { x, y, width, height }, pet: petInWindow, bubble, side, tailX, maxBubbleHeight };
}

export function compactFrame(pet: Point, size: number): Rect {
  return { x: pet.x, y: pet.y, width: size, height: size };
}
