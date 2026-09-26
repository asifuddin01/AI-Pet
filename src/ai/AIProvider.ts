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

/** What the pet says. Technical detail goes to the log, never the bubble. */
export function friendlyError(error: unknown): string {
  const kind = error instanceof AIError ? error.kind : "unknown";
  switch (kind) {
    case "not_configured":
      return "Connect an AI provider to use this feature.";
    case "ai_disabled":
      return "AI requests are turned off in Settings.";
    case "invalid_url":
      return "The AI endpoint in Settings doesn't look right.";
    case "network":
      return "Hmm... I couldn't reach my AI brain right now.";
    case "timeout":
      return "My AI brain is taking too long. Try again?";
    case "auth":
      return "My API key didn't work. Check it in Settings.";
    case "rate_limit":
      return "I'm being rate-limited. Give me a moment!";
    case "invalid_model":
      return "I couldn't find that AI model. Check Settings.";
    case "unavailable":
      return "My AI brain is busy right now. Try again soon.";
    case "refused":
      return "I can't help with that one.";
    default:
      return "Oops, something went wrong. Try again?";
  }
}

/** Errors the user fixes in Settings (the bubble offers a Settings button). */
export function needsSettings(error: unknown): boolean {
  return (
    error instanceof AIError &&
    ["not_configured", "ai_disabled", "invalid_url", "auth", "invalid_model"].includes(error.kind)
  );
}
