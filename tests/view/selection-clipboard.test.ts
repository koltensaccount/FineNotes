import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ Notice: class {}, Platform: {}, setIcon: vi.fn() }));
import type { Bounds, Stroke, TextBoxElement, ImageElement } from "../../src/model/document";
import type { PageElements } from "../../src/model/selection-commands";
import { InkClipboard } from "../../src/model/clipboard";
import { clipboardMarker } from "../../src/view/clipboard-read";
import {
  renderSelectionToPng,
  copySelectionToSystemClipboard,
} from "../../src/view/selection-clipboard";

class FakePath2D {
  moveTo() {}
  lineTo() {}
  closePath() {}
}

beforeEach(() => {
  vi.stubGlobal("Path2D", FakePath2D);
});
afterEach(() => vi.unstubAllGlobals());

describe("selection clipboard", () => {
  it("renders selected strokes onto transparent canvas with retina scaling and padding", async () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(ctx),
      toBlob: vi.fn((cb: (blob: Blob) => void, mime: string) => {
        cb(new Blob(["mock-png-bytes"], { type: mime }));
      }),
    };
    vi.stubGlobal("document", {
      createElement: (tag: string) => (tag === "canvas" ? canvas : {}),
    });

    const stroke: Stroke = {
      id: "s1",
      tool: "pen",
      color: "#ff0000",
      size: 4,
      pts: [100, 100, 0.5, 200, 150, 0.5],
    };
    const elements: PageElements = {
      strokes: [stroke],
      images: [],
      textBoxes: [],
    };
    const bounds: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 150 };

    const blob = await renderSelectionToPng(elements, bounds, {
      padding: 4,
      scale: 2,
      pressure: true,
      highlighterAlpha: 0.4,
    });

    expect(blob.type).toBe("image/png");
    // bounds w = 100, h = 50. With pad=4, w = 108, h = 58. Scale = 2 => width = 216, height = 116.
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
    expect(ctx.translate).toHaveBeenCalledWith(-96, -96);
    // After toBlob completes, releaseCanvas frees memory by setting width and height to 0
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("renders text boxes and placed images when included in selection", async () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 50, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 2 }),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(ctx),
      toBlob: vi.fn((cb: (blob: Blob) => void, mime: string) => {
        cb(new Blob(["mock-png-bytes"], { type: mime }));
      }),
    };
    vi.stubGlobal("document", {
      createElement: (tag: string) => (tag === "canvas" ? canvas : {}),
    });

    const image: ImageElement = {
      id: "i1",
      path: "photo.png",
      x: 50,
      y: 50,
      w: 100,
      h: 100,
    };
    const textBox: TextBoxElement = {
      id: "t1",
      x: 160,
      y: 50,
      w: 80,
      h: 40,
      text: "hello",
      fontSize: 16,
      color: "#000",
    };
    const elements: PageElements = {
      strokes: [],
      images: [image],
      textBoxes: [textBox],
    };
    const bounds: Bounds = { minX: 50, minY: 50, maxX: 240, maxY: 150 };

    const prepare = vi.fn().mockResolvedValue(undefined);
    const paintImage = vi.fn();
    const imagePainter = { prepare, paintImage };

    const blob = await renderSelectionToPng(elements, bounds, {
      images: imagePainter,
      scale: 2,
    });

    expect(blob.type).toBe("image/png");
    expect(prepare).toHaveBeenCalledOnce();
    expect(paintImage).toHaveBeenCalledOnce();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it("throws error when selection bounds are empty or degenerate", async () => {
    const elements: PageElements = { strokes: [], images: [], textBoxes: [] };
    const invalidBounds: Bounds = { minX: 100, minY: 100, maxX: 100, maxY: 100 };
    await expect(
      renderSelectionToPng(elements, invalidBounds, { padding: 0 }),
    ).rejects.toThrow("Selection bounds are empty");
  });

  it("writes multi-MIME ClipboardItem with image/png and text/plain to system clipboard", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write } });

    const entries: Record<string, Blob | Promise<Blob>>[] = [];
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(data: Record<string, Blob | Promise<Blob>>) {
          entries.push(data);
        }
      },
    );

    const png = Promise.resolve(new Blob(["png-data"], { type: "image/png" }));
    const marker = clipboardMarker(42);

    copySelectionToSystemClipboard(png, marker);

    expect(write).toHaveBeenCalledOnce();
    expect(entries).toHaveLength(1);
    expect(entries[0]["image/png"]).toBe(png);
    expect(entries[0]["text/plain"]).toBeInstanceOf(Blob);
  });

  it("falls back to writeText when ClipboardItem writing rejects or fails", async () => {
    const write = vi.fn().mockRejectedValue(new Error("Permission denied"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });

    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor() {}
      },
    );

    const png = Promise.resolve(new Blob(["png-data"], { type: "image/png" }));
    const marker = clipboardMarker(10);

    copySelectionToSystemClipboard(png, marker);

    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(marker);
  });

  it("falls back to writeText when navigator.clipboard.write is unavailable", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const png = Promise.resolve(new Blob(["png-data"], { type: "image/png" }));
    const marker = clipboardMarker(5);

    copySelectionToSystemClipboard(png, marker);

    expect(writeText).toHaveBeenCalledWith(marker);
  });

  it("preserves internal editable ink in InkClipboard alongside system clipboard export", () => {
    const stroke: Stroke = {
      id: "s1",
      tool: "pen",
      color: "#123456",
      size: 3,
      pts: [10, 20, 0.5, 30, 40, 0.5],
    };
    const clipboard = new InkClipboard();
    clipboard.put(
      { strokes: [stroke], images: [], textBoxes: [] },
      { minX: 10, minY: 20, maxX: 30, maxY: 40 },
    );

    expect(clipboard.canPaste()).toBe(true);
    const content = clipboard.content!;
    expect(content.elements.strokes).toHaveLength(1);
    expect(content.elements.strokes[0].id).toBe("s1");
    expect(content.elements.strokes[0].color).toBe("#123456");
  });
});
