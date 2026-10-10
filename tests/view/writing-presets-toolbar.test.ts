import { presetActivation } from "../../src/view/transient-popover";
import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../src/view/thickness-editor", () => ({ renderThicknessEditor: vi.fn(() => Object.assign(() => {}, { dispose: () => {} })) }));
const { Toolbar, PEN_TYPES } = await import("../../src/view/toolbar");
import { migrateWritingPresets, selectedColor, selectColor } from "../../src/model/writing-presets";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
function setup() {
  const presets = migrateWritingPresets(DEFAULT_SETTINGS);
  const save = vi.fn();
  const state = { tool: "pen", color: selectedColor(presets, "pen"), size: 3 };
  const toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
    state,
    popoverDisposers: [],
    options: { writingPresets: presets, onPresetsChange: save },
    callbacks: {
      onColorChange: vi.fn(),
      onSizeChange: vi.fn(),
      onToolChange: vi.fn(),
      onPressureToggle: vi.fn(),
    },
    buildOptions: vi.fn(),
    syncActive: vi.fn(),
  }) as unknown as {
    setPenColor(color: string): void;
    activateColorPreset(anchor: HTMLElement, id: string, color: string): void;
    setWidth(width: number): void;
    choosePenType(spec: (typeof PEN_TYPES)[number]): void;
    quickColors(): string[];
    quickWidths(): number[];
    presetsChanged(): void;
  };
  return { toolbar, state, presets, save };
}
describe("toolbar preset integration", () => {
  it("empty quick widths do not manufacture an undefined slot", () => {
    const s = setup();
    s.presets.widths = [];
    expect(s.toolbar.quickWidths()).toEqual([]);
    expect(s.state.size).toBe(3);
  });
  it("persists selections and restores each tool's color on switch", () => {
    const s = setup();
    s.toolbar.setPenColor("#123456");
    s.toolbar.setWidth(5);
    s.toolbar.choosePenType(PEN_TYPES[3]);
    s.toolbar.setPenColor("#abcdef");
    s.toolbar.choosePenType(PEN_TYPES[0]);
    expect(s.state.color).toBe("#123456");
    expect(selectedColor(s.presets, "highlighter")).toBe("#abcdef");
    expect(s.presets.selectedWidth).toBe(5);
    expect(s.save).toHaveBeenCalledTimes(3);
  });
  it("shows user order including white and never revives a removed color", () => {
    const s = setup();
    s.presets.palettes.pen = ["#ffffff", "#abcdef", "#123456"].map((color, i) => ({
      id: `pen-${i + 50}`,
      color,
    }));
    expect(s.toolbar.quickColors()).toEqual(s.presets.palettes.pen.map((entry) => entry.color));
    s.presets.palettes.pen = [];
    expect(s.toolbar.quickColors()).toEqual([]);
  });
  it("keeps every stored width in user order without injecting a slider value", () => {
    const s = setup();
    s.state.size = 1.22;
    expect(s.toolbar.quickWidths()).toEqual(s.presets.widths);
  });
  it("an edited selected color follows its slot and reports persistence", () => {
    const s = setup();
    selectColor(s.presets, "pen", "#abcdef");
    s.toolbar.presetsChanged();
    expect(s.state.color).toBe("#abcdef");
    expect(s.save).toHaveBeenCalledWith(s.presets);
  });
});

it.each([1, 5, 6, 20])("the quick strip includes every one of %s colors in user order", (count) => {
  const s = setup();
  s.presets.palettes.pen = Array.from({ length: count }, (_, i) => ({
    id: `pen-${i + 50}`,
    color: "#" + i.toString(16).padStart(6, "0"),
  }));
  expect(s.toolbar.quickColors()).toEqual(s.presets.palettes.pen.map((entry) => entry.color));
  s.state.color = s.presets.palettes.pen[count - 1].color;
  expect(s.toolbar.quickColors()).toHaveLength(count);
  expect(s.state.color).toBe(s.presets.palettes.pen[count - 1].color);
});

it("tap unselected selects; tap the selected ID again edits that exact record regardless of elapsed time", () => {
  const s = setup();
  const editor = vi.fn();
  Object.assign(s.toolbar, { presetPopover: editor });
  const red = s.presets.palettes.pen[2];
  const anchor = {} as HTMLElement;
  s.toolbar.activateColorPreset(anchor, red.id, red.color);
  expect(s.presets.selectedIds.pen).toBe(red.id);
  expect(s.state.color).toBe(red.color);
  expect(editor).not.toHaveBeenCalled();
  s.toolbar.activateColorPreset(anchor, red.id, red.color);
  expect(editor).toHaveBeenCalledExactlyOnceWith(anchor, { id: red.id });
});

it("color and width presets share select/edit/toggle transitions without a clock", () => {
  expect(presetActivation("blue", "red", null)).toBe("select");
  expect(presetActivation("red", "red", null)).toBe("open");
  expect(presetActivation("red", "red", "red")).toBe("close");
  expect(presetActivation("red", "blue", "red")).toBe("select");
  expect(presetActivation("blue", "blue", null)).toBe("open");
  expect(presetActivation("blue", "blue", "blue")).toBe("close");
  expect(presetActivation(null, "red", "red")).toBe("select");
});

it("selected color closes its anchored editor; changing presets closes and selects without opening", () => {
  const s = setup(), red = s.presets.palettes.pen[2], blue = s.presets.palettes.pen[3];
  s.presets.selectedIds.pen = red.id;
  const close = vi.fn(), editor = vi.fn();
  Object.assign(s.toolbar, {popoverKind: "pen-color", popoverPresetId: red.id, closePopover: close, presetPopover: editor});
  s.toolbar.activateColorPreset({} as HTMLElement, red.id, red.color);
  expect(close).toHaveBeenCalledOnce(); expect(editor).not.toHaveBeenCalled();
  s.toolbar.activateColorPreset({} as HTMLElement, blue.id, blue.color);
  expect(s.presets.selectedIds.pen).toBe(blue.id); expect(s.state.color).toBe(blue.color);
  expect(editor).not.toHaveBeenCalled();
});


describe("popover anchors and eraser resizing", () => {
  it("rebinds rebuilt controls without changing preset anchor identity", () => {
    const button = (label: string, classes: string[], connected: boolean, dataset = {}) => ({ isConnected: connected, dataset, classList: Object.assign([...classes], { contains: (name: string) => classes.includes(name) }), getAttribute: () => label });
    const old = button("Eraser erases: All ink", ["goodobsidian-erasermode", "goodobsidian-eraserfilter"], false);
    const rebuilt = button("Eraser erases: Highlighter only", ["goodobsidian-erasermode", "goodobsidian-eraserfilter", "is-filtered"], true);
    const toolbar = Object.assign(Object.create(Toolbar.prototype), { popoverAnchor: old, popoverPresetId: null, optionsEl: { querySelectorAll: () => [rebuilt] } });
    expect(toolbar.resolvePopoverAnchor()).toBe(rebuilt);
    toolbar.popoverPresetId = "width-3";
    expect(toolbar.resolvePopoverAnchor()).toBeNull();
    rebuilt.dataset = { widthId: "width-3" };
    expect(toolbar.resolvePopoverAnchor()).toBe(rebuilt);
  });
  it("eraser slider/reset use the eraser callback without changing writing widths or colors", async () => {
    const { renderThicknessEditor } = await import("../../src/view/thickness-editor");
    vi.mocked(renderThicknessEditor).mockClear();
    const state = { tool: "eraser", eraserSize: 24, eraserMode: "stroke", eraserFilter: "highlighter", size: 5, color: "#123456" };
    const callback = vi.fn(), close = vi.fn();
    const anchor = {};
    const toolbar = Object.assign(Object.create(Toolbar.prototype), { state, popoverKind: null, popover: { addClass: vi.fn() }, openPopover: vi.fn(() => ({})), closePopover: close, keepPopoverInside: vi.fn(), callbacks: { onEraserChange: callback }, syncActive: vi.fn() });
    toolbar.toggleEraserSizeList(anchor);
    const options = vi.mocked(renderThicknessEditor).mock.calls[0][1];
    expect(options.title).toBe("Eraser diameter");
    options.select(17.5);
    expect(callback).toHaveBeenLastCalledWith("stroke", 17.5);
    expect(options.current().width).toBe(17.5);
    expect(state.size).toBe(5); expect(state.color).toBe("#123456");
    expect(state.eraserMode).toBe("stroke"); expect(state.eraserFilter).toBe("highlighter");
    const doc = { createElementNS: (_ns: string, tag: string) => ({ tag, attrs: {} as Record<string, string>, children: [] as unknown[], classList: { add: () => {} }, setAttribute(name: string, value: string) { this.attrs[name] = value; }, removeAttribute(name: string) { delete this.attrs[name]; }, append(child: unknown) { this.children.push(child); } }) };
    const preview = options.preview!(17.5, false, doc as unknown as Document) as unknown as { tag: string; attrs: Record<string,string>; children: Array<{ tag: string; attrs: Record<string,string> }> };
    expect(preview.children[0].tag).toBe("circle");
    expect(preview.children[0].attrs.fill).toBe("none");
    expect(Number(preview.children[0].attrs.r)).toBeCloseTo(12 * 17.5 / 48);
    expect(preview.attrs["aria-label"]).toContain("Eraser diameter");
    options.reset(); expect(state.eraserSize).toBe(24);
    toolbar.popoverKind = "eraser-size"; toolbar.popoverAnchor = anchor;
    toolbar.toggleEraserSizeList(anchor); expect(close).toHaveBeenCalledOnce();
  });
});


it("eraser filter choices expose All ink/Highlighter/Pen without resetting mode or diameter", () => {
  const entries: Array<{ label: string; click?: () => void }> = [];
  const body = { createDiv: () => ({}), createEl: (_tag: string, options: { text: string }) => {
    const entry = { label: options.text, click: undefined as undefined | (() => void) }; entries.push(entry);
    return { toggleClass: () => {}, addEventListener: (_type: string, click: () => void) => { entry.click = click; } };
  } };
  const state = { eraserMode: "stroke", eraserSize: 17.5, eraserFilter: "all" };
  const changed = vi.fn();
  const toolbar = Object.assign(Object.create(Toolbar.prototype), { state, callbacks: { onEraserFilterChange: changed }, closePopover: vi.fn(), buildOptions: vi.fn(), syncActive: vi.fn() });
  toolbar.renderEraserFilters(body);
  expect(entries.map(e => e.label)).toEqual(["All ink", "Highlighter only", "Pen only"]);
  entries[2].click!();
  expect(state.eraserFilter).toBe("pen"); expect(changed).toHaveBeenCalledWith("pen");
  expect(state.eraserMode).toBe("stroke"); expect(state.eraserSize).toBe(17.5);
});

describe("pen gestures pressure controls", () => {
  it("switching pen types reads the shared preference without overwriting it", () => {
    const s = setup(); const preference = vi.fn();
    const t = s.toolbar as unknown as { callbacks: Record<string, unknown> };
    t.callbacks.pressureAllowed = () => true; t.callbacks.onPressurePreferenceChange = preference;
    for (const spec of PEN_TYPES) {
      s.toolbar.choosePenType(spec);
      expect((s.state as unknown as { pressureEnabled: boolean }).pressureEnabled).toBe(spec.pressure);
    }
    expect(preference).not.toHaveBeenCalled();
  });
  it("pressure writes the shared preference and removed gesture controls are absent", () => {
    const inputs: { value: string; listeners: Record<string, () => void> }[] = [];
    const node = (): any => ({ querySelector: () => ({ childElementCount: 1 }), createDiv: () => node(), createSpan: () => node(), setAttribute: () => {}, addEventListener: () => {}, createEl: (tag: string, options: { type?: string }) => {
      const child = node(); child.value = ""; child.listeners = {}; child.addEventListener = (name: string, fn: () => void) => { child.listeners[name] = fn; };
      if (tag === "input" && options.type === "range") inputs.push(child);
      return child;
    } });
    const switches = new Map<string, (on: boolean) => void>(), preference = vi.fn(), saved = vi.fn(), rerender = vi.fn();
    const state = { penGestures: {} };
    const toolbar = Object.assign(Object.create(Toolbar.prototype), { state, callbacks: { pressureAllowed: () => true, onPressurePreferenceChange: preference, onPenGesturesChange: saved }, popoverRender: rerender, switchRow: (_body: unknown, label: string, _enabled: boolean, on: (enabled: boolean) => void) => { switches.set(label, on); return {}; } });
    toolbar.renderPenGestures(node(), () => {});
    switches.get("Pressure sensitivity")!(false); expect(preference).toHaveBeenCalledWith(false);
    expect(inputs).toHaveLength(0);
    expect(switches.has("Constrain shapes with finger")).toBe(false);
    expect(rerender).not.toHaveBeenCalled();
  });
});
