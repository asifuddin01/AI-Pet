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
    voiceStart: vi.fn(async (_c: unknown, mode: string) => void bridge.calls.push(`start:${mode}`)),
    voiceCancel: vi.fn(async () => void bridge.calls.push("cancel")),
  },
}));

import { RECYCLE_MS, UTTERANCE_PAUSE_MS, WakeService, type Wake } from "./WakeService";

const last = () => bridge.channels[bridge.channels.length - 1];
const say = (text: string) => last().onmessage({ event: "partial", data: { text } });

describe("WakeService", () => {
  let woke: Wake[];
  let problems: string[];
  let service: WakeService;

  beforeEach(async () => {
    vi.useFakeTimers();
    bridge.channels.length = 0;
    bridge.calls.length = 0;
    woke = [];
    problems = [];
    service = new WakeService({ onWake: (w) => void woke.push(w), onUnavailable: (m) => void problems.push(m) });
    service.setActive(true);
    await vi.advanceTimersByTimeAsync(300);
    last().onmessage({ event: "started" });
  });
  afterEach(() => vi.useRealTimers());

  it("listens on-device and forgets ordinary talk after each pause", async () => {
    expect(bridge.calls).toEqual(["start:wake"]);
    say("so I told him");
    say("so I told him the meeting moved");
    await vi.advanceTimersByTimeAsync(UTTERANCE_PAUSE_MS + 10);
    expect(woke).toEqual([]);
    expect(bridge.calls).toContain("cancel");
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.calls.filter((c) => c === "start:wake")).toHaveLength(2); // listening afresh
  });

  it("hands over when she's called, and stays off until switched back on", async () => {
    say("hey Lucy");
    say("hey Lucy what time is it");
    await vi.advanceTimersByTimeAsync(UTTERANCE_PAUSE_MS + 10);
    expect(woke).toEqual([{ kind: "request", text: "what time is it" }]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bridge.calls.filter((c) => c === "start:wake")).toHaveLength(1);
    expect(service.active).toBe(false);
    service.setActive(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.calls.filter((c) => c === "start:wake")).toHaveLength(2);
  });

  it("recycles long sessions and checks what was said", async () => {
    say("I'm home");
    await vi.advanceTimersByTimeAsync(RECYCLE_MS);
    expect(woke[0]).toEqual({ kind: "home", rest: "" });
  });

  it("gives up quietly-but-clearly on permission or language problems", async () => {
    last().onmessage({ event: "error", data: { kind: "permission", message: "Allow the mic" } });
    expect(problems).toEqual(["Allow the mic"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(bridge.calls.filter((c) => c === "start:wake")).toHaveLength(1);
    service.reset();
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.calls.filter((c) => c === "start:wake")).toHaveLength(2);
  });

  it("retries after a glitch with growing delays", async () => {
    last().onmessage({ event: "error", data: { kind: "failed", message: "oops" } });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(bridge.calls.filter((c) => c === "start:wake")).toHaveLength(2);
  });
});
