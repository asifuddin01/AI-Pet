/**
 * Lucy's wardrobe and moods. Pure data + decision logic (no DOM), so it's testable.
 *
 * Her mood comes from simple signals (time of day, how much you've been talking,
 * errors, idle time, sleep). In "let Lucy decide" mode she occasionally changes into
 * an outfit that fits the mood — and her hair palette changes with it.
 */

export type Mood = "confident" | "focused" | "dreamy" | "sleepy" | "playful" | "melancholy";

export type OutfitId =
  | "edgerunner"
  | "netrunner"
  | "moonlight"
  | "cozy"
  | "nightout"
  | "rain"
  | "pool"
  | "cyberdress"
  | "techwear"
  | "nightcity"
  | "casual"
  | "street"
  | "beach"
  | "gym"
  | "office"
  | "teacher"
  | "sweater"
  | "denim"
  | "sister"
  | "sisterwhite"
  | "commander"
  | "lingerie"
  | "midnight"
  | "babydoll"
  | "shizuku"
  | "saree";

export interface HairPalette {
  /** Five stops from crown to tips (front hair); back hair is derived darker. */
  front: [string, string, string, string, string];
  back: [string, string, string, string, string];
}

export interface Outfit {
  id: OutfitId;
  name: string;
  emoji: string;
  hair: HairPalette;
  /** Bodysuit, swimsuit or dress (the dress replaces top + bottom). */
  top: {
    /** leotard: Lucy's high-neck, sleeveless, high-cut suit; crop: ends under the bust; bikini: a bandeau;
     *  scoop: off-shoulder neckline; deepv: open collar; tee: cropped t-shirt; shirt / shirt-open: a blouse,
     *  buttoned or open (over `underwear`); bra; babydoll. */
    style:
      | "bodysuit"
      | "leotard"
      | "swimsuit"
      | "dress"
      | "crop"
      | "bikini"
      | "bra"
      | "scoop"
      | "deepv"
      | "tee"
      | "shirt"
      | "shirt-open"
      | "babydoll"
      | "saree-blouse";
    from: string;
    to: string;
    accent: string;
    shine: string;
    /** Long sleeves (a sweater / turtleneck) when there's no jacket. */
    sleeves?: boolean;
    /** Plain fabric: no glowing accent lines. */
    matte?: boolean;
  };
  jacket:
    | null
    | {
        style: "cropped" | "hoodie" | "raincoat" | "leather" | "coat";
        from: string;
        to: string;
        lining: string;
        trim: string;
        opacity?: number;
        /** Sleeve colours when they differ from the body of the jacket. */
        sleeve?: [string, string];
        /** Worn slipping off the shoulders. */
        offShoulder?: boolean;
      };
  bottom: {
    style: "shorts" | "skirt" | "jeans" | "bikini" | "panties" | "longskirt" | "pencil" | "saree" | "none";
    color: string;
    /** Trim / hem glow colour. */
    shade: string;
  };
  /** What shows under an open shirt. */
  underwear?: { color: string; trim: string };
  legs: {
    style: "thighhigh" | "tights" | "leggings" | "tights-boots" | "socks" | "sheer-boots" | "boots" | "bare";
    color: string;
    band: string;
    shoe: string;
  };
  extras: (
    | "headphones"
    | "moonclip"
    | "circuits"
    | "sunglasses"
    | "glasses"
    | "pendant"
    | "cables"
    | "veil"
    | "cap"
    | "ribbon"
    | "garter"
    | "bangles"
    | "flowers"
  )[];
}

const HAIR = {
  rainbow: {
    front: ["#f8f6ff", "#e2d9fb", "#f3b7e5", "#9fdff6", "#e3f79c"],
    back: ["#d6cdf4", "#c7b8f0", "#df98d2", "#7fcbe6", "#c7e483"],
  },
  cyber: {
    front: ["#f5f8ff", "#d3e1ff", "#9fe6ff", "#62b3ff", "#b894ff"],
    back: ["#cfdaf5", "#b3c7f0", "#79c9ea", "#4a8fe0", "#9a76e8"],
  },
  moon: {
    front: ["#ffffff", "#eee8ff", "#dccdff", "#f7cdec", "#fff1c9"],
    back: ["#e2dcf5", "#d2c6f2", "#bca9ee", "#e3aad7", "#f0dca6"],
  },
  pastel: {
    front: ["#fff0f8", "#f9bde3", "#bcc6ff", "#86cdfb", "#aef0d4"],
    back: ["#ead3ea", "#e39fcf", "#9aa7f0", "#5fb2ea", "#86d9b8"],
  },
  neon: {
    front: ["#fbf6ff", "#f2d6f6", "#ff94d2", "#ff4fae", "#b650ff"],
    back: ["#e0cdea", "#dab3e8", "#f06cba", "#d8338f", "#8f36d6"],
  },
} satisfies Record<string, HairPalette>;

export const OUTFITS: Record<OutfitId, Outfit> = {
  edgerunner: {
    id: "edgerunner",
    name: "Edgerunner",
    emoji: "⚡",
    hair: HAIR.rainbow,
    top: { style: "leotard", from: "#2e2a47", to: "#15131f", accent: "#ff3d6e", shine: "#4a4570" },
    jacket: { style: "cropped", from: "#ffffff", to: "#d9d6ec", lining: "#bfe2f6", trim: "#1b1829", offShoulder: true },
    bottom: { style: "none", color: "#1b1829", shade: "#1b1829" },
    legs: { style: "thighhigh", color: "#1b1829", band: "#3d3858", shoe: "#221f33" },
    extras: [],
  },
  netrunner: {
    id: "netrunner",
    name: "Netrunner",
    emoji: "💾",
    hair: HAIR.cyber,
    top: { style: "bodysuit", from: "#1c2240", to: "#0b0e1a", accent: "#5ff3ff", shine: "#34406e" },
    jacket: null,
    bottom: { style: "none", color: "#0f1322", shade: "#1c2240" },
    legs: { style: "tights", color: "#10152a", band: "#10152a", shoe: "#0b0e1a" },
    extras: ["headphones", "circuits", "cables"],
  },
  moonlight: {
    id: "moonlight",
    name: "Moonlight",
    emoji: "🌙",
    hair: HAIR.moon,
    top: { style: "bodysuit", from: "#f7f5ff", to: "#d9d1f3", accent: "#9d86e8", shine: "#ffffff" },
    jacket: { style: "cropped", from: "#f1ebff", to: "#c9bbef", lining: "#fff0bf", trim: "#6b5ca8" },
    bottom: { style: "skirt", color: "#fbfaff", shade: "#d9d3ee" },
    legs: { style: "thighhigh", color: "#f2effa", band: "#cfc6ea", shoe: "#b3a7de" },
    extras: ["moonclip"],
  },
  cozy: {
    id: "cozy",
    name: "Cozy",
    emoji: "☕",
    hair: HAIR.rainbow,
    top: { style: "bodysuit", from: "#2e2a47", to: "#15131f", accent: "#ff3d6e", shine: "#4a4570" },
    jacket: { style: "hoodie", from: "#d5c3f6", to: "#a994de", lining: "#b9a3ea", trim: "#f7f3ff" },
    bottom: { style: "shorts", color: "#2a2640", shade: "#3a3556" },
    legs: { style: "socks", color: "#f6f3ff", band: "#cbb6f2", shoe: "#ffc2dc" },
    extras: [],
  },
  nightout: {
    id: "nightout",
    name: "Night out",
    emoji: "🌃",
    hair: HAIR.neon,
    top: { style: "bodysuit", from: "#ff5c96", to: "#c9336f", accent: "#1b1829", shine: "#ff9cc2" },
    jacket: { style: "leather", from: "#2d2939", to: "#121019", lining: "#ff4f8b", trim: "#c9c6d8" },
    bottom: { style: "skirt", color: "#1f1c2e", shade: "#34304a" },
    legs: { style: "sheer-boots", color: "#1b1829", band: "#1b1829", shoe: "#16141f" },
    extras: [],
  },
  pool: {
    id: "pool",
    name: "Pool day",
    emoji: "🏖",
    hair: HAIR.rainbow,
    top: { style: "leotard", from: "#23213a", to: "#101019", accent: "#ff3d6e", shine: "#4a4570" },
    jacket: null,
    bottom: { style: "none", color: "#23213a", shade: "#3a3556" },
    legs: { style: "bare", color: "#fbd6c8", band: "#fbd6c8", shoe: "#5fd8ff" },
    extras: ["sunglasses"],
  },
  cyberdress: {
    id: "cyberdress",
    name: "Neon dress",
    emoji: "💃",
    hair: HAIR.neon,
    top: { style: "dress", from: "#231f36", to: "#0f0d17", accent: "#ff3df0", shine: "#4d3f78" },
    jacket: null,
    bottom: { style: "none", color: "#0f0d17", shade: "#231f36" },
    legs: { style: "thighhigh", color: "#15131f", band: "#ff3df0", shoe: "#15131f" },
    extras: [],
  },
  nightcity: {
    id: "nightcity",
    name: "Night City",
    emoji: "🏙",
    hair: HAIR.rainbow,
    top: { style: "bodysuit", from: "#2e2a47", to: "#15131f", accent: "#ff3d6e", shine: "#4a4570" },
    jacket: null,
    bottom: { style: "shorts", color: "#f3f2f9", shade: "#d3d0e4" },
    legs: { style: "tights-boots", color: "#3a3358", band: "#ff3d6e", shoe: "#191724" },
    extras: [],
  },
  techwear: {
    id: "techwear",
    name: "Techwear",
    emoji: "🧥",
    hair: HAIR.pastel,
    top: { style: "bodysuit", from: "#ffffff", to: "#dcdaea", accent: "#e2b04a", shine: "#ffffff" },
    jacket: {
      style: "coat",
      from: "#8d93a6",
      to: "#565b6e",
      lining: "#5fc6f0",
      trim: "#2c3040",
      sleeve: ["#f0c25a", "#c98f2a"],
    },
    bottom: { style: "shorts", color: "#f3f2f9", shade: "#d3d0e4" },
    legs: { style: "boots", color: "#2a2d3b", band: "#2a2d3b", shoe: "#2a2d3b" },
    extras: ["pendant"],
  },
  casual: {
    id: "casual",
    name: "Casual",
    emoji: "👓",
    hair: HAIR.rainbow,
    top: { style: "bodysuit", from: "#2b2834", to: "#131118", accent: "#2f2b3a", shine: "#4a4658", sleeves: true },
    jacket: null,
    bottom: { style: "jeans", color: "#4f72a3", shade: "#36547e" },
    legs: { style: "tights", color: "#4f72a3", band: "#4f72a3", shoe: "#f1eff7" },
    extras: ["glasses", "pendant"],
  },
  street: {
    id: "street",
    name: "Street",
    emoji: "🛹",
    hair: HAIR.rainbow,
    top: { style: "crop", from: "#221f2e", to: "#121018", accent: "#ff3d6e", shine: "#4a4570" },
    jacket: { style: "cropped", from: "#ffffff", to: "#d9d6ec", lining: "#bfe2f6", trim: "#1b1829" },
    bottom: { style: "shorts", color: "#5a7fb3", shade: "#3d5c88" },
    legs: { style: "thighhigh", color: "#1b1829", band: "#ff3d6e", shoe: "#f1eff7" },
    extras: [],
  },
  beach: {
    id: "beach",
    name: "Beach",
    emoji: "🏝️",
    hair: HAIR.pastel,
    top: { style: "bikini", from: "#ff6aa0", to: "#d93a77", accent: "#ffffff", shine: "#ffb3cf" },
    jacket: null,
    bottom: { style: "bikini", color: "#e8447f", shade: "#b82e63" },
    legs: { style: "bare", color: "#fbd6c8", band: "#fbd6c8", shoe: "#5fd8ff" },
    extras: ["sunglasses"],
  },
  gym: {
    id: "gym",
    name: "Gym",
    emoji: "🏋️",
    hair: HAIR.cyber,
    top: { style: "crop", from: "#2b2f4a", to: "#16182b", accent: "#5ff3ff", shine: "#5a608a" },
    jacket: null,
    bottom: { style: "none", color: "#23253a", shade: "#16182b" },
    legs: { style: "leggings", color: "#23253a", band: "#5ff3ff", shoe: "#f1eff7" },
    extras: [],
  },
  office: {
    id: "office",
    name: "Office",
    emoji: "💼",
    hair: HAIR.moon,
    top: { style: "shirt", from: "#fbfbff", to: "#e4e3ef", accent: "#c0284a", shine: "#ffffff", sleeves: true, matte: true },
    jacket: null,
    bottom: { style: "pencil", color: "#1d1b28", shade: "#000000" },
    legs: { style: "thighhigh", color: "#1b1829", band: "#1b1829", shoe: "#16141f" },
    extras: ["ribbon"],
  },
  teacher: {
    id: "teacher",
    name: "Teacher",
    emoji: "📚",
    hair: HAIR.moon,
    top: { style: "shirt-open", from: "#fbfbff", to: "#e4e3ef", accent: "#ff6f91", shine: "#ffffff", sleeves: true, matte: true },
    underwear: { color: "#c0284a", trim: "#ff6f91" },
    jacket: null,
    bottom: { style: "pencil", color: "#1d1b28", shade: "#000000" },
    legs: { style: "bare", color: "#fbd6c8", band: "#fbd6c8", shoe: "#16141f" },
    extras: ["glasses"],
  },
  sweater: {
    id: "sweater",
    name: "Sweater dress",
    emoji: "🖤",
    hair: HAIR.moon,
    top: { style: "scoop", from: "#27232f", to: "#17151d", accent: "#3a3548", shine: "#4a4658", sleeves: true, matte: true },
    jacket: null,
    bottom: { style: "skirt", color: "#1e1b25", shade: "#000000" },
    legs: { style: "bare", color: "#fbd6c8", band: "#fbd6c8", shoe: "#1e1b25" },
    extras: [],
  },
  denim: {
    id: "denim",
    name: "Tee & denim",
    emoji: "🧋",
    hair: HAIR.pastel,
    top: { style: "tee", from: "#ffffff", to: "#eceaf4", accent: "#d9d6ec", shine: "#ffffff", matte: true },
    jacket: null,
    bottom: { style: "shorts", color: "#4a6f9f", shade: "#36547e" },
    legs: { style: "bare", color: "#fbd6c8", band: "#fbd6c8", shoe: "#f1eff7" },
    extras: [],
  },
  sister: {
    id: "sister",
    name: "Sister",
    emoji: "✝️",
    hair: HAIR.moon,
    top: { style: "bodysuit", from: "#1f1c27", to: "#121017", accent: "#e8e6f0", shine: "#3c3848", sleeves: true, matte: true },
    jacket: null,
    bottom: { style: "longskirt", color: "#1a1822", shade: "#000000" },
    legs: { style: "thighhigh", color: "#f4f2fa", band: "#f4f2fa", shoe: "#16141f" },
    extras: ["veil", "pendant"],
  },
  sisterwhite: {
    id: "sisterwhite",
    name: "White sister",
    emoji: "🕊️",
    hair: HAIR.moon,
    top: { style: "bodysuit", from: "#fbfaff", to: "#e6e3f0", accent: "#d9b35a", shine: "#ffffff", sleeves: true, matte: true },
    jacket: null,
    bottom: { style: "longskirt", color: "#f6f4fb", shade: "#d9b35a" },
    legs: { style: "thighhigh", color: "#2a2530", band: "#2a2530", shoe: "#2a2530" },
    extras: ["veil", "pendant"],
  },
  commander: {
    id: "commander",
    name: "Commander",
    emoji: "🎖️",
    hair: HAIR.cyber,
    top: { style: "deepv", from: "#f7f6fb", to: "#dcdae8", accent: "#1b1829", shine: "#ffffff", sleeves: true, matte: true },
    jacket: null,
    bottom: { style: "longskirt", color: "#f4f3f9", shade: "#000000" },
    legs: { style: "boots", color: "#16141f", band: "#16141f", shoe: "#16141f" },
    extras: ["cap"],
  },
  lingerie: {
    id: "lingerie",
    name: "Lingerie (white)",
    emoji: "🤍",
    hair: HAIR.moon,
    top: { style: "bra", from: "#ffffff", to: "#eeedf6", accent: "#ffffff", shine: "#ffffff" },
    jacket: null,
    bottom: { style: "panties", color: "#fbfbff", shade: "#e7e5f1" },
    legs: { style: "bare", color: "#fbd6c8", band: "#fbd6c8", shoe: "#f1eff7" },
    extras: [],
  },
  midnight: {
    id: "midnight",
    name: "Midnight",
    emoji: "🖤",
    hair: HAIR.neon,
    top: { style: "bra", from: "#221e28", to: "#141218", accent: "#6b5a7a", shine: "#4a4454" },
    jacket: { style: "coat", from: "#b8a98a", to: "#8d7f62", lining: "#e9e1cf", trim: "#6c5f45", offShoulder: true },
    bottom: { style: "panties", color: "#1b1820", shade: "#141218" },
    legs: { style: "thighhigh", color: "#1b1829", band: "#1b1829", shoe: "#16141f" },
    extras: ["garter"],
  },
  babydoll: {
    id: "babydoll",
    name: "Babydoll",
    emoji: "🌙",
    hair: HAIR.cyber,
    top: { style: "babydoll", from: "#2a2233", to: "#18141d", accent: "#8b6fd6", shine: "#4d4260" },
    jacket: null,
    bottom: { style: "panties", color: "#1d1822", shade: "#141218" },
    legs: { style: "thighhigh", color: "#1b1829", band: "#1b1829", shoe: "#16141f" },
    extras: [],
  },
  shizuku: {
    id: "shizuku",
    name: "Bookworm",
    emoji: "🕷️",
    hair: HAIR.moon,
    top: { style: "crop", from: "#23202b", to: "#141218", accent: "#2f2b3a", shine: "#4a4658", matte: true },
    jacket: null,
    bottom: { style: "jeans", color: "#2f3b52", shade: "#222b3d" },
    legs: { style: "tights", color: "#2f3b52", band: "#2f3b52", shoe: "#16141f" },
    extras: ["glasses"],
  },
  saree: {
    id: "saree",
    name: "Saree",
    emoji: "🪷",
    hair: HAIR.moon,
    top: { style: "saree-blouse", from: "#243056", to: "#18203c", accent: "#243056", shine: "#3a4a7a", matte: true },
    jacket: null,
    bottom: { style: "saree", color: "#f4eddc", shade: "#1b1829" },
    legs: { style: "bare", color: "#fbd6c8", band: "#fbd6c8", shoe: "#c9a24a" },
    extras: ["bangles", "flowers"],
  },
  rain: {
    id: "rain",
    name: "Neon rain",
    emoji: "☔",
    hair: HAIR.cyber,
    top: { style: "bodysuit", from: "#2e2a47", to: "#15131f", accent: "#ff3d6e", shine: "#4a4570" },
    jacket: { style: "raincoat", from: "#8fe9ff", to: "#4fc3f0", lining: "#bff4ff", trim: "#2ab3e6", opacity: 0.55 },
    bottom: { style: "shorts", color: "#f3f2f9", shade: "#d3d0e4" },
    legs: { style: "thighhigh", color: "#1b1829", band: "#3d3858", shoe: "#221f33" },
    extras: [],
  },
};

export const OUTFIT_IDS = Object.keys(OUTFITS) as OutfitId[];
export const DEFAULT_OUTFIT: OutfitId = "edgerunner";

export function outfitById(id: string | undefined): Outfit {
  return OUTFITS[id as OutfitId] ?? OUTFITS[DEFAULT_OUTFIT];
}

/** Which outfits suit each mood, with weights. */
export const MOOD_OUTFITS: Record<Mood, [OutfitId, number][]> = {
  confident: [["edgerunner", 3], ["street", 2], ["commander", 2], ["nightcity", 2], ["cyberdress", 2], ["techwear", 2], ["office", 1], ["nightout", 1]],
  focused: [["netrunner", 3], ["casual", 2], ["office", 2], ["teacher", 1], ["shizuku", 1], ["gym", 1], ["nightcity", 1], ["edgerunner", 1]],
  dreamy: [["moonlight", 3], ["saree", 2], ["sisterwhite", 1], ["lingerie", 1], ["techwear", 1], ["rain", 1]],
  sleepy: [["cozy", 3], ["babydoll", 2], ["sweater", 2], ["lingerie", 1], ["moonlight", 1]],
  playful: [["nightout", 2], ["beach", 2], ["street", 2], ["denim", 2], ["midnight", 1], ["pool", 1], ["gym", 1], ["cyberdress", 1], ["edgerunner", 1]],
  melancholy: [["rain", 3], ["casual", 2], ["sister", 2], ["saree", 1], ["sweater", 1], ["cozy", 1]],
};

export const MOOD_INFO: Record<Mood, { emoji: string; greeting: string }> = {
  confident: { emoji: "⚡", greeting: "Hey, choom. What's up?" },
  focused: { emoji: "💾", greeting: "Jacked in. What's the job?" },
  dreamy: { emoji: "🌙", greeting: "Thinking about the moon… need something?" },
  sleepy: { emoji: "😪", greeting: "*yawn*… you need me?" },
  playful: { emoji: "✨", greeting: "Heh, back again? What'll it be?" },
  melancholy: { emoji: "🌧", greeting: "…Hey. What do you need?" },
};

/** Hello when she shows up. `{name}` is you (Settings → Your name), else a pet name. */
export const HELLO_LINES: Record<Mood, string[]> = {
  confident: ["Hey, {name}. Missed me?", "Hi {name}. Ready when you are."],
  focused: ["Hi {name}. Let's get to work.", "Hey {name}. What's the job today?"],
  dreamy: ["Hi, honey… I was just thinking about you.", "Hey {name}… you're here. Good."],
  sleepy: ["*yawn*… hi, {name}.", "Mmh… hi honey. I'm awake. Mostly."],
  playful: ["Hi honey! Hi {name}! I'm back!", "Heeey, {name}! Miss me?"],
  melancholy: ["…Hi, {name}. Glad you're here.", "Hey, honey. Stay a while?"],
};

/** What she says when you stroke her with the cursor. */
export const PAT_LINES: Record<Mood, string[]> = {
  confident: ["Mm. I know, I'm great.", "Careful, {name}. I could get used to that."],
  focused: ["Hey, I'm working… okay, one more.", "Heh. Thanks, {name}. Back to it."],
  dreamy: ["Mmm… that's nice.", "Don't stop, {name}…"],
  sleepy: ["Mmh… five more minutes…", "That's making me sleepier, honey…"],
  playful: ["Hehe, that tickles!", "Again, {name}! Again!"],
  melancholy: ["…Thanks. I needed that.", "You're sweet, {name}."],
};

/** A random line for the mood, addressed to you. */
export function moodLine(lines: Record<Mood, string[]>, mood: Mood, name: string, random: () => number = Math.random): string {
  const options = lines[mood];
  return options[Math.floor(random() * options.length)].replaceAll("{name}", name || "choom");
}

export interface MoodSignals {
  /** Local hour, 0–23. */
  hour: number;
  weekday: boolean;
  minutesIdle: number;
  /** User interactions (clicks, hotkeys, messages) in the last ~30 minutes. */
  interactions: number;
  /** AI tasks run in the last ~30 minutes. */
  tasks: number;
  /** AI errors in the last ~30 minutes. */
  errors: number;
  asleep: boolean;
}

/** Her mood right now. A little randomness keeps her from feeling mechanical. */
export function decideMood(s: MoodSignals, random: () => number = Math.random): Mood {
  if (s.asleep || (s.hour >= 1 && s.hour < 6)) return "sleepy";
  if (s.errors >= 2) return "melancholy";
  if (s.interactions >= 5) return "playful";
  if (s.tasks >= 2) return "focused";
  if (s.hour >= 21 || s.hour < 1) return random() < 0.7 ? "dreamy" : "confident";
  if (s.minutesIdle > 45) return random() < 0.5 ? "sleepy" : "dreamy";
  if (s.weekday && s.hour >= 9 && s.hour < 17 && random() < 0.45) return "focused";
  const r = random();
  return r < 0.55 ? "confident" : r < 0.8 ? "playful" : "dreamy";
}

/**
 * Pick an outfit for a mood (weighted). When `current` is given and the mood has
 * another option, she picks something different so the change is visible.
 */
export function pickOutfit(mood: Mood, current: OutfitId | null, random: () => number = Math.random): OutfitId {
  let options = MOOD_OUTFITS[mood];
  if (current && options.length > 1) options = options.filter(([id]) => id !== current);
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [id, w] of options) {
    roll -= w;
    if (roll < 0) return id;
  }
  return options[options.length - 1][0];
}

/** Voice delivery per mood: Lucy is calm and low-key; mood nudges pace and pitch. */
export function voiceFor(mood: Mood): { rate: number; pitch: number } {
  switch (mood) {
    case "sleepy":
      return { rate: 0.84, pitch: 0.86 };
    case "dreamy":
      return { rate: 0.9, pitch: 0.92 };
    case "melancholy":
      return { rate: 0.88, pitch: 0.86 };
    case "playful":
      return { rate: 1.04, pitch: 1.0 };
    case "focused":
      return { rate: 1.0, pitch: 0.9 };
    default:
      return { rate: 0.95, pitch: 0.92 };
  }
}

const WINDOW_MS = 30 * 60_000;

/** Remembers recent activity (in memory only) and turns it into mood signals. */
export class MoodTracker {
  private events: { kind: "interaction" | "task" | "error"; at: number }[] = [];
  private lastInteraction: number;

  constructor(private readonly now: () => number = Date.now) {
    this.lastInteraction = now();
  }

  record(kind: "interaction" | "task" | "error"): void {
    const at = this.now();
    if (kind === "interaction") this.lastInteraction = at;
    this.events.push({ kind, at });
    this.events = this.events.filter((e) => at - e.at <= WINDOW_MS);
  }

  signals(asleep: boolean, date: Date = new Date(this.now())): MoodSignals {
    const at = this.now();
    const recent = this.events.filter((e) => at - e.at <= WINDOW_MS);
    const count = (kind: string) => recent.filter((e) => e.kind === kind).length;
    const day = date.getDay();
    return {
      hour: date.getHours(),
      weekday: day >= 1 && day <= 5,
      minutesIdle: (at - this.lastInteraction) / 60_000,
      interactions: count("interaction"),
      tasks: count("task"),
      errors: count("error"),
      asleep,
    };
  }
}
