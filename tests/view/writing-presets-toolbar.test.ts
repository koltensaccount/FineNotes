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
  it("keeps the live quick width in numerical order", () => {
    const s = setup();
    s.state.size = 1.22;
    expect(s.toolbar.quickWidths()).toEqual([1.22, 2, 3]);
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
