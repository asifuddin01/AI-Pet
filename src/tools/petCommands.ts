import { OUTFIT_IDS, OUTFITS, type OutfitId } from "../pet/Wardrobe";
import type { RoamArea } from "../types";
import { normalizeInput } from "./types";

/**
 * Things you can ask Lucy herself to do, typed or spoken: "change your outfit",
 * "wear the saree", "stop walking", "float around", "go to sleep", "be quiet",
 * "come here", "wave", "what can you do". Parsing is pure (and tested); the pet
 * controller carries the command out.
 */
export type PetCommand =
  | { kind: "outfit"; id: OutfitId | null }
  | { kind: "outfit-auto" }
  | { kind: "roam"; on: boolean; area?: RoamArea }
  | { kind: "come" }
  | { kind: "sleep" }
  | { kind: "wake" }
  | { kind: "mute"; on: boolean }
  | { kind: "shush" }
  | { kind: "hide" }
  | { kind: "bye" }
  | { kind: "status" }
  | { kind: "settings" }
  | { kind: "translate-clipboard" }
  | { kind: "gesture"; gesture: "wave" | "happy" | "hop" | "hair-touch" | "dance" }
  | { kind: "outfit-status" }
  | { kind: "help" };

/** Extra words people use for each outfit, besides its name and id. */
const OUTFIT_ALIASES: Partial<Record<OutfitId, string[]>> = {
  edgerunner: ["edgerunners", "leotard", "your usual", "usual", "default", "your normal outfit", "normal"],
  netrunner: ["hacker", "headphones"],
  moonlight: ["moon"],
  cozy: ["pyjamas", "pajamas", "pjs", "sleepwear", "comfy"],
  nightout: ["party", "night out", "going out"],
  pool: ["swimsuit", "swimwear", "pool"],
  cyberdress: ["dress", "neon dress"],
  casual: ["jeans", "turtleneck"],
  street: ["streetwear"],
  beach: ["bikini"],
  gym: ["workout", "sporty", "sportswear", "gym clothes", "yoga"],
  office: ["work clothes", "formal", "blouse", "pencil skirt"],
  sweater: ["sweater", "jumper"],
  denim: ["denim", "tee", "t-shirt", "shorts"],
  sister: ["nun", "habit", "black nun"],
  sisterwhite: ["white nun", "white habit"],
  commander: ["uniform", "military", "general"],
  lingerie: ["underwear", "white lingerie", "bra"],
  midnight: ["black lingerie", "garter"],
  babydoll: ["nightie", "nightgown"],
  shizuku: ["bookworm", "glasses", "nerd"],
  saree: ["sari", "sharee", "shari", "saree"],
  rain: ["rain", "raincoat", "neon rain"],
};

function outfitKeys(): [string, OutfitId][] {
  const keys: [string, OutfitId][] = [];
  for (const id of OUTFIT_IDS) {
    const names = [id, OUTFITS[id].name.toLowerCase().replace(/\s*\(.*\)$/, ""), ...(OUTFIT_ALIASES[id] ?? [])];
    for (const n of names) keys.push([n.toLowerCase(), id]);
  }
  // Longest first so "white nun" wins over "nun".
  return keys.sort((a, b) => b[0].length - a[0].length);
}

const KEYS = outfitKeys();

/** The outfit a phrase names ("the saree", "your office clothes"), if any. */
export function findOutfit(phrase: string): OutfitId | null {
  const text = ` ${phrase.toLowerCase().replace(/[^a-z0-9&' -]/g, " ").replace(/\s+/g, " ")} `;
  for (const [key, id] of KEYS) {
    if (text.includes(` ${key} `)) return id;
  }
  return null;
}

const WEAR = /^(?:(?:can you |could you |please )?(?:wear|put on|change into|switch to|get into|dress (?:up )?(?:in|as)|try on|show me)\s+(?:your |the |a |an |that |some )?)(.+?)(?:\s+(?:outfit|look|clothes|one))?$/;
const CHANGE = /^(?:change|switch|swap)(?: up)? (?:your |the )?(?:outfit|clothes|dress|look|style)(?: please)?$|^(?:change clothes|dress up|get changed|new outfit|different outfit|something else|surprise me|wear something (?:else|different|new))$/;
const AUTO = /^(?:(?:choose|pick|decide) (?:your |the )?(?:own )?(?:outfits?|clothes)(?: yourself)?|dress (?:how|however) you (?:like|want)|you (?:choose|pick|decide))$/;

/** Parse a message into a pet command, or null if it's for someone else (tools, AI). */
export function parsePetCommand(raw: string): PetCommand | null {
  const text = normalizeInput(raw).toLowerCase().replace(/[’]/g, "'");
  if (!text || text.length > 80) return null;

  if (/^(?:help|commands|what can you do|what are you (?:capable of|able to do)|what do you do|how do i use you|what can i (?:ask|tell) you(?: to do)?)$/.test(text)) {
    return { kind: "help" };
  }
  if (/^(?:what are you wearing|what(?:'s| is) your outfit|which outfit is this|what outfit is this)$/.test(text)) {
    return { kind: "outfit-status" };
  }

  // Outfits
  if (AUTO.test(text)) return { kind: "outfit-auto" };
  if (CHANGE.test(text)) return { kind: "outfit", id: null };
  const wear = WEAR.exec(text);
  if (wear) {
    const id = findOutfit(wear[1]);
    if (id) return { kind: "outfit", id };
    if (/^(?:something (?:else|different|new)|another(?: one)?|a different one)$/.test(wear[1])) return { kind: "outfit", id: null };
  }

  // Moving around
  if (/^(?:stop (?:walking|moving|roaming|wandering|floating|flying|hovering)(?: around)?|stay(?: still| here| put| there)?|don't move|sit(?: down)?|freeze|hold still|stand still)$/.test(text)) {
    return { kind: "roam", on: false };
  }
  if (/^(?:float|hover|fly)(?: around)?(?: the screen)?$|^(?:start )?(?:floating|hovering|flying)(?: around)?$/.test(text)) {
    return { kind: "roam", on: true, area: "float" };
  }
  if (/^walk (?:along|on) the bottom$/.test(text)) return { kind: "roam", on: true, area: "bottom" };
  if (/^(?:(?:go |start )?(?:walk|walking|roam|roaming|wander|wandering|explore|exploring|move|moving)(?: around)?|keep moving|go for a walk)$/.test(text)) {
    return { kind: "roam", on: true };
  }
  if (/^(?:come here|come (?:over )?(?:here|to me)|over here|follow me|get over here)$/.test(text)) return { kind: "come" };

  // Sleep / wake
  if (/^(?:go to sleep|(?:take|have) a nap|nap(?: time)?|sleep|good ?night|go to bed|rest)$/.test(text)) return { kind: "sleep" };
  if (/^(?:wake up|wakey wakey|rise and shine)$/.test(text)) return { kind: "wake" };

  // Voice
  if (/^(?:stop talking|stop speaking|shut up|shh+|hush|stop)$/.test(text)) return { kind: "shush" };
  if (/^(?:be quiet|mute(?: yourself)?|(?:go )?silent|silence|no (?:more )?talking|don't talk|quiet)$/.test(text)) return { kind: "mute", on: true };
  if (/^(?:unmute(?: yourself)?|(?:you can )?talk (?:to me )?(?:again)?|speak(?: up)?(?: again)?|use your voice)$/.test(text)) {
    return { kind: "mute", on: false };
  }

  // Window / app
  if (/^(?:hide|go away|disappear|leave me alone|turn off|switch off|hide yourself)$/.test(text)) return { kind: "hide" };
  if (/^(?:bye|goodbye|bye bye|see you|see ya|later|see you later|that's all|that is all|thanks,? that's all)$/.test(text)) return { kind: "bye" };
  if (/^(?:what (?:are|r) (?:you|u) (?:doing|up to)|what's up|wassup|sup)$/.test(text)) return { kind: "status" };
  if (/^(?:open )?(?:your |the )?(?:settings|preferences)$/.test(text)) return { kind: "settings" };
  if (/^translate (?:my |the )?clipboard$/.test(text)) return { kind: "translate-clipboard" };

  // Little gestures
  if (/^(?:wave|wave (?:at|to) me|say hi|say hello)$/.test(text)) return { kind: "gesture", gesture: "wave" };
  if (/^(?:dance|dance for me|do a dance|show me your moves)$/.test(text)) return { kind: "gesture", gesture: "dance" };
  if (/^(?:jump|hop)$/.test(text)) return { kind: "gesture", gesture: "hop" };
  if (/^(?:smile|be happy|cheer up)$/.test(text)) return { kind: "gesture", gesture: "happy" };
  if (/^(?:fix|touch|do) your hair$/.test(text)) return { kind: "gesture", gesture: "hair-touch" };
  return null;
}

/** Lucy's answer to "what can you do?". */
export const CAPABILITIES = [
  "**Text you select** (press ⌥P): translate, explain, define, summarize, rewrite, fix grammar, explain code.",
  "**Chat** about anything — type, or talk to me with 🎤, the talk key, or \"Hey Lucy\".",
  "**Offline tools:** 25*4 · 10 km in miles · timer 10 min tea · remind me in 20 min to stretch · pomodoro · note buy milk · time in Tokyo.",
  "**Ask me to:** change your outfit · wear the saree · float around · stay still · come here · go to sleep · be quiet · wave · dance · open settings · translate my clipboard · hide.",
].map((l) => `- ${l}`).join("\n");
