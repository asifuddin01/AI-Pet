import { normalizeInput, type LocalTool, type ToolReply } from "./types";

/** Quick notes kept on this Mac: "note buy milk", "notes", "delete note 2", "clear notes". */

export interface Note {
  text: string;
  /** Unix ms. */
  created: number;
}

export interface NotesStore {
  load(): Promise<Note[]>;
  save(notes: Note[]): Promise<void>;
}

export const MAX_NOTES = 200;
export const MAX_NOTE_CHARS = 1000;

const ADD = /^(?:note|notes|add (?:a )?note|new note|save (?:a )?note|take (?:a )?note|jot(?: down)?|note down)\s*[:\-–]?\s+([^]+)$/i;
const LIST = /^(?:(?:show|list|read|open|see|view)\s+)?(?:(?:me\s+)?(?:my|the|all)\s+)?notes$/i;
const DELETE = /^(?:delete|remove|clear|done with|tick off|cross off)\s+note\s+#?(\d+)$/i;
const CLEAR = /^(?:clear|delete|remove|wipe)\s+(?:all\s+)?(?:my\s+|the\s+)?notes$/i;

export class NotesTool implements LocalTool {
  readonly id = "notes";
  readonly name = "Notes";
  readonly icon = "🗒";
  readonly description = "Quick notes on this Mac: note buy milk, notes, delete note 2.";
  private cache: Note[] | null = null;

  constructor(
    private readonly store: NotesStore,
    private readonly now: () => number = Date.now,
  ) {}

  async handle(raw: string): Promise<ToolReply | null> {
    const input = raw.trim().replace(/^lucy[,:!\s]+/i, "");
    if (LIST.test(normalizeInput(input))) return this.list();
    if (CLEAR.test(normalizeInput(input))) return this.clear();
    const del = DELETE.exec(normalizeInput(input));
    if (del) return this.remove(parseInt(del[1], 10));
    const add = ADD.exec(input);
    if (add) return this.add(add[1]);
    return null;
  }

  async all(): Promise<Note[]> {
    if (!this.cache) this.cache = await this.store.load().catch(() => []);
    return this.cache;
  }

  private async persist(notes: Note[]): Promise<boolean> {
    try {
      await this.store.save(notes);
      this.cache = notes;
      return true;
    } catch {
      return false;
    }
  }

  private async add(text: string): Promise<ToolReply> {
    const clean = text.trim().slice(0, MAX_NOTE_CHARS);
    const notes = await this.all();
    if (notes.length >= MAX_NOTES) {
      return { title: "Notes", text: `That's ${MAX_NOTES} notes — delete a few first ("delete note 1").` };
    }
    const next = [...notes, { text: clean, created: this.now() }];
    if (!(await this.persist(next))) return { title: "Notes", text: "I couldn't save that note." };
    return {
      title: "Noted",
      text: `🗒 ${clean}\n\nThat's note ${next.length}. Say "notes" to see them all.`,
      speech: "Noted.",
      gesture: "happy",
    };
  }

  async list(): Promise<ToolReply> {
    const notes = await this.all();
    if (!notes.length) return { title: "Notes", text: 'No notes yet. Try "note buy milk".' };
    const lines = notes.map((n, i) => `${i + 1}. ${n.text.replace(/\s*\n\s*/g, " ")}`);
    return {
      title: `Notes (${notes.length})`,
      text: `${lines.join("\n")}\n\nSay "delete note 2" when one's done.`,
      speech: notes.length === 1 ? "You've got one note." : `You've got ${notes.length} notes.`,
    };
  }

  private async remove(index: number): Promise<ToolReply> {
    const notes = await this.all();
    const target = notes[index - 1];
    if (!target) return { title: "Notes", text: `There's no note ${index}.` };
    const next = notes.filter((_, i) => i !== index - 1);
    if (!(await this.persist(next))) return { title: "Notes", text: "I couldn't update your notes." };
    return { title: "Notes", text: `Deleted note ${index}: ${target.text}`, speech: "Done." };
  }

  private async clear(): Promise<ToolReply> {
    const notes = await this.all();
    if (!notes.length) return { title: "Notes", text: "No notes to clear." };
    if (!(await this.persist([]))) return { title: "Notes", text: "I couldn't clear your notes." };
    return { title: "Notes", text: `Cleared ${notes.length} note${notes.length === 1 ? "" : "s"}.` };
  }
}
