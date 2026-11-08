import { describe, it, expect } from "vitest";
import { emptyDocument } from "../../src/model/document";
import {
  isBlockPage,
  createBlockPage,
  expandBlockPageIfNeeded,
  resolveBlockBounds,
  findBlockInDocument,
  BLOCK_PADDING,
} from "../../src/model/handwrite-block";

describe("handwrite-block", () => {
  it("creates a dedicated block page that can expand without colliding", () => {
    const doc = emptyDocument();
    const { page, pageIndex, clip } = createBlockPage(doc, "block-test-1", 800, 360);

    expect(pageIndex).toBe(1); // doc already has 1 blank page
    expect(page.id).toBe("block-test-1");
    expect(page.geometry.width).toBe(800);
    expect(page.geometry.height).toBe(360);
    expect(clip.id).toBe("block-test-1");
    expect(isBlockPage(page)).toBe(true);
  });

  it("expands block page height when content approaches the bottom", () => {
    const doc = emptyDocument();
    const { page } = createBlockPage(doc, "block-test-2", 800, 360);

    // Content at y = 100 doesn't trigger expand
    expect(expandBlockPageIfNeeded(page, 100)).toBe(false);
    expect(page.geometry.height).toBe(360);

    // Content near bottom (e.g. y = 320 where height = 360) triggers expansion
    expect(expandBlockPageIfNeeded(page, 320)).toBe(true);
    expect(page.geometry.height).toBeGreaterThan(500);

    // Clip maxY expands along with page height
    expect(page.clips![0].bounds.maxY).toBe(page.geometry.height - BLOCK_PADDING);
  });

  it("resolves dynamic block bounds for rendering and export", () => {
    const doc = emptyDocument();
    const { page, clip } = createBlockPage(doc, "block-test-3", 800, 360);

    // Initially empty
    const emptyBounds = resolveBlockBounds(page, clip);
    expect(emptyBounds.minX).toBe(BLOCK_PADDING);
    expect(emptyBounds.maxX).toBe(800 - BLOCK_PADDING);
    expect(emptyBounds.minY).toBe(BLOCK_PADDING);

    // Add stroke
    page.strokes.push({
      id: "s1",
      color: "#000",
      size: 2,
      tool: "pen",
      pts: [100, 100, 1, 200, 450, 1],
    });
    expandBlockPageIfNeeded(page, 450);

    const boundsWithInk = resolveBlockBounds(page, clip);
    expect(boundsWithInk.maxY).toBeGreaterThanOrEqual(450 + 24);
  });

  it("finds block by block id or subpath across document pages", () => {
    const doc = emptyDocument();
    createBlockPage(doc, "block-algebra", 800);

    const found = findBlockInDocument(doc, "block-algebra");
    expect(found).not.toBeNull();
    expect(found?.page.id).toBe("block-algebra");

    const foundWithSubpath = findBlockInDocument(doc, "#block=block-algebra");
    expect(foundWithSubpath?.page.id).toBe("block-algebra");

    expect(findBlockInDocument(doc, "#^block-algebra")).toEqual(found);

    const notFound = findBlockInDocument(doc, "block-missing");
    expect(notFound).toBeNull();
  });
});
