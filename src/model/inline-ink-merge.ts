import type { InkDocument, Page, Stroke } from "./document";
import { storedStrokeKey } from "./serialize";
import { BLOCK_PADDING } from "./handwrite-block";

export function dedicatedInkPage(doc: InkDocument, id: string): Page {
  const pages = doc.pages.filter((page) => page.id === id);
  const page = pages[0];
  if (!id.startsWith("block-") || pages.length !== 1 || page.clips?.length !== 1 ||
      page.clips[0].id !== id || page.clips[0].pageId !== id ||
      doc.pages.some((other) => other !== page && other.clips?.some((clip) => clip.id === id))) {
    throw new Error("The handwriting block was removed or its identity changed.");
  }
  return page;
}

function strokesById(strokes: Stroke[]): Map<string, Stroke> {
  const indexed = new Map(strokes.map((stroke) => [stroke.id, stroke]));
  if (indexed.size !== strokes.length) throw new Error("The handwriting block contains duplicate stroke IDs.");
  return indexed;
}

function sameStroke(a?: Stroke, b?: Stroke): boolean {
  return a === b || (a !== undefined && b !== undefined && storedStrokeKey(a) === storedStrokeKey(b));
}

function otherPageData({ strokes, images, epoch, geometry, clips, ...page }: Page): string {
  const { height, ...dimensions } = geometry;
  return JSON.stringify({
    page, dimensions,
    clips: clips?.map(({ bounds, updatedAt, writingGuides, ...clip }) => {
      const { maxY, ...edges } = bounds;
      return { ...clip, bounds: edges };
    }),
  });
}

/** Merge local handwriting and pictures with the latest version of the block. */
export function mergeInlineInk(base: Page, local: Page, latest: Page): void {
  if (otherPageData(local) !== otherPageData(base)) {
    throw new Error("The inline editor changed unsupported page content.");
  }
  if (latest.geometry.width !== base.geometry.width || latest.geometry.height < base.geometry.height) {
    throw new Error("The handwriting block was resized elsewhere.");
  }

  const guideKey = (page: Page): string | undefined => JSON.stringify(page.clips?.[0]?.writingGuides);
  const guideChanged = guideKey(base) !== guideKey(local);
  if (guideChanged && guideKey(base) !== guideKey(latest) && guideKey(local) !== guideKey(latest)) {
    throw new Error("The writing guides were changed elsewhere.");
  }

  const imageKey = (images: Page["images"]) => JSON.stringify(images);
  const imagesChanged = imageKey(local.images) !== imageKey(base.images);
  if (imagesChanged && imageKey(latest.images) !== imageKey(base.images) &&
      imageKey(latest.images) !== imageKey(local.images)) {
    throw new Error("The handwriting block's pictures changed elsewhere.");
  }

  const before = strokesById(base.strokes);
  const after = strokesById(local.strokes);
  const disk = strokesById(latest.strokes);
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const original = before.get(id);
    const edited = after.get(id);
    const current = disk.get(id);
    if (sameStroke(original, edited) || sameStroke(current, edited)) continue;
    if (!sameStroke(original, current)) throw new Error("The same handwriting was changed elsewhere.");
    if (edited) disk.set(id, edited);
    else disk.delete(id);
  }

  if (local.epoch !== base.epoch) {
    if (latest.epoch !== base.epoch && latest.epoch !== local.epoch) {
      throw new Error("The handwriting timeline changed elsewhere.");
    }
    latest.epoch = local.epoch;
  } else if (latest.epoch !== base.epoch && local.strokes.some((s) => !sameStroke(s, before.get(s.id)))) {
    throw new Error("The handwriting timeline changed elsewhere.");
  }
  const sameOrder = latest.strokes.length === base.strokes.length &&
    latest.strokes.every((stroke, index) => sameStroke(stroke, base.strokes[index]));
  latest.strokes = sameOrder ? local.strokes : [...disk.values()];
  if (imagesChanged) latest.images = local.images;

  if (guideChanged) {
    const clip = latest.clips![0];
    clip.writingGuides = local.clips![0].writingGuides;
    clip.updatedAt = Date.now();
  }

  if (local.geometry.height > base.geometry.height && local.geometry.height > latest.geometry.height) {
    latest.geometry.height = local.geometry.height;
    const clip = latest.clips![0];
    clip.bounds.maxY = Math.max(clip.bounds.maxY, local.geometry.height - BLOCK_PADDING);
    clip.updatedAt = Date.now();
  }
}
