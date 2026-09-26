/** Provider-agnostic AI interface. Implementations must support cancellation. */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  system: string;
  signal?: AbortSignal;
  /** Called for each streamed chunk with the chunk and the full text so far. */
  onDelta?: (delta: string, full: string) => void;
  /** The provider discarded what it streamed so far (e.g. switched models). */
  onReset?: () => void;
}

export interface AIProvider {
  chat(messages: ChatMessage[], options: ChatOptions): Promise<string>;
  complete(prompt: string, options: ChatOptions): Promise<string>;
}

export type AIErrorKind =
  | "not_configured"
  | "ai_disabled"
  | "invalid_url"
  | "network"
  | "timeout"
  | "auth"
  | "rate_limit"
  | "invalid_model"
  | "unavailable"
  | "refused"
  | "bad_request"
  | "bad_response"
  | "cancelled"
  | "unknown";

export class AIError extends Error {
  constructor(
    readonly kind: AIErrorKind,
    message: string = kind,
  ) {
    super(message);
    this.name = "AIError";
  }
}

export function isCancellation(error: unknown): boolean {
  return error instanceof AIError && error.kind === "cancelled";
}

/** What Lucy says. Technical detail goes to the log, never the bubble. */
export function friendlyError(error: unknown): string {
  const kind = error instanceof AIError ? error.kind : "unknown";
  switch (kind) {
    case "not_configured":
      return "Connect an AI provider first, choom — then I can do that.";
    case "ai_disabled":
      return "AI requests are switched off in Settings.";
    case "invalid_url":
      return "That AI endpoint in Settings looks off.";
    case "network":
      return "Can't reach my AI brain right now. The Net's being difficult.";
    case "timeout":
      return "The Net's crawling. Give it another shot?";
    case "auth":
      return "My API key got rejected. Check it in Settings.";
    case "rate_limit":
      return "Rate-limited. Give me a moment.";
    case "invalid_model":
      return "Can't find that AI model. Check Settings.";
    case "unavailable":
      return "The AI's jammed up right now. Try again soon.";
    case "refused":
      return "Not touching that one.";
    default:
      return "Something glitched. Try again?";
  }
}

/** Errors the user fixes in Settings (the bubble offers a Settings button). */
export function needsSettings(error: unknown): boolean {
  return (
    error instanceof AIError &&
    ["not_configured", "ai_disabled", "invalid_url", "auth", "invalid_model"].includes(error.kind)
  );
}
