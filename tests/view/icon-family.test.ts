import { describe, expect, it, vi } from "vitest";
import { addIcon } from "obsidian";
import {
  APPROVED_ICONS,
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
  "import-pdf-concept2",
  "scan-document-concept2",
  "convert-notebook-concept2",
  "handwrite-here-concept2",
  "update-companion-pdf-concept2",
];

describe("FineNotes Concept #2 icon review", () => {
  it("keeps the review batches separate", () => {
    expect(ICON_FAMILY_CANDIDATES.map((candidate) => candidate.id)).toEqual(expectedIds);
    expect(new Set(expectedIds).size).toBe(ICON_FAMILY_CANDIDATES.length);
    expect(ICON_FAMILY_CANDIDATES.map(({ category }) => category)).toEqual([
      ...Array(3).fill("Writing tools"),
      ...Array(3).fill("Notebook and pages"),
      ...Array(3).fill("Import and convert"),
      ...Array(2).fill("Handwriting and PDF updates"),
    ]);
    for (const candidate of ICON_FAMILY_CANDIDATES) {
      expect(candidate.title).toBeTruthy();
      expect(candidate.original).toBeTruthy();
      expect(candidate.usage).toBeTruthy();
      expect(candidate.svg).toMatch(/<path d=/);
    }
  });

  it("uses the current glyph where the action has one", () => {
    const current = ICON_FAMILY_CANDIDATES.map(x => x.original);
    expect(current).toEqual([
      "fn-original-pen", "fn-original-highlighter", "eraser",
      "notebook-pen", "panel-left", "plus",
      "file-text", "scan-line", "book-open",
      "fn-original-none", "fn-original-none",
    ]);
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

  it("registers every approved icon with its own name and the host viewport scale", () => {
    vi.mocked(addIcon).mockClear();
    registerIconFamilyCandidates();
    expect(addIcon).toHaveBeenCalledTimes(expectedIds.length);
    expect(vi.mocked(addIcon).mock.calls.map(([name]) => name)).toEqual(Object.values(APPROVED_ICONS));
    for (const [name, markup] of vi.mocked(addIcon).mock.calls) {
      expect(name).toMatch(/^finenotes-concept2-/);
      expect(markup).toContain('stroke-width="1.6"');
      expect(markup).toContain(`transform="scale(${100 / 24})"`);
      expect(markup.includes('<g transform="rotate(45 12 12)">')).toBe(
        /-(pen|highlighter|eraser)-concept2$/.test(name),
      );
      expect(markup).toContain("</g>");
    }
    expect(candidateIconName(expectedIds[0])).toBe("finenotes-concept2-pen-concept2");
  });
});
