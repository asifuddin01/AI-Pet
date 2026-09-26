import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { Animation, Gesture } from "../pet/AnimationController";
import type { Mood, Outfit } from "../pet/Wardrobe";
import type { CharacterView } from "./CharacterView";

/** Loads a model file's bytes by name (from the app's character folder). */
export type ModelSource = (name: string) => Promise<ArrayBuffer>;

interface ActiveGesture {
  start: number;
  duration: number;
}

const FX_MARKUP = `
  <div class="vrm-fx vrm-fx--dots"><span></span><span></span><span></span></div>
  <div class="vrm-fx vrm-fx--zzz"><span>z</span><span>z</span></div>
  <div class="vrm-fx vrm-fx--sparkles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
  <div class="vrm-fx vrm-fx--loading"><span></span><span></span><span></span></div>`;

const CHANGE_MS = 900;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 → 1 → 0 over a gesture, with gentle ease in/out. */
const envelope = (t: number) => {
  const x = clamp01(t);
  if (x < 0.2) return Math.sin((x / 0.2) * (Math.PI / 2));
  if (x > 0.8) return Math.sin(((1 - x) / 0.2) * (Math.PI / 2));
  return 1;
};
const approach = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

/** Base facial expression per mood (VRM preset name → weight). */
const MOOD_FACE: Record<Mood, Partial<Record<string, number>>> = {
  confident: { happy: 0.12 },
  focused: {},
  dreamy: { relaxed: 0.4 },
  sleepy: { relaxed: 0.45 },
  playful: { happy: 0.3 },
  melancholy: { sad: 0.3 },
};

/**
 * A 3D character from a VRM model (e.g. a Lucy made in VRoid Studio), rendered with
 * three.js on a transparent canvas. Every motion is procedural — breathing, blinking,
 * walking, waving, talking, head tilts — plus the model's own spring-bone physics
 * for hair and clothes. Rendering pauses entirely while the pet is off, and drops to
 * a low frame rate while she's just standing around.
 */
export class VrmPet implements CharacterView {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(20, 1, 0.1, 50);
  private readonly root = new THREE.Group();
  private readonly lookTarget = new THREE.Object3D();
  private vrm: VRM | null = null;
  private modelName = "";
  private loadToken = 0;

  private outfit: Outfit;
  private mood: Mood = "confident";
  private anim: Animation = "idle";
  private facing = 1;
  private yaw = 0;
  private speed = 1;
  private size = 140;
  private paused = true;
  private raf = 0;
  private lastFrame = 0;
  private time = 0;
  private gestures = new Map<Gesture, ActiveGesture>();
  private nextBlink = 2;
  private blinkStart = -1;
  private mouth = 0;
  private mouthTarget = 0;
  private nextMouth = 0;
  private expressions = new Map<string, number>();

  constructor(
    parent: HTMLElement,
    outfit: Outfit,
    private readonly source: ModelSource,
    private readonly modelFor: (outfit: Outfit) => string,
    private readonly onLoadError: (message: string) => void,
  ) {
    this.outfit = outfit;
    this.el = document.createElement("div");
    this.el.className = "pet pet--vrm is-loading";
    this.el.setAttribute("role", "img");
    this.el.setAttribute("aria-label", "Lucy, your desktop pet");
    this.canvas = document.createElement("canvas");
    this.el.append(this.canvas);
    this.el.insertAdjacentHTML("beforeend", FX_MARKUP);
    parent.append(this.el);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const key = new THREE.DirectionalLight(0xffffff, Math.PI * 0.9);
    key.position.set(1, 1.6, 2.2);
    this.scene.add(key, new THREE.AmbientLight(0xffffff, 0.9), this.root, this.lookTarget);
    this.place(0, 0, this.size);
    void this.load(this.modelFor(outfit));
  }

  get currentOutfit(): Outfit {
    return this.outfit;
  }

  // ------------------------------------------------------------------ CharacterView

  setOutfit(outfit: Outfit): void {
    this.outfit = outfit;
    const model = this.modelFor(outfit);
    if (model !== this.modelName) void this.load(model);
  }

  changeOutfit(outfit: Outfit): Promise<void> {
    this.playGesture("change", CHANGE_MS);
    setTimeout(() => this.setOutfit(outfit), CHANGE_MS * 0.45);
    return new Promise((resolve) => setTimeout(resolve, CHANGE_MS));
  }

  setAnimation(animation: Animation): void {
    this.anim = animation;
    this.el.dataset.anim = animation;
  }

  playGesture(gesture: Gesture, durationMs: number): void {
    this.gestures.set(gesture, { start: this.time, duration: durationMs / 1000 });
    const cls = `g-${gesture}`;
    this.el.classList.remove(cls);
    void this.el.offsetWidth;
    this.el.classList.add(cls);
    setTimeout(() => this.el.classList.remove(cls), durationMs);
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  setFacing(direction: "left" | "right"): void {
    this.facing = direction === "left" ? -1 : 1;
  }

  setScale(): void {
    // The canvas fills the pet box; nothing to scale.
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  setMood(mood: Mood): void {
    this.mood = mood;
  }

  place(x: number, y: number, size: number): void {
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    this.el.style.width = `${size}px`;
    this.el.style.height = `${size}px`;
    if (size !== this.size || !this.canvas.width) {
      this.size = size;
      this.renderer.setSize(size, size, false);
      this.canvas.style.width = `${size}px`;
      this.canvas.style.height = `${size}px`;
      this.renderFrame(0);
    }
  }

  dispose(): void {
    this.setPaused(true);
    this.loadToken++;
    this.unloadModel();
    this.renderer.dispose();
    this.el.remove();
  }

  // ------------------------------------------------------------------ loading

  private async load(name: string): Promise<void> {
    const token = ++this.loadToken;
    this.modelName = name;
    if (!name) {
      this.onLoadError("No 3D model selected yet.");
      return;
    }
    this.el.classList.add("is-loading");
    try {
      const bytes = await this.source(name);
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.parseAsync(bytes, "");
      if (token !== this.loadToken) return;
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) throw new Error("That file isn't a VRM model.");
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse((o) => (o.frustumCulled = false));
      this.unloadModel();
      this.vrm = vrm;
      this.root.add(vrm.scene);
      if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
      this.frameCamera();
      this.el.classList.remove("is-loading");
      this.renderFrame(0);
    } catch (e) {
      if (token !== this.loadToken) return;
      this.el.classList.remove("is-loading");
      this.onLoadError(e instanceof Error ? e.message : String(e));
    }
  }

  private unloadModel(): void {
    if (!this.vrm) return;
    this.root.remove(this.vrm.scene);
    VRMUtils.deepDispose(this.vrm.scene);
    this.vrm = null;
  }

  /** Fit the whole figure (standing) into the square box. */
  private frameCamera(): void {
    if (!this.vrm) return;
    this.resetPose();
    this.vrm.update(0);
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const height = box.max.y - box.min.y;
    const centerY = box.min.y + height * 0.5;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (height * 1.08) / 2 / Math.tan(fov / 2);
    this.camera.position.set(0, centerY, distance);
    this.camera.lookAt(0, centerY, 0);
    this.camera.updateProjectionMatrix();
    const head = this.bone("head");
    const headY = head ? head.getWorldPosition(new THREE.Vector3()).y : box.max.y - height * 0.1;
    this.lookTarget.position.set(0, headY, distance);
  }

  // ------------------------------------------------------------------ animation

  private readonly loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const busy = this.anim !== "idle" || this.gestures.size > 0 || this.el.classList.contains("is-loading");
    const fps = this.anim === "sleep" && this.gestures.size === 0 ? 12 : busy ? 30 : 20;
    if (now - this.lastFrame < 1000 / fps - 2) return;
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.renderFrame(dt);
  };

  private renderFrame(dt: number): void {
    if (this.vrm) {
      this.time += dt * this.speed;
      this.animate(dt * this.speed);
      this.vrm.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private bone(name: VRMHumanBoneName): THREE.Object3D | null {
    return this.vrm?.humanoid.getNormalizedBoneNode(name) ?? null;
  }

  private rot(name: VRMHumanBoneName, x: number, y: number, z: number): void {
    this.bone(name)?.rotation.set(x, y, z);
  }

  private resetPose(): void {
    if (!this.vrm) return;
    this.vrm.humanoid.resetNormalizedPose();
  }

  /** Weight (0..1) of a running gesture; expired gestures are dropped. */
  private gestureWeight(g: Gesture): number {
    const active = this.gestures.get(g);
    if (!active) return 0;
    const t = (this.time - active.start) / active.duration;
    if (t >= 1) {
      this.gestures.delete(g);
      return 0;
    }
    return envelope(t);
  }

  private animate(dt: number): void {
    const t = this.time;
    const a = this.anim;
    this.resetPose();

    // Turn slightly toward where she's walking; face the viewer otherwise.
    const targetYaw = a === "walk" ? this.facing * 0.55 : 0;
    this.yaw = approach(this.yaw, targetYaw, 6, dt);
    this.root.rotation.y = this.yaw;

    const breath = Math.sin(t * ((2 * Math.PI) / (a === "sleep" ? 4.6 : 3.4)));
    let hipsY = 0;

    // Base pose: arms relaxed at the sides, elbows softly bent.
    let lUpper = { x: 0, y: 0, z: -1.2 };
    let rUpper = { x: 0, y: 0, z: 1.2 };
    let lLower = { x: 0, y: -0.25, z: 0 };
    let rLower = { x: 0, y: 0.25, z: 0 };
    let head = { x: 0, y: Math.sin(t * 0.37) * 0.05, z: Math.sin(t * 0.23) * 0.02 };
    const chest = { x: breath * 0.02, y: 0, z: 0 };
    const spine = { x: 0, y: 0, z: Math.sin(t * 0.5) * 0.012 };
    const legs = { l: 0, r: 0, lk: 0, rk: 0 };

    if (a === "walk") {
      const phase = t * ((2 * Math.PI) / 1.05);
      const s = Math.sin(phase);
      legs.l = -s * 0.38;
      legs.r = s * 0.38;
      // Knees bend while each leg swings forward, and stay nearly straight while planted.
      legs.lk = 0.05 + Math.max(0, Math.cos(phase)) * 0.6;
      legs.rk = 0.05 + Math.max(0, -Math.cos(phase)) * 0.6;
      lUpper = { ...lUpper, x: s * 0.32 };
      rUpper = { ...rUpper, x: -s * 0.32 };
      hipsY = Math.abs(Math.cos(phase)) * 0.012;
      spine.y = s * 0.06;
    } else if (a === "thinking") {
      head = { x: -0.08, y: 0.1, z: 0.13 };
      rUpper = { x: -0.45, y: 0.35, z: 1.1 };
      rLower = { x: 0, y: 2.25, z: 0 };
    } else if (a === "sleep") {
      head = { x: 0.28, y: 0, z: 0.14 };
      chest.x = breath * 0.035;
    } else if (a === "error") {
      head = { x: 0.14, y: Math.sin(t * 9) * 0.03, z: -0.05 };
    } else if (a === "listening") {
      head = { x: -0.04, y: 0, z: -0.14 };
    } else if (a === "talking") {
      head = { x: Math.sin(t * 5) * 0.025, y: Math.sin(t * 1.3) * 0.06, z: 0.03 };
    }

    // Gestures blend over the base pose.
    const wave = this.gestureWeight("wave");
    if (wave) {
      // Elbow at shoulder height, forearm up and swaying.
      rUpper = mix(rUpper, { x: 0, y: 0.25, z: -0.2 }, wave);
      rLower = mix(rLower, { x: 0, y: 0, z: -1.35 + Math.sin(t * 11) * 0.35 }, wave);
    }
    const hair = this.gestureWeight("hair-touch");
    if (hair) {
      // Elbow out to the side, hand up by her ear, head leaning into it.
      rUpper = mix(rUpper, { x: 0, y: 0.45, z: -0.6 }, hair);
      rLower = mix(rLower, { x: 0, y: 0, z: -2.4 }, hair);
      head = mix(head, { x: 0.04, y: -0.12, z: 0.1 }, hair);
    }
    const glance = this.gestureWeight("glance");
    if (glance) head = mix(head, { x: -0.03, y: 0.55, z: 0.06 }, glance);
    const lookL = this.gestureWeight("look-left");
    const lookR = this.gestureWeight("look-right");
    const hop = Math.max(this.gestureWeight("hop"), this.gestureWeight("happy") * 0.5);
    hipsY += Math.sin(hop * Math.PI) * 0.035 * hop;

    this.rot("leftUpperArm", lUpper.x, lUpper.y, lUpper.z);
    this.rot("rightUpperArm", rUpper.x, rUpper.y, rUpper.z);
    this.rot("leftLowerArm", lLower.x, lLower.y, lLower.z);
    this.rot("rightLowerArm", rLower.x, rLower.y, rLower.z);
    this.rot("spine", spine.x, spine.y, spine.z);
    this.rot("chest", chest.x, chest.y, chest.z);
    this.rot("neck", head.x * 0.4, head.y * 0.4, head.z * 0.4);
    this.rot("head", head.x * 0.6, head.y * 0.6, head.z * 0.6);
    this.rot("leftUpperLeg", legs.l, 0, 0);
    this.rot("rightUpperLeg", legs.r, 0, 0);
    this.rot("leftLowerLeg", legs.lk, 0, 0);
    this.rot("rightLowerLeg", legs.rk, 0, 0);
    const hips = this.bone("hips");
    if (hips) hips.position.y += hipsY;

    // Eyes follow the viewer, or glance aside.
    const side = (lookR - lookL) * 0.6 + glance * 0.9;
    const cam = this.camera.position;
    this.lookTarget.position.set(cam.x + side, this.lookTarget.position.y, cam.z);

    this.updateFace(dt, t);
  }

  private updateFace(dt: number, t: number): void {
    const em = this.vrm?.expressionManager;
    if (!em) return;
    const target = new Map<string, number>(Object.entries(MOOD_FACE[this.mood]) as [string, number][]);
    const a = this.anim;
    if (a === "error") target.set("sad", 0.8);
    if (a === "listening") target.set("surprised", 0.3);
    if (a === "sleep") target.set("relaxed", 0.5);
    const happy = Math.max(this.gestureWeight("happy"), this.gestureWeight("wave") * 0.6);
    if (happy) target.set("happy", Math.max(target.get("happy") ?? 0, happy));

    // Blink every few seconds; eyes stay shut while asleep.
    let blink = 0;
    if (a === "sleep") blink = 1;
    else {
      if (t >= this.nextBlink && this.blinkStart < 0) this.blinkStart = t;
      if (this.blinkStart >= 0) {
        const k = (t - this.blinkStart) / 0.16;
        blink = k < 1 ? Math.sin(k * Math.PI) : 0;
        if (k >= 1) {
          this.blinkStart = -1;
          this.nextBlink = t + 2.5 + Math.random() * 4;
        }
      }
    }
    if (this.gestureWeight("blink")) blink = Math.max(blink, 1);
    target.set("blink", blink);

    // Talking: mouth flaps with a little randomness while speaking.
    if (a === "talking") {
      if (t >= this.nextMouth) {
        this.mouthTarget = 0.15 + Math.random() * 0.75;
        this.nextMouth = t + 0.07 + Math.random() * 0.09;
      }
    } else {
      this.mouthTarget = 0;
    }
    this.mouth = approach(this.mouth, this.mouthTarget, 22, dt);
    target.set("aa", this.mouth);

    for (const name of ["happy", "sad", "relaxed", "surprised", "blink", "aa"]) {
      const goal = target.get(name) ?? 0;
      const current = this.expressions.get(name) ?? 0;
      const next = name === "blink" || name === "aa" ? goal : approach(current, goal, 5, dt);
      this.expressions.set(name, next);
      em.setValue(name, next);
    }
  }
}

type Rot = { x: number; y: number; z: number };
function mix(a: Rot, b: Rot, w: number): Rot {
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w };
}
