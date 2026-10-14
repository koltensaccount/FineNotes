import type { PageGeometry } from "./document";

export interface SlideLayout {
  widthPercent: number;
  /** Blank space height as a percentage of the slide's displayed height. */
  notesPercent: number;
}
export const DEFAULT_SLIDE_LAYOUT: SlideLayout = { widthPercent: 94, notesPercent: 100 };

/** Keep slide width large; grow the page for notes instead of shrinking the slide. */
export function slidePlacement(source: PageGeometry, pageWidth: number, options: SlideLayout) {
  const width = Math.max(1, pageWidth);
  const w = width * Math.max(0.5, Math.min(1, options.widthPercent / 100));
  const h = w * source.height / Math.max(1, source.width);
  const margin = width * 0.03;
  const notes = h * Math.max(0.25, Math.min(3, options.notesPercent / 100));
  return { geometry: { width, height: margin + h + notes + margin }, image: { x: (width-w)/2, y: margin, w, h } };
}
