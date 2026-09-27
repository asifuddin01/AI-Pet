import type { ChatMessage } from "./AIProvider";
import { PromptBuilder, type BuiltPrompt, type PromptPrefs } from "./PromptBuilder";

export type PetTask = "chat" | "translate" | "define" | "explain" | "code" | "summarize" | "rewrite" | "grammar" | "ask" | "search";

export interface TaskContext {
  selectedText?: string;
  userPrompt?: string;
  /** Explicit translation target, overriding the setting. */
  language?: string;
  clipboardText?: string;
  history?: ChatMessage[];
  /** Web results the answer should be based on (search task). */
  searchResults?: { title: string; link: string; snippet: string; site: string }[];
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
  /** Only offered when this returns true for the selected text. */
  showFor?: (text: string) => boolean;
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

/**
 * Rough "is this source code?" check: a few strong signals (keywords at line starts,
 * braces and semicolons at line ends, arrows, tags) — prose rarely hits two of them.
 */
export function looksLikeCode(text: string): boolean {
  const sample = text.slice(0, 4000);
  const lines = sample.split("\n").filter((l) => l.trim());
  if (!lines.length) return false;
  let score = 0;
  const keyword =
    /^\s*(?:function|def|class|import|from\s+\S+\s+import|export|const|let|var|return|if\s*\(|for\s*\(|while\s*\(|public|private|fn|struct|impl|package|#include|using|SELECT|INSERT|UPDATE|CREATE)\b/i;
  const keywordLines = lines.filter((l) => keyword.test(l)).length;
  if (keywordLines) score += keywordLines >= 2 ? 2 : 1;
  const endings = lines.filter((l) => /[;{}]\s*$/.test(l)).length;
  if (endings / lines.length > 0.3) score += 2;
  else if (endings) score += 1;
  if (/=>|->|::|\+\+|&&|\|\||!==|===|<\/\w+>|\w+\([^)]*\)\s*[{:]/.test(sample)) score += 1;
  if (/^\s{2,}\S/m.test(sample) && lines.length > 1) score += 1;
  return score >= 3;
}

export const CodeTask: PetTaskHandler = {
  id: "code",
  label: "Explain code",
  icon: "🧑‍💻",
  title: "Code explained",
  needsText: true,
  inMenu: true,
  showFor: looksLikeCode,
  buildPrompt: (c) => PromptBuilder.code(withSubject(c)),
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

/** Answers a question from web results the pet fetched (the model doesn't browse). */
export const SearchTask: PetTaskHandler = {
  id: "search",
  label: "Search web",
  icon: "🔎",
  title: "From the web",
  needsText: false,
  inMenu: false,
  buildPrompt: (c) => PromptBuilder.search(c),
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
  CodeTask,
  ExplainTask,
  DefineTask,
  SummarizeTask,
  RewriteTask,
  GrammarTask,
  AskTask,
  SearchTask,
  ChatTask,
];
