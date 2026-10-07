import { describe, expect, it } from "vitest";
import { patternedRuns, lineStyleOf } from "../../src/ink/line-style";
import { inkRuns, penOptions, InkTracer } from "../../src/ink/freehand";
import { eraseCircleFromStroke } from "../../src/ink/stroke-eraser";
import { emptyDocument, type Stroke } from "../../src/model/document";
import { encodeDocument, decodeDocument } from "../../src/model/serialize";
import {
  AddElements,
  RemoveElements,
  TranslateElements,
  copyElements,
} from "../../src/model/selection-commands";
import { History } from "../../src/model/history";
const stroke = (style: "solid" | "dashed" | "dotted"): Stroke => ({
  id: "s1",
  tool: "pen",
  color: "#000",
  size: 2,
  pts: [0, 0, 0.2, 100, 0, 0.9],
  ...(style !== "solid" ? { lineStyle: style } : {}),
});
describe("stroke-wide patterns", () => {
  it("Solid preserves the existing runs and unknown styles fall back", () => {
    const runs = [{ width: 2, pts: [0, 0, 10, 0] }];
    expect(patternedRuns(runs, "solid", 2)).toEqual(runs);
    expect(lineStyleOf("other")).toBe("solid");
  });
  it("dash phase continues across pressure runs rather than restarting", () => {
    const split = patternedRuns(
      [
        { width: 2, pts: [0, 0, 5, 0] },
        { width: 3, pts: [5, 0, 24, 0] },
      ],
      "dashed",
      2,
    );
    expect(split.map((r) => r.pts)).toEqual([
      [0, 0, 5, 0],
      [5, 0, 6, 0],
      [12, 0, 18, 0],
    ]);
  });
  it("dots are explicit circles at stable intervals regardless of pressure", () => {
    const dots = patternedRuns(
      [
        { width: 1, pts: [0, 0, 5, 0] },
        { width: 3, pts: [5, 0, 24, 0] },
      ],
      "dotted",
      2,
    );
    expect(dots.map((r) => r.pts)).toEqual([
      [0, 0],
      [6, 0],
      [12, 0],
      [18, 0],
      [24, 0],
    ]);
    expect(dots.every((r) => r.dot)).toBe(true);
  });
  it.each([0.98, 2, 5, 12])("width %s yields a usable stable pattern", (size) => {
    const r = patternedRuns([{ width: size, pts: [0, 0, 300, 0] }], "dotted", size);
    expect(r.length).toBeGreaterThan(1);
    expect(r[1].pts[0] - r[0].pts[0]).toBeCloseTo(3 * size);
  });
  it("long curved wet tracing matches finalized tracing", () => {
    const pts = Array.from({ length: 300 }, (_, i) => [
      i,
      Math.sin(i / 20) * 30,
      (i % 10) / 10,
    ]).flat();
    const tracer = new InkTracer(penOptions(3, true));
    for (let i = 0; i < pts.length; i += 3) tracer.push(pts[i], pts[i + 1], pts[i + 2]);
    for (const style of ["dashed", "dotted"] as const)
      expect(patternedRuns(tracer.runs(), style, 3)).toEqual(
        patternedRuns(inkRuns(pts, penOptions(3, true)), style, 3),
      );
  });
  it.each(["solid", "dashed", "dotted"] as const)(
    "%s survives save, selection operations, copies and undo",
    (style) => {
      const doc = emptyDocument(1024);
      const s = stroke(style);
      doc.pages[0].strokes = [s];
      const reloaded = decodeDocument(encodeDocument(doc));
      expect(lineStyleOf(reloaded.pages[0].strokes[0].lineStyle)).toBe(style);
      const elements = { strokes: [s], images: [], textBoxes: [] };
      const history = new History();
      history.push(doc, new TranslateElements("p1", elements, 10, 20));
      expect(s.lineStyle).toBe(style === "solid" ? undefined : style);
      history.undo(doc);
      expect(s.pts[0]).toBe(0);
      const copy = copyElements(
        elements,
        { stroke: () => "s2", image: () => "i2", textBox: () => "t2" },
        30,
        40,
      );
      expect(lineStyleOf(copy.strokes[0].lineStyle)).toBe(style);
      history.push(doc, new AddElements("p1", copy, "Paste"));
      history.undo(doc);
      history.redo(doc);
      expect(doc.pages[0].strokes).toHaveLength(2);
      history.push(doc, new RemoveElements("p1", elements, "Cut"));
      history.undo(doc);
      expect(doc.pages[0].strokes.find((v) => v.id === "s1")!.lineStyle).toBe(s.lineStyle);
    },
  );
  it("partial eraser retains style and phase on surviving fragments", () => {
    const s = stroke("dotted");
    let n = 1;
    const pieces = eraseCircleFromStroke(s, 50, 0, 5, () => `s${++n}`)!;
    expect(pieces).toHaveLength(2);
    expect(pieces.every((v) => v.lineStyle === "dotted")).toBe(true);
    expect(pieces[1].dashOffset).toBeGreaterThan(50);
    const doc = emptyDocument(1024);
    doc.pages[0].strokes = pieces;
    expect(decodeDocument(encodeDocument(doc)).pages[0].strokes[1].dashOffset).toBe(
      pieces[1].dashOffset,
    );
  });
  it("old Solid payloads remain byte-stable and do not gain style keys", () => {
    const doc = emptyDocument(1024);
    doc.pages[0].strokes = [stroke("solid")];
    const payload = encodeDocument(doc);
    expect(encodeDocument(decodeDocument(payload))).toBe(payload);
    expect(decodeDocument(payload).pages[0].strokes[0]).not.toHaveProperty("lineStyle");
  });
});
