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
export type RoamArea = "bottom" | "anywhere";

export interface Settings {
  petEnabled: boolean;
  roaming: boolean;
  roamAllDisplays: boolean;
  roamArea: RoamArea;
  launchAtLogin: boolean;

  hotkey: string;
  toggleHotkey: string;

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

  petSize: number;
  animationSpeed: number;

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
