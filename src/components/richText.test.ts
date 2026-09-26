import { describe, expect, it } from "vitest";

import { parseBlocks, parseInline } from "./richText";

describe("richText parser", () => {
  it("parses inline bold and code, leaving everything else as plain text", () => {
    expect(parseInline("a **b** `c` <img src=x>")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " " },
      { kind: "code", text: "c" },
      { kind: "text", text: " <img src=x>" },
    ]);
  });

  it("groups paragraphs and lists", () => {
    const blocks = parseBlocks("Intro line\nstill intro\n\n- one\n- two\n1. first\n2) second\n\n## Heading");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "ul", "ol", "p"]);
    expect(blocks[1]).toMatchObject({ kind: "ul", items: [[{ text: "one" }], [{ text: "two" }]] });
    expect(blocks[3]).toMatchObject({ kind: "p", inlines: [{ kind: "text", text: "Heading" }] });
  });
});
