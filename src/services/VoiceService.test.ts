import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  channels: [] as { onmessage: (m: unknown) => void }[],
  calls: [] as string[],
}));

vi.mock("./native", () => ({
  Channel: class {
    onmessage: (m: unknown) => void = () => undefined;
    constructor() {
      bridge.channels.push(this);
    }
  },
  native: {
    voiceStart: vi.fn(async () => void bridge.calls.push("start")),
    voiceStop: vi.fn(async () => void bridge.calls.push("stop")),
    voiceCancel: vi.fn(async () => void bridge.calls.push("cancel")),
  },
}));

import { MAX_LISTEN_MS, NO_SPEECH_MS, PAUSE_MS, VoiceService, type VoiceHandlers } from "./VoiceService";

const last = () => bridge.channels[bridge.channels.length - 1];

function recorder(): VoiceHandlers & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    onListening: () => void log.push("listening"),
    onPartial: (t) => void log.push(`partial:${t}`),
    onFinal: (t) => void log.push(`final:${t}`),
    onError: (k) => void log.push(`error:${k}`),
  };
}

describe("VoiceService", () => {
  beforeEach(() => {
    bridge.channels.length = 0;
    bridge.calls.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("streams partials and delivers the final transcript", async () => {
    const voice = new VoiceService();
    const h = recorder();
    await voice.start(h, { autoStop: false });
    last().onmessage({ event: "started" });
    last().onmessage({ event: "partial", data: { text: "what's the" } });
    last().onmessage({ event: "partial", data: { text: "what's the time" } });
    await voice.stop();
    last().onmessage({ event: "final", data: { text: " what's the time " } });
    expect(h.log).toEqual(["listening", "partial:what's the", "partial:what's the time", "final:what's the time"]);
    expect(voice.active).toBe(false);
    expect(bridge.calls).toEqual(["start", "stop"]);
  });

  it("stops by itself after a pause in speech, or when nothing is said", async () => {
    const voice = new VoiceService();
    await voice.start(recorder(), { autoStop: true });
    last().onmessage({ event: "started" });
    last().onmessage({ event: "partial", data: { text: "hello" } });
    vi.advanceTimersByTime(PAUSE_MS + 10);
    expect(bridge.calls).toContain("stop");

    bridge.calls.length = 0;
    const quiet = new VoiceService();
    await quiet.start(recorder(), { autoStop: true });
    last().onmessage({ event: "started" });
    vi.advanceTimersByTime(NO_SPEECH_MS + 10);
    expect(bridge.calls).toContain("stop");
  });

  it("hold-to-talk never auto-stops before the time limit", async () => {
    const voice = new VoiceService();
    await voice.start(recorder(), { autoStop: false });
    last().onmessage({ event: "started" });
    vi.advanceTimersByTime(NO_SPEECH_MS * 2);
    expect(bridge.calls).not.toContain("stop");
    vi.advanceTimersByTime(MAX_LISTEN_MS);
    expect(bridge.calls).toContain("stop");
  });

  it("a release before the mic opens closes it quietly", async () => {
    const voice = new VoiceService();
    const h = recorder();
    await voice.start(h, { autoStop: false });
    await voice.stop(); // released while macOS was still asking for permission
    last().onmessage({ event: "started" });
    expect(h.log).toEqual(["final:"]);
    expect(bridge.calls).toEqual(["start", "cancel"]);
  });

  it("ignores events from a cancelled or replaced session", async () => {
    const voice = new VoiceService();
    const first = recorder();
    await voice.start(first, { autoStop: false });
    const stale = last();
    const second = recorder();
    await voice.start(second, { autoStop: false });
    stale.onmessage({ event: "started" });
    stale.onmessage({ event: "final", data: { text: "old" } });
    expect(first.log).toEqual([]);
    last().onmessage({ event: "error", data: { kind: "permission", message: "no mic" } });
    expect(second.log).toEqual(["error:permission"]);
  });

  it("falls back to what it heard if the final result never comes", async () => {
    const voice = new VoiceService();
    const h = recorder();
    await voice.start(h, { autoStop: false });
    last().onmessage({ event: "started" });
    last().onmessage({ event: "partial", data: { text: "remind me" } });
    await voice.stop();
    vi.advanceTimersByTime(20_000);
    expect(h.log).toContain("final:remind me");
    expect(bridge.calls).toContain("cancel");
  });
});
