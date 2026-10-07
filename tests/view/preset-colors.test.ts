import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/view/color-picker", () => ({ renderColorPicker: vi.fn() }));
import { renderPresetColors } from "../../src/view/preset-colors";
import { migrateWritingPresets } from "../../src/model/writing-presets";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
class Element {
  children: Element[] = [];
  parentElement: Element | null = null;
  text = "";
  value = "";
  attrs: Record<string, string> = {};
  handlers = new Map<string, Set<(e: unknown) => void>>();
  ownerDocument = {
    defaultView: { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} },
    addEventListener() {},
    removeEventListener() {},
  };
  createDiv(options: { text?: string; attr?: Record<string, string> } = {}) {
    return this.createEl("div", options);
  }
  createEl(
    _tag: string,
    options: { text?: string; attr?: Record<string, string>; value?: string } = {},
  ) {
    const el = new Element();
    el.text = options.text ?? "";
    el.attrs = options.attr ?? {};
    el.value = options.value ?? "";
    el.parentElement = this;
    this.children.push(el);
    return el;
  }
  empty() {
    this.children = [];
  }
  setText(text: string) {
    this.text = text;
  }
  setCssProps() {}
  addClass() {}
  removeClass() {}
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  addEventListener(name: string, fn: (e: unknown) => void) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(fn);
  }
  removeEventListener(name: string, fn: (e: unknown) => void) {
    this.handlers.get(name)?.delete(fn);
  }
  querySelectorAll() {
    return [];
  }
  focus() {}
  find(label: string): Element {
    if (this.attrs["aria-label"] === label) return this;
    for (const child of this.children) {
      try {
        return child.find(label);
      } catch {
        /* next child */
      }
    }
    throw new Error(`Missing ${label}`);
  }
  click() {
    for (const fn of this.handlers.get("click") ?? []) fn({});
  }
}
describe("color preset manager UI lifecycle", () => {
  it("edits and removes defaults, adds HEX, confirms reset, and leaves highlighter intact", () => {
    const body = new Element();
    const p = migrateWritingPresets(DEFAULT_SETTINGS);
    const highlighter = [...p.palettes.highlighter];
    const changed = vi.fn();
    const pick = vi.fn();
    const dispose = renderPresetColors(
      body as unknown as HTMLElement,
      p,
      "pen",
      changed,
      pick,
      vi.fn(),
    );
    body.find("Select #1a1a1a").click();
    expect(pick).toHaveBeenCalledExactlyOnceWith("#1a1a1a");
    body.find("Edit #1a1a1a").click();
    body.find("HEX color").value = "#abc";
    body.find("Replace with HEX color").click();
    expect(p.palettes.pen[0]).toBe("#aabbcc");
    body.find("Remove #ffffff").click();
    expect(p.palettes.pen).not.toContain("#ffffff");
    body.find("Add color").click();
    body.find("HEX color").value = "#def";
    body.find("Add HEX color").click();
    expect(p.palettes.pen.at(-1)).toBe("#ddeeff");
    body.find("Restore default colors").click();
    expect(p.palettes.pen).toContain("#ddeeff");
    body.find("Cancel").click();
    body.find("Restore default colors").click();
    body.find("Restore default colors").click();
    expect(p.palettes.pen).toEqual(highlighter);
    expect(p.palettes.highlighter).toEqual(highlighter);
    expect(changed).toHaveBeenCalledTimes(4);
    dispose();
    expect(body.children).toHaveLength(0);
  });
  it("repeated open/close removes UI and listeners before rebinding", () => {
    const body = new Element();
    const p = migrateWritingPresets(DEFAULT_SETTINGS);
    const changed = vi.fn();
    for (let i = 0; i < 3; i++) {
      const dispose = renderPresetColors(
        body as unknown as HTMLElement,
        p,
        "pen",
        changed,
        vi.fn(),
        vi.fn(),
      );
      const handle = body.find("Move #1a1a1a");
      expect(handle.handlers.get("pointerdown")?.size).toBe(1);
      dispose();
      expect(handle.handlers.get("pointerdown")?.size).toBe(0);
      expect(body.children).toHaveLength(0);
    }
    expect(changed).not.toHaveBeenCalled();
  });
});
