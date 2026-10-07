import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
import { HIGHLIGHTER_COLORS, HIGHLIGHTER_SIZES, PALETTE, SIZES } from "../../src/constants";
import {
  migrateWritingPresets,
  restoreColors,
  restoreWidths,
  saveColor,
  saveWidth,
  selectedColor,
  selectedWidthFor,
  widthsFor,
  selectPreset,
  selectWidth,
} from "../../src/model/writing-presets";
describe("tool-specific fresh/restored writing defaults", () => {
  it("fresh profiles start with five studying colors and wider Highlighter widths", () => {
    const p = migrateWritingPresets(DEFAULT_SETTINGS, true);
    expect(p.palettes.highlighter.map((v) => v.color)).toEqual(HIGHLIGHTER_COLORS);
    expect(selectedColor(p, "highlighter")).toBe(HIGHLIGHTER_COLORS[0]);
    expect(p.highlighterWidths).toEqual(HIGHLIGHTER_SIZES);
    expect(selectedWidthFor(p, "highlighter")).toBe(8);
    expect(p.widths).toEqual(SIZES);
    expect(p.selectedWidth).toBe(3);
    expect(p.palettes.pen.map((v) => v.color)).toEqual(PALETTE);
  });
  it("existing pre-preset settings preserve colors, widths and chosen size", () => {
    const p = migrateWritingPresets({
      ...DEFAULT_SETTINGS,
      customColors: ["#abc"],
      defaultSize: 9.75,
      defaultColor: "#123456",
    });
    expect(selectedColor(p, "highlighter")).toBe("#123456");
    expect(p.highlighterWidths).toEqual(SIZES);
    expect(p.selectedHighlighterWidth).toBe(9.75);
    expect(p.palettes.highlighter.map((v) => v.color)).toContain("#aabbcc");
  });
  it("v2 shared widths clone to both tools without sharing arrays or changing active choices", () => {
    const old = {
      version: 2,
      widths: [5, 2.5, 3],
      selectedWidth: 9.75,
      nextColorId: 3,
      palettes: {
        pen: [{ id: "pen-1", color: "#123456" }],
        highlighter: [{ id: "highlighter-2", color: "#abcdef" }],
      },
      selectedIds: { pen: "pen-1", highlighter: "highlighter-2" },
    };
    const p = migrateWritingPresets({ ...DEFAULT_SETTINGS, writingPresets: old });
    expect(p.widths).toEqual([2.5, 3, 5]);
    expect(p.highlighterWidths).toEqual(p.widths);
    expect(p.highlighterWidths).not.toBe(p.widths);
    expect(p.selectedWidth).toBe(9.75);
    expect(p.selectedHighlighterWidth).toBe(9.75);
    expect(p.selectedIds).toEqual(old.selectedIds);
    expect(p.palettes).toEqual(old.palettes);
  });
  it("v1 empty/custom widths survive tool separation and sorted normalization", () => {
    const p = migrateWritingPresets({
      ...DEFAULT_SETTINGS,
      writingPresets: {
        version: 1,
        widths: [],
        selectedWidth: 1.22,
        palettes: { pen: ["#abc"], highlighter: ["#def"] },
        selectedColors: { pen: "#abc", highlighter: "#def" },
      },
    });
    expect(p.widths).toEqual([]);
    expect(p.highlighterWidths).toEqual([]);
    expect(p.selectedHighlighterWidth).toBe(1.22);
    expect(selectedColor(p, "highlighter")).toBe("#ddeeff");
  });
  it("existing customized Highlighter state is preserved even when a caller requests fresh defaults", () => {
    const p = migrateWritingPresets(DEFAULT_SETTINGS, true);
    const custom = saveColor(p, "highlighter", "#123456")!;
    selectPreset(p, "highlighter", custom.id);
    selectWidth(p, "highlighter", 5);
    saveWidth(p, 2.5, undefined, "highlighter");
    const loaded = migrateWritingPresets({ ...DEFAULT_SETTINGS, writingPresets: p }, true);
    expect(loaded).toEqual(p);
  });
  it("each tool edits/sorts/deduplicates independently and selected widths follow replacement", () => {
    const p = migrateWritingPresets(DEFAULT_SETTINGS, true);
    const pen = structuredClone(p.widths);
    saveWidth(p, 5.01, 8, "highlighter");
    expect(widthsFor(p, "highlighter")).toEqual([5, 12]);
    expect(selectedWidthFor(p, "highlighter")).toBe(5);
    expect(p.widths).toEqual(pen);
    expect(p.selectedWidth).toBe(3);
  });
  it("Restore Defaults resets only that tool's palette and widths", () => {
    const p = migrateWritingPresets(DEFAULT_SETTINGS, true),
      pen = structuredClone({ palette: p.palettes.pen, widths: p.widths, width: p.selectedWidth });
    saveColor(p, "highlighter", "#123456");
    saveWidth(p, 2.5, undefined, "highlighter");
    restoreColors(p, "highlighter");
    restoreWidths(p, "highlighter");
    expect(p.palettes.highlighter.map((v) => v.color)).toEqual(HIGHLIGHTER_COLORS);
    expect(p.highlighterWidths).toEqual(HIGHLIGHTER_SIZES);
    expect(p.selectedHighlighterWidth).toBe(8);
    expect({ palette: p.palettes.pen, widths: p.widths, width: p.selectedWidth }).toEqual(pen);
  });
  it("v3 reload retains stable color identities and independent selected widths", () => {
    const p = migrateWritingPresets(DEFAULT_SETTINGS, true);
    selectWidth(p, "pen", 5);
    selectWidth(p, "highlighter", 12);
    const loaded = migrateWritingPresets({
      ...DEFAULT_SETTINGS,
      writingPresets: JSON.parse(JSON.stringify(p)),
    });
    expect(loaded).toEqual(p);
  });
});
