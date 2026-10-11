import { strokeBounds, type Page } from "../model/document";
import { boundsMeet } from "../canvas/pdf-raster";
import { imageBounds } from "../canvas/image-geometry";
import type { Polygon } from "../canvas/lasso";
import { PdfBackdropCache } from "./pdf-backdrop";
import { drawPlacedImage, fillStroke, styleOf, paintTextBox } from "../canvas/renderer";
import type { VaultImageCache } from "./image-cache";
import { releaseCanvas } from "./image-import";

export interface PdfRegion {
  pageId: string;
  polygon: Polygon;
  rectangular: boolean;
}
const regionFiles = new WeakSet<File>();
export function isPdfRegionFile(file: File): boolean {
  return regionFiles.has(file);
}
export function pdfRegionDpi(fraction: number): number {
  return fraction <= 0.1 ? 600 : 300;
}

let capturing = false;
export async function renderPdfRegion(
  page: Page,
  region: PdfRegion,
  pdf: PdfBackdropCache,
  images: VaultImageCache | null,
  pressure: boolean,
  alpha: number,
): Promise<File> {
  if (capturing) throw new Error("A PDF region is already being copied; please wait");
  capturing = true;
  try {
    return await renderRegion(page, region, pdf, images, pressure, alpha);
  } finally {
    capturing = false;
  }
}

/** PDF worker/source pixels, plus normal annotation painters; no live viewport or guides. */
async function renderRegion(
  page: Page,
  region: PdfRegion,
  pdf: PdfBackdropCache,
  images: VaultImageCache | null,
  pressure: boolean,
  alpha: number,
): Promise<File> {
  if (page.backdrop.kind !== "pdf") throw new Error("This page has no source PDF");
  const b = region.polygon.bounds,
    width = b.maxX - b.minX,
    height = b.maxY - b.minY;
  if (!(width > 0 && height > 0)) throw new Error("Select a larger PDF region");
  const entry = await pdf.captureRegion(page.backdrop.path, page.backdrop.page, {
    geometry: page.geometry,
    region: b,
    sourceDpi: pdfRegionDpi((width * height) / (page.geometry.width * page.geometry.height)),
  });
  if (!entry.ok) throw new Error(entry.reason);
  let canvas: HTMLCanvasElement;
  if ("getContext" in entry.canvas) canvas = entry.canvas;
  else {
    canvas = createEl("canvas");
    canvas.width = entry.canvas.width;
    canvas.height = entry.canvas.height;
    canvas.getContext("2d")?.drawImage(entry.canvas, 0, 0);
    entry.canvas.close();
  }
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PNG canvas unavailable");
    const box = entry.box!;
    const scale = canvas.width / box.w;
    const pictures = page.images.filter((image) => boundsMeet(imageBounds(image), b));
    if (images) await images.prepare(pictures, scale);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-box.x, -box.y);
    if (images) for (const image of pictures) drawPlacedImage(ctx, image, images, scale);
    for (const stroke of page.strokes) {
      const bounds = strokeBounds(stroke);
      if (
        bounds &&
        boundsMeet(
          {
            minX: bounds.minX - stroke.size * 0.8,
            minY: bounds.minY - stroke.size * 0.8,
            maxX: bounds.maxX + stroke.size * 0.8,
            maxY: bounds.maxY + stroke.size * 0.8,
          },
          b,
        )
      )
        fillStroke(ctx, stroke.pts, styleOf(stroke, pressure), alpha);
    }
    for (const text of page.textBoxes) paintTextBox(ctx, text);
    ctx.restore();
    if (!region.rectangular) {
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "#000";
      ctx.beginPath();
      const p = region.polygon.pts;
      ctx.moveTo((p[0] - box.x) * scale, (p[1] - box.y) * scale);
      for (let i = 2; i < p.length; i += 2)
        ctx.lineTo((p[i] - box.x) * scale, (p[i + 1] - box.y) * scale);
      ctx.closePath();
      ctx.fill("evenodd");
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))),
        "image/png",
      ),
    );
    const file = new File([blob], "PDF region.png", { type: "image/png" });
    regionFiles.add(file);
    return file;
  } finally {
    releaseCanvas(canvas);
  }
}

/** Invoke in the Copy gesture, before awaiting source rendering. */
export function copyPdfRegionToSystemClipboard(
  png: Promise<File>,
  marker: string,
  failed: (message: string) => void,
): void {
  png.catch(() => undefined);
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      failed("System clipboard unavailable; use Paste inside FineNotes.");
      return;
    }
    const item = new ClipboardItem({
      "image/png": png,
      "text/plain": new Blob([marker], { type: "text/plain" }),
    });
    void navigator.clipboard
      .write([item])
      .catch(() => failed("System clipboard copy failed; use Paste inside FineNotes."));
  } catch {
    failed("System clipboard copy failed; use Paste inside FineNotes.");
  }
}
