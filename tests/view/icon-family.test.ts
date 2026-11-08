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
];

describe("FineNotes Concept #2 icon review", () => {
  it("shows exactly three new instrument designs, not the rejected 28-icon pack", () => {
    expect(ICON_FAMILY_CANDIDATES.map((candidate) => candidate.id)).toEqual(expectedIds);
    expect(new Set(expectedIds).size).toBe(ICON_FAMILY_CANDIDATES.length);
    expect(ICON_FAMILY_CANDIDATES.every(({category}) => category === "Writing tools")).toBe(true);
    for (const candidate of ICON_FAMILY_CANDIDATES) {
      expect(candidate.title).toBeTruthy();
      expect(candidate.original).toBeTruthy();
      expect(candidate.usage).toBeTruthy();
      expect(candidate.svg).toMatch(/<path d=/);
    }
  });

  it("keeps the real original stroke or Obsidian icon in each comparison", () => {
    const current = ICON_FAMILY_CANDIDATES.map(x => x.original);
    expect(current).toEqual(["fn-original-pen", "fn-original-highlighter", "eraser"]);
  });

  it("limits selected ink to the two instrument tips, never the eraser body", () => {
    for (const candidate of ICON_FAMILY_CANDIDATES.slice(0, 2)) {
      expect(candidate.svg).toMatch(/class="fnv2-ink"[^>]+stroke="none"/);
    }
    expect(ICON_FAMILY_CANDIDATES[2].svg).not.toContain("fnv2-ink");
    for (const candidate of ICON_FAMILY_CANDIDATES) {
      expect(candidate.svg).not.toMatch(/stroke-width="(?:3|4|5)"/);
      expect(candidate.svg).not.toContain("<text");
    }
  });

  it("registers only namespaced gallery icons, never overwriting live toolbar names", () => {
    vi.mocked(addIcon).mockClear();
    registerIconFamilyCandidates();
    expect(addIcon).toHaveBeenCalledTimes(3);
    for (const [name, markup] of vi.mocked(addIcon).mock.calls) {
      expect(name).toMatch(/^finenotes-concept2-/);
      expect(markup).toContain('stroke-width="1.6"');
      expect(markup).toContain('<g transform="rotate(45 12 12)">');
      expect(markup).toContain("</g>");
    }
    expect(candidateIconName(expectedIds[0])).toBe("finenotes-concept2-pen-concept2");
  });
});
