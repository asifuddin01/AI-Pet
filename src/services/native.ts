/**
 * Typed wrappers around the (deliberately small) native IPC surface.
 * Every command here is allow-listed per window in `src-tauri/capabilities/`.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { AppStatus, Point, ProviderId, Rect, SaveResult, ScreenInfo, Settings } from "../types";

export interface WireMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiWireRequest {
  system: string;
  messages: WireMessage[];
}

export type StreamEvent =
  | { event: "delta"; data: { text: string } }
  | { event: "reset" }
  | { event: "done" }
  | { event: "error"; data: { kind: string; message: string } };

export const native = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<SaveResult>("save_settings", { settings }),
  getAppStatus: () => invoke<AppStatus>("get_app_status"),
  setApiKey: (provider: ProviderId, key: string) => invoke<void>("set_api_key", { provider, key }),
  deleteApiKey: (provider: ProviderId) => invoke<void>("delete_api_key", { provider }),

  getScreens: () => invoke<ScreenInfo[]>("get_screens"),
  getMousePosition: () => invoke<Point>("get_mouse_position"),
  getPetFrame: () => invoke<Rect>("get_pet_frame"),
  setPetFrame: (frame: Rect) => invoke<void>("set_pet_frame", { frame }),
  setPetPosition: (x: number, y: number) => invoke<void>("set_pet_position", { x, y }),
  movePetTo: (x: number, y: number, durationMs: number) =>
    invoke<number>("move_pet_to", { x, y, durationMs: Math.round(durationMs) }),
  stopPetMotion: () => invoke<Rect>("stop_pet_motion"),
  showPet: () => invoke<void>("show_pet"),
  hidePet: () => invoke<void>("hide_pet"),
  focusPet: () => invoke<void>("focus_pet"),
  releaseFocus: () => invoke<void>("release_focus"),
  setClickThrough: (enabled: boolean, hitRect: Rect | null) =>
    invoke<void>("set_click_through", { enabled, hitRect }),

  checkAccessibility: () => invoke<boolean>("check_accessibility_permission"),
  requestAccessibility: () => invoke<boolean>("request_accessibility_permission"),
  openAccessibilitySettings: () => invoke<void>("open_accessibility_settings"),
  readClipboard: () => invoke<string | null>("read_clipboard"),
  writeClipboard: (text: string) => invoke<boolean>("write_clipboard", { text }),

  aiStream: (requestId: number, request: AiWireRequest, onEvent: Channel<StreamEvent>) =>
    invoke<void>("ai_stream", { requestId, request, onEvent }),
  aiCancel: (requestId: number) => invoke<void>("ai_cancel", { requestId }),
  aiTestConnection: () => invoke<string>("ai_test_connection"),

  ttsSpeak: (text: string, voice: string | null, rate: number) =>
    invoke<boolean>("tts_speak", { text, voice, rate }),
  ttsStop: () => invoke<void>("tts_stop"),

  openSettingsWindow: () => invoke<void>("open_settings_window"),
  quitApp: () => invoke<void>("quit_app"),
};

/** Structured log line in the app log. Never pass user text, keys or chat content. */
export function log(level: "info" | "warn" | "error", message: string): void {
  invoke("app_log", { level, message }).catch(() => undefined);
}

export function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(event, (e) => handler(e.payload));
}

export { Channel };
