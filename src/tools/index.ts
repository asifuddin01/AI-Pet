import { CalculatorTool } from "./calculator";
import { ClockTool } from "./clock";
import { NotesTool, type NotesStore } from "./notes";
import { Pomodoro } from "./pomodoro";
import { Timers } from "./timers";
import type { LocalTool, ToolHost, ToolReply } from "./types";
import { UnitsTool } from "./units";

export type { LocalTool, ToolHost, ToolReply } from "./types";

/** A button in the Tools view: fill the input with an example, or run straight away. */
export interface ToolButton {
  id: string;
  label: string;
  icon: string;
  /** Text put in the input box (the user finishes it). */
  prefill?: string;
  /** Command run immediately. */
  run?: string;
  hint: string;
}

/**
 * The pet's offline tools. `handle` offers a message to each tool in turn; the first
 * one that recognises it answers. New tools only need to be added to `tools` (guide §63).
 */
export class Toolbox {
  readonly timers: Timers;
  readonly pomodoro: Pomodoro;
  readonly notes: NotesTool;
  readonly tools: LocalTool[];

  constructor(host: ToolHost, notesStore: NotesStore, now: () => number = Date.now) {
    this.timers = new Timers(host, now);
    this.pomodoro = new Pomodoro(host, now);
    this.notes = new NotesTool(notesStore, now);
    // Explicit commands first; the pattern-based tools last.
    this.tools = [this.notes, this.timers, this.pomodoro, ClockTool, UnitsTool, CalculatorTool];
  }

  async handle(input: string): Promise<ToolReply | null> {
    if (!input.trim() || input.length > 1200) return null;
    for (const tool of this.tools) {
      const reply = await tool.handle(input);
      if (reply) return reply;
    }
    return null;
  }

  buttons(): ToolButton[] {
    return [
      { id: "timer", label: "Timer", icon: "⏱", prefill: "timer ", hint: "How long? e.g. 10 min tea · remind me in 20 min to stretch" },
      this.pomodoro.running
        ? { id: "pomodoro", label: "Stop focus", icon: "🍅", run: "stop pomodoro", hint: "" }
        : { id: "pomodoro", label: "Pomodoro", icon: "🍅", run: "pomodoro", hint: "" },
      { id: "notes", label: "Notes", icon: "🗒", run: "notes", hint: "" },
      { id: "note", label: "New note", icon: "✏️", prefill: "note ", hint: "Type your note and press Enter." },
      { id: "calc", label: "Calculator", icon: "🧮", prefill: "", hint: "Type a sum: 25*4 · 15% of 80 · sqrt(2)" },
      { id: "convert", label: "Convert", icon: "📏", prefill: "", hint: "e.g. 10 km to miles · 72 f in c · 2 cups to ml" },
      { id: "clock", label: "World clock", icon: "🌐", prefill: "time in ", hint: "Which city? e.g. Tokyo, London, New York" },
    ];
  }

  /** One short line about running timers / focus, for the quick menu. */
  statusLine(): string | null {
    return [this.pomodoro.statusLine(), this.timers.statusLine()].filter(Boolean).join(" · ") || null;
  }

  dispose(): void {
    this.timers.cancelAll();
    this.pomodoro.reset();
  }
}
