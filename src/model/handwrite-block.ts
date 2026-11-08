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

/**
 * Checks if a page is a dedicated Handwrite Here block page.
 */
export function isBlockPage(page: Page): boolean {
  return (
    page.id.startsWith("block-") ||
    (page.clips?.length === 1 && page.clips[0].id.startsWith("block-"))
  );
}

/**
 * Calculates the bounding box of all content on a page.
 */
export function contentBoundsOnPage(page: Page): Bounds | null {
  const boxes: Bounds[] = [];
  for (const s of page.strokes) {
    const b = strokeBounds(s);
    if (b) boxes.push(b);
  }
  for (const el of [
    ...page.images,
    ...page.textBoxes,
    ...(page.circuits ?? []),
    ...(page.equations ?? []),
  ]) {
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

/**
 * Creates a new dedicated block page and associated NotebookClip in the backing notebook.
 * This guarantees the block can expand indefinitely downwards without colliding with any other block.
 */
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

/**
 * Smoothly expands a block page's vertical geometry when content is written near the bottom.
 * Returns true if the page geometry was enlarged.
 */
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
 * Resolves the dynamic rendering/cropping bounds for a block.
 * For dedicated block pages, returns the bounds enclosing all content (or minimum block size).
 * For legacy multi-clip pages, preserves exact legacy clipCurrentBounds.
 */
export function resolveBlockBounds(page: Page, clip: NotebookClip): Bounds {
  if (!isBlockPage(page)) {
    return clipCurrentBounds(page, clip);
  }
  const content = contentBoundsOnPage(page);
  const minX = clip.bounds.minX;
  const maxX = clip.bounds.maxX;
  const minY = clip.bounds.minY;
  const baseHeight = Math.max(
    INITIAL_BLOCK_HEIGHT - BLOCK_PADDING * 2,
    clip.bounds.maxY - clip.bounds.minY,
  );
  if (!content) {
    return {
      minX,
      minY,
      maxX,
      maxY: minY + baseHeight,
    };
  }
  const targetBottom = Math.max(minY + baseHeight, content.maxY + 24);
  return {
    minX,
    minY,
    maxX,
    maxY: Math.min(page.geometry.height, targetBottom),
  };
}

/**
 * Finds a block or clip across all pages of a document.
 */
export function findBlockInDocument(
  doc: InkDocument,
  blockId: string,
): { page: Page; pageIndex: number; clip: NotebookClip } | null {
  const cleanId = blockId.replace(/^[\^#]/, "").replace(/^block=/, "").replace(/^clip=/, "").trim();
  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    if (page.id === cleanId || page.id === `block-${cleanId}`) {
      const clip = page.clips?.[0] ?? {
        id: page.id,
        pageId: page.id,
        bounds: {
          minX: BLOCK_PADDING,
          minY: BLOCK_PADDING,
          maxX: page.geometry.width - BLOCK_PADDING,
          maxY: page.geometry.height - BLOCK_PADDING,
        },
        isExpandable: true,
        originY: BLOCK_PADDING,
        createdAt: 0,
        updatedAt: 0,
      };
      return { page, pageIndex: i, clip };
    }
    if (page.clips) {
      const clip = page.clips.find(
        (c) =>
          c.id === cleanId ||
          c.id === `clip-${cleanId}` ||
          c.id === `block-${cleanId}`,
      );
      if (clip) return { page, pageIndex: i, clip };
    }
  }
  return null;
}
