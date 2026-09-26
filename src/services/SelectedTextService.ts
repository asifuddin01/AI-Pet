import type { HotkeyEvent, SelectedTextEvent } from "../types";
import { on } from "./native";

/**
 * The native layer does the capturing (Accessibility API first, clipboard fallback
 * second) and only when the user presses the hotkey. This service just pairs the two
 * events: `global-hotkey` (show the pet now) and `selected-text` (what was selected).
 */
export class SelectedTextService {
  private latestSeq = 0;

  async listen(handlers: {
    onActivate: (event: HotkeyEvent) => void;
    onCaptured: (event: SelectedTextEvent) => void;
  }): Promise<void> {
    await on<HotkeyEvent>("global-hotkey", (event) => {
      this.latestSeq = event.seq;
      handlers.onActivate(event);
    });
    await on<SelectedTextEvent>("selected-text", (event) => {
      // A newer hotkey press supersedes an older capture.
      if (event.seq === this.latestSeq) handlers.onCaptured(event);
    });
  }
}
