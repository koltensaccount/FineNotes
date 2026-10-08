import { describe, it, expect } from "vitest";
import { blankPage, emptyDocument, type InkDocument } from "../../src/model/document";
import {
  copiedPages,
  deletePages,
  insertPages,
  MovePages,
  pageInsertionIndex,
  reorderedPages,
} from "../../src/model/page-manager";
import { buildScanInsert } from "../../src/model/scan-commands";
const notebook = (names = "ABCDEFG"): InkDocument => ({
  ...emptyDocument(),
  pages: [...names].map((id) => blankPage(id)),
});
const names = (doc: InkDocument) => doc.pages.map((page) => page.id).join("");
describe("page manager operations", () => {
  it("single move B after C preserves objects and undoes exactly", () => {
    const doc = notebook("ABCD"),
      original = [...doc.pages],
      command = new MovePages(new Set(["B"]), 3);
    command.apply(doc);
    expect(names(doc)).toBe("ACBD");
    expect(doc.pages[2]).toBe(original[1]);
    command.invert(doc);
    expect(doc.pages).toEqual(original);
  });
  it("noncontiguous group moves after G in document order", () => {
    const doc = notebook();
    doc.pages = reorderedPages(doc.pages, new Set(["E", "B", "D"]), 7);
    expect(names(doc)).toBe("ACFGBDE");
  });
  it.each([1, 2, 3, 4, 5])(
    "drop %s inside selected occupied region is a no-op without loss",
    (gap) => {
      const doc = notebook(),
        before = [...doc.pages];
      const result = reorderedPages(doc.pages, new Set(["B", "D", "E"]), gap);
      expect(result).toEqual(before);
      expect(new Set(result).size).toBe(7);
    },
  );
  it("copy/paste keeps order, new page/element IDs, PDF/image references and independent ink", () => {
    const doc = notebook("ABCD");
    doc.pages[1].backdrop = { kind: "pdf", path: "source.pdf", page: 9 };
    doc.pages[1].strokes = [
      { id: "s1", color: "#000000", size: 3, tool: "pen", pts: [1, 2, 0.5], lineStyle: "dashed" },
    ];
    doc.pages[1].images = [{ id: "i1", path: "picture.png", x: 0, y: 0, w: 20, h: 30 }];
    const source = [doc.pages[1], doc.pages[3]],
      copies = copiedPages(doc, source);
    expect(copies.map((page) => page.id)).not.toEqual(["B", "D"]);
    expect(copies[0].backdrop).toEqual(source[0].backdrop);
    expect(copies[0].images[0].path).toBe("picture.png");
    expect(copies[0].images[0].id).not.toBe("i1");
    copies[0].strokes[0].pts[0] = 99;
    expect(source[0].strokes[0].pts[0]).toBe(1);
    const command = insertPages(copies, 4);
    command.apply(doc);
    expect(doc.pages.slice(4)).toEqual(copies);
    const second = copiedPages(doc, source);
    expect(second[0].id).not.toBe(copies[0].id);
    command.invert(doc);
    expect(names(doc)).toBe("ABCD");
  });
  it("duplicate selected B,D once together after D", () => {
    const doc = notebook("ABCDE"),
      source = [doc.pages[1], doc.pages[3]],
      copies = copiedPages(doc, source);
    insertPages(copies, 4, "Duplicate pages").apply(doc);
    expect(doc.pages.slice(0, 4).map((page) => page.id)).toEqual(["A", "B", "C", "D"]);
    expect(doc.pages.slice(4, 6)).toEqual(copies);
    expect(doc.pages[6].id).toBe("E");
    expect(new Set(doc.pages.map((page) => page.id)).size).toBe(7);
  });
  it("bulk delete retains one page and restores every original on Undo", () => {
    const doc = notebook("ABC"),
      original = [...doc.pages],
      command = deletePages(doc, new Set(["A", "B", "C"]))!;
    command.apply(doc);
    expect(names(doc)).toBe("C");
    command.invert(doc);
    expect(doc.pages).toEqual(original);
    expect(deletePages(notebook("A"), new Set(["A"]))).toBeNull();
  });
  it.each([
    ["before", 1],
    ["after", 2],
    ["beginning", 0],
    ["end", 4],
  ] as const)(
    "PDF inserts at %s with consecutive source order and one inverse",
    (destination, gap) => {
      const doc = notebook("ABCD"),
        insertion = pageInsertionIndex(destination, 1, 4);
      expect(insertion).toBe(gap);
      const result = buildScanInsert(
        doc,
        1,
        [
          {
            kind: "pdf",
            path: "source.pdf",
            pages: [
              { width: 600, height: 800, page: 2 },
              { width: 600, height: 800, page: 3 },
            ],
          },
        ],
        "Import PDF",
        insertion,
      )!;
      result.command.apply(doc);
      expect(doc.pages.slice(gap, gap + 2).map((page) => page.backdrop)).toEqual([
        { kind: "pdf", path: "source.pdf", page: 2 },
        { kind: "pdf", path: "source.pdf", page: 3 },
      ]);
      expect(result.placed[0].pageIndex).toBe(gap);
      result.command.invert(doc);
      expect(names(doc)).toBe("ABCD");
    },
  );
  it("explicit PDF gap works independently of the current page", () => {
    const doc = notebook("ABCD");
    const result = buildScanInsert(
      doc,
      0,
      [{ kind: "pdf", path: "source.pdf", pages: [{ width: 600, height: 800 }] }],
      "Import PDF",
      3,
    )!;
    result.command.apply(doc);
    expect(doc.pages[3].backdrop.kind).toBe("pdf");
    expect(doc.pages[4].id).toBe("D");
  });
});
