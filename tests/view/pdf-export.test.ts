import { PDF_QUALITY_FACTORS, pdfQuality } from "../../src/export/pdf-quality";
import { exportPixelScale, EXPORT_MAX_EDGE, EXPORT_MAX_PIXELS, POINTS_PER_PAGE_PX } from "../../src/export/pdf-writer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { blankPage, type Stroke } from "../../src/model/document";
import { LIGHT_PAPER } from "../../src/canvas/backdrop";

vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../src/canvas/renderer", () => ({
  renderPageThumbnail: vi.fn((canvas: HTMLCanvasElement) => {
    canvas.width = 8;
    canvas.height = 8;
  }),
}));
const { renderPageThumbnail } = await import("../../src/canvas/renderer");
const { exportPagesToPdf } = await import("../../src/view/pdf-export");
const jpg = readFileSync(new URL("../export/fixtures/white.jpg", import.meta.url));
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=",
    "base64",
  ),
);
const sources = {
  pdf: null,
  images: null,
  paper: LIGHT_PAPER,
  usePressure: false,
  highlighterAlpha: 0.3,
};
const pdfPage = () => ({
  ...blankPage("p1"),
  backdrop: { kind: "pdf" as const, path: "Lecture.pdf", page: 0 },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("createEl", () => ({
    width: 0,
    height: 0,
    toBlob: (callback: (blob: Blob) => void, mime: string) =>
      callback(new Blob([mime === "image/png" ? png : jpg], { type: mime })),
  }));
});
afterEach(() => vi.unstubAllGlobals());
async function source() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText("Original PDF text", { font });
  return (await doc.save()).slice().buffer as ArrayBuffer;
}
describe("existing PDF export integration", () => {
  it("composes PDF source with annotation layers alongside ordinary pages", async () => {
    const page = pdfPage();
    page.textBoxes.push({
      id: "t1",
      x: 10,
      y: 10,
      w: 200,
      text: "Notebook text",
      fontSize: 16,
      color: "#000",
    });
    page.strokes = [
      { id: "s1", tool: "highlighter", color: "#ff0", size: 10, pts: [0, 0, 0.5, 50, 50, 0.5] },
      { id: "s2", tool: "pen", color: "#000", size: 3, pts: [0, 0, 0.5, 50, 50, 0.5] },
    ] as Stroke[];
    const readPdf = vi.fn(source);
    const onProgress = vi.fn();
    const bytes = await exportPagesToPdf(
      [page, blankPage("p2")],
      { ...sources, readPdf },
      { title: "Notebook", onProgress },
    );
    const result = await PDFDocument.load(bytes);
    expect(result.getPageCount()).toBe(2);
    expect(readPdf).toHaveBeenCalledWith("Lecture.pdf");
    expect(onProgress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(
      vi.mocked(renderPageThumbnail).mock.calls.map((call) => call[5].transparent ?? false),
    ).toEqual([true, true, true, false]);
    expect(
      vi
        .mocked(renderPageThumbnail)
        .mock.calls.map((call) => call[1].strokes.map((stroke) => stroke.id)),
    ).toEqual([[], ["s1"], ["s2"], []]);
  });
  it("keeps an unannotated PDF page entirely vector without rasterizing its backdrop", async () => {
    const bytes = await exportPagesToPdf(
      [pdfPage()],
      { ...sources, readPdf: source },
      { title: "PDF" },
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(renderPageThumbnail).not.toHaveBeenCalled();
  });
  it("retains the existing ordinary-page export without needing source PDF access", async () => {
    const bytes = await exportPagesToPdf([blankPage("p1")], sources, { title: "Plain" });
    expect(Buffer.from(bytes.subarray(0, 8)).toString()).toBe("%PDF-1.4");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("stops on missing PDF sources rather than exporting a placeholder", async () => {
    await expect(
      exportPagesToPdf(
        [pdfPage()],
        {
          ...sources,
          readPdf: async () => {
            throw new Error("Missing PDF source");
          },
        },
        { title: "Missing" },
      ),
    ).rejects.toThrow("Missing PDF source");
    expect(renderPageThumbnail).not.toHaveBeenCalled();
  });
  it("honors cancellation before rendering and checks after the final page", async () => {
    await expect(
      exportPagesToPdf(
        [pdfPage()],
        { ...sources, readPdf: source },
        { title: "Stop", cancelled: () => true },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    let cancelled = false;
    vi.mocked(renderPageThumbnail).mockImplementationOnce((canvas) => {
      canvas.width = canvas.height = 8;
      cancelled = true;
    });
    await expect(
      exportPagesToPdf([blankPage("p1")], sources, { title: "Stop", cancelled: () => cancelled }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

it.each(["dashed", "dotted"] as const)(
  "PDF-backed overlays retain %s Pen metadata through the existing exporter",
  async (lineStyle) => {
    const page = pdfPage();
    page.strokes = [
      {
        id: "styled",
        tool: "pen",
        color: "#000",
        size: 3,
        pts: [0, 0, 0.5, 100, 10, 0.8],
        lineStyle,
      },
    ];
    const bytes = await exportPagesToPdf(
      [page],
      { ...sources, readPdf: source },
      { title: "Styled PDF" },
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(
      vi
        .mocked(renderPageThumbnail)
        .mock.calls.some((call) =>
          call[1].strokes.some((stroke) => stroke.lineStyle === lineStyle),
        ),
    ).toBe(true);
  },
);
describe("companion uses the same high-quality PDF exporter", () => {
  it.each([false, true])(
    "embeds optional ownership for PDF-backed=%s without altering manual export",
    async (backed) => {
      const pages = backed ? [pdfPage()] : [blankPage("p1")];
      const input = { ...sources, readPdf: source };
      const subject = "FineNotes companion a3f9211234567890";
      const companion = await PDFDocument.load(
        await exportPagesToPdf(pages, input, { title: "Biology", subject }),
      );
      expect(companion.getSubject()).toBe(subject);
      expect(companion.getPageCount()).toBe(1);
      const manual = await PDFDocument.load(
        await exportPagesToPdf(pages, input, { title: "Biology" }),
      );
      expect(manual.getSubject()).toBeUndefined();
      if (backed)
        expect(companion.getPages()[0].node.Resources()?.keys().length).toBeGreaterThan(0);
    },
  );
});

it.each(["dashed", "dotted"] as const)(
  "personal integration: companion ownership and %s overlay share PDF-backed composition",
  async (lineStyle) => {
    const page = pdfPage();
    page.strokes = [
      {
        id: "styled",
        tool: "pen",
        color: "#1971c2",
        size: 3,
        pts: [0, 0, 0.5, 100, 10, 0.8],
        lineStyle,
      },
    ];
    const subject = "FineNotes companion a3f9211234567890";
    const bytes = await exportPagesToPdf(
      [page],
      { ...sources, readPdf: source },
      { title: "Biology", subject },
    );
    const result = await PDFDocument.load(bytes);
    expect(result.getSubject()).toBe(subject);
    expect(result.getPages()[0].node.Resources()?.keys().length).toBeGreaterThan(0);
    expect(
      vi
        .mocked(renderPageThumbnail)
        .mock.calls.some((call) =>
          call[1].strokes.some(
            (stroke) => stroke.color === "#1971c2" && stroke.lineStyle === lineStyle,
          ),
        ),
    ).toBe(true);
  },
);

it("quality tiers change raster detail within existing memory caps, without changing page geometry", () => {
  expect(PDF_QUALITY_FACTORS).toEqual({standard: 1, high: 1.25, "very-high": 1.5});
  expect(pdfQuality(undefined)).toBe("high"); expect(pdfQuality("standard")).toBe("standard");
  const width = 1024, height = 1448;
  const scales = Object.values(PDF_QUALITY_FACTORS).map(factor => exportPixelScale(width, height, factor));
  expect(scales[1]).toBeGreaterThan(scales[0]); expect(scales[2]).toBeGreaterThan(scales[1]);
  for (const scale of scales) {expect(height * scale).toBeLessThanOrEqual(EXPORT_MAX_EDGE); expect(width * height * scale * scale).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);}
});

it.each(["standard", "high", "very-high"] as const)("%s reaches the shared exporter without altering physical page size", async quality => {
  const page = blankPage("p1");
  const bytes = await exportPagesToPdf([page], sources, {title: "Quality", quality});
  const scale = exportPixelScale(page.geometry.width, page.geometry.height, PDF_QUALITY_FACTORS[quality]);
  expect(vi.mocked(renderPageThumbnail).mock.calls[0][3]).toBe(page.geometry.width * scale);
  const result = await PDFDocument.load(bytes);
  expect(result.getPage(0).getWidth()).toBeCloseTo(page.geometry.width * POINTS_PER_PAGE_PX, 2);
});
