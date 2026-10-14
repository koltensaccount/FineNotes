function el(tag, o = {}) {
  const e = document.createElement(tag);
  if (o.cls) e.className = o.cls;
  if (o.text) e.textContent = o.text;
  if (o.type) e.type = o.type;
  if (o.title) e.title = o.title;
  for (const [k, v] of Object.entries(o.attr || {})) e.setAttribute(k, v);
  return e;
}
Object.assign(HTMLElement.prototype, {
  createEl(tag, o) {
    const e = el(tag, o);
    this.append(e);
    return e;
  },
  createDiv(o) {
    return this.createEl("div", o);
  },
  createSpan(o) {
    return this.createEl("span", o);
  },
  empty() {
    this.replaceChildren();
  },
  addClass(...c) {
    this.classList.add(...c);
  },
  removeClass(...c) {
    this.classList.remove(...c);
  },
  hasClass(c) {
    return this.classList.contains(c);
  },
  toggleClass(c, v) {
    this.classList.toggle(c, v);
  },
  setText(t) {
    this.textContent = t;
  },
  setAttr(k, v) {
    this.setAttribute(k, v);
  },
  setCssStyles(s) {
    Object.assign(this.style, s);
  },
  setCssProps(s) {
    for (const [k, v] of Object.entries(s)) this.style.setProperty(k, v);
  },
});
window.createEl = el;
window.activeDocument = document;
export class Modal {
  constructor() {
    this.containerEl = el("div", { cls: "modal-container" });
    this.modalEl = el("div", { cls: "modal" });
    this.contentEl = el("div", { cls: "modal-content" });
    this.modalEl.append(this.contentEl);
    this.containerEl.append(this.modalEl);
    document.body.append(this.containerEl);
    this.scope = { register() {} };
  }
  close() {
    this.onClose?.();
    this.containerEl.remove();
  }
  open() {
    this.onOpen();
  }
}
export class Notice {
  constructor(text) {
    window.notices ??= [];
    window.notices.push(text);
  }
}
export function setIcon(e) {
  e.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 12H20" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
}

export const Platform = { isMobile: false };
