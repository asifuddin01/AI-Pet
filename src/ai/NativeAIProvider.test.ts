import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Replace the Tauri bridge with a controllable fake.
const bridge = vi.hoisted(() => ({
  channels: [] as { onmessage: (m: unknown) => void }[],
  cancelled: [] as number[],
  requests: [] as { requestId: number }[],
}));

vi.mock("../services/native", () => ({
  Channel: class {
    onmessage: (m: unknown) => void = () => undefined;
    constructor() {
      bridge.channels.push(this);
    }
  },
  native: {
    aiStream: vi.fn(async (requestId: number) => {
      bridge.requests.push({ requestId });
    }),
    aiCancel: vi.fn(async (requestId: number) => {
      bridge.cancelled.push(requestId);
    }),
  },
}));

import { AIError, isCancellation } from "./AIProvider";
import { NativeAIProvider } from "./NativeAIProvider";

const last = () => bridge.channels[bridge.channels.length - 1];

describe("NativeAIProvider", () => {
  beforeEach(() => {
    bridge.channels.length = 0;
    bridge.cancelled.length = 0;
    bridge.requests.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("streams deltas and resolves with the full text", async () => {
    const deltas: string[] = [];
    const p = new NativeAIProvider(() => 5000).chat([{ role: "user", content: "hi" }], {
      system: "s",
      onDelta: (d) => deltas.push(d),
    });
    last().onmessage({ event: "delta", data: { text: "Hel" } });
    last().onmessage({ event: "delta", data: { text: "lo" } });
    last().onmessage({ event: "done" });
    await expect(p).resolves.toBe("Hello");
    expect(deltas).toEqual(["Hel", "lo"]);
  });

  it("maps provider errors to typed AIErrors", async () => {
    const p = new NativeAIProvider(() => 5000).chat([{ role: "user", content: "hi" }], { system: "s" });
    last().onmessage({ event: "error", data: { kind: "rate_limit", message: "HTTP 429" } });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AIError);
    expect((err as AIError).kind).toBe("rate_limit");
  });

  it("cancels the native request when aborted, and ignores late chunks", async () => {
    const controller = new AbortController();
    const onDelta = vi.fn();
    const p = new NativeAIProvider(() => 5000).chat([{ role: "user", content: "hi" }], {
      system: "s",
      signal: controller.signal,
      onDelta,
    });
    await Promise.resolve();
    controller.abort();
    const err = await p.catch((e: unknown) => e);
    expect(isCancellation(err)).toBe(true);
    expect(bridge.cancelled).toEqual([bridge.requests[0].requestId]);
    last().onmessage({ event: "delta", data: { text: "late" } });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it("never gets stuck: a silent provider times out", async () => {
    vi.useFakeTimers();
    const p = new NativeAIProvider(() => 1000).chat([{ role: "user", content: "hi" }], { system: "s" });
    const settled = p.catch((e: unknown) => e);
    vi.advanceTimersByTime(1001);
    const err = await settled;
    expect((err as AIError).kind).toBe("timeout");
    expect(bridge.cancelled).toHaveLength(1);
  });

  it("clears text when the provider resets mid-stream", async () => {
    const onReset = vi.fn();
    const p = new NativeAIProvider(() => 5000).chat([{ role: "user", content: "hi" }], { system: "s", onReset });
    last().onmessage({ event: "delta", data: { text: "partial" } });
    last().onmessage({ event: "reset" });
    last().onmessage({ event: "delta", data: { text: "fresh" } });
    last().onmessage({ event: "done" });
    await expect(p).resolves.toBe("fresh");
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("rejects immediately when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const p = new NativeAIProvider(() => 5000).chat([{ role: "user", content: "hi" }], {
      system: "s",
      signal: controller.signal,
    });
    await expect(p).rejects.toSatisfy(isCancellation);
    expect(bridge.requests).toHaveLength(0);
  });
});
