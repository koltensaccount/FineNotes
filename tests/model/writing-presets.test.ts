import { describe, expect, it } from "vitest";
import { PALETTE } from "../../src/constants";
import { DEFAULT_SETTINGS, storeShownValue } from "../../src/settings-data";
import {
  migrateWritingPresets,
  moveColor,
  normalizeWidth,
  removeWidth,
  restoreColors,
  saveColor,
  saveWidth,
} from "../../src/model/writing-presets";
const fresh = () => migrateWritingPresets({ ...DEFAULT_SETTINGS });
describe("writing width presets", () => {
  it.each([
    [1.22, [1.22, 2, 3, 5]],
    [2.5, [2, 2.5, 3, 5]],
    [12, [2, 3, 5, 12]],
  ])("adds %s in numerical order", (value, expected) => {
    const p = fresh();
    p.widths = [2, 3, 5];
    p.selectedWidth = 3;
    saveWidth(p, value as number);
    expect(p.widths).toEqual(expected);
    expect(p.selectedWidth).toBe(3);
  });
  it("edits and resorts while following the selected value", () => {
    const p = fresh();
    p.selectedWidth = 3;
    saveWidth(p, 10, 3);
    expect(p.widths).toEqual([2, 5, 8, 10, 12]);
    expect(p.selectedWidth).toBe(10);
  });
  it("normalizes precision/range and merges meaningful duplicates", () => {
    const p = fresh();
    saveWidth(p, 3.01);
    expect(p.widths).toEqual([2, 3, 5, 8, 12]);
    expect(normalizeWidth(-100)).toBe(0.98);
    expect(normalizeWidth(100)).toBe(12);
    saveWidth(p, 5, 3);
    expect(p.widths).toEqual([2, 5, 8, 12]);
  });
  it("removal keeps active ink and supports an empty list after reload", () => {
    const p = fresh();
    p.widths = [3];
    p.selectedWidth = 3;
    removeWidth(p, 3);
    expect(p.selectedWidth).toBe(3);
    expect(migrateWritingPresets({ ...DEFAULT_SETTINGS, writingPresets: p }).widths).toEqual([]);
  });
  it("persists sorted presets and selected width through JSON/reload", () => {
    const p = fresh();
    p.selectedWidth = 5;
    saveWidth(p, 2.5);
    const saved = JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, writingPresets: p }));
    expect(migrateWritingPresets(saved)).toEqual(p);
  });
});
describe("writing color presets", () => {
  it("allows editing and deleting former defaults independently", () => {
    const p = fresh();
    const highlighter = [...p.palettes.highlighter];
    expect(saveColor(p, "pen", "#abc", 0)).toBe(true);
    expect(p.palettes.pen[0]).toBe("#aabbcc");
    expect(p.selectedColors.pen).toBe("#aabbcc");
    p.palettes.pen.splice(1, 1);
    expect(p.palettes.pen).not.toContain(PALETTE[1]);
    expect(p.palettes.highlighter).toEqual(highlighter);
  });
  it("adds colors, rejects duplicates, and preserves user-controlled order on reload", () => {
    const p = fresh();
    expect(saveColor(p, "pen", "#abc")).toBe(true);
    expect(saveColor(p, "pen", "#AABBCC")).toBe(false);
    const last = p.palettes.pen.length - 1;
    moveColor(p, "pen", last, 0);
    expect(p.palettes.pen[0]).toBe("#aabbcc");
    expect(
      migrateWritingPresets(JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, writingPresets: p }))),
    ).toEqual(p);
  });
  it("reset restores only the requested palette", () => {
    const p = fresh();
    saveColor(p, "pen", "#abc");
    saveColor(p, "highlighter", "#def");
    const before = structuredClone(p);
    restoreColors(p, "pen");
    expect(p.palettes.pen).toEqual(PALETTE);
    expect(p.palettes.highlighter).toEqual(before.palettes.highlighter);
    expect(p.widths).toEqual(before.widths);
    expect(p.selectedColors).toEqual(before.selectedColors);
  });
  it("migration retains custom colors, selected ink, widths and opacity and is idempotent", () => {
    const old = {
      ...DEFAULT_SETTINGS,
      customColors: ["#abc", "#ABC", "#00ccaa"],
      defaultColor: "#123456",
      defaultSize: 9.75,
      highlighterAlpha: 0.7,
    };
    const p = migrateWritingPresets(old);
    expect(p.palettes.pen).toEqual([...PALETTE, "#aabbcc", "#00ccaa"]);
    expect(p.palettes.highlighter).toEqual(p.palettes.pen);
    expect(p.palettes.highlighter).not.toBe(p.palettes.pen);
    expect(p.selectedColors).toEqual({ pen: "#123456", highlighter: "#123456" });
    expect(p.selectedWidth).toBe(9.75);
    expect(migrateWritingPresets({ ...old, writingPresets: p })).toEqual(p);
    expect(old.highlighterAlpha).toBe(0.7);
  });
  it("does not resurrect deleted default colors or empty palettes", () => {
    const p = fresh();
    p.palettes.pen = [];
    expect(migrateWritingPresets({ ...DEFAULT_SETTINGS, writingPresets: p }).palettes.pen).toEqual(
      [],
    );
  });
  it("legacy bulk color setting updates both palettes without reviving defaults", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      customColors: ["#abc"],
      writingPresets: migrateWritingPresets({ ...DEFAULT_SETTINGS, customColors: ["#abc"] }),
    };
    settings.writingPresets.palettes.pen.splice(0, 1);
    storeShownValue(settings, "customColors", "#def");
    expect(settings.writingPresets.palettes.pen).not.toContain(PALETTE[0]);
    expect(settings.writingPresets.palettes.pen).not.toContain("#aabbcc");
    expect(settings.writingPresets.palettes.highlighter).toContain("#ddeeff");
  });
});
