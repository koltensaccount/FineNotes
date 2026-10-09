import { afterEach, describe, expect, it, vi } from "vitest";
import { paintWritingGuides } from "../../src/canvas/writing-guides";
import { DEFAULT_WRITING_GUIDES, writingGuidesOf, guideColor } from "../../src/model/writing-guides";
import { blankPage, emptyDocument } from "../../src/model/document";
import { encodeDocument } from "../../src/model/serialize";
import { Renderer, renderPageThumbnail } from "../../src/canvas/renderer";
import { LIGHT_PAPER, DARK_PAPER } from "../../src/canvas/backdrop";
const region = { minX: 0, minY: 0, maxX: 400, maxY: 600 };
function context() {
  const log: [string, ...unknown[]][] = [], state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, { get: (o, key) => key in o ? o[key] : (...args: unknown[]) => log.push([String(key), ...args]), set: (o, key, value) => { o[key] = value; log.push([String(key), value]); return true; } }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}
afterEach(() => vi.unstubAllGlobals());
describe("writing guide preferences and colors", () => {
  it("loads defaults and validates missing, invalid and out-of-range values, omitting visibility", () => {
    expect(writingGuidesOf(null)).toEqual(DEFAULT_WRITING_GUIDES);
    expect(writingGuidesOf({ spacing: NaN, opacity: Infinity, thickness: "large" })).toEqual(DEFAULT_WRITING_GUIDES);
    expect(writingGuidesOf({ spacing: -100, opacity: 4, thickness: 10, customColor: "invalid", enabled: true })).toEqual({ ...DEFAULT_WRITING_GUIDES, spacing: 8, opacity: .6, thickness: 3 });
    expect(writingGuidesOf({ spacing: 900, thickness: -1, opacity: -1 })).toMatchObject({ spacing: 128, thickness: .5, opacity: .05 });
  });
  it("chooses neutral contrast from actual light, dark and colored paper", () => {
    expect(guideColor(DEFAULT_WRITING_GUIDES, LIGHT_PAPER.paper)).toBe("#64748b");
    expect(guideColor(DEFAULT_WRITING_GUIDES, DARK_PAPER.paper)).toBe("#cbd5e1");
    expect(guideColor(DEFAULT_WRITING_GUIDES, "#fff1a0")).toBe("#64748b");
    expect(guideColor(DEFAULT_WRITING_GUIDES, "#132f60")).toBe("#cbd5e1");
  });
  it("manual colors ignore paper and opacity, and auto preserves the last custom choice", () => {
    const style = writingGuidesOf({ customColor: "#abc", colorMode: "custom" });
    expect(guideColor(style, "#ffffff")).toBe("#aabbcc"); expect(guideColor({ ...style, opacity: .6 }, "#000000")).toBe("#aabbcc");
    const auto = writingGuidesOf({ ...style, colorMode: "auto" }); expect(auto.customColor).toBe("#aabbcc"); expect(guideColor(auto, "#000000")).toBe("#cbd5e1");
  });
});
describe("bounded page-space guide drawing", () => {
  it("off and incompatible templates/PDFs do no drawing", () => {
    const { ctx, log } = context(), page = blankPage();
    expect(paintWritingGuides(ctx, page, region, null, "#ffffff", 1, 1)).toBe(0);
    for (const kind of ["lined", "grid", "dotted", "cornell", "cover", "pdf"]) {
      page.backdrop = { kind } as typeof page.backdrop;
      expect(paintWritingGuides(ctx, page, region, DEFAULT_WRITING_GUIDES, "#ffffff", 1, 1)).toBe(0);
    }
    expect(log).toEqual([]);
  });
  it.each([[300, 500], [1200, 900]])("clips guide geometry to each %s × %s page and requested tile", (width, height) => {
    const { ctx, log } = context(), page = blankPage("p1", { width, height });
    paintWritingGuides(ctx, page, { minX: -50, minY: -80, maxX: width + 20, maxY: height + 100 }, DEFAULT_WRITING_GUIDES, "#abcdef", 2, 2);
    expect(log.find(([name]) => name === "rect")).toEqual(["rect", 0, 0, width, height]);
    expect(log.filter(([name]) => name === "clip")).toHaveLength(1);
    for (const [name, x, y] of log) if (name === "moveTo" || name === "lineTo") { expect(Number(x)).toBeGreaterThanOrEqual(0); expect(Number(x)).toBeLessThanOrEqual(width); expect(Number(y)).toBeGreaterThanOrEqual(0); expect(Number(y)).toBeLessThanOrEqual(height); }
    expect(log.find(([name]) => name === "lineWidth")).toEqual(["lineWidth", .5]);
  });
  it("keeps tile positions on the same page-space grid, with a single alpha stroke", () => {
    const page = blankPage("p1", { width: 600, height: 600 }), style = { ...DEFAULT_WRITING_GUIDES, style: "grid" as const };
    for (const [left, top] of [[0, 0], [110, 190], [250, 330]]) {
      const { ctx, log } = context(); paintWritingGuides(ctx, page, { minX: left, minY: top, maxX: left + 150, maxY: top + 150 }, style, "#ffffff", 2, 2);
      const points = log.filter(([name]) => name === "moveTo");
      for (const [, x, y] of points) expect(Number(x) % 32 === 0 || Number(y) % 32 === 0).toBe(true);
      expect(log.filter(([name]) => name === "stroke")).toHaveLength(1); expect(log.filter(([name]) => name === "globalAlpha")).toEqual([["globalAlpha", .2]]);
    }
  });
  it("dots use one fill, stable screen diameter, clipped tile bounds and bounded density", () => {
    const { ctx, log } = context(), page = blankPage("p1", { width: 20000, height: 20000 });
    const count = paintWritingGuides(ctx, page, { minX: 0, minY: 0, maxX: 4096, maxY: 4096 }, { ...DEFAULT_WRITING_GUIDES, style: "dots", spacing: 8 }, "#ffffff", .125, .125);
    expect(count).toBeLessThan(5000); expect(log.filter(([name]) => name === "fill")).toHaveLength(1);
    expect(log.find(([name]) => name === "arc")?.[3]).toBe(4);
    expect(paintWritingGuides(ctx, page, { minX: 0, minY: 0, maxX: 20000, maxY: 20000 }, { ...DEFAULT_WRITING_GUIDES, style: "dots", spacing: 8 }, "#ffffff", 1, 1)).toBe(0);
  });
});
describe("interactive-only renderer boundary", () => {
  function interactive() {
    const { ctx, log } = context(), page = blankPage("p1", { width: 400, height: 600 });
    const canvas = { getContext: () => ctx };
    vi.stubGlobal("createEl", () => canvas);
    const renderer = Object.assign(Object.create(Renderer.prototype), { writingGuides: null, paper: LIGHT_PAPER, view: { scale: 1 }, painter: { paint: () => log.push(["backdrop"]) }, paintImages: () => log.push(["images"]), paintStrokes: () => log.push(["ink"]), tiles: { set: vi.fn(), deleteWhere: vi.fn() }, previews: { delete: vi.fn() } });
    return { renderer, page, log, ctx };
  }
  it("rasterizes guides between backdrop and images/ink; disabling invalidates only affected view caches", () => {
    const { renderer, page, log } = interactive();
    renderer.setWritingGuides(DEFAULT_WRITING_GUIDES, [page.id]);
    renderer.rasterTile(page, { width: 400, height: 600 }, { x: 0, y: 0, w: 400, h: 600, col: 0, row: 0 }, 1, false);
    const index = (name: string) => log.findIndex(([n]) => n === name);
    expect(index("backdrop")).toBeLessThan(index("stroke")); expect(index("stroke")).toBeLessThan(index("images")); expect(index("images")).toBeLessThan(index("ink"));
    renderer.setWritingGuides(null, [page.id]); expect(renderer.previews.delete).toHaveBeenCalledWith(page.id); log.length = 0;
    renderer.rasterTile(page, { width: 400, height: 600 }, { x: 0, y: 0, w: 400, h: 600, col: 0, row: 0 }, 1, false);
    expect(log.some(([name]) => name === "stroke")).toBe(false);
  });
  it("does not change serialized content, sidebar thumbnails or the shared PDF annotation painter", () => {
    const { renderer, page } = interactive(), doc = emptyDocument(); doc.pages = [page]; const before = encodeDocument(doc);
    renderer.setWritingGuides(DEFAULT_WRITING_GUIDES, [page.id]);
    for (const transparent of [false, true]) {
      const { ctx, log } = context(), canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
      renderPageThumbnail(canvas, page, { paint: () => {} }, 300, 1, { usePressure: false, transparent });
      expect(log.some(([name]) => name === "stroke" || name === "arc" || name === "lineTo")).toBe(false);
    }
    expect(encodeDocument(doc)).toBe(before);
  });
});
