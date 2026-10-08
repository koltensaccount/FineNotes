import { afterEach, describe, expect, it, vi } from "vitest";
import { highlighterPolygons, highlighterWetRuns } from "../../src/ink/highlighter";
import { inkRuns, penOptions } from "../../src/ink/freehand";
import { StrokeBuilder } from "../../src/ink/stroke-builder";
import { Renderer, renderPageThumbnail } from "../../src/canvas/renderer";
import { blankPage } from "../../src/model/document";
import { DrawLog, LoggedPath2D } from "./draw-log";

afterEach(() => vi.unstubAllGlobals());

describe("highlighter continuity", () => {
  it("settles the provisional tail through the same smoothing as committed geometry", () => {
    const builder = new StrokeBuilder({ minDistance: .1, pressureEnabled: false, smoothing: "centred", densify: true });
    for (let i = 0; i < 18; i++) builder.add({ x: i * 3, y: 30 + Math.sin(i) * 5, pressure: i % 2 ? .1 : .9 });
    expect(builder.tail.length).toBeGreaterThan(0);
    const old = inkRuns(builder.view, penOptions(20, false));
    for (const tip of builder.tail) old[old.length - 1].pts.push(tip[0], tip[1]);
    const wet = highlighterWetRuns(builder, 20);
    builder.settle();
    const dry = inkRuns(builder.points(), penOptions(20, false));
    expect(old).not.toEqual(dry); // regression: raw live tail differed from settled smoothing
    expect(wet).toEqual(dry);
    expect(wet).toHaveLength(1);
    expect(wet[0].width).toBe(20);
  });
  it("ignores duplicate samples and does not place round sample-point caps", () => {
    const simple = [{ width: 20, pts: [0, 0, 10, 0, 20, 10] }];
    const duplicated = [{ width: 20, pts: [0, 0, 0, 0, 10, 0, 10, 0, 20, 10] }];
    expect(highlighterPolygons(duplicated, 20)).toEqual(highlighterPolygons(simple, 20));
    const polygons = highlighterPolygons(simple, 20);
    expect(polygons.filter(p => p.length > 10)).toHaveLength(2); // only the two end caps
    for (const polygon of polygons) expect(polygon.every(Number.isFinite)).toBe(true);
  });
  it("uses positive winding for uniform self-overlap, while closed shapes have no end caps", () => {
    const polygons = highlighterPolygons([{ width: 10, pts: [0, 0, 40, 0, 40, 40, 0, 40], closed: true }], 10);
    expect(polygons.every(p => p.length <= 8)).toBe(true);
    for (const p of polygons) {
      let area = 0;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) area += p[j] * p[i + 1] - p[i] * p[j + 1];
      expect(area).toBeGreaterThanOrEqual(0);
    }
  });
  it("paints identical wet, committed and thumbnail/PDF silhouettes with one alpha fill", () => {
    const log = new DrawLog(); vi.stubGlobal("Path2D", LoggedPath2D);
    const wet = log.canvas("wet");
    const renderer = new Renderer(log.canvas("back"), log.canvas("dry"), wet, false);
    renderer.highlighterAlpha = .3;
    renderer.resize(800, 1000, 1);
    renderer.setLayout({ boxes: [{ index: 0, id: "p1", x: 0, y: 0, width: 800, height: 1000 }], width: 800, height: 1000, direction: "vertical", fitWidth: 800 });
    renderer.setViewport({ scrollY: 0, scale: 1, width: 800 }, 12);
    const page = blankPage("p1", { width: 800, height: 1000 });
    const stroke = { id: "s1", pts: [10, 20, .1, 30, 45, .9, 70, 30, .2, 90, 50, .5], size: 20, color: "#f2d45c", tool: "highlighter" as const };
    page.strokes.push(stroke);
    renderer.renderWetRuns(0, inkRuns(stroke.pts, penOptions(20, false)), { ...stroke, usePressure: true });
    const wetFill = log.lines.find(line => line.startsWith("wet fill "))!;
    expect(wet.style.mixBlendMode).toBe("multiply");
    const committed = log.canvas("committed");
    (renderer as unknown as { paintEntry: (...args: unknown[]) => void }).paintEntry(committed.getContext("2d"), stroke, { minX: 0, minY: 0, maxX: 800, maxY: 1000 }, true);
    renderPageThumbnail(log.canvas("thumbnail"), page, { paint: () => {} }, 800, 1, { usePressure: true, highlighterAlpha: .3, transparent: true });
    const drawing = (line: string): string => line.replace(/^\w+ /, "").replace(/ at [^ ]+ /, " ");
    expect(drawing(wetFill)).toBe(drawing(log.lines.find(line => line.startsWith("committed fill "))!));
    expect(drawing(wetFill)).toBe(drawing(log.lines.find(line => line.startsWith("thumbnail fill "))!));
    expect(log.lines.filter(line => /^(wet|committed|thumbnail) fill /.test(line))).toHaveLength(3);
    expect(log.lines.filter(line => /^(wet|committed|thumbnail) stroke /.test(line))).toHaveLength(0);
    expect(wetFill).toContain("globalAlpha=0.3");
    renderer.clearWet(); expect(wet.style.mixBlendMode).toBe("normal");
  });
});
