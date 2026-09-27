import { AIError, type AIProvider } from "./AIProvider";
import type { PromptPrefs } from "./PromptBuilder";
import { DEFAULT_TASKS, subjectText, type PetTask, type PetTaskHandler, type TaskContext, type TaskResult } from "./tasks";

export interface TaskRunOptions {
  signal?: AbortSignal;
  onDelta?: (delta: string, full: string) => void;
  onReset?: () => void;
}

/** Runs any registered task through the same AI provider layer. */
export class TaskRunner {
  private readonly handlers = new Map<PetTask, PetTaskHandler>();

  constructor(
    private readonly provider: AIProvider,
    private readonly prefs: () => PromptPrefs,
    handlers: PetTaskHandler[] = DEFAULT_TASKS,
  ) {
    for (const h of handlers) this.register(h);
  }

  register(handler: PetTaskHandler): void {
    this.handlers.set(handler.id, handler);
  }

  get(task: PetTask): PetTaskHandler {
    const handler = this.handlers.get(task);
    if (!handler) throw new Error(`Unknown task: ${task}`);
    return handler;
  }

  /** Buttons offered for the selected text (some tasks only suit some text, e.g. code). */
  menuTasks(text?: string): PetTaskHandler[] {
    return [...this.handlers.values()].filter((h) => h.inMenu && (!h.showFor || (!!text && h.showFor(text))));
  }

  async run(task: PetTask, context: TaskContext, options: TaskRunOptions = {}): Promise<TaskResult> {
    const handler = this.get(task);
    if (handler.needsText && !subjectText(context)) {
      throw new AIError("bad_request", "This task needs some text to work on.");
    }
    if (!handler.needsText && !context.userPrompt?.trim()) {
      throw new AIError("bad_request", "Ask me something first.");
    }
    const { system, messages } = handler.buildPrompt(context, this.prefs());
    const text = await this.provider.chat(messages, { system, ...options });
    return { task, title: handler.title, text: text.trim() };
  }
}
