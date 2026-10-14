/**
 * Render FineNotes notebook clips and pages to high-DPI PNGs with full page background.
 */

import type { Backdrop, Bounds, Page, PageGeometry, SyntheticBackdrop } from "../model/document";
import {
  drawSynthetic,
  fillPaper,
  paperTheme,
} from "../canvas/backdrop";
import {
  type ImagePainter,
  drawPlacedImage,
  fillStroke,
  paintTextBox,
  styleOf,
} from "../canvas/renderer";
import { drawPlacedCircuit } from "../circuit/circuit-render";
import { DEFAULT_HIGHLIGHTER_ALPHA } from "../constants";

export interface RenderClipPngOptions {
  padding?: number;
  scale?: number;
  images?: ImagePainter | null;
  backdropPainter?: {
    paint: (
      ctx: CanvasRenderingContext2D,
      backdrop: Backdrop,
      geometry: PageGeometry,
      weight?: number,
      target?: { deviceScale: number; region?: Bounds },
    ) => void;
  } | null;
}

function boundsMeet(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Render a notebook region or full page to a PNG ArrayBuffer with complete paper background.
 */
export async function renderClipPng(
  page: Page,
  bounds: Bounds,
  options: RenderClipPngOptions = {},
): Promise<ArrayBuffer> {
  const geom: PageGeometry = page.geometry ?? { width: 1024, height: 1366 };
  const pad = Math.max(0, options.padding ?? 16);

  const minX = Math.max(0, Math.floor(bounds.minX - pad));
  const minY = Math.max(0, Math.floor(bounds.minY - pad));
  const maxX = Math.min(geom.width, Math.ceil(bounds.maxX + pad));
  const maxY = Math.min(geom.height, Math.ceil(bounds.maxY + pad));
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2;
  const scale = options.scale ?? Math.max(2, Math.min(3, dpr));

  const canvas =
    typeof createEl === "function"
      ? createEl("canvas")
      : typeof document !== "undefined"
        ? document.createElement("canvas")
        : null;
  if (!canvas) throw new Error("Canvas unavailable");

  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");

  const isDark = typeof document !== "undefined" && document.body.classList.contains("theme-dark");
  const theme = paperTheme(isDark);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);

  // 1. Draw page background
  if (options.backdropPainter && page.backdrop) {
    options.backdropPainter.paint(ctx, page.backdrop, geom, 1);
  } else if (page.backdrop?.kind === "pdf") {
    fillPaper(ctx, geom, theme);
  } else {
    const backdrop: SyntheticBackdrop = (page.backdrop as SyntheticBackdrop) ?? {
      kind: "ruled-wide",
      paperColor: isDark ? theme.paper : "#ffffff",
    };
    drawSynthetic(ctx, backdrop, geom, theme);
  }

  const cropBox: Bounds = { minX, minY, maxX, maxY };

  // 2. Draw placed images
  const pictures = page.images ?? [];
  if (pictures.length > 0 && options.images) {
    if (
      "prepare" in options.images &&
      typeof (options.images as { prepare?: (imgs: typeof pictures, sc: number) => Promise<void> })
        .prepare === "function"
    ) {
      await (
        options.images as { prepare: (imgs: typeof pictures, sc: number) => Promise<void> }
      ).prepare(pictures, scale);
    }
    for (const img of pictures) {
      if (boundsMeet({ minX: img.x, minY: img.y, maxX: img.x + img.w, maxY: img.y + img.h }, cropBox)) {
        drawPlacedImage(ctx, img, options.images, scale);
      }
    }
  }

  // 3. Draw circuits
  for (const circuit of page.circuits ?? []) {
    if (
      boundsMeet(
        { minX: circuit.x, minY: circuit.y, maxX: circuit.x + circuit.w, maxY: circuit.y + circuit.h },
        cropBox,
      )
    ) {
      drawPlacedCircuit(ctx, circuit);
    }
  }

  // 4. Draw text boxes
  for (const box of page.textBoxes ?? []) {
    const boxH = box.h ?? 100;
    if (
      boundsMeet(
        { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + boxH },
        cropBox,
      )
    ) {
      paintTextBox(ctx, box);
    }
  }

  // 5. Draw ink strokes
  for (const stroke of page.strokes ?? []) {
    fillStroke(ctx, stroke.pts, styleOf(stroke, true), DEFAULT_HIGHLIGHTER_ALPHA);
  }

  ctx.restore();

  return await new Promise<ArrayBuffer>((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error("PNG encoding failed"));
        try {
          const buf = await blob.arrayBuffer();
          resolve(buf);
        } catch (e) {
          reject(e);
        }
      }, "image/png");
    } else if (typeof canvas.toDataURL === "function") {
      try {
        const dataUrl = canvas.toDataURL("image/png");
        fetch(dataUrl)
          .then((res) => res.arrayBuffer())
          .then(resolve)
          .catch(reject);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    } else {
      reject(new Error("Canvas toBlob unavailable"));
    }
  });
}
