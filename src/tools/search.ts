import { normalizeInput } from "./types";

/**
 * "search for …", "google …", "look up …", "look … up", "what's the weather in …",
 * "latest news about …" → the query to send to the web search. Null for anything else.
 */
export function parseSearch(raw: string): string | null {
  const text = normalizeInput(raw).replace(/[’]/g, "'");
  if (!text || text.length > 300) return null;
  const patterns: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^(?:search|web search|google|bing|look up|lookup|find (?=online|on the web))(?: (?:the web|online|on (?:the )?(?:web|internet|google)|google))?(?: for| about)? (.+)$/i, (m) => m[1]],
    [/^look (.+) up(?: online)?$/i, (m) => m[1]],
    [/^(?:can you )?(?:search|google|look up) (.+?)(?: for me)?$/i, (m) => m[1]],
    [/^(?:what(?:'s| is) the )?weather(?: like)?(?: today| tomorrow)?(?: in| at| for) (.+)$/i, (m) => `weather in ${m[1]}`],
    [/^(?:what(?:'s| is) the )?(?:latest )?news(?: about| on| for)? (.+)$/i, (m) => `${m[1]} news`],
    [/^(?:what(?:'s| is) the )?(?:latest |today's )?news$/i, () => "top news today"],
  ];
  for (const [re, pick] of patterns) {
    const m = re.exec(text);
    if (m) {
      const query = pick(m).replace(/^(?:for|about) /i, "").trim();
      return query || null;
    }
  }
  return null;
}
