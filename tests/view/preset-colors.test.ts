import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar } = await import("../../src/view/toolbar");
vi.mock("../../src/view/color-picker", () => ({ renderColorPicker: vi.fn() }));
import { renderPresetColors } from "../../src/view/preset-colors";
import {
  migrateWritingPresets,
  selectPreset,
  selectedColor,
  moveColor,
} from "../../src/model/writing-presets";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
class Element {
  children: Element[] = [];
  parentElement: Element | null = null;
  text = "";
  value = "";
  style: Record<string, string> = {};
  scrollLeft = 0;
  attrs: Record<string, string> = {};
  handlers = new Map<string, Set<(e: unknown) => void>>();
  ownerDocument = {
    defaultView: { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} },
    addEventListener() {},
    removeEventListener() {},
  };
  createDiv(options: { cls?: string; text?: string; attr?: Record<string, string> } = {}) {
    return this.createEl("div", options);
  }
  createEl(
    _tag: string,
    options: { cls?: string; text?: string; attr?: Record<string, string>; value?: string } = {},
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
  setCssStyles(styles: Record<string, string>) {
    Object.assign(this.style, styles);
  }
  setAttr(key: string, value: string) {
    this.setAttribute(key, value);
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  querySelector() {
    return null;
  }
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
    expect(pick).toHaveBeenCalledExactlyOnceWith(p.palettes.pen[0].id);
    body.find("Edit #1a1a1a").click();
    body.find("HEX color").value = "#abc";
    body.find("Replace with HEX color").click();
    expect(p.palettes.pen[0].color).toBe("#aabbcc");
    body.find("Remove #ffffff").click();
    expect(p.palettes.pen.map((entry) => entry.color)).not.toContain("#ffffff");
    body.find("Add color").click();
    body.find("HEX color").value = "#def";
    body.find("Add HEX color").click();
    expect(p.palettes.pen.at(-1)?.color).toBe("#ddeeff");
    body.find("Restore default colors").click();
    expect(p.palettes.pen.map((entry) => entry.color)).toContain("#ddeeff");
    body.find("Cancel").click();
    body.find("Restore default colors").click();
    body.find("Restore default colors").click();
    expect(p.palettes.pen.map((entry) => entry.color)).toEqual(
      highlighter.map((entry) => entry.color),
    );
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

it("physical regression: editing selected default red updates the actual strip and writing state, then reopens the same blue preset", () => {
  const p = migrateWritingPresets(DEFAULT_SETTINGS);
  const red = p.palettes.pen.find((preset) => preset.color === "#e03131")!;
  const blue = p.palettes.pen.find((preset) => preset.color === "#1971c2")!;
  selectPreset(p, "pen", red.id);
  const strip = new Element();
  const drawing = { color: red.color };
  const state = { tool: "pen", color: red.color };
  const colors = new Map<string, Element>();
  const toolbar = Object.assign(Object.create(Toolbar.prototype) as Record<string, unknown>, {
    state,
    options: { writingPresets: p },
    optionsEl: strip,
    colorSwatches: colors,
    optionDisposers: [],
    colorScroll: { pen: 0, highlighter: 0 },
    callbacks: {
      onColorChange: (color: string) => {
        drawing.color = color;
      },
    },
    buildOptions: () => {
      strip.empty();
      colors.clear();
      (Toolbar.prototype as unknown as { buildColorStrip(): void }).buildColorStrip.call(toolbar);
    },
    syncActive: () => {},
  });
  const changed = () =>
    (Toolbar.prototype as unknown as { presetsChanged(): void }).presetsChanged.call(toolbar);
  changed();
  expect(colors.get(red.id)?.style.backgroundColor).toBe("#e03131");
  const body = new Element();
  let dispose = renderPresetColors(
    body as unknown as HTMLElement,
    p,
    "pen",
    changed,
    vi.fn(),
    vi.fn(),
    () => [],
    () => {},
    { id: red.id },
  );
  expect(body.find("HEX color").value).toBe("#e03131");
  body.find("HEX color").value = blue.color;
  body.find("Replace with HEX color").click();
  expect(p.selectedIds.pen).toBe(red.id);
  expect(colors.get(red.id)?.style.backgroundColor).toBe("#1971c2");
  expect(state.color).toBe("#1971c2");
  expect(drawing.color).toBe("#1971c2");
  dispose();
  moveColor(
    p,
    "pen",
    p.palettes.pen.findIndex((entry) => entry.id === red.id),
    0,
  );
  dispose = renderPresetColors(
    body as unknown as HTMLElement,
    p,
    "pen",
    changed,
    vi.fn(),
    vi.fn(),
    () => [],
    () => {},
    { id: red.id },
  );
  expect(body.find("HEX color").value).toBe("#1971c2");
  expect(selectedColor(p, "pen")).toBe("#1971c2");
  expect(p.palettes.pen.at(-1)?.color).not.toBe("#1971c2");
  dispose();
  for (const cleanup of toolbar.optionDisposers as Array<() => void>) cleanup();
});
