/**
 * Selection clipboard rendering and system clipboard integration.
 *
 * When ink, shapes, text boxes, or placed images are selected and copied
 * (or cut) in FineNotes, the system clipboard receives a multi-MIME payload:
 * 1. "image/png": a rendered, transparent PNG of the selection cropped to its
 *    bounds with retina scaling and padding, suitable for pasting into external
 *    applications (Apple Notes, Mail, Slack, Keynote, Preview, etc.).
 * 2. "text/plain": a FineNotes marker token tying this clipboard item to the
 *    in-memory InkClipboard (`src/model/clipboard.ts`).
 *
 * Inside FineNotes, the paste handler recognizes the marker and pastes the
 * original vector strokes and elements (allowing full subsequent editing,
 * recoloring, and scribble-erasing). Outside FineNotes, apps ignore the marker
 * or accept the PNG graphic.
 */

import type { Bounds } from "../model/document";
import type { PageElements } from "../model/selection-commands";
import { DEFAULT_HIGHLIGHTER_ALPHA } from "../constants";
import {
  type ImagePainter,
  drawPlacedImage,
  fillStroke,
  paintTextBox,
  styleOf,
} from "../canvas/renderer";
import { drawPlacedCircuit } from "../circuit/circuit-render";

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export interface RenderSelectionOptions {
  pressure?: boolean;
  highlighterAlpha?: number;
  images?: ImagePainter | null;
  padding?: number;
  scale?: number;
  backgroundColor?: string;
}

/**
 * Render the given selected elements onto an offscreen transparent canvas
 * cropped to their bounding box (with optional padding) and encode as a PNG blob.
 */
export async function renderSelectionToPng(
  elements: PageElements,
  bounds: Bounds,
  options: RenderSelectionOptions = {},
): Promise<Blob> {
  const pad = Math.max(0, options.padding ?? 4);
  const minX = bounds.minX - pad;
  const minY = bounds.minY - pad;
  const maxX = bounds.maxX + pad;
  const maxY = bounds.maxY + pad;
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0 && h > 0)) {
    throw new Error("Selection bounds are empty");
  }

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2;
  let scale = options.scale ?? Math.max(2, Math.min(3, dpr));
  const MAX_IMAGE_LONG_SIDE = 4096;
  if (Math.max(w, h) * scale > MAX_IMAGE_LONG_SIDE) {
    scale = MAX_IMAGE_LONG_SIDE / Math.max(w, h);
  }

  const canvas =
    typeof createEl === "function"
      ? createEl("canvas")
      : typeof document !== "undefined"
        ? document.createElement("canvas")
        : null;
  if (!canvas) {
    throw new Error("Canvas is unavailable");
  }

  try {
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable");
    }

    const pictures = elements.images ?? [];
    if (
      options.images &&
      pictures.length > 0 &&
      "prepare" in options.images &&
      typeof (options.images as { prepare?: (imgs: typeof pictures, sc: number) => Promise<void> })
        .prepare === "function"
    ) {
      await (
        options.images as { prepare: (imgs: typeof pictures, sc: number) => Promise<void> }
      ).prepare(pictures, scale);
    }

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-minX, -minY);

    if (options.backgroundColor) {
      ctx.fillStyle = options.backgroundColor;
      ctx.fillRect(minX, minY, w, h);
    }

    if (options.images && pictures.length > 0) {
      for (const image of pictures) {
        drawPlacedImage(ctx, image, options.images, scale);
      }
    }

    for (const circuit of elements.circuits ?? []) {
      drawPlacedCircuit(ctx, circuit);
    }

    const pressure = options.pressure !== false;
    const alpha = options.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA;
    for (const stroke of elements.strokes ?? []) {
      fillStroke(ctx, stroke.pts, styleOf(stroke, pressure), alpha);
    }

    for (const box of elements.textBoxes ?? []) {
      paintTextBox(ctx, box);
    }

    ctx.restore();

    return await new Promise<Blob>((resolve, reject) => {
      if (typeof canvas.toBlob === "function") {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))),
          "image/png",
        );
      } else if (typeof canvas.toDataURL === "function") {
        try {
          const dataUrl = canvas.toDataURL("image/png");
          fetch(dataUrl)
            .then((res) => res.blob())
            .then(resolve)
            .catch(reject);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      } else {
        reject(new Error("Canvas toBlob is unavailable"));
      }
    });
  } finally {
    releaseCanvas(canvas);
  }
}

/** Monotonically increasing ticket so older pending clipboard writes never overwrite newer ones. */
let activeClipboardTicket = 0;

/**
 * Write the rendered PNG alongside the FineNotes text marker to the system
 * clipboard. Must be invoked during the user gesture (before any await) so
 * engines such as iPadOS WebKit accept the clipboard item promise.
 *
 * If writing ClipboardItem fails synchronously (unsupported platform or engine error),
 * falls back immediately inside the user gesture to writing just the text marker.
 * If rejected asynchronously (outside the gesture), delegates to `onFailed` rather than
 * attempting an unprivileged delayed write that WebKit would reject or that would
 * overwrite newer clipboard contents.
 */
export function copySelectionToSystemClipboard(
  png: Promise<Blob>,
  marker: string,
  onFailed?: (error: unknown) => void,
): void {
  const ticket = ++activeClipboardTicket;
  // Prevent unhandled rejections
  png.catch(() => undefined);
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    writeMarkerText(marker);
    return;
  }
  try {
    const item = new ClipboardItem({
      "image/png": png,
      "text/plain": new Blob([marker], { type: "text/plain" }),
    });
    navigator.clipboard.write([item]).catch((err) => {
      if (ticket !== activeClipboardTicket) return;
      onFailed?.(err);
    });
  } catch {
    if (ticket === activeClipboardTicket) {
      writeMarkerText(marker);
    }
  }
}

function writeMarkerText(marker: string): void {
  try {
    navigator.clipboard?.writeText?.(marker).catch(() => undefined);
  } catch {
    /* Best effort; internal in-memory clipboard remains available */
  }
}
