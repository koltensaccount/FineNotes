import {
  type Bounds,
  type InkDocument,
  type NotebookClip,
  type Page,
  blankPage,
  clipCurrentBounds,
  strokeBounds,
} from "./document";
import { parseHexColor } from "./colors";

export const INITIAL_BLOCK_HEIGHT = 360;
export const BLOCK_PADDING = 40;
export const BLOCK_EXPAND_STEP = 240;

export function isBlockPage(page: Page): boolean {
  return (
    page.id.startsWith("block-") ||
    (page.clips?.length === 1 && page.clips[0].id.startsWith("block-"))
  );
}

export function contentBoundsOnPage(page: Page): Bounds | null {
  const boxes: Bounds[] = [];
  for (const s of page.strokes) {
    const b = strokeBounds(s);
    if (b) boxes.push(b);
  }
  for (const el of [...page.images, ...page.textBoxes, ...(page.equations ?? [])]) {
    boxes.push({
      minX: el.x,
      minY: el.y,
      maxX: el.x + el.w,
      maxY: el.y + (el.h ?? 100),
    });
  }
  if (!boxes.length) return null;
  return boxes.reduce(
    (acc, b) => ({
      minX: Math.min(acc.minX, b.minX),
      minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX),
      maxY: Math.max(acc.maxY, b.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function createBlockPage(
  doc: InkDocument,
  blockId = `block-${crypto.randomUUID()}`,
  width = 800,
  initialHeight = INITIAL_BLOCK_HEIGHT,
): { page: Page; pageIndex: number; clip: NotebookClip } {
  const pageIndex = doc.pages.length;
  const page = blankPage(blockId, { width, height: initialHeight });
  const now = Date.now();
  const clip: NotebookClip = {
    id: blockId,
    pageId: page.id,
    bounds: {
      minX: BLOCK_PADDING,
      minY: BLOCK_PADDING,
      maxX: width - BLOCK_PADDING,
      maxY: initialHeight - BLOCK_PADDING,
    },
    isExpandable: true,
    originY: BLOCK_PADDING,
    createdAt: now,
    updatedAt: now,
  };
  page.clips = [clip];
  doc.pages.push(page);
  return { page, pageIndex, clip };
}

export function expandBlockPageIfNeeded(
  page: Page,
  contentBottomY: number,
  buffer = 60,
): boolean {
  if (contentBottomY + buffer > page.geometry.height) {
    const required = contentBottomY + buffer + BLOCK_EXPAND_STEP;
    page.geometry.height = Math.max(page.geometry.height + BLOCK_EXPAND_STEP, required);
    if (page.clips && page.clips.length > 0) {
      for (const clip of page.clips) {
        if (clip.isExpandable) {
          clip.bounds.maxY = page.geometry.height - BLOCK_PADDING;
          clip.updatedAt = Date.now();
        }
      }
    }
    return true;
  }
  return false;
}

/**
 * Fits a dedicated Handwrite Here block page height to its current content:
 * - Grows when content approaches the bottom (`expandBlockPageIfNeeded`).
 * - Shrinks back down to `INITIAL_BLOCK_HEIGHT` when completely blank, or to
 *   a comfortable writing buffer below the lowest remaining content when
 *   trailing strokes are erased/undone.
 */
export function fitBlockPageHeight(
  page: Page,
  contentBottomY: number | null,
  buffer = 60,
): boolean {
  if (contentBottomY !== null && expandBlockPageIfNeeded(page, contentBottomY, buffer)) {
    return true;
  }
  const targetHeight =
    contentBottomY === null
      ? INITIAL_BLOCK_HEIGHT
      : Math.max(
          INITIAL_BLOCK_HEIGHT,
          Math.ceil((contentBottomY + buffer + 120) / 120) * 120,
        );
  // Require > 60px excess before shrinking when non-empty (prevents jitter),
  // and always snap back to INITIAL_BLOCK_HEIGHT when completely blank.
  const shouldShrink =
    contentBottomY === null
      ? page.geometry.height > INITIAL_BLOCK_HEIGHT
      : page.geometry.height - targetHeight > 60;
  if (!shouldShrink) return false;
  page.geometry.height = targetHeight;
  if (page.clips && page.clips.length > 0) {
    for (const clip of page.clips) {
      if (clip.isExpandable) {
        clip.bounds.maxY = Math.max(BLOCK_PADDING, page.geometry.height - BLOCK_PADDING);
        clip.updatedAt = Date.now();
      }
    }
  }
  return true;
}

export function resolveBlockBounds(page: Page, clip: NotebookClip): Bounds {
  if (!isBlockPage(page)) return clipCurrentBounds(page, clip);
  const content = contentBoundsOnPage(page);
  const w = page.geometry.width;
  if (!content) {
    return {
      minX: 0,
      minY: 0,
      maxX: w,
      maxY: Math.min(page.geometry.height, INITIAL_BLOCK_HEIGHT),
    };
  }
  const pad = 20;
  return {
    minX: Math.max(0, Math.min(content.minX - pad, BLOCK_PADDING)),
    minY: Math.max(0, content.minY - pad),
    maxX: Math.min(w, Math.max(content.maxX + pad, w - BLOCK_PADDING)),
    maxY: Math.min(page.geometry.height, Math.max(content.maxY + pad, 140)),
  };
}

export function findBlockInDocument(
  doc: InkDocument,
  blockId: string,
): { page: Page; pageIndex: number; clip: NotebookClip } | null {
  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    if (page.id === blockId) {
      const clip: NotebookClip = page.clips?.[0] ?? {
        id: blockId,
        pageId: page.id,
        bounds: {
          minX: 0,
          minY: 0,
          maxX: page.geometry.width,
          maxY: page.geometry.height,
        },
        isExpandable: true,
        createdAt: 0,
        updatedAt: 0,
      };
      return { page, pageIndex: i, clip };
    }
    const found = page.clips?.find((c) => c.id === blockId);
    if (found) return { page, pageIndex: i, clip: found };
  }
  return null;
}

function isNearWhiteNeutral(color: string): boolean {
  const s = color.trim().toLowerCase();
  if (s === "white") return true;
  const hex = parseHexColor(s);
  if (hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return Math.min(r, g, b) >= 210 && Math.max(r, g, b) - Math.min(r, g, b) <= 35;
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/.exec(s);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    return Math.min(r, g, b) >= 210 && Math.max(r, g, b) - Math.min(r, g, b) <= 35;
  }
  return false;
}

/**
 * Converts accidental near-white neutral ink (`#ffffff`, etc.) to canonical
 * black (`#1a1a1a`) inside a dedicated Handwrite Here block page ONLY.
 * Plain notebook pages are never touched.
 *
 * Canonical black renders as black in Light mode and automatically inverts to
 * crisp white in Dark mode (both in previews and in the active Dark editor).
 */
export function normalizeBlockWhiteInkToBlack(page: Page): number {
  if (!isBlockPage(page)) return 0;
  let changed = 0;
  for (const stroke of page.strokes) {
    if (stroke.tool === "highlighter" || stroke.onSticky) continue;
    if (isNearWhiteNeutral(stroke.color)) {
      stroke.color = "#1a1a1a";
      changed++;
    }
  }
  for (const box of page.textBoxes) {
    if (box.onSticky || box.onShape) continue;
    if (isNearWhiteNeutral(box.color)) {
      box.color = "#1a1a1a";
      changed++;
    }
  }
  for (const eq of page.equations ?? []) {
    if (isNearWhiteNeutral(eq.color)) {
      eq.color = "#1a1a1a";
      changed++;
    }
  }
  return changed;
}
