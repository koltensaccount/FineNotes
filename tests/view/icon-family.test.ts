import { describe, expect, it, vi } from "vitest";
import { addIcon } from "obsidian";
import {
  ICON_FAMILY_CANDIDATES,
  candidateIconName,
  registerIconFamilyCandidates,
} from "../../src/view/icon-family";

vi.mock("obsidian", () => ({ addIcon: vi.fn() }));

describe("FineNotes icon candidate review", () => {
  it("has unique, namespaced ids and complete side-by-side originals", () => {
    const ids = ICON_FAMILY_CANDIDATES.map((candidate) => candidate.id);
    expect(ids.length).toBeGreaterThanOrEqual(25);
    expect(new Set(ids).size).toBe(ids.length);
    for (const candidate of ICON_FAMILY_CANDIDATES) {
      expect(candidate.title).toBeTruthy();
      expect(candidate.original).toBeTruthy();
      expect(candidate.usage).toBeTruthy();
      expect(candidate.svg).toMatch(/<(path|circle|rect)/);
      expect(candidateIconName(candidate.id)).toBe(`finenotes-v2-${candidate.id}`);
    }
  });

  it("preserves explicit dynamic Lasso and Shapes behavior", () => {
    const byId = new Map(ICON_FAMILY_CANDIDATES.map((icon) => [icon.id, icon]));
    for (const id of ["lasso-free", "lasso-rect", "shapes"]) {
      expect(byId.get(id)?.preserveState).toBeTruthy();
    }
  });

  it("reserves ink fills for meaningful tool-tip details", () => {
    const byId = new Map(ICON_FAMILY_CANDIDATES.map((icon) => [icon.id, icon]));
    for (const id of ["pen", "highlighter", "ballpoint", "brush", "handwrite-here"]) {
      expect(byId.get(id)?.svg).toContain("fnv2-ink");
    }
    for (const id of ["eraser", "lasso-rect", "bookmark", "crop"]) {
      expect(byId.get(id)?.svg).not.toContain("fnv2-ink");
    }
  });

  it("registers original candidate glyphs without replacing native icon identifiers", () => {
    vi.mocked(addIcon).mockClear();
    registerIconFamilyCandidates();
    expect(addIcon).toHaveBeenCalledTimes(ICON_FAMILY_CANDIDATES.length);
    for (const [name] of vi.mocked(addIcon).mock.calls) {
      expect(name).toMatch(/^finenotes-v2-/);
    }
  });
});
