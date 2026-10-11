import { afterEach, describe, expect, it, vi } from "vitest";
import { planPdfRaster } from "../../src/canvas/pdf-raster";
import { InkClipboard } from "../../src/model/clipboard";
vi.mock("obsidian", () => ({ loadPdfJs: vi.fn() }));
const { renderPdfRegion, copyPdfRegionToSystemClipboard, isPdfRegionFile, pdfRegionDpi } =
  await import("../../src/view/pdf-region-copy");
afterEach(() => vi.unstubAllGlobals());
describe("source PDF region PNG", () => {
  it("has zoom-independent source DPI, bounded memory and precise crop transform", () => {
    const area = {
      geometry: { width: 1224, height: 1584 },
      region: { minX: 200, minY: 400, maxX: 400, maxY: 500 },
      sourceDpi: 600,
    };
    const a = planPdfRaster({ width: 612, height: 792 }, 0.5, area),
      b = planPdfRaster({ width: 612, height: 792 }, 8, area);
    expect(a).toEqual(b);
    expect(a.sourceScale).toBeCloseTo(600 / 72);
    expect(a.width).toBe(833);
    expect(a.height).toBe(416);
    expect(a.transform[4]).toBeCloseTo((-200 * 600) / 144);
    expect(a.transform[5]).toBeCloseTo((-400 * 600) / 144);
    const huge = planPdfRaster({ width: 612, height: 792 }, 1, {
      ...area,
      region: { minX: 0, minY: 0, maxX: 1224, maxY: 1584 },
    });
    expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(4096);
    expect(huge.width * huge.height).toBeLessThanOrEqual(9_000_000);
    expect(pdfRegionDpi(0.05)).toBe(600);
    expect(pdfRegionDpi(0.5)).toBe(300);
  });
  it.each([true, false])("encodes PNG and releases pixels; rectangular=%s", async (rectangular) => {
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
    };
    const canvas = {
      width: 800,
      height: 400,
      getContext: () => ctx,
      toBlob: (done: (blob: Blob) => void, mime: string) => done(new Blob(["png"], { type: mime })),
    };
    const captureRegion = vi
      .fn()
      .mockResolvedValue({ ok: true, canvas, box: { x: 20, y: 40, w: 100, h: 50 } });
    const page = {
      id: "p",
      geometry: { width: 600, height: 800 },
      backdrop: { kind: "pdf", path: "original.pdf", page: 2 },
      images: [],
      strokes: [],
      textBoxes: [],
    };
    const region = {
      pageId: "p",
      rectangular,
      polygon: {
        pts: [20, 40, 120, 40, 100, 90],
        bounds: { minX: 20, minY: 40, maxX: 120, maxY: 90 },
      },
    };
    const file = await renderPdfRegion(
      page as never,
      region,
      { captureRegion } as never,
      null,
      true,
      0.4,
    );
    expect(file.type).toBe("image/png");
    expect(isPdfRegionFile(file)).toBe(true);
    expect(captureRegion).toHaveBeenCalledWith(
      "original.pdf",
      2,
      expect.objectContaining({ sourceDpi: 600, region: region.polygon.bounds }),
    );
    expect(ctx.fill).toHaveBeenCalledTimes(rectangular ? 0 : 1);
    if (!rectangular) expect(ctx.fill).toHaveBeenCalledWith("evenodd");
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
  it("initiates clipboard write before rendering resolves and retains internal fallback", async () => {
    let finish!: (f: File) => void;
    const png = new Promise<File>((resolve) => (finish = resolve)),
      write = vi.fn().mockResolvedValue(undefined),
      failed = vi.fn();
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
    copyPdfRegionToSystemClipboard(png, "marker", failed);
    expect(write).toHaveBeenCalledOnce();
    expect(entries[0]["image/png"]).toBe(png);
    const clipboard = new InkClipboard();
    clipboard.putRegion(png);
    expect(clipboard.canPaste()).toBe(true);
    expect(clipboard.canPaste(false)).toBe(false);
    const file = new File(["pixels"], "region.png", { type: "image/png" });
    finish(file);
    expect(await clipboard.regionPng).toBe(file);
    expect(failed).not.toHaveBeenCalled();
    clipboard.put(
      { strokes: [], images: [], textBoxes: [] },
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    );
    expect(clipboard.regionPng).toBeNull();
  });
  it("reports clipboard rejection and missing source", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { write: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    vi.stubGlobal("ClipboardItem", class {});
    const failed = vi.fn();
    copyPdfRegionToSystemClipboard(Promise.resolve(new File([], "r.png")), "marker", failed);
    await Promise.resolve();
    expect(failed).toHaveBeenCalledOnce();
    const page = {
      geometry: { width: 600, height: 800 },
      backdrop: { kind: "pdf", path: "missing.pdf", page: 0 },
    };
    await expect(
      renderPdfRegion(
        page as never,
        {
          pageId: "p",
          rectangular: true,
          polygon: { pts: [0, 0, 1, 0, 1, 1], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
        },
        { captureRegion: async () => ({ ok: false, reason: "Missing source" }) } as never,
        null,
        true,
        0.4,
      ),
    ).rejects.toThrow("Missing source");
  });
});
