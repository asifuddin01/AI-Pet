import type { AnimatedView, Animation, Gesture } from "../pet/AnimationController";

/**
 * The pet character: an original little robot built from plain elements and CSS
 * (see `styles/pet.css`). Every animation is a CSS transform/opacity animation, so
 * WebKit hands it to the compositor instead of repainting from JavaScript.
 *
 * To swap in sprite or Lottie art later, keep this class's interface and replace
 * the markup — the controllers only talk to `setAnimation` / `playGesture`.
 */
export class Pet implements AnimatedView {
  readonly el: HTMLDivElement;
  private gestureTimers = new Map<Gesture, ReturnType<typeof setTimeout>>();

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "pet";
    this.el.dataset.anim = "idle";
    this.el.dataset.facing = "right";
    this.el.setAttribute("role", "img");
    this.el.setAttribute("aria-label", "AI Pet");
    this.el.innerHTML = `
      <div class="pet__stage">
      <div class="pet__shadow"></div>
      <div class="pet__rig">
        <div class="pet__leg pet__leg--l"></div>
        <div class="pet__leg pet__leg--r"></div>
        <div class="pet__arm pet__arm--l"></div>
        <div class="pet__arm pet__arm--r"></div>
        <div class="pet__antenna"><div class="pet__antenna-tip"></div></div>
        <div class="pet__ear pet__ear--l"></div>
        <div class="pet__ear pet__ear--r"></div>
        <div class="pet__body">
          <div class="pet__screen">
            <div class="pet__eyes">
              <div class="pet__eye pet__eye--l"></div>
              <div class="pet__eye pet__eye--r"></div>
            </div>
            <div class="pet__mouth"></div>
            <div class="pet__cheek pet__cheek--l"></div>
            <div class="pet__cheek pet__cheek--r"></div>
          </div>
          <div class="pet__gloss"></div>
        </div>
        <div class="pet__fx pet__fx--dots"><span></span><span></span><span></span></div>
        <div class="pet__fx pet__fx--zzz"><span>z</span><span>z</span></div>
        <div class="pet__fx pet__fx--waves"><span></span><span></span></div>
      </div>
      </div>`;
    parent.append(this.el);
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

  setScale(scale: number): void {
    this.el.style.setProperty("--pet-scale", String(scale));
  }

  setSpeed(speed: number): void {
    this.el.style.setProperty("--pet-speed", String(speed));
  }

  /** Position of the pet box inside the window (compact: 0,0). */
  place(x: number, y: number, size: number): void {
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    this.el.style.width = `${size}px`;
    this.el.style.height = `${size}px`;
  }
}
