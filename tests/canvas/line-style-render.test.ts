import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Renderer, renderPageThumbnail, paintInk, styleOf } from "../../src/canvas/renderer";
import { blankPage } from "../../src/model/document";
import { patternedRuns } from "../../src/ink/line-style";
class Path {
  moveTo() {}
  lineTo() {}
  closePath() {}
}
beforeEach(() => vi.stubGlobal("Path2D", Path));
afterEach(() => vi.unstubAllGlobals());
function context() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
  };
}
describe("line styles in shared wet/dry/thumbnail renderer", () => {
  it("dots use circular fills rather than tiny rectangular strokes", () => {
    const ctx = context();
    paintInk(
      ctx as unknown as CanvasRenderingContext2D,
      patternedRuns([{ width: 3, pts: [0, 0, 30, 0] }], "dotted", 3),
    );
    expect(ctx.arc).toHaveBeenCalledTimes(4);
    expect(ctx.fill).toHaveBeenCalledTimes(4);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
  it.each(["solid", "dashed", "dotted"] as const)(
    "wet, cached dry and thumbnail geometry agree for %s",
    (style) => {
      const ctx = context();
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        classList: { add() {}, remove() {} },
      };
      const page = blankPage("p1");
      const stroke = {
        id: "s1",
        tool: "pen" as const,
        color: "#000",
        size: 3,
        pts: [0, 0, 0.5, 100, 0, 0.5],
        ...(style !== "solid" ? { lineStyle: style } : {}),
      };
      page.strokes = [stroke];
      renderPageThumbnail(canvas as unknown as HTMLCanvasElement, page, { paint() {} }, 200, 1, {
        usePressure: false,
      });
      const circles = ctx.arc.mock.calls.length,
        strokes = ctx.stroke.mock.calls.length;
      const renderer = new Renderer(
        canvas as unknown as HTMLCanvasElement,
        canvas as unknown as HTMLCanvasElement,
        canvas as unknown as HTMLCanvasElement,
        false,
      );
      const inside = renderer as unknown as {
        pathEntry(s: typeof stroke, p: boolean): { runs: ReturnType<typeof patternedRuns> };
        layout: unknown;
      };
      const runs = inside.pathEntry(stroke, false).runs;
      ctx.arc.mockClear();
      ctx.stroke.mockClear();
      paintInk(ctx as unknown as CanvasRenderingContext2D, runs);
      expect(ctx.arc).toHaveBeenCalledTimes(circles);
      expect(ctx.stroke).toHaveBeenCalledTimes(strokes);
      inside.layout = { boxes: [{ index: 0, id: "p1", x: 0, y: 0, width: 1024, height: 1448 }] };
      ctx.arc.mockClear();
      ctx.stroke.mockClear();
      renderer.renderWetRuns(0, [{ width: 3, pts: [0, 0, 100, 0] }], styleOf(stroke, false));
      expect(ctx.arc).toHaveBeenCalledTimes(circles);
      expect(ctx.stroke).toHaveBeenCalledTimes(strokes);
    },
  );
});
