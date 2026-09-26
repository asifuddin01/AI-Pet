/** Shortcut strings use the native parser's format, e.g. "Alt+Shift+KeyP". */

const MODIFIERS: Record<string, { symbol: string; order: number; canonical: string }> = {
  ctrl: { symbol: "⌃", order: 0, canonical: "Ctrl" },
  control: { symbol: "⌃", order: 0, canonical: "Ctrl" },
  alt: { symbol: "⌥", order: 1, canonical: "Alt" },
  option: { symbol: "⌥", order: 1, canonical: "Alt" },
  shift: { symbol: "⇧", order: 2, canonical: "Shift" },
  cmd: { symbol: "⌘", order: 3, canonical: "Cmd" },
  command: { symbol: "⌘", order: 3, canonical: "Cmd" },
  super: { symbol: "⌘", order: 3, canonical: "Cmd" },
  cmdorctrl: { symbol: "⌘", order: 3, canonical: "Cmd" },
  commandorcontrol: { symbol: "⌘", order: 3, canonical: "Cmd" },
};

const KEY_NAMES: Record<string, string> = {
  Space: "Space",
  Enter: "↩",
  Tab: "⇥",
  Backspace: "⌫",
  Escape: "⎋",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^[A-Za-z0-9]$/.test(code)) return code.toUpperCase();
  return KEY_NAMES[code] ?? code;
}

/** "Alt+Shift+KeyP" → "⌥⇧P" (macOS menu order: ⌃⌥⇧⌘). */
export function formatShortcut(shortcut: string): string {
  const mods: { symbol: string; order: number }[] = [];
  let key = "";
  for (const raw of shortcut.split("+")) {
    const part = raw.trim();
    if (!part) continue;
    const mod = MODIFIERS[part.toLowerCase()];
    if (mod) mods.push(mod);
    else key = keyLabel(part);
  }
  mods.sort((a, b) => a.order - b.order);
  return mods.map((m) => m.symbol).join("") + key;
}

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS|CapsLock|Fn)(Left|Right)?$/;

/**
 * Build a shortcut string from a key press in the Settings recorder.
 * Uses `event.code` (physical key), so Option+P records as "Alt+KeyP", not "π".
 */
export function shortcutFromEvent(e: {
  code: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): string | null {
  if (!e.code || MODIFIER_CODES.test(e.code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Cmd");
  if (!parts.length) return null; // a global shortcut needs a modifier
  return [...parts, e.code].join("+");
}
