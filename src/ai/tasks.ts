import type { ChatMessage } from "./AIProvider";
import { PromptBuilder, type BuiltPrompt, type PromptPrefs } from "./PromptBuilder";

export type PetTask = "chat" | "translate" | "define" | "explain" | "summarize" | "rewrite" | "grammar" | "ask";

export interface TaskContext {
  selectedText?: string;
  userPrompt?: string;
  /** Explicit translation target, overriding the setting. */
  language?: string;
  clipboardText?: string;
  history?: ChatMessage[];
}

export interface TaskResult {
  task: PetTask;
  title: string;
  text: string;
}

/**
 * One small AI utility. New tasks are added by writing a handler and registering it —
 * the pet UI doesn't need to change (guide §35, future plugins §63).
 */
export interface PetTaskHandler {
  id: PetTask;
  label: string;
  icon: string;
  /** Heading shown above the answer. */
  title: string;
  /** Needs selected (or pasted/clipboard) text to work on. */
  needsText: boolean;
  /** Offered as a button when text is selected. */
  inMenu: boolean;
  buildPrompt(context: TaskContext, prefs: PromptPrefs): BuiltPrompt;
}

/** The text a task should work on: selection first, then clipboard. */
export function subjectText(context: TaskContext): string | undefined {
  return context.selectedText?.trim() || context.clipboardText?.trim() || undefined;
}

const withSubject = (context: TaskContext): TaskContext => ({ ...context, selectedText: subjectText(context) });

export const TranslateTask: PetTaskHandler = {
  id: "translate",
  label: "Translate",
  icon: "🌐",
  title: "Translation",
  needsText: true,
  inMenu: true,
  buildPrompt: (c, prefs) => PromptBuilder.translate(withSubject(c), prefs),
};

export const ExplainTask: PetTaskHandler = {
  id: "explain",
  label: "Explain",
  icon: "💡",
  title: "Explanation",
  needsText: true,
  inMenu: true,
  buildPrompt: (c) => PromptBuilder.explain(withSubject(c)),
};

export const DefineTask: PetTaskHandler = {
  id: "define",
  label: "Define",
  icon: "📖",
  title: "Definition",
  needsText: true,
  inMenu: true,
  buildPrompt: (c) => PromptBuilder.define(withSubject(c)),
};

export const SummarizeTask: PetTaskHandler = {
  id: "summarize",
  label: "Summarize",
  icon: "📝",
  title: "Summary",
  needsText: true,
  inMenu: true,
  buildPrompt: (c) => PromptBuilder.summarize(withSubject(c)),
};

export const RewriteTask: PetTaskHandler = {
  id: "rewrite",
  label: "Rewrite",
  icon: "✨",
  title: "Rewritten",
  needsText: true,
  inMenu: true,
  buildPrompt: (c) => PromptBuilder.rewrite(withSubject(c)),
};

export const GrammarTask: PetTaskHandler = {
  id: "grammar",
  label: "Fix grammar",
  icon: "✅",
  title: "Corrected",
  needsText: true,
  inMenu: true,
  buildPrompt: (c) => PromptBuilder.grammar(withSubject(c)),
};

export const AskTask: PetTaskHandler = {
  id: "ask",
  label: "Ask AI…",
  icon: "💬",
  title: "Answer",
  needsText: false,
  inMenu: false,
  buildPrompt: (c, prefs) => PromptBuilder.ask(withSubject(c), prefs),
};

export const ChatTask: PetTaskHandler = {
  id: "chat",
  label: "Chat",
  icon: "💬",
  title: "Chat",
  needsText: false,
  inMenu: false,
  buildPrompt: (c, prefs) => PromptBuilder.chat(c, prefs),
};

export const DEFAULT_TASKS: PetTaskHandler[] = [
  TranslateTask,
  ExplainTask,
  DefineTask,
  SummarizeTask,
  RewriteTask,
  GrammarTask,
  AskTask,
  ChatTask,
];
