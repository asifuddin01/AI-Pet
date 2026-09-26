import { native } from "./native";

/** Explicit, user-initiated clipboard access only (never polled). */
export const ClipboardService = {
  async readText(): Promise<string | null> {
    try {
      const text = await native.readClipboard();
      return text && text.trim() ? text : null;
    } catch {
      return null;
    }
  },

  async writeText(text: string): Promise<boolean> {
    try {
      if (await native.writeClipboard(text)) return true;
    } catch {
      // fall through to the web fallbacks
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  },
};
