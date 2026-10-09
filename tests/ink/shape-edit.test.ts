import { describe, expect, it } from "vitest";
import { presetGeometry } from "../../src/ink/shape-geometry";
import { alignNewShape, adjustHeldShape, scaledStrokeSize, shapeFrame, resizeShape, rotateShape, scaleShape, editEndpoint, resizeHeldShape, localPoint } from "../../src/ink/shape-edit";
import { TransformStroke } from "../../src/model/commands";
import { History } from "../../src/model/history";
import { emptyDocument, type Stroke } from "../../src/model/document";
import { encodeDocument, decodeDocument } from "../../src/model/serialize";
const rect = () => presetGeometry("rect", { x: 100, y: 100 }, { x: 300, y: 200 }, 0.5);
const pivot = { x: 200, y: 150 };
describe("vector shape editing", () => {
  it("resizes local axes independently without rotating or changing pressure", () => {
    for (const angle of [0, 0.7, -1.2]) {
      const pts = rotateShape(rect(), pivot, angle), frame = shapeFrame("rect", pts)!;
      for (const [w, h] of [[200, 150], [300, 100]]) {
        const resized = resizeShape("rect", pts, frame, w, h), after = shapeFrame("rect", resized)!;
        expect(after.w).toBeCloseTo(w, 1); expect(after.h).toBeCloseTo(h, 1); expect(after.angle).toBeCloseTo(angle, 3);
        expect(resized.filter((_, i) => i % 3 === 2)).toEqual(pts.filter((_, i) => i % 3 === 2));
      }
    }
  });
  it("scales proportionally and rotates only explicitly; held manipulation keeps angle", () => {
    const base = rotateShape(rect(), pivot, .5), frame = shapeFrame("rect", base)!;
    const scaled = shapeFrame("rect", scaleShape(base, pivot, 2))!;
    expect(scaled.w / frame.w).toBeCloseTo(2, 3); expect(scaled.h / frame.h).toBeCloseTo(2, 3); expect(scaled.angle).toBeCloseTo(.5, 3);
    const held = shapeFrame("rect", resizeHeldShape(base, pivot, { x: 300, y: 150 }, { x: 200, y: 350 }))!;
    expect(held.angle).toBeCloseTo(.5, 3);
    expect(shapeFrame("rect", rotateShape(base, pivot, .4))!.angle).toBeCloseTo(.9, 3);
  });
  it("keeps line opposite endpoints and arrowhead lengths/directions", () => {
    const arrow = presetGeometry("arrow", { x: 10, y: 20 }, { x: 210, y: 20 }, .4);
    const edited = editEndpoint("arrow", arrow, "end", { x: 10, y: 220 });
    expect(edited.slice(0, 3)).toEqual(arrow.slice(0, 3)); expect(edited.slice(3, 6)).toEqual([10, 220, .4]);
    const oldLength = Math.hypot(arrow[9] - arrow[3], arrow[10] - arrow[4]);
    expect(Math.hypot(edited[9] - edited[3], edited[10] - edited[4])).toBeCloseTo(oldLength, 1);
    const line = [0, 0, .2, 100, 0, .8];
    expect(editEndpoint("line", line, "start", { x: 0, y: 50 })).toEqual([0, 50, .2, 100, 0, .8]);
    expect(editEndpoint("line", line, "end", { x: 0, y: 0 })).toEqual(line);
  });
  it("retains proper ellipses and circular proportions", () => {
    const ellipse = rotateShape(presetGeometry("ellipse", { x: 100, y: 100 }, { x: 300, y: 200 }, .7), pivot, .6);
    const frame = shapeFrame("ellipse", ellipse)!;
    const changed = resizeShape("ellipse", ellipse, frame, 240, 160);
    for (let i = 0; i < changed.length; i += 3) {
      const p = localPoint(frame, { x: changed[i], y: changed[i + 1] });
      expect(p.x * p.x / 120 ** 2 + p.y * p.y / 80 ** 2).toBeCloseTo(1, 2);
    }
    const circle = presetGeometry("ellipse", { x: 0, y: 0 }, { x: 100, y: 100 }, .5);
    const next = shapeFrame("circle", scaleShape(circle, { x: 50, y: 50 }, 1.5))!;
    expect(next.w).toBeCloseTo(next.h, 2);
  });
  it("rejects invalid dimensions and keeps rounded rectangles closed", () => {
    const pts = rect(), frame = shapeFrame("rect", pts)!;
    for (const w of [0, NaN, Infinity, -10]) expect(resizeShape("rect", pts, frame, w, 150)).toEqual(pts);
    const round = presetGeometry("roundrect", { x: 0, y: 0 }, { x: 200, y: 100 }, .3);
    const resized = resizeShape("roundrect", round, shapeFrame("roundrect", round)!, 200, 150);
    expect(resized.slice(0, 3)).toEqual(resized.slice(-3)); expect(resized.every(Number.isFinite)).toBe(true);
  });
  it("commits one history step and preserves object, metadata, width and persistence", () => {
    const doc = emptyDocument(), page = doc.pages[0], history = new History();
    const stroke: Stroke = { id: "s1", pts: rect(), color: "#abcdef", size: 3, tool: "pen", shape: "rect", lineStyle: "dashed", t0: 25 };
    page.strokes.push(stroke); const before = structuredClone(stroke);
    const next = resizeShape("rect", stroke.pts, shapeFrame("rect", stroke.pts)!, 200, 150);
    history.push(doc, new TransformStroke(page.id, stroke.id, next));
    expect(page.strokes[0]).toBe(stroke); expect(stroke.size).toBe(3); expect(stroke.lineStyle).toBe("dashed"); expect(stroke.t0).toBe(25);
    const reopened = decodeDocument(encodeDocument(doc)).pages[0].strokes[0];
    expect({ ...reopened, pts: [] }).toEqual({ ...stroke, pts: [] });
    for (let i = 0; i < next.length; i++) expect(reopened.pts[i]).toBeCloseTo(next[i], i % 3 === 2 ? 2 : 3);
    history.undo(doc); expect(stroke).toEqual(before); expect(history.undo(doc)).toBeNull(); history.redo(doc); expect(stroke.pts).toEqual(next);
  });
});


describe("new page-aligned creation and proportional outline scaling", () => {
  it.each(["rect", "roundrect", "ellipse", "triangle", "diamond", "star"] as const)("new %s is page aligned without modifying its source", kind => {
    const original = rotateShape(presetGeometry(kind, { x: 100, y: 100 }, { x: 300, y: 200 }, .5), pivot, .3);
    const before = original.slice(), clean = alignNewShape(kind, original);
    expect(original).toEqual(before);
    if (kind === "rect") { expect(clean[1]).toBe(clean[4]); expect(clean[3]).toBe(clean[6]); expect(shapeFrame(kind,clean)!.angle).toBe(0); }
    if (kind === "ellipse") {
      const frame = shapeFrame(kind,clean,0)!;
      for (let i=0;i<clean.length;i+=3) { const x = (clean[i]-frame.cx)/(frame.w/2), y=(clean[i+1]-frame.cy)/(frame.h/2); expect(x*x+y*y).toBeCloseTo(1,2); }
    }
    expect(shapeFrame(kind,clean,0)!.cx).toBeCloseTo(shapeFrame(kind,original,0)!.cx,1);
  });
  it("initial lines snap to the nearest page axis, then endpoints and arrowheads follow Pencil freely", () => {
    for (const kind of ["line", "arrow"] as const) {
      const pts = presetGeometry(kind,{ x: 100,y: 100 },{ x: 300,y: 160 },.5), aligned=alignNewShape(kind,pts);
      expect(aligned[1]).toBe(aligned[4]); expect(aligned.slice(0,3)).toEqual(pts.slice(0,3));
      const from={ x: 300,y: 160 }, to={ x: 320,y: 230 };
      const moved=adjustHeldShape(kind,aligned,{ x: 100,y: 100 },from,to);
      expect(moved[4]).toBe(170); expect(moved.slice(0,3)).toEqual(aligned.slice(0,3));
      if(kind === "arrow") expect(Math.hypot(moved[9]-moved[3],moved[10]-moved[4])).toBeCloseTo(Math.hypot(aligned[9]-aligned[3],aligned[10]-aligned[4]),1);
    }
  });
  it("held closed resizing changes axes independently without rotation", () => {
    const base=rect(), resized=adjustHeldShape("rect",base,pivot,{ x: 300,y: 200 },{ x: 300,y: 225 });
    const frame=shapeFrame("rect",resized)!; expect(frame.w).toBe(200); expect(frame.h).toBe(150); expect(frame.angle).toBe(0);
  });
  it("proportional scaling changes geometry and outline together in one undo/redo command", () => {
    const doc=emptyDocument(), page=doc.pages[0], history=new History();
    const stroke: Stroke={ id:"s1",pts:rect(),size:3,tool:"pen",shape:"rect",color:"#000000",lineStyle:"dashed",t0:25 }; page.strokes.push(stroke);
    const before=structuredClone(stroke), next=scaleShape(stroke.pts,pivot,2);
    history.push(doc,new TransformStroke(page.id,stroke.id,next,scaledStrokeSize(stroke.size,2),"Scale shape"));
    expect(stroke.size).toBe(6); expect(shapeFrame("rect",stroke.pts)!.w).toBe(400); expect(stroke.t0).toBe(25);
    history.undo(doc); expect(stroke).toEqual(before); expect(history.undo(doc)).toBeNull(); history.redo(doc); expect(stroke.size).toBe(6); expect(stroke.pts).toEqual(next);
    expect(scaledStrokeSize(3,NaN)).toBe(3); expect(scaledStrokeSize(3,10000)).toBe(1000); expect(scaledStrokeSize(3,.0001)).toBe(.1);
  });
});
