import { Channel, native, type StreamEvent } from "../services/native";
import { AIError, type AIErrorKind, type AIProvider, type ChatMessage, type ChatOptions } from "./AIProvider";

let nextRequestId = 1;

/**
 * Streams from whichever provider is configured (OpenAI-compatible or Anthropic).
 * The HTTP call happens in Rust so the API key never enters the webview; this class
 * only moves prompts in and text chunks out.
 */
export class NativeAIProvider implements AIProvider {
  /** Safety net: never leave the pet stuck in THINKING if the native side goes quiet. */
  constructor(private readonly watchdogMs: () => number) {}

  complete(prompt: string, options: ChatOptions): Promise<string> {
    return this.chat([{ role: "user", content: prompt }], options);
  }

  chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const requestId = nextRequestId++;
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(new AIError("cancelled"));

    return new Promise<string>((resolve, reject) => {
      let text = "";
      let settled = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const armWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          native.aiCancel(requestId).catch(() => undefined);
          finish(() => reject(new AIError("timeout")));
        }, this.watchdogMs());
      };
      const onAbort = () => {
        native.aiCancel(requestId).catch(() => undefined);
        finish(() => reject(new AIError("cancelled")));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const channel = new Channel<StreamEvent>();
      channel.onmessage = (message) => {
        if (settled) return;
        armWatchdog();
        switch (message.event) {
          case "delta":
            text += message.data.text;
            options.onDelta?.(message.data.text, text);
            break;
          case "reset":
            text = "";
            options.onReset?.();
            break;
          case "done":
            finish(() => resolve(text));
            break;
          case "error":
            finish(() => reject(new AIError(message.data.kind as AIErrorKind, message.data.message)));
            break;
        }
      };

      armWatchdog();
      native
        .aiStream(requestId, { system: options.system, messages }, channel)
        .catch((e) => finish(() => reject(new AIError("unknown", String(e)))));
    });
  }
}
