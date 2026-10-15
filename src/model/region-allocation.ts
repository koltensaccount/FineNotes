import {
  type Bounds,
  type InkDocument,
  type NotebookClip,
  type Page,
  clipCurrentBounds,
  strokeBounds,
} from "./document";
import { type Command, AddPage } from "./commands";
import { pageToInsertAfter } from "./page-commands";

export function pageContentBottom(page: Page): number | null {
  const bottoms = page.strokes.flatMap((stroke) => {
    const b = strokeBounds(stroke);
    return b ? [b.maxY] : [];
  });
  bottoms.push(...page.images.map((image) => image.y + image.h));
  bottoms.push(...page.textBoxes.map((box) => box.y + (box.h ?? 100)));
  bottoms.push(...(page.circuits ?? []).map((circuit) => circuit.y + circuit.h));
  bottoms.push(...(page.clips ?? []).map((clip) => clipCurrentBounds(page, clip).maxY));
  return bottoms.length ? bottoms.reduce((a, b) => Math.max(a, b), -Infinity) : null;
}

/** Empty means no content anywhere in this expandable section, including crossing strokes. */
export function handwritingRegionEmpty(page: Page, clip: NotebookClip): boolean {
  if (!clip.isExpandable || typeof clip.originY !== "number") return false;
  const start = clip.originY - 20;
  const end = Math.min(
    ...(page.clips ?? [])
      .filter(
        (other) =>
          other !== clip &&
          other.isExpandable &&
          typeof other.originY === "number" &&
          other.originY > clip.originY!,
      )
      .map((other) => other.originY! - 20),
  );
  const occupied = (min: number, max: number) => min < end && max >= start;
  return (
    !page.strokes.some((stroke) => {
      const box = strokeBounds(stroke);
      return box && occupied(box.minY, box.maxY);
    }) &&
    ![...page.images, ...page.textBoxes, ...(page.circuits ?? [])].some((element) =>
      occupied(element.y, element.y + (element.h ?? 100)),
    )
  );
}

export interface RegionAllocation {
  page: Page;
  pageIndex: number;
  newPage: boolean;
  reusableClip?: NotebookClip;
  bounds: Bounds;
}

/** Pure placement plan. Reserve existing clips even before they contain ink. */
export function allocateHandwritingRegion(
  doc: InkDocument,
  preferredPage = doc.pages.length - 1,
  referencedImages?: ReadonlySet<string>,
): RegionAllocation {
  if (referencedImages) {
    for (const [pageIndex, page] of doc.pages.entries()) {
      const clip = page.clips
        ?.filter(
          (clip) =>
            clip.imagePath &&
            !referencedImages.has(clip.imagePath) &&
            handwritingRegionEmpty(page, clip),
        )
        .sort((a, b) => a.bounds.minY - b.bounds.minY)[0];
      if (clip)
        return { page, pageIndex, bounds: { ...clip.bounds }, newPage: false, reusableClip: clip };
    }
  }
  let pageIndex = doc.pages[preferredPage] ? preferredPage : doc.pages.length - 1;
  let page = doc.pages[pageIndex];
  if (!page) throw new Error("The notebook has no pages.");
  const bottom = pageContentBottom(page);
  let startY = bottom === null ? 60 : bottom + 40;
  let newPage = false;
  if (page.geometry.height - startY < 280) {
    const insert = pageToInsertAfter(doc, doc.pages.length - 1);
    if (!insert) throw new Error("Cannot add a notebook page.");
    page = insert.page;
    pageIndex = doc.pages.length;
    newPage = true;
    startY = 60;
  }
  if (page.geometry.height - startY < 240 || page.geometry.width <= 80)
    throw new Error("This paper size is too small for a handwriting region.");
  return {
    page,
    pageIndex,
    newPage,
    bounds: { minX: 40, minY: startY, maxX: page.geometry.width - 40, maxY: startY + 240 },
  };
}

/** Page and clip travel together through the notebook's existing undo stack. */
export class AddHandwritingRegion implements Command {
  readonly label = "Add handwriting region";
  readonly pageId: string;
  private readonly addPage: AddPage | null;
  constructor(
    readonly allocation: RegionAllocation,
    readonly clip: NotebookClip,
  ) {
    this.pageId = allocation.page.id;
    this.addPage = allocation.newPage ? new AddPage(allocation.pageIndex, allocation.page) : null;
  }
  apply(doc: InkDocument): void {
    this.addPage?.apply(doc);
    const page = doc.pages.find((page) => page.id === this.pageId);
    if (page && !page.clips?.includes(this.clip)) (page.clips ??= []).push(this.clip);
  }
  invert(doc: InkDocument): void {
    const page = doc.pages.find((page) => page.id === this.pageId);
    if (page?.clips) page.clips = page.clips.filter((clip) => clip !== this.clip);
    this.addPage?.invert(doc);
  }
}
