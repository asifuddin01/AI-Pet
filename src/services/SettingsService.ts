import type { Settings } from "../types";
import { native, on } from "./native";

type Listener = (next: Settings, prev: Settings) => void;

/**
 * Holds the current settings for a window and keeps them in sync with the native
 * layer (the source of truth, which validates and persists them).
 */
export class SettingsService {
  private listeners = new Set<Listener>();

  private constructor(private current: Settings) {}

  static async load(): Promise<SettingsService> {
    const service = new SettingsService(await native.getSettings());
    await on<Settings>("settings-changed", (next) => service.replace(next));
    return service;
  }

  get(): Settings {
    return this.current;
  }

  /** Merge, save and return any user-facing warnings (e.g. a shortcut conflict). */
  async update(patch: Partial<Settings>): Promise<string[]> {
    const { settings, warnings } = await native.saveSettings({ ...this.current, ...patch });
    this.replace(settings);
    return warnings;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private replace(next: Settings): void {
    const prev = this.current;
    this.current = next;
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    for (const l of this.listeners) l(next, prev);
  }
}
