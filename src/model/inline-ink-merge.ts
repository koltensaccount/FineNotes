import type { InkDocument, Page, Stroke } from "./document";
import { BLOCK_PADDING } from "./handwrite-block";

export function dedicatedInkPage(doc: InkDocument, id: string): Page {
  const pages = doc.pages.filter((page) => page.id === id);
  const page = pages[0];
  if (
    !id.startsWith("block-") ||
    pages.length !== 1 ||
    page.clips?.length !== 1 ||
    page.clips[0].id !== id ||
    page.clips[0].pageId !== id ||
    doc.pages.some((other) => other !== page && other.clips?.some((clip) => clip.id === id))
  ) {
    throw new Error("The handwriting block was removed or its identity changed.");
  }
  return page;
}

function strokesById(strokes: Stroke[]): Map<string, Stroke> {
  const indexed = new Map(strokes.map((stroke) => [stroke.id, stroke]));
  if (indexed.size !== strokes.length) {
    throw new Error("The handwriting block contains duplicate stroke IDs.");
  }
  return indexed;
}

function sameStroke(a?: Stroke, b?: Stroke): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Merge local inline handwriting, shapes, text boxes, and images with latest on-disk block page. */
export function mergeInlineInk(base: Page, local: Page, latest: Page): void {
  if (latest.geometry.width !== base.geometry.width) {
    throw new Error("The handwriting block was resized elsewhere.");
  }

  const before = strokesById(base.strokes);
  const after = strokesById(local.strokes);
  const disk = strokesById(latest.strokes);
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const original = before.get(id);
    const edited = after.get(id);
    const current = disk.get(id);
    if (sameStroke(original, edited) || sameStroke(current, edited)) continue;
    if (!sameStroke(original, current))
      throw new Error("The same handwriting was changed elsewhere.");
    if (edited) disk.set(id, edited);
    else disk.delete(id);
  }

  const sameOrder =
    latest.strokes.length === base.strokes.length &&
    latest.strokes.every((stroke, index) => sameStroke(stroke, base.strokes[index]));
  latest.strokes = sameOrder ? local.strokes : [...disk.values()];

  if (JSON.stringify(local.textBoxes) !== JSON.stringify(base.textBoxes)) {
    latest.textBoxes = local.textBoxes;
  }
  if (JSON.stringify(local.images) !== JSON.stringify(base.images)) {
    latest.images = local.images;
  }
  if (local.epoch !== base.epoch) {
    latest.epoch = local.epoch;
  }
  const baseGuides = JSON.stringify(base.clips?.[0]?.writingGuides);
  const localGuides = JSON.stringify(local.clips?.[0]?.writingGuides);
  if (localGuides !== baseGuides && latest.clips?.[0]) {
    latest.clips[0].writingGuides = local.clips?.[0]?.writingGuides;
    latest.clips[0].updatedAt = Date.now();
  }
  if (local.geometry.height !== base.geometry.height) {
    if (latest.geometry.height === base.geometry.height) {
      latest.geometry.height = local.geometry.height;
    } else if (local.geometry.height > latest.geometry.height) {
      latest.geometry.height = local.geometry.height;
    }
    const clip = latest.clips?.[0];
    if (clip) {
      clip.bounds.maxY = Math.max(BLOCK_PADDING, latest.geometry.height - BLOCK_PADDING);
      clip.updatedAt = Date.now();
    }
  }
}
