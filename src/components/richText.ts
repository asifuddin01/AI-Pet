/**
 * Tiny, safe renderer for the Markdown subset models usually return in short
 * answers: paragraphs, bullet/numbered lists, **bold** and `code`.
 * Builds DOM nodes with textContent only — model output is never parsed as HTML.
 */

export type Inline = { kind: "text" | "bold" | "code"; text: string };
export type Block =
  | { kind: "p"; inlines: Inline[] }
  | { kind: "ul" | "ol"; items: Inline[][] };

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ kind: "bold", text: m[2] });
    else out.push({ kind: "code", text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", inlines: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/^\s{0,3}#{1,6}\s+/, ""); // headings → plain lines
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const listKind = bullet ? "ul" : numbered ? "ol" : null;
    if (listKind) {
      flush();
      const item = parseInline((bullet ?? numbered)![1]);
      const prev = blocks[blocks.length - 1];
      if (prev && prev.kind === listKind) prev.items.push(item);
      else blocks.push({ kind: listKind, items: [item] });
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

function renderInlines(parent: HTMLElement, inlines: Inline[]): void {
  for (const i of inlines) {
    if (i.kind === "text") parent.append(document.createTextNode(i.text));
    else {
      const el = document.createElement(i.kind === "bold" ? "strong" : "code");
      el.textContent = i.text;
      parent.append(el);
    }
  }
}

export function renderRichText(target: HTMLElement, text: string): void {
  const frag = document.createDocumentFragment();
  for (const block of parseBlocks(text)) {
    if (block.kind === "p") {
      const p = document.createElement("p");
      renderInlines(p, block.inlines);
      frag.append(p);
    } else {
      const list = document.createElement(block.kind);
      for (const item of block.items) {
        const li = document.createElement("li");
        renderInlines(li, item);
        list.append(li);
      }
      frag.append(list);
    }
  }
  target.replaceChildren(frag);
}
