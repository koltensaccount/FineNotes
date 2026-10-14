import type { PageGeometry } from "./document";

export interface SlideLayout {
  widthPercent: number;
  paperGeometry?: PageGeometry;
  backdrop?: import("./document").SyntheticBackdrop;
  /** Blank space height as a percentage of the slide's displayed height. */
  notesPercent: number;
}
export const DEFAULT_SLIDE_LAYOUT: SlideLayout = { widthPercent: 94, notesPercent: 100 };

/** Keep slide width large; grow the page for notes instead of shrinking the slide. */
export function slidePlacement(source: PageGeometry, pageWidth: number, options: SlideLayout) {
  const width = Math.max(1, options.paperGeometry?.width ?? pageWidth);
  let w = width * Math.max(0.5, Math.min(1, options.widthPercent / 100));
  let h = w * source.height / Math.max(1, source.width);
  const margin = width * 0.03;
  if (options.paperGeometry) {
    h = Math.min(h, (options.paperGeometry.height - 2 * margin) / (1 + Math.max(.25, Math.min(3, options.notesPercent / 100))));
    w = h * source.width / Math.max(1,source.height);
  }
  const notes = h * Math.max(0.25, Math.min(3, options.notesPercent / 100));
  return { geometry: { width, height: options.paperGeometry?.height ?? margin + h + notes + margin }, image: { x: (width-w)/2, y: margin, w, h } };
}
