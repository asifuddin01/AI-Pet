import type { Animation, Gesture } from "../pet/AnimationController";
import type { Mood, Outfit } from "../pet/Wardrobe";
import type { CharacterView, SpriteState } from "./CharacterView";

/** Loads a stored sprite/clip by file name. */
export type SpriteSource = (name: string) => Promise<ArrayBuffer>;

const MIME: Record<string, string> = {
  webp: "image/webp",
  gif: "image/gif",
  png: "image/png",
  apng: "image/apng",
  webm: "video/webm",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
};

/** Which image to show for each pet animation, falling back to idle. */
export const ANIMATION_SPRITE: Record<Animation, SpriteState[]> = {
  idle: ["idle"],
  walk: ["walk", "idle"],
  float: ["idle"],
  thinking: ["think", "idle"],
  talking: ["talk", "idle"],
  listening: ["listen", "think", "idle"],
  error: ["error", "idle"],
  sleep: ["sleep", "idle"],
};

const GESTURE_SPRITE: Partial<Record<Gesture, SpriteState[]>> = {
  happy: ["happy"],
  wave: ["wave", "happy"],
};

/** Pick the first state that has a file (pure; tested). */
export function resolveSprite(wanted: SpriteState[], available: Set<string>): SpriteState | null {
  return wanted.find((s) => available.has(s)) ?? null;
}

const CHANGE_MS = 900;

/**
 * A character made of real animated art: animated WebP/GIF/APNG images or short clips
 * (WebM/MP4/MOV — transparent ones float right on the desktop), one per pet state.
 * `scripts/make_sprite.py` turns an anime clip into a transparent animated WebP.
 */
export class SpritePet implements CharacterView {
  readonly el: HTMLDivElement;
  private outfit: Outfit;
  private urls = new Map<SpriteState, { url: string; video: boolean }>();
  private media: HTMLImageElement | HTMLVideoElement | null = null;
  private shown: SpriteState | null = null;
  private anim: Animation = "idle";
  private gesture: { state: SpriteState; until: number } | null = null;
  private gestureTimer: ReturnType<typeof setTimeout> | undefined;
  private paused = true;

  constructor(
    parent: HTMLElement,
    outfit: Outfit,
    private readonly files: Record<string, string>,
    private readonly source: SpriteSource,
    private readonly onLoadError: (message: string) => void,
  ) {
    this.outfit = outfit;
    this.el = document.createElement("div");
    this.el.className = "pet pet--sprites is-loading";
    this.el.setAttribute("role", "img");
    this.el.setAttribute("aria-label", "Lucy, your desktop pet");
    this.el.insertAdjacentHTML(
      "beforeend",
      `<div class="vrm-fx vrm-fx--sparkles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
       <div class="vrm-fx vrm-fx--loading"><span></span><span></span><span></span></div>`,
    );
    parent.append(this.el);
    void this.load();
  }

  get currentOutfit(): Outfit {
    return this.outfit;
  }

  private async load(): Promise<void> {
    if (!this.files.idle) {
      this.el.classList.remove("is-loading");
      this.onLoadError("Add at least an idle image or clip in Settings → Character.");
      return;
    }
    await Promise.all(
      Object.entries(this.files).map(async ([state, name]) => {
        try {
          const ext = name.split(".").pop()?.toLowerCase() ?? "";
          const type = MIME[ext] ?? "application/octet-stream";
          const blob = new Blob([await this.source(name)], { type });
          this.urls.set(state as SpriteState, { url: URL.createObjectURL(blob), video: type.startsWith("video/") });
        } catch {
          // A missing optional state just falls back to idle.
        }
      }),
    );
    this.el.classList.remove("is-loading");
    if (!this.urls.has("idle")) {
      this.onLoadError("The idle image couldn't be loaded. Import it again in Settings.");
      return;
    }
    this.refresh();
  }

  private refresh(): void {
    const available = new Set(this.urls.keys());
    const wanted = this.gesture && Date.now() < this.gesture.until ? [this.gesture.state] : ANIMATION_SPRITE[this.anim];
    const state = resolveSprite(wanted, available) ?? resolveSprite(["idle"], available);
    if (!state || state === this.shown) return;
    const entry = this.urls.get(state)!;
    let media: HTMLImageElement | HTMLVideoElement;
    if (entry.video) {
      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = !this.paused;
      video.src = entry.url;
      media = video;
    } else {
      const img = document.createElement("img");
      img.alt = "";
      img.src = entry.url;
      media = img;
    }
    media.draggable = false;
    media.classList.toggle("is-flippable", state === "walk");
    this.media?.remove();
    this.el.prepend(media);
    this.media = media;
    this.shown = state;
  }

  setOutfit(outfit: Outfit): void {
    this.outfit = outfit;
  }

  changeOutfit(outfit: Outfit): Promise<void> {
    this.playGesture("change", CHANGE_MS);
    this.outfit = outfit;
    return new Promise((resolve) => setTimeout(resolve, CHANGE_MS));
  }

  setAnimation(animation: Animation): void {
    this.anim = animation;
    this.el.dataset.anim = animation;
    this.refresh();
  }

  playGesture(gesture: Gesture, durationMs: number): void {
    const cls = `g-${gesture}`;
    this.el.classList.remove(cls);
    void this.el.offsetWidth;
    this.el.classList.add(cls);
    setTimeout(() => this.el.classList.remove(cls), durationMs);
    const states = GESTURE_SPRITE[gesture];
    const state = states && resolveSprite(states, new Set(this.urls.keys()));
    if (state) {
      this.gesture = { state, until: Date.now() + Math.max(durationMs, 1600) };
      this.refresh();
      clearTimeout(this.gestureTimer);
      this.gestureTimer = setTimeout(() => {
        this.gesture = null;
        this.refresh();
      }, Math.max(durationMs, 1600));
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.media instanceof HTMLVideoElement) {
      if (paused) this.media.pause();
      else void this.media.play().catch(() => undefined);
    }
  }

  setFacing(dx: number): void {
    this.el.dataset.facing = dx < 0 ? "left" : "right";
  }

  setScale(): void {
    // Images scale to the pet box.
  }

  setSpeed(speed: number): void {
    if (this.media instanceof HTMLVideoElement) this.media.playbackRate = speed;
  }

  setMood(_mood: Mood): void {
    // Sprite packs have one look; moods still change her words and voice.
  }

  place(x: number, y: number, size: number): void {
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    this.el.style.width = `${size}px`;
    this.el.style.height = `${size}px`;
  }

  dispose(): void {
    clearTimeout(this.gestureTimer);
    this.media?.remove();
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.el.remove();
  }
}
