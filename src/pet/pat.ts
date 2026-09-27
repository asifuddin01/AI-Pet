import type { Point } from "../types";

/** Samples further apart than this start a new stroke. */
const GAP_MS = 400;
/** Direction changes that make it petting rather than passing by. */
const TURNS = 3;

/**
 * Turns cursor positions over the pet (no click) into pats: a few quick back-and-forth
 * strokes on either axis. Moving straight across her never counts.
 */
export class PatDetector {
  private last: Point | null = null;
  private at = 0;
  private dir = [0, 0];
  private turns = 0;

  /** Feed a cursor position; true when it completes a pat. */
  push(p: Point, now: number): boolean {
    if (!this.last || now - this.at > GAP_MS) {
      this.dir = [0, 0];
      this.turns = 0;
    } else {
      [p.x - this.last.x, p.y - this.last.y].forEach((d, i) => {
        if (Math.abs(d) < 3) return;
        const dir = Math.sign(d);
        if (this.dir[i] && dir !== this.dir[i]) this.turns++;
        this.dir[i] = dir;
      });
    }
    this.last = p;
    this.at = now;
    if (this.turns < TURNS) return false;
    this.turns = 0;
    return true;
  }
}
