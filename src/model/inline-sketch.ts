/**
 * Pure model for inline handwriting sketches embedded in Markdown notes via
 * `![[Notebook#id=hw-…]]`. No DOM, no Obsidian.
 */

import { blankPage, type Page } from "./document";

export const INLINE_SKETCH_PREFIX = "hw-";
export const INLINE_SKETCH_WIDTH = 1024;
export const INLINE_DEFAULT_HEIGHT = 260;
export const INLINE_MIN_HEIGHT = 120;
export const INLINE_GROW_MARGIN = 64;
export const INLINE_GROW_STEP = 160;
export const INLINE_BOTTOM_PAD = 28;
export const INLINE_RESIZE_PAD = 12;
export const INLINE_MAX_HEIGHT = 4096;

export function isInlineSketchId(id: string): boolean {
  return id.startsWith(INLINE_SKETCH_PREFIX);
}

export function isInlineSketchPage(page: Pick<Page, "id">): boolean {
  return isInlineSketchId(page.id);
}

/** Creates a compact, expandable inline sketch page (transparent by default). */
export function createInlineSketchPage(
  id: string,
  options?: { transparent?: boolean; width?: number; height?: number },
): Page {
  const page = blankPage(id);
  const width = options?.width ?? INLINE_SKETCH_WIDTH;
  const height = options?.height ?? INLINE_DEFAULT_HEIGHT;
  page.geometry = { width, height };
  page.backdrop =
    options?.transparent === false
      ? { kind: "blank" }
      : { kind: "blank", paperColor: "transparent" };
  return page;
}

/** Lowest Y coordinate (page px) reached by any drawn content on `page`, or 0 when empty. */
export function lowestInlineContentY(page: Page): number {
  let maxY = 0;
  for (const stroke of page.strokes) {
    const pad = stroke.size / 2;
    for (let i = 1; i < stroke.pts.length; i += 3) {
      const y = stroke.pts[i] + pad;
      if (y > maxY) maxY = y;
    }
  }
  for (const image of page.images) {
    const y = image.y + image.h;
    if (y > maxY) maxY = y;
  }
  for (const text of page.textBoxes) {
    const y = text.y + (text.h ?? text.fontSize * 1.4);
    if (y > maxY) maxY = y;
  }
  for (const table of page.tables ?? []) {
    const h = table.rows.reduce((sum, r) => sum + r, 0);
    const y = table.y + h;
    if (y > maxY) maxY = y;
  }
  for (const graph of page.graphs ?? []) {
    const y = graph.y + graph.h;
    if (y > maxY) maxY = y;
  }
  for (const eq of page.equations ?? []) {
    const y = eq.y + eq.h;
    if (y > maxY) maxY = y;
  }
  return maxY;
}

/**
 * Target height after a stroke finishes: grows smoothly in `INLINE_GROW_STEP`
 * increments when ink reaches within `INLINE_GROW_MARGIN` of the bottom edge.
 * Never shrinks while actively writing.
 */
export function inlineGrowHeight(page: Page): number {
  const current = page.geometry.height;
  const lowest = lowestInlineContentY(page);
  if (lowest <= current - INLINE_GROW_MARGIN) return current;
  let next = current;
  while (lowest > next - INLINE_GROW_MARGIN && next < INLINE_MAX_HEIGHT) {
    next = Math.min(INLINE_MAX_HEIGHT, next + INLINE_GROW_STEP);
  }
  return next;
}

/**
 * Target height when finishing an inline writing session: trims excess empty
 * bottom space while keeping `INLINE_BOTTOM_PAD` below the lowest content.
 * Respects `manualHeight` if the user explicitly dragged the bottom handle.
 */
export function inlineTrimHeight(page: Page, manualHeight?: number | null): number {
  const lowest = lowestInlineContentY(page);
  if (lowest <= 0) {
    if (manualHeight !== null && manualHeight !== undefined) {
      return Math.max(INLINE_MIN_HEIGHT, Math.min(INLINE_MAX_HEIGHT, Math.round(manualHeight)));
    }
    return INLINE_DEFAULT_HEIGHT;
  }
  const tight = Math.max(INLINE_MIN_HEIGHT, Math.ceil(lowest + INLINE_BOTTOM_PAD));
  if (manualHeight !== null && manualHeight !== undefined) {
    return Math.min(INLINE_MAX_HEIGHT, Math.max(tight, Math.round(manualHeight)));
  }
  return Math.min(INLINE_MAX_HEIGHT, tight);
}

/** Clamps a user-dragged bottom-handle height so existing content is never clipped. */
export function inlineClampedResizeHeight(page: Page, desiredHeight: number): number {
  const lowest = lowestInlineContentY(page);
  const floor = Math.max(
    INLINE_MIN_HEIGHT,
    lowest > 0 ? Math.ceil(lowest + INLINE_RESIZE_PAD) : INLINE_MIN_HEIGHT,
  );
  return Math.max(floor, Math.min(INLINE_MAX_HEIGHT, Math.round(desiredHeight)));
}

/**
 * Finds the link target of the first inline handwriting embed
 * (`![[Notebook#id=hw-...]]`) in a Markdown document, so "Handwrite here"
 * automatically reuses the note's existing backing notebook without needing a
 * separate association registry.
 */
export function findLinkedNotebookInMarkdown(markdown: string): string | null {
  const match = /!\[\[([^\]|#]+)#id=hw-[A-Za-z0-9_-]+(?:\|[^\]]*)?\]\]/.exec(markdown);
  return match ? match[1].trim() : null;
}
