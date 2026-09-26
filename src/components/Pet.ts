import type { Animation, Gesture } from "../pet/AnimationController";
import type { Mood, Outfit } from "../pet/Wardrobe";
import type { CharacterView } from "./CharacterView";
import { renderDefs, renderParts, type PetParts } from "./lucyArt";

/** Layers back-to-front. Each is its own element so CSS can move it on the compositor. */
const MARKUP = `
  <div class="pet__stage">
    <svg class="pet__defs" width="0" height="0" aria-hidden="true" focusable="false"></svg>
    <div class="pet__shadow"></div>
    <div class="pet__rig">
      <div class="pet__part pet__jacket-back" data-part="jacketBack"></div>
      <div class="pet__part pet__hair-back" data-part="hairBack"></div>
      <div class="pet__part pet__leg pet__leg--l" data-part="legL"></div>
      <div class="pet__part pet__leg pet__leg--r" data-part="legR"></div>
      <div class="pet__part pet__body" data-part="body"></div>
      <div class="pet__part pet__arm pet__arm--l" data-part="armL"></div>
      <div class="pet__part pet__arm pet__arm--r" data-part="armR"></div>
      <div class="pet__part pet__head">
        <div class="pet__part" data-part="face"></div>
        <div class="pet__part pet__eyes">
          <div class="pet__part pet__eye pet__eye--l" data-part="eyeL"></div>
          <div class="pet__part pet__eye pet__eye--r" data-part="eyeR"></div>
        </div>
        <div class="pet__part pet__mouth" data-part="mouth"></div>
        <div class="pet__part" data-part="hairFront"></div>
      </div>
      <div class="pet__fx pet__fx--dots"><span></span><span></span><span></span></div>
      <div class="pet__fx pet__fx--zzz"><span>z</span><span>z</span></div>
      <div class="pet__fx pet__fx--waves"><span></span><span></span></div>
      <div class="pet__fx pet__fx--sweat"></div>
    </div>
    <div class="pet__fx pet__fx--sparkles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
  </div>`;

/** Outfit changes swap the art halfway through the "change" gesture. */
const CHANGE_MS = 900;
const CHANGE_SWAP_MS = 430;

/**
 * The pet character: a Lucy-inspired figure (see `lucyArt.ts`). Controllers only use
 * this class's interface, so the artwork can be replaced without touching them.
 */
export class Pet implements CharacterView {
  readonly el: HTMLDivElement;
  private readonly parts = new Map<keyof PetParts, HTMLElement>();
  private readonly defs: SVGSVGElement;
  private gestureTimers = new Map<Gesture, ReturnType<typeof setTimeout>>();
  private outfit: Outfit;

  constructor(parent: HTMLElement, outfit: Outfit) {
    this.el = document.createElement("div");
    this.el.className = "pet";
    this.el.dataset.anim = "idle";
    this.el.dataset.facing = "right";
    this.el.setAttribute("role", "img");
    this.el.setAttribute("aria-label", "Lucy, your desktop pet");
    this.el.innerHTML = MARKUP;
    this.defs = this.el.querySelector(".pet__defs")!;
    for (const node of this.el.querySelectorAll<HTMLElement>("[data-part]")) {
      this.parts.set(node.dataset.part as keyof PetParts, node);
    }
    parent.append(this.el);
    this.outfit = outfit;
    this.render(outfit);
  }

  get currentOutfit(): Outfit {
    return this.outfit;
  }

  /** Change clothes instantly (startup, settings). */
  setOutfit(outfit: Outfit): void {
    this.outfit = outfit;
    this.render(outfit);
  }

  /** Change clothes with the glitch-sparkle transition. */
  changeOutfit(outfit: Outfit): Promise<void> {
    this.playGesture("change", CHANGE_MS);
    setTimeout(() => this.setOutfit(outfit), CHANGE_SWAP_MS);
    return new Promise((resolve) => setTimeout(resolve, CHANGE_MS));
  }

  setAnimation(animation: Animation): void {
    this.el.dataset.anim = animation;
  }

  setFacing(direction: "left" | "right"): void {
    this.el.dataset.facing = direction;
  }

  playGesture(gesture: Gesture, durationMs: number): void {
    const cls = `g-${gesture}`;
    clearTimeout(this.gestureTimers.get(gesture));
    this.el.classList.remove(cls);
    void this.el.offsetWidth; // restart the CSS animation
    this.el.classList.add(cls);
    this.gestureTimers.set(
      gesture,
      setTimeout(() => this.el.classList.remove(cls), durationMs),
    );
  }

  setPaused(paused: boolean): void {
    this.el.classList.toggle("is-paused", paused);
  }

  /** Artwork scale (the art is drawn in a 120-unit box). */
  setScale(scale: number): void {
    this.el.style.setProperty("--pet-scale", String(scale));
  }

  setSpeed(speed: number): void {
    this.el.style.setProperty("--pet-speed", String(speed));
  }

  setMood(_mood: Mood): void {
    // Moods show through outfit changes and her words.
  }

  dispose(): void {
    for (const t of this.gestureTimers.values()) clearTimeout(t);
    this.el.remove();
  }

  /** Position of the pet box inside the window (compact: 0,0). */
  place(x: number, y: number, size: number): void {
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    this.el.style.width = `${size}px`;
    this.el.style.height = `${size}px`;
  }

  private render(outfit: Outfit): void {
    this.el.dataset.outfit = outfit.id;
    this.defs.innerHTML = renderDefs(outfit);
    const parts = renderParts(outfit);
    for (const [name, node] of this.parts) node.innerHTML = parts[name];
  }
}
