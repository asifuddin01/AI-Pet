import type { AnimatedView } from "../pet/AnimationController";
import type { Mood, Outfit } from "../pet/Wardrobe";

/**
 * What the pet controller needs from a character renderer. Three implementations:
 * the built-in vector Lucy (`Pet`), a 3D VRM model (`VrmPet`) and animated 2D images
 * (`SpritePet`).
 */
export interface CharacterView extends AnimatedView {
  readonly el: HTMLElement;
  readonly currentOutfit: Outfit;
  setOutfit(outfit: Outfit): void;
  changeOutfit(outfit: Outfit): Promise<void>;
  /** Screen-space direction she's heading in (dy > 0 is down the screen). */
  setFacing(dx: number, dy: number): void;
  /** Ratio of the pet box to the 120-unit art box (vector art only uses it). */
  setScale(scale: number): void;
  setSpeed(speed: number): void;
  setMood(mood: Mood): void;
  /** Position/size of the pet box inside the window. */
  place(x: number, y: number, size: number): void;
  dispose(): void;
}

export type CharacterKind = "vector" | "vrm" | "sprites";

/** Pet states that can have their own animated image in a sprite pack. */
export const SPRITE_STATES = [
  "idle",
  "walk",
  "talk",
  "think",
  "listen",
  "sleep",
  "error",
  "happy",
  "wave",
] as const;
export type SpriteState = (typeof SPRITE_STATES)[number];
