import { presetActivation } from "../../src/view/transient-popover";
import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar, PEN_TYPES } = await import("../../src/view/toolbar");
import { migrateWritingPresets, selectedColor, selectColor } from "../../src/model/writing-presets";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
function setup() {
  const presets = migrateWritingPresets(DEFAULT_SETTINGS);
  const save = vi.fn();
  const state = { tool: "pen", color: selectedColor(presets, "pen"), size: 3 };
  const toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
    state,
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
