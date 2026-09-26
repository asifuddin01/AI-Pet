/** Lightweight, offline script-based language detection (no dependencies). */

export type Script =
  | "bengali"
  | "devanagari"
  | "arabic"
  | "cyrillic"
  | "hangul"
  | "kana"
  | "han"
  | "thai"
  | "latin"
  | "unknown";

const RANGES: [Script, RegExp][] = [
  ["bengali", /[ঀ-৿]/u],
  ["devanagari", /[ऀ-ॿ]/u],
  ["arabic", /[؀-ۿݐ-ݿ]/u],
  ["cyrillic", /[Ѐ-ӿ]/u],
  ["hangul", /[가-힯ᄀ-ᇿ]/u],
  ["kana", /[぀-ヿ]/u],
  ["han", /[一-鿿㐀-䶿]/u],
  ["thai", /[฀-๿]/u],
  ["latin", /[A-Za-zÀ-ɏ]/u],
];

/** Dominant writing system of the text's letters. */
export function detectScript(text: string): Script {
  const counts = new Map<Script, number>();
  for (const ch of text) {
    for (const [script, re] of RANGES) {
      if (re.test(ch)) {
        counts.set(script, (counts.get(script) ?? 0) + 1);
        break;
      }
    }
  }
  // Any kana means Japanese even though most characters may be Han.
  if ((counts.get("kana") ?? 0) > 0) return "kana";
  let best: Script = "unknown";
  let max = 0;
  for (const [script, n] of counts) {
    if (n > max) {
      best = script;
      max = n;
    }
  }
  return best;
}

const SCRIPT_LANGUAGE: Record<Script, { name: string; bcp47: string } | null> = {
  bengali: { name: "Bangla", bcp47: "bn-IN" },
  devanagari: { name: "Hindi", bcp47: "hi-IN" },
  arabic: { name: "Arabic", bcp47: "ar-SA" },
  cyrillic: { name: "Russian", bcp47: "ru-RU" },
  hangul: { name: "Korean", bcp47: "ko-KR" },
  kana: { name: "Japanese", bcp47: "ja-JP" },
  han: { name: "Chinese", bcp47: "zh-CN" },
  thai: { name: "Thai", bcp47: "th-TH" },
  // Latin script can't be pinned to one language offline; English is the common case.
  latin: { name: "English", bcp47: "en-US" },
  unknown: null,
};

export function detectLanguage(text: string): { name: string; bcp47: string } | null {
  return SCRIPT_LANGUAGE[detectScript(text)];
}

/** BCP-47 tag used to pick a TTS voice that can pronounce the text. */
export function speechLangFor(text: string): string | undefined {
  return detectLanguage(text)?.bcp47;
}

export const TRANSLATE_LANGUAGES = [
  "English",
  "Bangla",
  "Japanese",
  "Chinese",
  "Korean",
  "Hindi",
  "Arabic",
  "Spanish",
  "French",
  "German",
  "Russian",
] as const;

export interface TranslationPlan {
  /** Instruction for the model, e.g. "into English". */
  instruction: string;
  /** Short label for the UI, e.g. "Bangla → English". */
  label: string;
}

/**
 * Auto mode: non-English text → English; English text → the user's second language
 * (Bangla by default). Latin-script text might not be English, so in that case the
 * model is told to decide.
 */
export function planTranslation(text: string, target: string, secondLanguage: string): TranslationPlan {
  if (target && target.toLowerCase() !== "auto") {
    return { instruction: `into ${target}`, label: `→ ${target}` };
  }
  const detected = detectLanguage(text);
  if (!detected) {
    return { instruction: "into English", label: "→ English" };
  }
  if (detected.name === "English") {
    return {
      instruction: `into ${secondLanguage} if the text is English; otherwise into English`,
      label: `English → ${secondLanguage}`,
    };
  }
  return { instruction: "into English", label: `${detected.name} → English` };
}
