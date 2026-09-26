import { describe, expect, it } from "vitest";

import { detectLanguage, detectScript, planTranslation, speechLangFor } from "./language";

describe("language detection", () => {
  it("detects scripts", () => {
    expect(detectScript("আমার সোনার বাংলা")).toBe("bengali");
    expect(detectScript("Hello world")).toBe("latin");
    expect(detectScript("こんにちは世界")).toBe("kana");
    expect(detectScript("漢字です")).toBe("kana"); // any kana → Japanese
    expect(detectScript("你好世界")).toBe("han");
    expect(detectScript("안녕하세요")).toBe("hangul");
    expect(detectScript("नमस्ते")).toBe("devanagari");
    expect(detectScript("123 !?")).toBe("unknown");
  });

  it("uses the dominant script in mixed text", () => {
    expect(detectScript("আমি Tauri দিয়ে একটি অ্যাপ বানাচ্ছি")).toBe("bengali");
  });

  it("maps to languages and TTS voices", () => {
    expect(detectLanguage("আমি")?.name).toBe("Bangla");
    expect(speechLangFor("আমি ভাত খাই")).toBe("bn-IN");
    expect(speechLangFor("Hello")).toBe("en-US");
    expect(speechLangFor("...")).toBeUndefined();
  });
});

describe("planTranslation (auto mode)", () => {
  it("Bangla → English", () => {
    expect(planTranslation("আমি ভাত খাই", "auto", "Bangla")).toEqual({
      instruction: "into English",
      label: "Bangla → English",
    });
  });

  it("English → the second language, letting the model confirm", () => {
    const plan = planTranslation("Good morning", "auto", "Bangla");
    expect(plan.label).toBe("English → Bangla");
    expect(plan.instruction).toContain("into Bangla");
  });

  it("other scripts → English", () => {
    expect(planTranslation("こんにちは", "auto", "Bangla").label).toBe("Japanese → English");
  });

  it("explicit targets win", () => {
    expect(planTranslation("আমি", "Japanese", "Bangla")).toEqual({ instruction: "into Japanese", label: "→ Japanese" });
  });
});
