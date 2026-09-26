/** Compact auto-growing text box. Enter sends, Shift+Enter adds a line, Esc closes. */
export class InputBox {
  readonly el: HTMLFormElement;
  private readonly area: HTMLTextAreaElement;

  constructor(
    placeholder: string,
    private readonly onSubmit: (text: string) => void,
    private readonly onEscape: () => void,
  ) {
    this.el = document.createElement("form");
    this.el.className = "input-box";
    this.area = document.createElement("textarea");
    this.area.rows = 1;
    this.area.placeholder = placeholder;
    this.area.setAttribute("aria-label", placeholder);
    this.area.spellcheck = true;
    const send = document.createElement("button");
    send.type = "submit";
    send.className = "input-box__send";
    send.setAttribute("aria-label", "Send");
    send.textContent = "↑";
    this.el.append(this.area, send);

    this.area.addEventListener("input", () => this.autosize());
    this.area.addEventListener("keydown", (e) => {
      // Never submit mid-composition (Bangla, Japanese, Chinese input methods).
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.onEscape();
      }
    });
    this.el.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
  }

  get value(): string {
    return this.area.value;
  }

  set value(v: string) {
    this.area.value = v;
    this.autosize();
  }

  focus(): void {
    this.area.focus({ preventScroll: true });
  }

  private submit(): void {
    const text = this.area.value.trim();
    if (!text) return;
    this.area.value = "";
    this.autosize();
    this.onSubmit(text);
  }

  private autosize(): void {
    this.area.style.height = "auto";
    this.area.style.height = `${Math.min(this.area.scrollHeight, 96)}px`;
  }
}
