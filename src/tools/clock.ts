import { normalizeInput, type LocalTool, type ToolReply } from "./types";

/** "what time is it", "date", "time in Tokyo" — answered from the Mac's clock. */

const PLACES: Record<string, string> = {
  utc: "UTC",
  gmt: "UTC",
  bangladesh: "Asia/Dhaka",
  india: "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  "new delhi": "Asia/Kolkata",
  mumbai: "Asia/Kolkata",
  bangalore: "Asia/Kolkata",
  bengaluru: "Asia/Kolkata",
  chennai: "Asia/Kolkata",
  japan: "Asia/Tokyo",
  china: "Asia/Shanghai",
  beijing: "Asia/Shanghai",
  "hong kong": "Asia/Hong_Kong",
  korea: "Asia/Seoul",
  "south korea": "Asia/Seoul",
  uk: "Europe/London",
  england: "Europe/London",
  france: "Europe/Paris",
  germany: "Europe/Berlin",
  italy: "Europe/Rome",
  spain: "Europe/Madrid",
  russia: "Europe/Moscow",
  uae: "Asia/Dubai",
  "saudi arabia": "Asia/Riyadh",
  mecca: "Asia/Riyadh",
  makkah: "Asia/Riyadh",
  pakistan: "Asia/Karachi",
  nepal: "Asia/Kathmandu",
  australia: "Australia/Sydney",
  canada: "America/Toronto",
  "san francisco": "America/Los_Angeles",
  sf: "America/Los_Angeles",
  california: "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  "night city": "America/Los_Angeles",
  la: "America/Los_Angeles",
  nyc: "America/New_York",
  "new york city": "America/New_York",
  boston: "America/New_York",
  washington: "America/New_York",
  texas: "America/Chicago",
  dallas: "America/Chicago",
  houston: "America/Chicago",
  usa: "America/New_York",
  us: "America/New_York",
  brazil: "America/Sao_Paulo",
};

/** IANA zone for a place name (a city in the tz database or a common alias). */
export function zoneFor(place: string): string | null {
  const key = place.toLowerCase().replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
  if (PLACES[key]) return PLACES[key];
  const zones: string[] =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const wanted = key.replace(/ /g, "_");
  return zones.find((z) => z.toLowerCase().split("/").pop() === wanted) ?? null;
}

const TIME = /^(?:(?:what(?:'s| is)\s+)?the\s+)?(?:current\s+)?time(?:\s+(?:is\s+it\s+)?now)?$|^what time is it(?: now)?$|^what(?:'s| is) the time$/;
const DATE = /^(?:(?:what(?:'s| is)\s+)?(?:the\s+|today'?s\s+)?date(?:\s+today)?|what(?:'s| is) today|what day is (?:it|today)(?: today)?|today)$/;
const TIME_IN = /^(?:what(?:'s| is)\s+)?(?:the\s+)?(?:current\s+)?time\s+in\s+(.+)$|^what time is it in\s+(.+)$/;

export const ClockTool = {
  id: "clock",
  name: "Clock",
  icon: "🕒",
  description: "Time and date, here or elsewhere: time in Tokyo.",
  handle(raw: string): ToolReply | null {
    const input = normalizeInput(raw).toLowerCase();
    const now = new Date();
    if (TIME.test(input)) {
      const t = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      return { title: "Time", text: `🕒 **${t}**`, speech: `It's ${t}.` };
    }
    if (DATE.test(input)) {
      const d = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      return { title: "Today", text: `📅 **${d}**`, speech: `It's ${d}.` };
    }
    const m = TIME_IN.exec(input);
    if (m) {
      const place = (m[1] ?? m[2]).trim();
      const zone = zoneFor(place);
      if (!zone) return { title: "Time", text: `I don't know the time zone for "${place}". Try a big city nearby.` };
      const t = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone });
      const day = now.toLocaleDateString(undefined, { weekday: "short", timeZone: zone });
      const name = place.replace(/\b\w/g, (c) => c.toUpperCase());
      return { title: `Time in ${name}`, text: `🌐 **${t}** (${day})`, speech: `It's ${t} in ${name}.` };
    }
    return null;
  },
} satisfies LocalTool;
