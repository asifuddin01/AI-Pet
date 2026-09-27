import { describe, expect, it } from "vitest";

import { parseSearch } from "./search";

describe("search phrases", () => {
  it("pulls the query out of the ways people ask", () => {
    expect(parseSearch("search for best ramen in Dhaka")).toBe("best ramen in Dhaka");
    expect(parseSearch("google tauri 2 release date")).toBe("tauri 2 release date");
    expect(parseSearch("Hey Lucy, look up the moon landing")).toBe("the moon landing");
    expect(parseSearch("look Cyberpunk Edgerunners up")).toBe("Cyberpunk Edgerunners");
    expect(parseSearch("search the web for rust async book")).toBe("rust async book");
    expect(parseSearch("what's the weather in Dhaka?")).toBe("weather in Dhaka");
    expect(parseSearch("latest news about Apple")).toBe("Apple news");
    expect(parseSearch("news")).toBe("top news today");
  });

  it("ignores ordinary chat", () => {
    for (const text of ["how are you", "find my keys", "explain search engines", "I searched everywhere", "search"]) {
      expect(parseSearch(text), text).toBeNull();
    }
  });
});
