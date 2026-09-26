import { InputBox } from "./InputBox";
import { renderRichText } from "./richText";
import { renderButtons, type MenuButton } from "./TaskMenu";

export interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
  state?: "pending" | "error";
}

export type TextState = "normal" | "thinking" | "error";

/** Everything the bubble can show; each view in the pet is just one of these. */
export interface BubbleModel {
  title?: string;
  /** Small label under the title, e.g. "Bangla → English". */
  subtitle?: string;
  /** Visual reference to the selected text the pet is working on. */
  quote?: { text: string; truncated?: boolean };
  text?: string;
  textState?: TextState;
  transcript?: TranscriptLine[];
  tasks?: MenuButton[];
  actions?: MenuButton[];
  input?: { placeholder: string } | null;
  hint?: string;
}

export interface BubbleHandlers {
  onTask(id: string): void;
  onAction(id: string): void;
  onSubmit(text: string): void;
  onClose(): void;
}

const QUOTE_PREVIEW = 140;

/** The speech bubble attached to the pet. Compact on purpose — the pet is the product. */
export class ChatBubble {
  readonly el: HTMLDivElement;
  private scroll!: HTMLDivElement;
  private textEl: HTMLDivElement | null = null;
  private transcriptEl: HTMLDivElement | null = null;
  private hintEl!: HTMLDivElement;
  private input: InputBox | null = null;
  private pendingText: { text: string; state: TextState } | null = null;
  private frame = 0;
  private stickToBottom = true;

  constructor(
    parent: HTMLElement,
    private readonly handlers: BubbleHandlers,
  ) {
    this.el = document.createElement("div");
    this.el.className = "bubble";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "AI Pet");
    this.el.hidden = true;
    parent.append(this.el);
  }

  render(model: BubbleModel): void {
    cancelAnimationFrame(this.frame);
    this.pendingText = null;
    this.textEl = null;
    this.transcriptEl = null;
    this.input = null;
    this.stickToBottom = true;

    const header = document.createElement("div");
    header.className = "bubble__header";
    const titles = document.createElement("div");
    titles.className = "bubble__titles";
    if (model.title) {
      const t = document.createElement("div");
      t.className = "bubble__title";
      t.textContent = model.title;
      titles.append(t);
    }
    if (model.subtitle) {
      const s = document.createElement("div");
      s.className = "bubble__subtitle";
      s.textContent = model.subtitle;
      titles.append(s);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "bubble__close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.addEventListener("click", () => this.handlers.onClose());
    header.append(titles, close);

    this.scroll = document.createElement("div");
    this.scroll.className = "bubble__scroll";
    this.scroll.addEventListener("scroll", () => {
      const s = this.scroll;
      this.stickToBottom = s.scrollHeight - s.scrollTop - s.clientHeight < 12;
    });

    let quote: HTMLElement | null = null;
    if (model.quote) {
      quote = document.createElement("div");
      quote.className = "bubble__quote";
      const preview = model.quote.text.replace(/\s+/g, " ").trim();
      quote.textContent = preview.length > QUOTE_PREVIEW ? `${preview.slice(0, QUOTE_PREVIEW)}…` : preview;
      quote.title = model.quote.truncated ? "Long selection — using the first 20,000 characters" : "Selected text";
    }
    if (model.transcript) {
      this.transcriptEl = document.createElement("div");
      this.transcriptEl.className = "bubble__transcript";
      this.scroll.append(this.transcriptEl);
      this.renderTranscript(model.transcript);
    }
    if (model.text !== undefined) {
      this.textEl = document.createElement("div");
      this.textEl.className = "bubble__text";
      this.scroll.append(this.textEl);
      this.paintText(model.text, model.textState ?? "normal");
    }
    if (model.tasks?.length) this.scroll.append(renderButtons(model.tasks, (id) => this.handlers.onTask(id)));

    const children: HTMLElement[] = quote ? [header, quote, this.scroll] : [header, this.scroll];
    if (model.actions?.length) {
      children.push(renderButtons(model.actions, (id) => this.handlers.onAction(id), "bubble__actions"));
    }
    this.hintEl = document.createElement("div");
    this.hintEl.className = "bubble__hint";
    this.hintEl.setAttribute("aria-live", "polite");
    this.hintEl.textContent = model.hint ?? "";
    this.hintEl.hidden = !model.hint;
    children.push(this.hintEl);
    if (model.input) {
      this.input = new InputBox(
        model.input.placeholder,
        (text) => this.handlers.onSubmit(text),
        () => this.handlers.onClose(),
      );
      children.push(this.input.el);
    }
    this.el.replaceChildren(...children);
    this.el.hidden = false;
  }

  /** Update the main answer; coalesced to one paint per frame while streaming. */
  setText(text: string, state: TextState = "normal"): void {
    if (!this.textEl) return;
    this.pendingText = { text, state };
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.pendingText) this.paintText(this.pendingText.text, this.pendingText.state);
      this.pendingText = null;
    });
  }

  setTranscript(lines: TranscriptLine[]): void {
    if (this.transcriptEl) this.renderTranscript(lines);
  }

  setHint(text: string): void {
    this.hintEl.textContent = text;
    this.hintEl.hidden = !text;
  }

  focusInput(): void {
    this.input?.focus();
  }

  get inputValue(): string {
    return this.input?.value ?? "";
  }

  set inputValue(v: string) {
    if (this.input) this.input.value = v;
  }

  hide(): void {
    cancelAnimationFrame(this.frame);
    this.el.hidden = true;
    this.el.replaceChildren();
  }

  /** Where the bubble sits in the window and which way its tail points. */
  layout(
    box: { x: number; y: number; width: number; height: number },
    side: "above" | "below",
    tailX: number,
    maxHeight: number,
  ): void {
    this.el.style.transform = `translate(${box.x}px, ${box.y}px)`;
    this.el.style.width = `${box.width}px`;
    this.el.style.height = `${box.height}px`;
    this.el.style.setProperty("--bubble-max", `${maxHeight}px`);
    this.el.style.setProperty("--tail-x", `${tailX}px`);
    this.el.dataset.side = side;
  }

  /** Set the width content will be laid out at, before measuring. */
  prepareWidth(width: number): void {
    this.el.style.width = `${width}px`;
    this.el.style.height = "auto";
  }

  /** Height the bubble wants for its current content (before max-height clamps it). */
  naturalHeight(): number {
    if (this.el.hidden) return 0;
    const chrome = this.el.offsetHeight - this.scroll.clientHeight;
    return Math.ceil(chrome + this.scroll.scrollHeight);
  }

  private paintText(text: string, state: TextState): void {
    if (!this.textEl) return;
    this.textEl.dataset.state = state;
    if (state === "thinking") {
      this.textEl.innerHTML = '<span class="thinking-dots" aria-label="Thinking"><i></i><i></i><i></i></span>';
      if (text) this.textEl.prepend(document.createTextNode(`${text} `));
    } else {
      renderRichText(this.textEl, text);
    }
    this.keepScrolled();
  }

  private renderTranscript(lines: TranscriptLine[]): void {
    if (!this.transcriptEl) return;
    const frag = document.createDocumentFragment();
    for (const line of lines) {
      const row = document.createElement("div");
      row.className = `msg msg--${line.role}`;
      if (line.state) row.dataset.state = line.state;
      if (line.state === "pending" && !line.text) {
        row.innerHTML = '<span class="thinking-dots" aria-label="Thinking"><i></i><i></i><i></i></span>';
      } else if (line.role === "assistant") {
        renderRichText(row, line.text);
      } else {
        row.textContent = line.text;
      }
      frag.append(row);
    }
    this.transcriptEl.replaceChildren(frag);
    this.keepScrolled();
  }

  private keepScrolled(): void {
    if (this.stickToBottom) this.scroll.scrollTop = this.scroll.scrollHeight;
  }
}
