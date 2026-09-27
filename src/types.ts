/** Shared types mirroring the Rust side (`src-tauri/src/*.rs`). */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenInfo {
  frame: Rect;
  /** Excludes menu bar, notch and Dock. */
  visibleFrame: Rect;
  scaleFactor: number;
  isPrimary: boolean;
}

export type ProviderId = "openai" | "anthropic";
/** "float": she hovers around the whole screen instead of walking. */
export type RoamArea = "bottom" | "anywhere" | "float";

export interface Settings {
  petEnabled: boolean;
  roaming: boolean;
  roamAllDisplays: boolean;
  roamArea: RoamArea;
  launchAtLogin: boolean;

  hotkey: string;
  toggleHotkey: string;
  /** Hold to talk (registered only while voice input is on). */
  talkHotkey: string;

  aiEnabled: boolean;
  provider: ProviderId;
  preset: string;
  baseUrl: string;
  model: string;
  requestTimeoutSecs: number;
  translateTarget: string;
  autoSecondLanguage: string;

  speak: boolean;
  voice: string;
  speechRate: number;
  voiceInput: boolean;
  /** "apple" (macOS speech recognition) or "whisper" (OpenAI-compatible transcription). */
  speechEngine: "apple" | "whisper";
  /** BCP-47 tag, "" = the Mac's language. */
  speechLanguage: string;
  sttBaseUrl: string;
  sttModel: string;
  /** "Hey Lucy": listen (on-device) for her name. Needs voiceInput. */
  wakeWord: boolean;
  /** Now and then she offers help or asks how she looks. */
  checkIns: boolean;
  checkInEvery: "rare" | "sometimes" | "often";

  petSize: number;
  animationSpeed: number;
  /** Bubble look: "auto" follows macOS. */
  theme: "auto" | "light" | "dark" | "neon";
  /** "auto" (Lucy picks by mood) or an outfit id. */
  outfit: string;
  /** What she's wearing right now (remembered across restarts). */
  currentOutfit: string;
  /** "vector" (built-in), "vrm" (3D model) or "sprites" (animated images / clips). */
  character: "vector" | "vrm" | "sprites";
  vrmModel: string;
  /** Optional per-outfit 3D models: outfit id → model file. */
  outfitModels: Record<string, string>;

  /** Web search: "google" (Programmable Search, key + engine ID) or "brave". */
  searchProvider: "google" | "brave";
  searchEngineId: string;

  /** Daily check for a newer release (off by default). */
  checkUpdates: boolean;
  skippedVersion: string;

  firstRunCompleted: boolean;
  accessibilityPrompted: boolean;
  lastPosition: Point | null;
}

export interface SaveResult {
  settings: Settings;
  warnings: string[];
}

export interface AppStatus {
  platform: "macos" | "windows" | "linux";
  version: string;
  accessibilityTrusted: boolean;
  hotkeyWarnings: string[];
  aiConfigured: boolean;
  hasApiKey: boolean;
  hasSttKey: boolean;
  hasSearchKey: boolean;
}

export interface HotkeyEvent {
  seq: number;
  cursor: Point;
}

export type CaptureSource = "accessibility" | "clipboard" | "none" | "unsupported";

export interface SelectedTextEvent {
  seq: number;
  text: string | null;
  source: CaptureSource;
  permissionMissing: boolean;
  truncated: boolean;
}
