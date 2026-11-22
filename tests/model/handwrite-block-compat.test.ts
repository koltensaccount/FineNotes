import { describe, expect, it } from "vitest";
import { emptyDocument } from "../../src/model/document";
import {
  INITIAL_BLOCK_HEIGHT,
  createBlockPage,
  expandBlockPageIfNeeded,
  findBlockInDocument,
  fitBlockPageHeight,
  isBlockPage,
} from "../../src/model/handwrite-block";
import { dedicatedInkPage, mergeInlineInk } from "../../src/model/inline-ink-merge";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";

describe("Handwrite Here backward compatibility & serialization", () => {
  it("losslessly round-trips page.clips and page.pageEmbedPath through serialize.ts", () => {
    const doc = emptyDocument();
    const { page, clip } = createBlockPage(doc, "block-compat-1", 800, 360);
    clip.imagePath = "FineNotes/Embeds/Test-block-compat-1.png";
    page.pageEmbedPath = "FineNotes/Embeds/Test-page-0.png";

    const raw = buildInkFile("# Test Note\n", doc);
    const parsed = parseInkFile(raw, 1024);
    expect(parsed.doc).not.toBeNull();
    const found = findBlockInDocument(parsed.doc!, "block-compat-1");
    expect(found).not.toBeNull();
    expect(isBlockPage(found!.page)).toBe(true);
    expect(found!.clip.imagePath).toBe("FineNotes/Embeds/Test-block-compat-1.png");
    expect(found!.page.pageEmbedPath).toBe("FineNotes/Embeds/Test-page-0.png");
    expect(dedicatedInkPage(parsed.doc!, "block-compat-1").id).toBe("block-compat-1");
  });

  it("expands block height and merges inline edits cleanly", () => {
    const doc = emptyDocument();
    const { page } = createBlockPage(doc, "block-grow-1", 800, 360);
    const base = structuredClone(page);
    const local = structuredClone(page);
    const latest = structuredClone(page);

    expect(expandBlockPageIfNeeded(local, 350)).toBe(true);
    expect(local.geometry.height).toBeGreaterThan(360);

    mergeInlineInk(base, local, latest);
    expect(latest.geometry.height).toBe(local.geometry.height);
  });

  it("shrinks an expanded block back to initial height when erased completely blank", () => {
    const doc = emptyDocument();
    const { page } = createBlockPage(doc, "block-shrink-1", 800, INITIAL_BLOCK_HEIGHT);
    expect(expandBlockPageIfNeeded(page, 620)).toBe(true);
    expect(page.geometry.height).toBeGreaterThan(INITIAL_BLOCK_HEIGHT);

    const base = structuredClone(page);
    const local = structuredClone(page);
    const latest = structuredClone(page);

    expect(fitBlockPageHeight(local, null)).toBe(true);
    expect(local.geometry.height).toBe(INITIAL_BLOCK_HEIGHT);

    mergeInlineInk(base, local, latest);
    expect(latest.geometry.height).toBe(INITIAL_BLOCK_HEIGHT);
  });
});
