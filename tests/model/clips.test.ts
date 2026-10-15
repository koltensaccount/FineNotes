import { describe, expect, it } from "vitest";
import {
  type Bounds,
  type InkDocument,
  type NotebookClip,
  type Stroke,
  blankPage,
  clipCurrentBounds,
  emptyDocument,
  findClip,
} from "../../src/model/document";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import { TranslateElements } from "../../src/model/selection-commands";

function stroke(id: string, pts: number[]): Stroke {
  return { id, color: "#111111", size: 2, tool: "pen", pts };
}

describe("NotebookClip and Live Embeds model", () => {
  it("serializes and deserializes clips on pages seamlessly", () => {
    const doc = emptyDocument(800);
    const p1 = doc.pages[0];
    const s1 = stroke("s1", [100, 100, 0.5, 200, 200, 0.5]);
    p1.strokes.push(s1);

    const clip: NotebookClip = {
      id: "clip-test123",
      pageId: p1.id,
      bounds: { minX: 90, minY: 90, maxX: 210, maxY: 210 },
      elements: {
        strokeIds: ["s1"],
      },
      elementBounds: { minX: 100, minY: 100, maxX: 200, maxY: 200 },
      imagePath: "attachments/Notebook-clip-test123.png",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    p1.clips = [clip];
    p1.pageEmbedPath = "attachments/Notebook-page-1.png";

    const markdown = buildInkFile("", doc);
    expect(markdown).toContain("%%goodobsidian");

    const parsed = parseInkFile(markdown, 800);
    expect(parsed.doc).not.toBeNull();
    const readDoc = parsed.doc!;
    const readPage = readDoc.pages[0];

    expect(readPage.clips).toBeDefined();
    expect(readPage.clips!.length).toBe(1);
    expect(readPage.pageEmbedPath).toBe("attachments/Notebook-page-1.png");
    const readClip = readPage.clips![0];
    expect(readClip.id).toBe("clip-test123");
    expect(readClip.pageId).toBe(p1.id);
    expect(readClip.bounds).toEqual({ minX: 90, minY: 90, maxX: 210, maxY: 210 });
    expect(readClip.elements?.strokeIds).toEqual(["s1"]);
    expect(readClip.elementBounds).toEqual({ minX: 100, minY: 100, maxX: 200, maxY: 200 });
    expect(readClip.imagePath).toBe("attachments/Notebook-clip-test123.png");
  });

  it("findClip resolves clips across pages with various subpath formats", () => {
    const doc = emptyDocument(800);
    const p2 = blankPage("p2");
    doc.pages.push(p2);

    p2.clips = [
      {
        id: "clip-abc456",
        pageId: "p2",
        bounds: { minX: 50, minY: 50, maxX: 150, maxY: 150 },
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    expect(findClip(doc, "clip-abc456")?.pageIndex).toBe(1);
    expect(findClip(doc, "^clip-abc456")?.pageIndex).toBe(1);
    expect(findClip(doc, "#^clip-abc456")?.pageIndex).toBe(1);
    expect(findClip(doc, "abc456")?.pageIndex).toBe(1);
    expect(findClip(doc, "unknown")).toBeNull();
  });

  it("dynamically shifts clip bounds when tracked handwriting moves or space is inserted", () => {
    const page = blankPage("p1");
    const s1 = stroke("s1", [100, 100, 0.5, 200, 200, 0.5]);
    page.strokes.push(s1);

    const initialBounds: Bounds = { minX: 90, minY: 90, maxX: 210, maxY: 210 };
    const initialElemBounds: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 200 };

    const clip: NotebookClip = {
      id: "clip-shift-test",
      pageId: "p1",
      bounds: { ...initialBounds },
      elements: { strokeIds: ["s1"] },
      elementBounds: { ...initialElemBounds },
      createdAt: 1000,
      updatedAt: 1000,
    };
    page.clips = [clip];

    // 1. Initial position: no shift
    expect(clipCurrentBounds(page, clip)).toEqual(initialBounds);

    // 2. Handwriting moves or space is inserted by translating s1 by (dx: 30, dy: 150)
    const doc: InkDocument = {
      version: 2,
      view: { scrollY: 0, width: 800, scale: 1 },
      pages: [page],
    };
    const moveCmd = new TranslateElements(page.id, { strokes: [s1], images: [], textBoxes: [] }, 30, 150);
    moveCmd.apply(doc);

    // Dynamic bounding box must follow the strokes exactly
    const shifted = clipCurrentBounds(page, clip);
    expect(shifted).toEqual({
      minX: 90 + 30,
      minY: 90 + 150,
      maxX: 210 + 30,
      maxY: 210 + 150,
    });

    // 3. Undo returns strokes to original coordinates, and clip bounds automatically return
    moveCmd.invert(doc);
    expect(clipCurrentBounds(page, clip)).toEqual(initialBounds);

    // 4. Redo applies movement again, and clip bounds automatically follow
    moveCmd.apply(doc);
    expect(clipCurrentBounds(page, clip)).toEqual({
      minX: 120,
      minY: 240,
      maxX: 240,
      maxY: 360,
    });
  });

  it("falls back gracefully to static bounds if all tracked elements are deleted", () => {
    const page = blankPage("p1");
    const clip: NotebookClip = {
      id: "clip-deleted-elem",
      pageId: "p1",
      bounds: { minX: 40, minY: 40, maxX: 140, maxY: 140 },
      elements: { strokeIds: ["non-existent-stroke"] },
      elementBounds: { minX: 50, minY: 50, maxX: 130, maxY: 130 },
      createdAt: 1000,
      updatedAt: 1000,
    };
    page.clips = [clip];

    expect(clipCurrentBounds(page, clip)).toEqual({ minX: 40, minY: 40, maxX: 140, maxY: 140 });
  });
});

it("persists expandable regions and grows with ink, text, pictures, and circuits while excluding earlier content", () => {
  const doc = emptyDocument(); const page = doc.pages[0];
  const clip: NotebookClip = {id: "clip-writing", pageId: page.id, bounds: {minX: 40, minY: 300, maxX: 760, maxY: 540}, isExpandable: true, originY: 300, createdAt: 0, updatedAt: 0};
  page.clips = [clip];
  expect(clipCurrentBounds(page, clip)).toEqual(clip.bounds);
  page.strokes.push(stroke("old", [0, 100, 1, 800, 200, 1]), stroke("new", [100, 310, 1, 500, 700, 1]));
  expect(clipCurrentBounds(page, clip)).toEqual({minX: 40, minY: 294, maxX: 760, maxY: 724});
  page.textBoxes.push({id: "text", x: 20, y: 750, w: 200, h: 80, text: "proof", color: "#000"} as never);
  expect(clipCurrentBounds(page, clip).maxY).toBe(854);
  page.images.push({id: "image", path: "picture.png", x: 60, y: 860, w: 40, h: 80});
  expect(clipCurrentBounds(page, clip).maxY).toBe(964);
  page.circuits = [{id: "c", x: 60, y: 960, w: 40, h: 80} as never];
  expect(clipCurrentBounds(page, clip).maxY).toBe(1064);
  const parsed = parseInkFile(buildInkFile("", doc), 800).doc!;
  expect(parsed.pages[0].clips![0]).toMatchObject({isExpandable: true, originY: 300});
  page.strokes = []; page.images = []; page.textBoxes = []; page.circuits = [];
  expect(clipCurrentBounds(page, clip)).toEqual(clip.bounds);
});

it("does not absorb later handwriting sections into an earlier expandable clip", () => {
  const page = blankPage();
  const first: NotebookClip = {id: "clip-first", pageId: page.id, bounds: {minX: 40, minY: 60, maxX: 760, maxY: 300}, isExpandable: true, originY: 60, createdAt: 0, updatedAt: 0};
  const second = {...first, id: "clip-second", originY: 500, bounds: {...first.bounds, minY: 500, maxY: 740}};
  page.clips = [first, second];
  page.strokes.push(stroke("first", [100, 80, 1, 200, 200, 1]), stroke("second", [100, 510, 1, 200, 900, 1]));
  expect(clipCurrentBounds(page, first).maxY).toBe(224);
  expect(clipCurrentBounds(page, second).maxY).toBe(924);
});
