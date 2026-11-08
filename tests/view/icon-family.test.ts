import { describe, expect, it, vi } from "vitest";
import { addIcon } from "obsidian";
import {
  ICON_FAMILY_CANDIDATES,
  candidateIconName,
  registerIconFamilyCandidates,
} from "../../src/view/icon-family";

vi.mock("obsidian", () => ({ addIcon: vi.fn() }));

const expectedIds = [
  "pen-concept2",
  "highlighter-concept2",
  "eraser-concept2",
  "new-notebook-concept2",
  "page-thumbnails-concept2",
  "add-page-concept2",
];

describe("FineNotes Concept #2 icon review", () => {
  it("keeps the writing and notebook batches separate", () => {
    expect(ICON_FAMILY_CANDIDATES.map((candidate) => candidate.id)).toEqual(expectedIds);
    expect(new Set(expectedIds).size).toBe(ICON_FAMILY_CANDIDATES.length);
    expect(ICON_FAMILY_CANDIDATES.map(({ category }) => category)).toEqual([
      ...Array(3).fill("Writing tools"),
      ...Array(3).fill("Notebook and pages"),
    ]);
    for (const candidate of ICON_FAMILY_CANDIDATES) {
      expect(candidate.title).toBeTruthy();
      expect(candidate.original).toBeTruthy();
      expect(candidate.usage).toBeTruthy();
      expect(candidate.svg).toMatch(/<path d=/);
    }
  });

  it("keeps the real original stroke or Obsidian icon in each comparison", () => {
    const current = ICON_FAMILY_CANDIDATES.map(x => x.original);
    expect(current).toEqual(["fn-original-pen", "fn-original-highlighter", "eraser", "notebook-pen", "panel-left", "plus"]);
  });

  it("limits selected ink to the two instrument tips, never the eraser body", () => {
    for (const candidate of ICON_FAMILY_CANDIDATES.slice(0, 2)) {
      expect(candidate.svg).toMatch(/class="fnv2-ink"[^>]+stroke="none"/);
    }
    for (const candidate of ICON_FAMILY_CANDIDATES.slice(2)) {
      expect(candidate.svg).not.toContain("fnv2-ink");
    }
    for (const candidate of ICON_FAMILY_CANDIDATES) {
      expect(candidate.svg).not.toMatch(/stroke-width="(?:3|4|5)"/);
      expect(candidate.svg).not.toContain("<text");
    }
  });

  it("registers only namespaced gallery icons, never overwriting live toolbar names", () => {
    vi.mocked(addIcon).mockClear();
    registerIconFamilyCandidates();
    expect(addIcon).toHaveBeenCalledTimes(expectedIds.length);
    for (const [name, markup] of vi.mocked(addIcon).mock.calls) {
      expect(name).toMatch(/^finenotes-concept2-/);
      expect(markup).toContain('stroke-width="1.6"');
      expect(markup.includes('<g transform="rotate(45 12 12)">')).toBe(
        /-(pen|highlighter|eraser)-concept2$/.test(name),
      );
      expect(markup).toContain("</g>");
    }
    expect(candidateIconName(expectedIds[0])).toBe("finenotes-concept2-pen-concept2");
  });
});
