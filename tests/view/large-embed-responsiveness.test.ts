import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  MarkdownRenderChild: class {
    onunload() {}
  },
}));
import { blankPage } from "../../src/model/document";
import { renderClipPng } from "../../src/view/clip-png";
import * as renderer from "../../src/canvas/renderer";
import { InkView } from "../../src/view/ink-view";

describe("Large Embed Responsiveness and Stroke Protection", () => {
  it("bounds canvas pixel dimensions for large expandable boxes to prevent thread stalls", async () => {
    let maxWidth = 0;
    let maxHeight = 0;
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
    };
    vi.stubGlobal("createEl", () => ({
      get width() {
        return maxWidth;
      },
      set width(v: number) {
        maxWidth = Math.max(maxWidth, v);
      },
      get height() {
        return maxHeight;
      },
      set height(v: number) {
        maxHeight = Math.max(maxHeight, v);
      },
      getContext: () => context,
      toBlob: (cb: (blob: Blob) => void) => cb(new Blob(["png"])),
    }));

    try {
      const page = blankPage("p1");
      page.geometry = { width: 1024, height: 1366 };

      // Case 1: Large box (e.g. 1000 x 1300)
      maxWidth = 0;
      maxHeight = 0;
      await renderClipPng(page, { minX: 12, minY: 30, maxX: 1012, maxY: 1330 });
      // Total pixels must not explode beyond 2 megapixels (was 5.6M - 8M)
      const totalPixels = maxWidth * maxHeight;
      expect(totalPixels).toBeLessThanOrEqual(2_050_000);
      expect(maxWidth).toBeLessThanOrEqual(1600);
      expect(maxHeight).toBeLessThanOrEqual(2048);

      // Case 2: Small box (e.g. 300 x 100) preserves crisp 2x retina
      maxWidth = 0;
      maxHeight = 0;
      await renderClipPng(page, { minX: 50, minY: 50, maxX: 350, maxY: 150 });
      expect(maxWidth).toBeGreaterThanOrEqual(600);
      expect(maxHeight).toBeGreaterThanOrEqual(200);
      expect(maxWidth * maxHeight).toBeLessThanOrEqual(300_000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips rendering off-clip ink strokes outside the crop bounds", async () => {
    const fill = vi.spyOn(renderer, "fillStroke").mockImplementation(() => {});
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
    };
    vi.stubGlobal("createEl", () => ({
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (cb: (blob: Blob) => void) => cb(new Blob(["png"])),
    }));

    try {
      const page = blankPage("p1");
      page.geometry = { width: 1024, height: 1366 };
      // Stroke 1: Inside region [100, 100, 300, 300]
      // Stroke 2: Far outside region at [800, 900, 950, 1050]
      page.strokes = [
        {
          id: "inside",
          tool: "pen",
          color: "#000000",
          size: 2,
          pts: [120, 120, 0.5, 200, 200, 0.5],
        },
        {
          id: "outside",
          tool: "pen",
          color: "#000000",
          size: 2,
          pts: [800, 900, 0.5, 950, 1050, 0.5],
        },
      ];

      await renderClipPng(page, { minX: 100, minY: 100, maxX: 300, maxY: 300 });
      // Only the inside stroke should have been drawn
      expect(fill).toHaveBeenCalledOnce();
      expect(fill).toHaveBeenCalledWith(
        context,
        page.strokes[0].pts,
        expect.anything(),
        expect.anything(),
      );
    } finally {
      fill.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("defers embed PNG updates while the pen is actively writing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    try {
      const view = Object.create(InkView.prototype) as any;
      view.doc = { pages: [{ pageEmbedPath: "embed.png" }] };
      view.clipsDirty = true;
      view.embedRefreshPending = false;
      view.embedRefreshRunning = null;
      view.refreshEmbedImages = vi.fn(async () => {});

      let isWriting = true;
      view.writeHold = {
        writing: () => isWriting,
      };

      // During active writing, updateClipsPng does not start background loop
      await view.updateClipsPng();
      expect(view.embedRefreshPending).toBe(true);
      expect(view.embedRefreshRunning).toBeNull();
      expect(view.refreshEmbedImages).not.toHaveBeenCalled();

      // Once writing is idle and quiet
      isWriting = false;
      const running = view.updateClipsPng();
      await vi.advanceTimersByTimeAsync(300);
      await running;
      expect(view.refreshEmbedImages).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("cancels running embed refresh timers when pen down arrives", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    try {
      const view = Object.create(InkView.prototype) as any;
      view.quietTimer = 0;
      view.latestDrawingAt = 0;
      view.embedRefreshTimer = 12345;
      const resolveMock = vi.fn();
      view.resolveEmbedRefreshDelay = resolveMock;
      view.embedRefreshPending = false;
      view.writeHold = {
        penDown: vi.fn(),
        quietIn: () => 1000,
      };
      view.pdfCache = { setHeld: vi.fn() };
      view.penQuiet = vi.fn();

      view.penActivity(true);

      expect(view.embedRefreshTimer).toBe(0);
      expect(resolveMock).toHaveBeenCalledOnce();
      expect(view.resolveEmbedRefreshDelay).toBeNull();
      expect(view.embedRefreshPending).toBe(true);
      expect(view.writeHold.penDown).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
