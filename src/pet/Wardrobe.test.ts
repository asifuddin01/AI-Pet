import { describe, expect, it } from "vitest";

import { chooseVoice } from "../services/TTSService";
import {
  decideMood,
  MOOD_INFO,
  MOOD_OUTFITS,
  MoodTracker,
  OUTFIT_IDS,
  OUTFITS,
  outfitById,
  pickOutfit,
  voiceFor,
  type MoodSignals,
} from "./Wardrobe";

const base: MoodSignals = {
  hour: 14,
  weekday: false,
  minutesIdle: 1,
  interactions: 0,
  tasks: 0,
  errors: 0,
  asleep: false,
};

describe("mood", () => {
  it("is sleepy when asleep or in the small hours", () => {
    expect(decideMood({ ...base, asleep: true })).toBe("sleepy");
    expect(decideMood({ ...base, hour: 3 })).toBe("sleepy");
  });

  it("reacts to errors, lots of attention and work", () => {
    expect(decideMood({ ...base, errors: 2 })).toBe("melancholy");
    expect(decideMood({ ...base, interactions: 6 })).toBe("playful");
    expect(decideMood({ ...base, tasks: 3 })).toBe("focused");
  });

  it("gets dreamy at night", () => {
    expect(decideMood({ ...base, hour: 22 }, () => 0.1)).toBe("dreamy");
  });

  it("every mood has a greeting and outfits that exist", () => {
    for (const [mood, options] of Object.entries(MOOD_OUTFITS)) {
      expect(MOOD_INFO[mood as keyof typeof MOOD_INFO].greeting.length).toBeGreaterThan(3);
      for (const [id] of options) expect(OUTFITS[id]).toBeDefined();
    }
  });
});

describe("wardrobe", () => {
  it("has the requested looks, every one fully dressed", () => {
    expect(OUTFIT_IDS).toEqual(
      expect.arrayContaining(["edgerunner", "nightcity", "netrunner", "pool", "cyberdress", "techwear", "cozy", "moonlight"]),
    );
    for (const id of OUTFIT_IDS) {
      const o = OUTFITS[id];
      expect(o.id).toBe(id);
      expect(o.hair.front).toHaveLength(5);
      expect(o.hair.back).toHaveLength(5);
      // Something always covers the torso and hips.
      const hipsCovered = o.top.style !== "bodysuit" || o.bottom.style !== "none" || o.legs.style === "tights";
      expect(hipsCovered).toBe(true);
    }
  });

  it("picks outfits that suit the mood and changes to something new", () => {
    for (let i = 0; i < 50; i++) {
      const pick = pickOutfit("sleepy", "cozy", Math.random);
      expect(pick).not.toBe("cozy");
      expect(MOOD_OUTFITS.sleepy.map(([id]) => id)).toContain(pick);
    }
    expect(pickOutfit("focused", null, () => 0)).toBe("netrunner");
  });

  it("falls back to the signature outfit for unknown ids", () => {
    expect(outfitById("nope").id).toBe("edgerunner");
    expect(outfitById("pool").name).toBe("Pool day");
  });
});

describe("MoodTracker", () => {
  it("counts recent activity and forgets it after 30 minutes", () => {
    let now = 1_000_000;
    const t = new MoodTracker(() => now);
    t.record("interaction");
    t.record("task");
    t.record("error");
    let s = t.signals(false, new Date(2026, 8, 28, 10)); // Monday 10:00
    expect(s).toMatchObject({ interactions: 1, tasks: 1, errors: 1, weekday: true, hour: 10 });
    now += 31 * 60_000;
    s = t.signals(false, new Date(2026, 8, 27, 10)); // Sunday
    expect(s).toMatchObject({ interactions: 0, tasks: 0, errors: 0, weekday: false });
    expect(s.minutesIdle).toBeGreaterThan(30);
  });
});

describe("Lucy's voice", () => {
  const voices = [
    { name: "Fred", lang: "en-US" },
    { name: "Samantha", lang: "en-US" },
    { name: "Ava (Premium)", lang: "en-US" },
    { name: "Piya", lang: "bn-IN" },
  ];

  it("prefers a calm, high-quality female voice for English", () => {
    expect(chooseVoice(voices, "", "en-US")?.name).toBe("Ava (Premium)");
    expect(chooseVoice(voices, "")?.name).toBe("Ava (Premium)");
  });

  it("respects the user's pick and switches voice for other languages", () => {
    expect(chooseVoice(voices, "Fred", "en-US")?.name).toBe("Fred");
    expect(chooseVoice(voices, "", "bn-IN")?.name).toBe("Piya");
  });

  it("is calm and low-key, slower when sleepy", () => {
    expect(voiceFor("confident").pitch).toBeLessThan(1);
    expect(voiceFor("sleepy").rate).toBeLessThan(voiceFor("playful").rate);
  });
});
