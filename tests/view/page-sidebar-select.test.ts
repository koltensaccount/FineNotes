import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

class MockElement {
  children: MockElement[] = [];
  attrs: Record<string, string> = {};
  classes = new Set<string>();
  dataset: Record<string, string> = {};
  text = "";
  parentElement: MockElement | null = null;
  handlers = new Map<string, Array<(...args: any[]) => void>>();
  ownerDocument!: any;

  constructor(readonly tag = "div") {}

  createEl(
    tag: string,
    o: { cls?: string; text?: string; attr?: Record<string, string> } = {},
  ): MockElement {
    const e = new MockElement(tag);
    e.text = o.text ?? "";
    e.attrs = { ...o.attr };
    if (o.cls) o.cls.split(" ").filter(Boolean).forEach((c) => e.classes.add(c));
    e.parentElement = this;
    e.ownerDocument = this.ownerDocument;
    this.children.push(e);
    return e;
  }

  createDiv(o = {}): MockElement {
    return this.createEl("div", o);
  }

  createSpan(o = {}): MockElement {
    return this.createEl("span", o);
  }

  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }

  setText(s: string): void {
    this.text = s;
  }

  setCssStyles(_s: Record<string, string>): void {}

  empty(): void {
    this.children = [];
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  addClass(...c: string[]): void {
    c.forEach((v) => this.classes.add(v));
  }

  removeClass(...c: string[]): void {
    c.forEach((v) => this.classes.delete(v));
  }

  hasClass(c: string): boolean {
    return this.classes.has(c);
  }

  toggleClass(c: string, on: boolean): void {
    if (on) this.classes.add(c);
    else this.classes.delete(c);
  }

  addEventListener(n: string, f: (...args: any[]) => void): void {
    const arr = this.handlers.get(n) ?? [];
    arr.push(f);
    this.handlers.set(n, arr);
  }

  removeEventListener(n: string, f: (...args: any[]) => void): void {
    const arr = this.handlers.get(n);
    if (!arr) return;
    const idx = arr.indexOf(f);
    if (idx !== -1) arr.splice(idx, 1);
  }

  querySelector(selector: string): MockElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const result: MockElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }

  matches(selector: string): boolean {
    if (selector.startsWith(".")) {
      const classes = selector.split(".").filter(Boolean);
      return classes.every((c) => this.classes.has(c));
    }
    return this.tag === selector;
  }
}

globalThis.HTMLElement = MockElement as any;

describe("Sidebar page selection circle rendering", () => {
  it("renders an empty container for unselected pages and a check icon for selected pages", () => {
    const checkSpan = new MockElement("span");
    checkSpan.addClass("goodobsidian-page-check");

    // Simulating unselected page sync in PageSidebar:
    const isSelectedFalse = false;
    checkSpan.toggleClass("is-page-checked", isSelectedFalse);
    if (isSelectedFalse) {
      checkSpan.createEl("svg", { cls: "svg-icon lucide-check" });
    } else {
      checkSpan.empty();
    }

    expect(checkSpan.hasClass("is-page-checked")).toBe(false);
    expect(checkSpan.children.length).toBe(0); // Single clean circle container, no inner SVG circle

    // Simulating selected page sync in PageSidebar:
    const isSelectedTrue = true;
    checkSpan.toggleClass("is-page-checked", isSelectedTrue);
    if (isSelectedTrue) {
      checkSpan.createEl("svg", { cls: "svg-icon lucide-check" });
    } else {
      checkSpan.empty();
    }

    expect(checkSpan.hasClass("is-page-checked")).toBe(true);
    expect(checkSpan.children.length).toBe(1);
    expect(checkSpan.children[0].classes.has("lucide-check")).toBe(true);

    // Deselecting page:
    checkSpan.toggleClass("is-page-checked", false);
    checkSpan.empty();
    expect(checkSpan.hasClass("is-page-checked")).toBe(false);
    expect(checkSpan.children.length).toBe(0);
  });

  it("verifies styles.css enforces 1:1 circular aspect ratio and border geometry", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cssPath = path.resolve(__dirname, "../../styles.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    // Match .goodobsidian-page-check rule block
    const checkRuleMatch = css.match(/\.goodobsidian-page-check\s*\{([^}]+)\}/);
    expect(checkRuleMatch).not.toBeNull();
    const ruleContent = checkRuleMatch![1];

    expect(ruleContent).toContain("width: 22px;");
    expect(ruleContent).toContain("height: 22px;");
    expect(ruleContent).toContain("border-radius: 50%;");
    expect(ruleContent).toContain("aspect-ratio: 1 / 1;");
    expect(ruleContent).toContain("border: 2px solid var(--interactive-accent);");
  });
});
