import { describe, expect, it } from "vitest";
import { PALETTE } from "../../src/constants";
import { DEFAULT_SETTINGS, shownValue, storeShownValue } from "../../src/settings-data";
import {
  migrateWritingPresets,
  moveColor,
  normalizeWidth,
  removeWidth,
  restoreColors,
  saveColor,
  saveWidth,
  selectedColor,
  selectPreset,
  selectedPreset,
  removeColor,
  selectColor,
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
describe("stable mutable color presets", () => {
  const colors = (p: ReturnType<typeof fresh>, tool: "pen" | "highlighter" = "pen") =>
    p.palettes[tool].map((entry) => entry.color);
  it.each([0, 2, 5])("edits position %s by identity, including duplicate color values", (index) => {
    const p = fresh();
    const preset = p.palettes.pen[index];
    const id = preset.id;
    selectPreset(p, "pen", id);
    expect(saveColor(p, "pen", "#0000ff", id)).toMatchObject({ id, color: "#0000ff" });
    expect(selectedPreset(p, "pen")?.id).toBe(id);
    expect(selectedColor(p, "pen")).toBe("#0000ff");
    expect(p.palettes.pen[index].color).toBe("#0000ff");
    expect(
      migrateWritingPresets(JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, writingPresets: p }))),
    ).toEqual(p);
  });
  it("editing red to an existing blue is allowed without merging their identities", () => {
    const p = fresh();
    const red = p.palettes.pen[2],
      blue = p.palettes.pen[3];
    selectPreset(p, "pen", red.id);
    saveColor(p, "pen", blue.color, red.id);
    expect(red.color).toBe(blue.color);
    expect(red.id).not.toBe(blue.id);
    expect(p.selectedIds.pen).toBe(red.id);
  });
  it("reorder/delete another row never changes the selected preset", () => {
    const p = fresh();
    const selected = p.palettes.pen[2];
    selectPreset(p, "pen", selected.id);
    moveColor(p, "pen", 2, 0);
    removeColor(p, "pen", p.palettes.pen[3].id);
    expect(p.selectedIds.pen).toBe(selected.id);
    expect(selectedColor(p, "pen")).toBe(selected.color);
  });
  it("deleting the selected row chooses the next row, then previous at the end, then black when empty", () => {
    const p = fresh();
    const next = p.palettes.pen[3].id;
    selectPreset(p, "pen", p.palettes.pen[2].id);
    removeColor(p, "pen", p.selectedIds.pen!);
    expect(p.selectedIds.pen).toBe(next);
    selectPreset(p, "pen", p.palettes.pen.at(-1)!.id);
    const previous = p.palettes.pen.at(-2)!.id;
    removeColor(p, "pen", p.selectedIds.pen!);
    expect(p.selectedIds.pen).toBe(previous);
    for (const entry of [...p.palettes.pen]) removeColor(p, "pen", entry.id);
    expect(p.selectedIds.pen).toBeNull();
    expect(selectedColor(p, "pen")).toBe(PALETTE[0]);
    expect(migrateWritingPresets({ ...DEFAULT_SETTINGS, writingPresets: p }).palettes.pen).toEqual(
      [],
    );
  });
  it("adding a color preserves selection until explicitly picked; IDs are not recycled", () => {
    const p = fresh(),
      id = p.selectedIds.pen;
    const added = saveColor(p, "pen", "#abc")!;
    expect(p.selectedIds.pen).toBe(id);
    removeColor(p, "pen", added.id);
    expect(saveColor(p, "pen", "#abc")!.id).not.toBe(added.id);
  });
  it("stale editors never append or target the final row", () => {
    const p = fresh();
    const first = p.palettes.pen[0];
    removeColor(p, "pen", first.id);
    const before = structuredClone(p);
    expect(saveColor(p, "pen", "#abc", first.id)).toBeNull();
    expect(p).toEqual(before);
  });
  it("defaults and added presets edit/remove identically and tools remain independent", () => {
    const p = fresh(),
      before = structuredClone(p.palettes.highlighter);
    const added = saveColor(p, "pen", "#abc")!;
    selectPreset(p, "pen", added.id);
    saveColor(p, "pen", "#def", added.id);
    expect(selectedColor(p, "pen")).toBe("#ddeeff");
    removeColor(p, "pen", added.id);
    expect(p.palettes.highlighter).toEqual(before);
  });
  it("restore recreates true defaults and a deterministic matching/first selection", () => {
    const p = fresh();
    const highlighter = structuredClone(p.palettes.highlighter);
    const oldIds = p.palettes.pen.map((entry) => entry.id);
    selectColor(p, "pen", "#abcdef");
    restoreColors(p, "pen");
    expect(colors(p)).toEqual(PALETTE);
    expect(selectedColor(p, "pen")).toBe(PALETTE[0]);
    expect(p.palettes.pen.every((entry) => !oldIds.includes(entry.id))).toBe(true);
    expect(p.palettes.highlighter).toEqual(highlighter);
  });
  it("migrates v1 palette order, selected custom ink and duplicates safely and idempotently", () => {
    const old = {
      version: 1,
      widths: [5, 2],
      selectedWidth: 9.75,
      palettes: { pen: ["#f00", "#00f"], highlighter: ["#abc"] },
      selectedColors: { pen: "#0000ff", highlighter: "#def" },
    };
    const p = migrateWritingPresets({ ...DEFAULT_SETTINGS, writingPresets: old });
    expect(p.version).toBe(3);
    expect(colors(p)).toEqual(["#ff0000", "#0000ff"]);
    expect(selectedColor(p, "pen")).toBe("#0000ff");
    expect(selectedColor(p, "highlighter")).toBe("#ddeeff");
    expect(p.widths).toEqual([2, 5]);
    expect(p.selectedWidth).toBe(9.75);
    expect(migrateWritingPresets({ ...DEFAULT_SETTINGS, writingPresets: p })).toEqual(p);
  });
  it("migrates pre-preset settings without changing active ink or sharing identities", () => {
    const p = migrateWritingPresets({
      ...DEFAULT_SETTINGS,
      customColors: ["#abc"],
      defaultColor: "#123456",
    });
    expect(selectedColor(p, "pen")).toBe("#123456");
    expect(colors(p)).toEqual([...PALETTE, "#aabbcc", "#123456"]);
    expect(p.selectedIds.pen).not.toBe(p.selectedIds.highlighter);
  });
  it("settings bulk imports keep stable surviving IDs and settings colors select real presets", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      customColors: ["#abc"],
      writingPresets: migrateWritingPresets({ ...DEFAULT_SETTINGS, customColors: ["#abc"] }),
    };
    const id = settings.writingPresets.palettes.pen[0].id;
    storeShownValue(settings, "customColors", "#def");
    expect(settings.writingPresets.palettes.pen[0].id).toBe(id);
    expect(colors(settings.writingPresets)).not.toContain("#aabbcc");
    expect(colors(settings.writingPresets)).toContain("#ddeeff");
    storeShownValue(settings, "defaultTool", "highlighter");
    storeShownValue(settings, "defaultColor", "#abcdef");
    expect(shownValue(settings, "defaultColor")).toBe("#abcdef");
    expect(selectedColor(settings.writingPresets, "pen")).toBe(DEFAULT_SETTINGS.defaultColor);
  });
});
