export interface MenuButton {
  id: string;
  label: string;
  icon?: string;
  primary?: boolean;
  disabled?: boolean;
}

/** A small grid of rounded buttons (task choices, quick-menu entries, actions). */
export function renderButtons(buttons: MenuButton[], onClick: (id: string) => void, className = "task-menu"): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = className;
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = b.primary ? "chip chip--primary" : "chip";
    btn.disabled = !!b.disabled;
    btn.dataset.id = b.id;
    if (b.icon) {
      const icon = document.createElement("span");
      icon.className = "chip__icon";
      icon.textContent = b.icon;
      icon.setAttribute("aria-hidden", "true");
      btn.append(icon);
    }
    btn.append(document.createTextNode(b.label));
    btn.addEventListener("click", () => onClick(b.id));
    wrap.append(btn);
  }
  return wrap;
}
