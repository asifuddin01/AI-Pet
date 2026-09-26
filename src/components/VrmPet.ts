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
  /** Current (blended) rotation of each posed bone, and the hips' rest position. */
  private current = new Map<VRMHumanBoneName, THREE.Quaternion>();
  private hipsRest = new THREE.Vector3();
  private hipsOffset = new THREE.Vector3();
  private weight = 1;
  private weightSide = 1;
  private nextWeightSwap = 6;
  private handOnHip = false;
  private hipHand = 0;
  private nextStance = 5;
  /** Clothing layers inside the model ("Layer_*" meshes), toggled and tinted per outfit. */
  private layers = new Map<string, THREE.Mesh[]>();

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
    this.applyLayers(outfit);
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

  // ------------------------------------------------------------------ clothing layers

  private collectLayers(vrm: VRM): void {
    this.layers.clear();
    vrm.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let node: THREE.Object3D | null = mesh;
      while (node && !node.name.startsWith("Layer_")) node = node.parent;
      if (!node) return;
      const list = this.layers.get(node.name) ?? [];
      list.push(mesh);
      this.layers.set(node.name, list);
    });
  }

  /** Dress a layered model (see scripts in docs) from the outfit definition. */
  private applyLayers(outfit: Outfit): void {
    if (!this.layers.size) return;
    const plan = layerPlan(outfit);
    for (const [name, meshes] of this.layers) {
      const look = plan.get(name);
      for (const mesh of meshes) {
        mesh.visible = !!look;
        if (!look) continue;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) tint(m, look);
      }
    }
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
      this.current.clear();
      vrm.humanoid.resetNormalizedPose();
      this.hipsRest.copy(vrm.humanoid.getNormalizedBoneNode("hips")?.position ?? new THREE.Vector3());
      this.collectLayers(vrm);
      this.applyLayers(this.outfit);
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
    const pose = new Map<VRMHumanBoneName, Rot>();
    const set = (b: VRMHumanBoneName, r: Rot) => pose.set(b, r);
    const add = (b: VRMHumanBoneName, r: Partial<Rot>) => {
      const cur = pose.get(b) ?? { x: 0, y: 0, z: 0 };
      pose.set(b, { x: cur.x + (r.x ?? 0), y: cur.y + (r.y ?? 0), z: cur.z + (r.z ?? 0) });
    };

    // Turn slightly toward where she's walking; face the viewer otherwise.
    const targetYaw = a === "walk" ? this.facing * 0.55 : 0;
    this.yaw = approach(this.yaw, targetYaw, 5, dt);
    this.root.rotation.y = this.yaw;

    // Weight shifts from one leg to the other every so often (contrapposto).
    if (t >= this.nextWeightSwap) {
      this.weightSide = -this.weightSide;
      this.nextWeightSwap = t + 7 + Math.random() * 9;
    }
    this.weight = approach(this.weight, this.weightSide, 1.6, dt);
    const w = a === "walk" ? 0 : this.weight; // +1 = weight on her left leg
    // Hand-on-hip stance now and then when she's feeling bold.
    if (t >= this.nextStance) {
      const bold = this.mood === "confident" || this.mood === "playful";
      this.handOnHip = !this.handOnHip && Math.random() < (bold ? 0.7 : 0.35);
      this.nextStance = t + 9 + Math.random() * 14;
    }
    const hipHand = approach(this.hipHand, this.handOnHip && (a === "idle" || a === "listening" || a === "talking") ? 1 : 0, 2.2, dt);
    this.hipHand = hipHand;

    const breath = Math.sin(t * ((2 * Math.PI) / (a === "sleep" ? 4.6 : 3.6)));
    const n1 = noise(t * 0.35, 1), n2 = noise(t * 0.28, 2), n3 = noise(t * 0.5, 3);
    const hipsOffset = new THREE.Vector3();

    // ---- idle base: relaxed, asymmetric, never perfectly still
    set("hips", { x: 0, y: n2 * 0.03, z: w * 0.055 });
    hipsOffset.x = w * 0.018;
    hipsOffset.y = -Math.abs(w) * 0.006;
    set("spine", { x: 0.02 + n1 * 0.01, y: -n2 * 0.02, z: -w * 0.03 });
    set("chest", { x: breath * 0.018, y: n3 * 0.015, z: -w * 0.025 });
    set("upperChest", { x: breath * 0.012, y: 0, z: 0 });
    set("neck", { x: 0, y: 0, z: 0 });
    let head: Rot = { x: n1 * 0.05 - 0.02, y: n2 * 0.09, z: w * 0.035 + n3 * 0.03 };
    set("leftShoulder", { x: 0, y: 0, z: -breath * 0.012 });
    set("rightShoulder", { x: 0, y: 0, z: breath * 0.012 });
    // legs: the standing leg straight under the hip, the free leg relaxed and bent
    const freeL = clamp01(-w), freeR = clamp01(w);
    set("leftUpperLeg", { x: -0.06 * freeL, y: -0.05 * freeL, z: -w * 0.055 - 0.02 * freeL });
    set("rightUpperLeg", { x: -0.06 * freeR, y: 0.05 * freeR, z: -w * 0.055 + 0.02 * freeR });
    set("leftLowerLeg", { x: 0.2 * freeL + 0.02, y: 0, z: 0 });
    set("rightLowerLeg", { x: 0.2 * freeR + 0.02, y: 0, z: 0 });
    set("leftFoot", { x: -0.1 * freeL, y: 0, z: 0 });
    set("rightFoot", { x: -0.1 * freeR, y: 0, z: 0 });
    // arms hang loosely, elbows soft, a touch of sway with the breath
    let lUpper: Rot = { x: 0.05 + n2 * 0.03, y: 0.1, z: -1.06 + breath * 0.015 };
    let rUpper: Rot = { x: 0.05 - n1 * 0.03, y: -0.1, z: 1.06 - breath * 0.015 };
    let lLower: Rot = { x: 0, y: -0.32 + n3 * 0.05, z: 0 };
    let rLower: Rot = { x: 0, y: 0.28 - n1 * 0.05, z: 0 };
    let lHand: Rot = { x: 0, y: 0, z: -0.12 };
    let rHand: Rot = { x: 0, y: 0, z: 0.12 };

    if (a === "walk") {
      const phase = t * ((2 * Math.PI) / 1.1);
      const s = Math.sin(phase), c = Math.cos(phase);
      set("hips", { x: 0.02, y: s * 0.09, z: -s * 0.05 });
      hipsOffset.set(-s * 0.012, Math.abs(c) * 0.018 - 0.012, 0);
      set("spine", { x: 0.04, y: -s * 0.05, z: s * 0.02 });
      set("chest", { x: breath * 0.012, y: -s * 0.05, z: s * 0.02 });
      head = { x: 0.02 + n1 * 0.02, y: s * 0.04, z: 0 };
      set("leftUpperLeg", { x: -s * 0.42, y: 0, z: 0.02 });
      set("rightUpperLeg", { x: s * 0.42, y: 0, z: -0.02 });
      // knees bend as each leg swings through, stay soft while planted
      set("leftLowerLeg", { x: 0.06 + Math.max(0, c) * 0.75, y: 0, z: 0 });
      set("rightLowerLeg", { x: 0.06 + Math.max(0, -c) * 0.75, y: 0, z: 0 });
      set("leftFoot", { x: -0.25 * Math.max(0, -s) + 0.2 * Math.max(0, c), y: 0, z: 0 });
      set("rightFoot", { x: -0.25 * Math.max(0, s) + 0.2 * Math.max(0, -c), y: 0, z: 0 });
      lUpper = { x: s * 0.38, y: 0.1, z: -1.12 };
      rUpper = { x: -s * 0.38, y: -0.1, z: 1.12 };
      lLower = { x: 0, y: -0.25 - Math.max(0, -s) * 0.45, z: 0 };
      rLower = { x: 0, y: 0.25 + Math.max(0, s) * 0.45, z: 0 };
    } else if (a === "thinking") {
      head = { x: -0.1 + n1 * 0.02, y: 0.12 + n2 * 0.03, z: 0.14 };
      rUpper = { x: -0.45, y: 0.35, z: 1.1 };
      rLower = { x: 0, y: 2.25, z: 0 };
      rHand = { x: 0, y: 0, z: -0.2 };
    } else if (a === "sleep") {
      head = { x: 0.3, y: 0.05, z: 0.16 };
      add("chest", { x: breath * 0.025 + 0.06 });
      add("spine", { x: 0.05 });
      lUpper = { ...lUpper, z: -1.12 };
      rUpper = { ...rUpper, z: 1.12 };
    } else if (a === "error") {
      head = { x: 0.14, y: Math.sin(t * 7) * 0.05, z: -0.08 };
      rUpper = { x: -0.5, y: 0.5, z: 0.4 };
      rLower = { x: 0, y: 0, z: -2.2 };
    } else if (a === "listening") {
      head = { x: -0.05 + n1 * 0.02, y: n2 * 0.05, z: -0.16 };
    } else if (a === "talking") {
      head = { x: n1 * 0.05 + Math.sin(t * 4.3) * 0.02, y: n2 * 0.1, z: 0.04 + n3 * 0.04 };
      // hands join in now and then while she explains
      const gest = clamp01(noise(t * 0.6, 7) * 1.6);
      rUpper = mix(rUpper, { x: -0.55, y: 0.25, z: 1.05 }, gest);
      rLower = mix(rLower, { x: 0, y: 1.5 + Math.sin(t * 2.6) * 0.2, z: 0 }, gest);
      rHand = mix(rHand, { x: 0, y: 0, z: -0.25 + Math.sin(t * 3.1) * 0.15 }, gest);
    }

    // hand on the hip (left arm), elbow out
    if (hipHand > 0.001) {
      lUpper = mix(lUpper, { x: 0.6, y: -0.3, z: -0.5 }, hipHand);
      lLower = mix(lLower, { x: 0, y: -1.3, z: -0.9 }, hipHand);
      lHand = mix(lHand, { x: 0, y: -0.2, z: 0.45 }, hipHand);
    }

    // ---- gestures on top
    const wave = this.gestureWeight("wave");
    if (wave) {
      rUpper = mix(rUpper, { x: 0, y: 0.25, z: -0.2 }, wave);
      rLower = mix(rLower, { x: 0, y: 0, z: -1.35 + Math.sin(t * 10) * 0.32 }, wave);
      rHand = mix(rHand, { x: 0, y: 0, z: Math.sin(t * 10 - 0.6) * 0.25 }, wave);
      head = mix(head, { x: -0.03, y: -0.08, z: 0.1 }, wave);
    }
    const hair = this.gestureWeight("hair-touch");
    if (hair) {
      rUpper = mix(rUpper, { x: 0, y: 0.45, z: -0.6 }, hair);
      rLower = mix(rLower, { x: 0, y: 0, z: -2.4 }, hair);
      head = mix(head, { x: 0.04, y: -0.12, z: 0.1 }, hair);
    }
    const glance = this.gestureWeight("glance");
    if (glance) head = mix(head, { x: -0.03, y: 0.55, z: 0.06 }, glance);
    const lookL = this.gestureWeight("look-left");
    const lookR = this.gestureWeight("look-right");
    head = { ...head, y: head.y + (lookL - lookR) * 0.35 };
    const hop = Math.max(this.gestureWeight("hop"), this.gestureWeight("happy") * 0.5);
    hipsOffset.y += Math.sin(hop * Math.PI) * 0.035 * hop;

    set("leftUpperArm", lUpper);
    set("rightUpperArm", rUpper);
    set("leftLowerArm", lLower);
    set("rightLowerArm", rLower);
    set("leftHand", lHand);
    set("rightHand", rHand);
    set("neck", { x: head.x * 0.4, y: head.y * 0.4, z: head.z * 0.4 });
    set("head", { x: head.x * 0.6, y: head.y * 0.6, z: head.z * 0.6 });
    // relaxed, slightly curled fingers
    for (const [side, sign] of [["left", -1], ["right", 1]] as const) {
      for (const f of ["Index", "Middle", "Ring", "Little"] as const) {
        const extra = f === "Index" ? 0 : f === "Little" ? 0.15 : 0.08;
        set(`${side}${f}Proximal` as VRMHumanBoneName, { x: 0, y: 0, z: sign * (0.3 + extra) });
        set(`${side}${f}Intermediate` as VRMHumanBoneName, { x: 0, y: 0, z: sign * (0.42 + extra) });
        set(`${side}${f}Distal` as VRMHumanBoneName, { x: 0, y: 0, z: sign * (0.3 + extra) });
      }
      set(`${side}ThumbProximal` as VRMHumanBoneName, { x: 0, y: sign * -0.25, z: 0 });
      set(`${side}ThumbDistal` as VRMHumanBoneName, { x: 0, y: sign * -0.2, z: 0 });
    }

    // Blend toward the target pose so nothing ever snaps.
    const rate = a === "walk" ? 16 : 7;
    const k = 1 - Math.exp(-rate * dt);
    for (const [name, r] of pose) {
      const node = this.bone(name);
      if (!node) continue;
      tmpEuler.set(r.x, r.y, r.z);
      tmpQuat.setFromEuler(tmpEuler);
      const cur = this.current.get(name);
      if (!cur) {
        this.current.set(name, tmpQuat.clone());
        node.quaternion.copy(tmpQuat);
      } else {
        cur.slerp(tmpQuat, dt === 0 ? 1 : k);
        node.quaternion.copy(cur);
      }
    }
    this.hipsOffset.lerp(hipsOffset, dt === 0 ? 1 : k);
    const hips = this.bone("hips");
    if (hips) hips.position.copy(this.hipsRest).add(this.hipsOffset);

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

const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();

/** Smooth, irregular motion in about -1..1 (sum of incommensurate sines). */
function noise(t: number, seed: number): number {
  return (
    0.5 * Math.sin(t * 1.31 + seed * 1.7) +
    0.3 * Math.sin(t * 2.17 + seed * 4.1) +
    0.2 * Math.sin(t * 0.61 + seed * 2.3)
  );
}

export interface LayerLook {
  color: string;
  glow?: string;
  /** Glossy highlight colour (bodysuits, legwear). */
  shine?: string;
  opacity?: number;
}

const mixHex = (a: string, b: string, t: number) =>
  "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

/** Which clothing layers an outfit uses, and their colours (pure; tested). */
export function layerPlan(o: Outfit): Map<string, LayerLook> {
  const plan = new Map<string, LayerLook>();
  const suit = mixHex(o.top.from, o.top.to, 0.55);
  plan.set("Layer_Suit", { color: suit, glow: o.top.accent, shine: o.top.shine });
  if (o.jacket) {
    plan.set("Layer_Jacket", { color: o.jacket.from, opacity: o.jacket.opacity });
    plan.set("Layer_Sleeves", { color: o.jacket.sleeve?.[0] ?? o.jacket.from, opacity: o.jacket.opacity });
  } else if (o.top.sleeves) {
    plan.set("Layer_Sleeves", { color: suit });
  }
  if (o.top.style === "dress") plan.set("Layer_Skirt", { color: suit, glow: o.top.accent });
  else if (o.bottom.style === "skirt") plan.set("Layer_Skirt", { color: o.bottom.color, glow: o.bottom.shade });
  else if (o.bottom.style === "shorts") plan.set("Layer_Shorts", { color: o.bottom.color });
  else if (o.bottom.style === "jeans") plan.set("Layer_Jeans", { color: o.bottom.color });
  const legs = o.legs;
  const legShine = mixHex(legs.color, "#ffffff", 0.18);
  if (legs.style === "thighhigh") plan.set("Layer_ThighHigh", { color: legs.color, glow: legs.band, shine: legShine });
  if (legs.style === "socks") plan.set("Layer_Socks", { color: legs.color, glow: legs.band });
  if (legs.style === "tights" || legs.style === "tights-boots") plan.set("Layer_Tights", { color: legs.color, shine: legShine });
  if (legs.style === "sheer-boots") plan.set("Layer_Tights", { color: legs.color, opacity: 0.55 });
  if (legs.style === "boots" || legs.style === "tights-boots" || legs.style === "sheer-boots") {
    plan.set("Layer_Boots", { color: legs.shoe });
  }
  plan.set("Layer_Shoes", { color: legs.shoe });
  if (o.extras.includes("glasses") || o.extras.includes("sunglasses")) plan.set("Layer_Glasses", { color: "#16141c" });
  if (o.extras.includes("sunglasses")) plan.set("Layer_Lenses", { color: "#1c1830", opacity: 0.82 });
  if (o.extras.includes("pendant")) plan.set("Layer_Necklace", { color: "#e2b54f", glow: "#6b4b10" });
  return plan;
}

function tint(material: THREE.Material, look: LayerLook): void {
  const m = material as THREE.Material & {
    color?: THREE.Color;
    shadeColorFactor?: THREE.Color;
    emissive?: THREE.Color;
    uniforms?: { opacity?: { value: number }; matcapFactor?: { value: THREE.Color } };
  };
  const color = new THREE.Color(look.color);
  m.color?.copy(color);
  m.shadeColorFactor?.copy(color).multiplyScalar(0.62).lerp(new THREE.Color("#3a3560"), 0.18);
  if (m.emissive) m.emissive.set(look.glow ?? "#000000");
  if (look.shine && m.uniforms?.matcapFactor) m.uniforms.matcapFactor.value.set(look.shine).multiplyScalar(0.8);
  const opacity = look.opacity ?? 1;
  const transparent = opacity < 1;
  if (m.transparent !== transparent) {
    m.transparent = transparent;
    m.needsUpdate = true;
  }
  if (m.uniforms?.opacity) m.uniforms.opacity.value = opacity;
  else m.opacity = opacity;
  m.depthWrite = !transparent;
}

