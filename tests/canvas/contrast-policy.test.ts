import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adaptColorForTheme } from "../../src/canvas/contrast";
import { DARK_PAPER, LIGHT_PAPER } from "../../src/canvas/backdrop";
import { Renderer, renderPageThumbnail } from "../../src/canvas/renderer";
import { blankPage, type Page, type Stroke } from "../../src/model/document";
import { DrawLog, LoggedPath2D } from "./draw-log";

const globals = globalThis as unknown as Record<string, unknown>;
let log: DrawLog;

beforeEach(() => {
  log = new DrawLog();
  globals.Path2D = LoggedPath2D;
  globals.createEl = () => log.canvas();
});

afterEach(() => {
  delete globals.Path2D;
  delete globals.createEl;
});

describe("Contrast and color policy", () => {
  describe("adaptColorForTheme unit tests", () => {
    it("returns color completely unchanged when mode is disabled, undefined, or null", () => {
      expect(adaptColorForTheme("#ffffff", "disabled")).toBe("#ffffff");
      expect(adaptColorForTheme("#ffffff", undefined)).toBe("#ffffff");
      expect(adaptColorForTheme("#ffffff", null)).toBe("#ffffff");

      expect(adaptColorForTheme("#000000", "disabled")).toBe("#000000");
      expect(adaptColorForTheme("#000000", undefined)).toBe("#000000");
      expect(adaptColorForTheme("#000000", null)).toBe("#000000");

      expect(adaptColorForTheme("#3b82f6", "disabled")).toBe("#3b82f6");
    });

    it("adapts black to white in dark mode, but preserves white and custom colors", () => {
      expect(adaptColorForTheme("#000000", "dark")).toBe("#ffffff");
      expect(adaptColorForTheme("#111111", "dark")).toBe("#ffffff");
      expect(adaptColorForTheme("#ffffff", "dark")).toBe("#ffffff");
      expect(adaptColorForTheme("#3b82f6", "dark")).toBe("#3b82f6");
      expect(adaptColorForTheme("#ef4444", "dark")).toBe("#ef4444");
    });

    it("adapts white to dark in light mode, but preserves black and custom colors", () => {
      expect(adaptColorForTheme("#ffffff", "light")).toBe("#1a1a1a");
      expect(adaptColorForTheme("#f8f8f8", "light")).toBe("#1a1a1a");
      expect(adaptColorForTheme("#000000", "light")).toBe("#000000");
      expect(adaptColorForTheme("#3b82f6", "light")).toBe("#3b82f6");
      expect(adaptColorForTheme("#10b981", "light")).toBe("#10b981");
    });
  });

  describe("Renderer contrast scoping", () => {
    function makeStroke(id: string, color: string): Stroke {
      return {
        id,
        color,
        size: 2,
        tool: "pen",
        pts: [10, 10, 0.5, 20, 20, 0.5, 30, 30, 0.5],
      };
    }

    it("preserves exact white and black ink outside inline editing (adaptContrast: false)", () => {
      const renderer = new Renderer(log.canvas("backdrop"), log.canvas("dry"), log.canvas("wet"), true);
      renderer.adaptContrast = false;

      const page: Page = {
        ...blankPage("p1"),
        strokes: [
          makeStroke("s1", "#ffffff"), // explicit white ink
          makeStroke("s2", "#000000"), // explicit black ink
          makeStroke("s3", "#3b82f6"), // blue ink
        ],
      };

      const canvas = log.canvas("test");
      const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

      // Paint on light paper
      renderer.paper = LIGHT_PAPER;
      (renderer as any).paintStrokes(ctx, page, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, false);

      // On light paper outside inline mode:
      // s1 (#ffffff) is explicitly #ffffff (not darkened to #1a1a1a)
      // s2 (#000000) retains default black (not adapted)
      // s3 (#3b82f6) is explicitly #3b82f6
      expect(log.lines.some((e) => e.includes("#ffffff"))).toBe(true);
      expect(log.lines.some((e) => e.includes("#1a1a1a"))).toBe(false);
      expect(log.lines.some((e) => e.includes("#3b82f6"))).toBe(true);

      log.lines.length = 0;

      // Paint on dark paper outside inline mode: white ink MUST remain #ffffff, not darkened!
      // and black ink MUST remain black (default), not adapted to white!
      renderer.paper = DARK_PAPER;
      (renderer as any).paintStrokes(ctx, page, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, false);

      expect(log.lines.some((e) => e.includes("#ffffff"))).toBe(true);
      expect(log.lines.some((e) => e.includes("#1a1a1a"))).toBe(false);
      expect(log.lines.some((e) => e.includes("#3b82f6"))).toBe(true);
    });

    it("adapts ink when adaptContrast is true (inline editing)", () => {
      const renderer = new Renderer(log.canvas("backdrop"), log.canvas("dry"), log.canvas("wet"), true);
      renderer.adaptContrast = true;

      const page: Page = {
        ...blankPage("p1"),
        strokes: [
          makeStroke("s1", "#000000"), // black ink on dark paper adapts to white
          makeStroke("s2", "#3b82f6"), // vibrant blue stays blue
        ],
      };

      const canvas = log.canvas("test");
      const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

      renderer.paper = DARK_PAPER;
      (renderer as any).paintStrokes(ctx, page, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, false);

      // Black should have adapted to white for dark paper
      expect(log.lines.some((e) => e.includes("#ffffff"))).toBe(true);
      // Blue stays blue
      expect(log.lines.some((e) => e.includes("#3b82f6"))).toBe(true);
    });

    it("renderPageThumbnail preserves white ink when adaptContrast is not enabled", () => {
      const page: Page = {
        ...blankPage("p1"),
        strokes: [makeStroke("s1", "#ffffff")],
      };
      const canvas = log.canvas("thumb");
      const painter = { paint: () => {} };

      renderPageThumbnail(canvas, page, painter, 100, 1, {
        usePressure: false,
        paper: LIGHT_PAPER,
      });

      // Must contain white #ffffff without darkening
      expect(log.lines.some((e) => e.includes("#ffffff"))).toBe(true);
      expect(log.lines.some((e) => e.includes("#1a1a1a"))).toBe(false);
    });
  });
});
