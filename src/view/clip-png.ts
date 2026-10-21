import type { PdfBackdropCache } from "./pdf-backdrop";
/**
 * Render FineNotes notebook clips and pages to high-DPI PNGs with full page background.
 */

import type { Backdrop, Bounds, Page, PageGeometry, SyntheticBackdrop } from "../model/document";
import { strokeBounds } from "../model/document";
import {
  drawSynthetic,
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
  pdf?: PdfBackdropCache | null;
  padding?: number;
  scale?: number;
  images?: ImagePainter | null;
  includeBackground?: boolean;
  usePressure?: boolean;
  highlighterAlpha?: number;
  themeMode?: "dark" | "light";
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

export function parseColorToRgb(color: string): { r: number; g: number; b: number; a?: number } | null {
  const c = color.trim().toLowerCase();
  if (c === "black") return { r: 0, g: 0, b: 0 };
  if (c === "white") return { r: 255, g: 255, b: 255 };
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  const rgbMatch = /^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }
  return null;
}

/**
 * Intelligently convert black/dark text to white in dark mode and vice versa,
 * while preserving vibrant colors (blue, red, green, etc.).
 */
export function adaptColorForTheme(color: string, isDark: boolean): string {
  const rgb = parseColorToRgb(color);
  if (!rgb) return color;
  const maxVal = Math.max(rgb.r, rgb.g, rgb.b);
  const minVal = Math.min(rgb.r, rgb.g, rgb.b);
  const isMonochrome = (maxVal - minVal) <= 35; // grayscale or neutral

  if (isDark) {
    // In dark mode: black or very dark text/strokes become white
    if (isMonochrome && maxVal <= 80) {
      return "#ffffff";
    }
  } else {
    // In light mode: white or very light text/strokes become black
    if (isMonochrome && minVal >= 195) {
      return "#1a1a1a";
    }
  }
  return color;
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
  const targetDpr = Math.min(2, Math.max(1, dpr));
  // Keep live embed image sizes bounded (up to 2 megapixels, max 2048px on an edge)
  // so large expandable regions do not stall the main thread during PNG encoding.
  const maxPixels = 2_000_000;
  const scale = Math.min(
    options.scale ?? Math.min(targetDpr, Math.sqrt(maxPixels / (w * h))),
    2048 / Math.max(w, h),
  );

  const canvas =
    typeof createEl === "function"
      ? createEl("canvas")
      : typeof document !== "undefined"
        ? document.createElement("canvas")
        : null;
  if (!canvas) throw new Error("Canvas unavailable");

  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  try {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");

  const isDark =
    options.themeMode !== undefined
      ? options.themeMode === "dark"
      : typeof document !== "undefined" && document.body.classList.contains("theme-dark");
  const theme = paperTheme(isDark);
  const includeBackground = options.includeBackground ?? (options.pdf ? true : false);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);

  // 1. Draw page background only if includeBackground is enabled
  if (includeBackground) {
    if (page.backdrop.kind === "pdf") {
      if (!options.pdf) throw new Error("PDF background unavailable");
      const entry = await options.pdf.captureRegion(page.backdrop.path,page.backdrop.page,{geometry:geom,region:{minX,minY,maxX,maxY},sourceDpi:144});
      if (!entry.ok || !entry.box) throw new Error(entry.ok ? "Missing PDF region" : entry.reason);
      try { ctx.drawImage(entry.canvas,entry.box.x,entry.box.y,entry.box.w,entry.box.h); }
      finally { if("close" in entry.canvas) (entry.canvas as { close?: () => void }).close?.(); else {entry.canvas.width=0;entry.canvas.height=0;} }
    } else if (options.backdropPainter && page.backdrop) {
      options.backdropPainter.paint(ctx, page.backdrop, geom, 1);
    } else {
      const backdrop: SyntheticBackdrop = (page.backdrop as SyntheticBackdrop) ?? {
        kind: "ruled-wide",
        paperColor: isDark ? theme.paper : "#ffffff",
      };
      drawSynthetic(ctx, backdrop, geom, theme);
    }
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

  // 3. Draw circuits (inverted in dark mode if background is transparent for high contrast)
  for (const circuit of page.circuits ?? []) {
    if (
      boundsMeet(
        { minX: circuit.x, minY: circuit.y, maxX: circuit.x + circuit.w, maxY: circuit.y + circuit.h },
        cropBox,
      )
    ) {
      if (!includeBackground && isDark) {
        ctx.save();
        ctx.filter = "invert(1) hue-rotate(180deg)";
        drawPlacedCircuit(ctx, circuit);
        ctx.restore();
      } else {
        drawPlacedCircuit(ctx, circuit);
      }
    }
  }

  // 4. Draw text boxes (intelligently adapted for theme contrast when background is transparent)
  for (const box of page.textBoxes ?? []) {
    const boxH = box.h ?? 100;
    if (
      boundsMeet(
        { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + boxH },
        cropBox,
      )
    ) {
      if (!includeBackground) {
        const adaptedColor = adaptColorForTheme(box.color, isDark);
        paintTextBox(ctx, adaptedColor === box.color ? box : { ...box, color: adaptedColor });
      } else {
        paintTextBox(ctx, box);
      }
    }
  }

  // 5. Draw ink strokes (intelligently converted between black/white when background is transparent)
  for (const stroke of page.strokes ?? []) {
    const sb = strokeBounds(stroke);
    if (sb && !boundsMeet(sb, cropBox)) continue;
    if (!includeBackground) {
      const adaptedColor = adaptColorForTheme(stroke.color, isDark);
      const adaptedStroke = adaptedColor === stroke.color ? stroke : { ...stroke, color: adaptedColor };
      fillStroke(ctx, adaptedStroke.pts, styleOf(adaptedStroke, options.usePressure ?? true), options.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA);
    } else {
      fillStroke(ctx, stroke.pts, styleOf(stroke, options.usePressure ?? true), options.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA);
    }
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
  } finally {canvas.width=0;canvas.height=0;}
}
