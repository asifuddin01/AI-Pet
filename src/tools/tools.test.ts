import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculate, CalculatorTool } from "./calculator";
import { ClockTool, zoneFor } from "./clock";
import { Toolbox } from "./index";
import { NotesTool, type Note, type NotesStore } from "./notes";
import { Pomodoro } from "./pomodoro";
import { formatClock, formatDuration, parseClockTime, parseDuration } from "./time";
import { splitDurationLabel, Timers } from "./timers";
import type { ToolHost, ToolReply } from "./types";
import { parseConversion, UnitsTool } from "./units";

const value = (input: string) => calculate(input)?.value;

function memoryStore(initial: Note[] = []): NotesStore & { notes: Note[] } {
  const store = {
    notes: initial,
    load: async () => store.notes,
    save: async (notes: Note[]) => {
      store.notes = notes;
    },
  };
  return store;
}

function recordingHost(): ToolHost & { alerts: ToolReply[]; focus: boolean[] } {
  const host = {
    alerts: [] as ToolReply[],
    focus: [] as boolean[],
    alert: (r: ToolReply) => void host.alerts.push(r),
    setFocus: (on: boolean) => void host.focus.push(on),
  };
  return host;
}

describe("calculator", () => {
  it("evaluates arithmetic with precedence, powers and parentheses", () => {
    expect(value("25*4")).toBe(100);
    expect(value("2 + 3 * 4")).toBe(14);
    expect(value("(2 + 3) * 4")).toBe(20);
    expect(value("2^10")).toBe(1024);
    expect(value("2**3**2")).toBe(512); // right-associative
    expect(value("-2^2")).toBe(-4);
    expect(value("10 / 4")).toBe(2.5);
    expect(value("7 mod 3")).toBe(1);
    expect(value("10 % 3")).toBe(1);
    expect(value("5!")).toBe(120);
  });

  it("understands words, percentages, functions, constants and implicit multiplication", () => {
    expect(value("what is 12 times 7?")).toBe(84);
    expect(value("15% of 80")).toBe(12);
    expect(value("12 x 7")).toBe(84);
    expect(value("sqrt(16) + sqrt 9")).toBe(7);
    expect(value("2pi")).toBeCloseTo(Math.PI * 2);
    expect(value("2(3+4)")).toBe(14);
    expect(value("sin(90 deg)")).toBeCloseTo(1);
    expect(value("1,234 + 1")).toBe(1235);
    expect(value("৫ + ৩")).toBe(8); // Bangla digits
    expect(value("max(3, 9, 4)")).toBe(9);
    expect(value("3 squared")).toBe(9);
  });

  it("leaves ordinary chat and bare numbers alone", () => {
    for (const text of ["hello", "42", "I have 2 cats", "what is love", "2024", "12/05/2024", "call me at 5", "top 10 movies"]) {
      expect(calculate(text), text).toBeNull();
    }
  });

  it("formats the answer and flags division by zero", () => {
    expect(CalculatorTool.handle("1/3")).toMatchObject({ text: expect.stringContaining("**0.3333333333**") });
    expect(CalculatorTool.handle("2 * 1000000")).toMatchObject({ text: expect.stringContaining("2,000,000") });
    expect((CalculatorTool.handle("1/0") as ToolReply).text).toContain("no answer");
  });
});

describe("unit conversion", () => {
  it("converts common units", () => {
    const miles = parseConversion("10 km to miles");
    expect(miles && "result" in miles ? miles.result : NaN).toBeCloseTo(6.2137, 3);
    const temp = parseConversion("72 f in c");
    expect(temp && "result" in temp ? temp.result : NaN).toBeCloseTo(22.22, 2);
    const cups = parseConversion("convert 2 cups into ml");
    expect(cups && "result" in cups ? cups.result : NaN).toBeCloseTo(473.18, 1);
    const data = parseConversion("1.5 GB in MB");
    expect(data && "result" in data ? data.result : NaN).toBe(1500);
    const inch = parseConversion("1 inch in cm");
    expect(inch && "result" in inch ? inch.result : NaN).toBeCloseTo(2.54);
    const speed = parseConversion("60 mph to km/h");
    expect(speed && "result" in speed ? speed.result : NaN).toBeCloseTo(96.56, 1);
    const kelvin = parseConversion("0 degrees celsius to kelvin");
    expect(kelvin && "result" in kelvin ? kelvin.result : NaN).toBeCloseTo(273.15);
  });

  it("explains incompatible units and ignores non-conversions", () => {
    expect(parseConversion("5 kg to km")).toEqual({ error: expect.stringContaining("different things") });
    expect(parseConversion("I put 2 apples in a basket")).toBeNull();
    expect(UnitsTool.handle("what's up")).toBeNull();
    expect((UnitsTool.handle("5 ft in cm") as ToolReply).text).toBe("5 ft = **152.4 cm**");
  });
});

describe("time parsing", () => {
  it("parses durations", () => {
    expect(parseDuration("5 min")).toBe(300_000);
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("1 hour and 30 minutes")).toBe(5_400_000);
    expect(parseDuration("1.5 hours")).toBe(5_400_000);
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("half an hour")).toBe(1_800_000);
    expect(parseDuration("an hour")).toBe(3_600_000);
    expect(parseDuration("5", true)).toBe(300_000);
    expect(parseDuration("5")).toBeNull();
    expect(parseDuration("5 apples")).toBeNull();
  });

  it("parses clock times as the next occurrence", () => {
    const now = new Date(2026, 8, 27, 16, 0);
    expect(parseClockTime("5pm", now)?.getHours()).toBe(17);
    expect(parseClockTime("5:30 pm", now)?.getMinutes()).toBe(30);
    const earlier = parseClockTime("09:15", now)!;
    expect(earlier.getDate()).toBe(28); // already passed today → tomorrow
    expect(parseClockTime("5", now)).toBeNull();
    expect(parseClockTime("13pm", now)).toBeNull();
  });

  it("formats durations and countdowns", () => {
    expect(formatDuration(300_000)).toBe("5 min");
    expect(formatDuration(3_900_000)).toBe("1 h 5 min");
    expect(formatClock(252_000)).toBe("4:12");
    expect(formatClock(3_723_000)).toBe("1:02:03");
  });
});

describe("timers and reminders", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("splits a duration from its label", () => {
    expect(splitDurationLabel("10 min tea")).toEqual({ ms: 600_000, label: "tea" });
    expect(splitDurationLabel("1 hour for the oven")).toEqual({ ms: 3_600_000, label: "the oven" });
    expect(splitDurationLabel("soon")).toBeNull();
  });

  it("sets timers in several phrasings and rings them", () => {
    const host = recordingHost();
    const timers = new Timers(host);
    expect(timers.handle("timer 5 min")?.title).toBe("Timer set");
    expect(timers.handle("set a 10 minute timer for pasta")?.title).toBe("Timer set");
    expect(timers.handle("hey lucy, set a timer for 1h")?.title).toBe("Timer set");
    expect(timers.active().map((t) => t.label)).toEqual(["", "pasta", ""]);
    vi.advanceTimersByTime(5 * 60_000);
    expect(host.alerts.map((a) => a.title)).toEqual(["⏰ Time's up!"]);
    vi.advanceTimersByTime(5 * 60_000);
    expect(host.alerts[1].text).toContain("pasta");
    expect(timers.active()).toHaveLength(1);
  });

  it("sets reminders and keeps the user's wording", () => {
    const host = recordingHost();
    const timers = new Timers(host);
    expect(timers.handle("Remind me in 20 min to Call Mum")?.title).toBe("Reminder set");
    expect(timers.handle("remind me to stretch in 1 hour")?.title).toBe("Reminder set");
    vi.advanceTimersByTime(20 * 60_000);
    expect(host.alerts[0]).toMatchObject({ title: "⏰ Reminder", text: "**Call Mum**" });
  });

  it("lists and cancels timers", () => {
    const timers = new Timers(recordingHost());
    timers.handle("timer 5 min eggs");
    timers.handle("timer 10 min");
    expect(timers.handle("timers")?.text).toContain("eggs");
    expect(timers.handle("cancel timer 1")?.text).toContain("eggs");
    expect(timers.active()).toHaveLength(1);
    expect(timers.handle("cancel timers")?.text).toBe("Timer cancelled.");
    expect(timers.statusLine()).toBeNull();
  });

  it("rejects silly durations and ignores unrelated text", () => {
    const timers = new Timers(recordingHost());
    expect(timers.handle("timer 2 days")?.text).toBeUndefined(); // "days" isn't a timer unit
    expect(timers.handle("timer 30 hours")?.text).toContain("24 hours");
    expect(timers.handle("what is a timer")).toBeNull();
    expect(timers.handle("the timer on my oven broke")).toBeNull();
  });
});

describe("pomodoro", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cycles focus and breaks, with a long break every fourth round", () => {
    const host = recordingHost();
    const p = new Pomodoro(host);
    expect(p.handle("start pomodoro")?.title).toBe("🍅 Focus on");
    expect(host.focus).toEqual([true]);
    vi.advanceTimersByTime(25 * 60_000);
    expect(p.phase).toBe("break");
    expect(host.alerts[0].title).toBe("☕ Break time");
    expect(host.focus).toEqual([true, false]);
    vi.advanceTimersByTime(5 * 60_000);
    expect(p.phase).toBe("focus");
    expect(host.alerts[1].title).toBe("🍅 Back to it");
    // rounds 2-4
    vi.advanceTimersByTime(25 * 60_000 + 5 * 60_000 + 25 * 60_000 + 5 * 60_000 + 25 * 60_000);
    expect(p.phase).toBe("long-break");
    expect(p.handle("stop pomodoro")?.text).toContain("4 rounds");
    expect(p.running).toBe(false);
  });

  it("accepts custom lengths", () => {
    const p = new Pomodoro(recordingHost());
    p.handle("focus 50/10");
    expect(p.focusMin).toBe(50);
    expect(p.breakMin).toBe(10);
    expect(p.statusLine()).toMatch(/^🍅 Focus 50:00/);
    expect(p.handle("focus on your work")).toBeNull();
  });
});

describe("notes", () => {
  it("adds, lists, deletes and clears notes", async () => {
    const store = memoryStore();
    const notes = new NotesTool(store, () => 1);
    expect((await notes.handle("note buy milk"))?.title).toBe("Noted");
    expect((await notes.handle("note: call the bank"))?.text).toContain("note 2");
    expect(store.notes.map((n) => n.text)).toEqual(["buy milk", "call the bank"]);
    expect((await notes.handle("notes"))?.text).toContain("1. buy milk\n2. call the bank");
    expect((await notes.handle("delete note 1"))?.text).toContain("buy milk");
    expect(store.notes.map((n) => n.text)).toEqual(["call the bank"]);
    expect((await notes.handle("clear notes"))?.text).toBe("Cleared 1 note.");
    expect(await notes.handle("I noticed something")).toBeNull();
  });
});

describe("clock", () => {
  it("finds time zones by city or alias", () => {
    expect(zoneFor("Dhaka")).toBe("Asia/Dhaka");
    expect(zoneFor("new york")).toBe("America/New_York");
    expect(zoneFor("Night City")).toBe("America/Los_Angeles");
    expect(zoneFor("Atlantis")).toBeNull();
  });

  it("answers time and date questions only", () => {
    expect(ClockTool.handle("what time is it?")?.title).toBe("Time");
    expect(ClockTool.handle("date")?.title).toBe("Today");
    expect(ClockTool.handle("time in Tokyo")?.title).toBe("Time in Tokyo");
    expect(ClockTool.handle("time flies")).toBeNull();
  });
});

describe("toolbox routing", () => {
  it("routes to the right tool and lets everything else through to the AI", async () => {
    vi.useFakeTimers();
    const box = new Toolbox(recordingHost(), memoryStore());
    expect((await box.handle("25*4"))?.title).toBe("Calculator");
    expect((await box.handle("10 km to miles"))?.title).toBe("Convert");
    expect((await box.handle("timer 5 min"))?.title).toBe("Timer set");
    expect((await box.handle("pomodoro"))?.title).toBe("🍅 Focus on");
    expect((await box.handle("note ship it"))?.title).toBe("Noted");
    expect(box.statusLine()).toMatch(/🍅 Focus 25:00 · round 1 · ⏱ 5:00/);
    for (const chat of ["hey lucy, how are you?", "explain quantum physics", "what's 'serendipity' mean", "tell me a joke about 2 cats"]) {
      expect(await box.handle(chat), chat).toBeNull();
    }
    box.dispose();
    expect(box.statusLine()).toBeNull();
    vi.useRealTimers();
  });
});
