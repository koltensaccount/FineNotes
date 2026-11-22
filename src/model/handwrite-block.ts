import {
  type Bounds,
  type InkDocument,
  type NotebookClip,
  type Page,
  blankPage,
  clipCurrentBounds,
  strokeBounds,
} from "./document";

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
