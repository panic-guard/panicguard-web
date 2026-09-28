type Attrs = Record<string, string | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function button(
  label: string,
  variant: "primary" | "secondary" | "link",
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const b = el("button", { class: `pg-btn pg-btn-${variant}`, type: "button" }, [label]);
  if (disabled) b.disabled = true;
  b.addEventListener("click", onClick);
  return b;
}
